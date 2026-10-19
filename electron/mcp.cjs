const { spawn } = require("node:child_process");

const PROTOCOL_VERSION = "2024-11-05";
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const LONG_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_STDERR_LINES = 20;

/**
 * Minimal MCP stdio client for `rea --mcp`.
 *
 * One long-lived server process keeps the analysed binary bound, so repeated
 * queries reuse the provider session instead of re-importing the artifact
 * (the CLI restarts analysis on every command).
 */
class McpClient {
  constructor() {
    this.child = null;
    this.pending = new Map();
    this.nextId = 1;
    this.buffer = "";
    this.stderrTail = [];
    this.startPromise = null;
    this.ready = false;
    this.server = null;
  }

  get running() {
    return Boolean(this.child && this.child.exitCode === null);
  }

  get diagnostics() {
    return { running: this.running, ready: this.ready, server: this.server, stderr: this.stderrTail.slice(-8) };
  }

  /** Spawn the server and complete the MCP handshake. Idempotent. */
  start({ exe, args, cwd, env }) {
    if (this.startPromise) return this.startPromise;
    this.startPromise = (async () => {
      const child = spawn(exe, args, { cwd, env, windowsHide: true });
      this.child = child;
      this.buffer = "";
      this.stderrTail = [];

      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => this.onStdout(chunk));
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => this.onStderr(chunk));
      child.on("error", (error) => this.failAll(error));
      child.on("exit", (code) => {
        this.ready = false;
        this.failAll(new Error(`MCP server exited (code ${code === null ? "?" : code})`));
      });

      const init = await this.request(
        "initialize",
        {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "rea-viewer", version: "0.1.0" },
        },
        60_000,
      );
      if (init.error) throw new Error(`initialize failed: ${init.error.message ?? "unknown"}`);
      this.notify("notifications/initialized", {});
      this.ready = true;
      this.server = init.result?.serverInfo ?? null;
      return init.result;
    })();
    return this.startPromise;
  }

  onStdout(chunk) {
    this.buffer += chunk;
    let index;
    while ((index = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        // Servers sometimes log to stdout; ignore anything that is not JSON-RPC.
        continue;
      }
      if (message.id !== undefined && this.pending.has(message.id)) {
        const entry = this.pending.get(message.id);
        this.pending.delete(message.id);
        clearTimeout(entry.timer);
        entry.resolve(message);
      }
    }
  }

  onStderr(chunk) {
    for (const line of chunk.split(/\r?\n/)) {
      const text = line.trim();
      if (!text) continue;
      this.stderrTail.push(text.slice(0, 400));
      if (this.stderrTail.length > MAX_STDERR_LINES) this.stderrTail.shift();
    }
  }

  request(method, params, timeoutMs = DEFAULT_TIMEOUT_MS) {
    if (!this.child) return Promise.reject(new Error("MCP server is not running"));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out after ${Math.round(timeoutMs / 1000)}s`));
      }, timeoutMs);
      this.pending.set(id, { resolve, timer });
      try {
        this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  notify(method, params) {
    if (!this.child) return;
    try {
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
    } catch {
      // A dead child is reported by the exit handler.
    }
  }

  /** Call one tool and return its parsed JSON payload. */
  async callTool(name, args, timeoutMs = DEFAULT_TIMEOUT_MS) {
    const response = await this.request("tools/call", { name, arguments: args ?? {} }, timeoutMs);
    if (response.error) throw new Error(`${name}: ${response.error.message ?? "tool call failed"}`);
    const result = response.result ?? {};
    const text = (Array.isArray(result.content) ? result.content : [])
      .filter((item) => item && item.type === "text")
      .map((item) => item.text)
      .join("");
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { raw: text };
    }
    if (result.isError) {
      const message = parsed?.error?.message ?? parsed?.error ?? text.slice(0, 400);
      throw new Error(`${name}: ${String(message)}`);
    }
    return parsed;
  }

  failAll(error) {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      this.pending.delete(id);
      entry.resolve({ jsonrpc: "2.0", id, error: { code: -1, message: String(error?.message ?? error) } });
    }
  }

  async close() {
    const child = this.child;
    this.ready = false;
    this.startPromise = null;
    this.child = null;
    if (child && child.exitCode === null) {
      try {
        child.stdin.end();
      } catch {
        // ignore
      }
      child.kill();
    }
    this.failAll(new Error("MCP server closed"));
  }
}

module.exports = { McpClient, DEFAULT_TIMEOUT_MS, LONG_TIMEOUT_MS };
