const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { spawn } = require("node:child_process");
const { suggestIgnoreGlobs, ENV_KEYS, DEFAULT_MODEL, DEFAULT_BASE_URL } = require("./ai.cjs");
const { loadEnvFiles } = require("./env.cjs");
const { collectRelevantSourcePaths } = require("./sources.cjs");

const isDev = Boolean(process.env.REA_DEV_SERVER_URL);

/** Known-good defaults for this machine's REA installation (overridable in the UI). */
const DEFAULT_SETTINGS = {
  // When scriptPath is set the CLI runs as: <nodePath> <scriptPath> <args>
  nodePath: "C:\\Users\\USER\\.workbuddy\\binaries\\node\\versions\\22.22.2-6\\node.exe",
  scriptPath:
    "C:\\Users\\USER\\.workbuddy\\binaries\\node\\versions\\22.22.2-6\\node_modules\\rea-agents\\scripts\\rea.mjs",
  // Fallback executable when scriptPath is empty (e.g. a global `rea` install).
  binPath: "rea",
  workdir: process.cwd(),
  // Optional TEMP/TMP override for the child process. REA's Windows native
  // self-test creates a protected-DACL probe in the process temp dir, so
  // pointing it at a known-good writable local NTFS directory avoids the
  // "private object requires a present protected DACL" access-denied failure.
  tempDir: "",
  // Glob patterns for nodes to hide in the viewer (one per line / comma separated).
  // REA itself has no exclude option, so filtering happens at display time.
  ignoreGlobs: ["**/node_modules", "**/.git", "**/.electron-cache"].join("\n"),
  // When on, the pipeline passes --source-path for every file that survives the
  // ignore rules, so REA skips reading/parsing the ignored ones (REA has no
  // exclude flag of its own).
  limitSources: true,
  // Runtime observation is endpoint/target scoped, not directory scoped.
  // One endpoint is remembered per channel so switching never loses it.
  runtimeChannel: "inspector",
  endpointInspector: "http://127.0.0.1:9229",
  endpointElectron: "http://127.0.0.1:9222",
  endpointBrowser: "http://127.0.0.1:9223",
  fridaMode: "attach",
  fridaTarget: "",
  fridaScript: "",
  observationMs: 2000,
  lastArgs: "providers",
};

function settingsFile() {
  return path.join(app.getPath("userData"), "rea-viewer-settings.json");
}

function loadSettings() {
  try {
    const raw = fs.readFileSync(settingsFile(), "utf8");
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(next) {
  const merged = { ...loadSettings(), ...next };
  try {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify(merged, null, 2), "utf8");
  } catch (error) {
    // Persisting settings is best-effort; a read-only profile must not crash the app.
    console.error("Failed to persist settings:", error);
  }
  return merged;
}

/** Split a command line into argv, honouring single/double quotes. */
function tokenize(input) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match;
  while ((match = re.exec(input)) !== null) {
    out.push(match[1] ?? match[2] ?? match[3]);
  }
  return out;
}

/** Resolve the CLI invocation for the current settings. */
function resolveCommand(argsString, settings) {
  const argv = tokenize(argsString ?? "");
  const hasFormat = argv.some((a) => a === "--format" || a.startsWith("--format="));
  const finalArgs = hasFormat ? argv : [...argv, "--format", "json"];
  if (settings.scriptPath) {
    const node = settings.nodePath && settings.nodePath.trim() ? settings.nodePath : process.execPath;
    return { exe: node, args: [settings.scriptPath, ...finalArgs] };
  }
  return { exe: settings.binPath && settings.binPath.trim() ? settings.binPath : "rea", args: finalArgs };
}

const running = new Map();

/** .env files already loaded, shown in the UI so the key source is obvious. */
let envSources = [];

/**
 * Load DEEPSEEK_* from .env files. Real environment variables always win,
 * so a shell export overrides the file. Candidates are checked in order.
 */
function bootstrapEnv() {
  try {
    envSources = loadEnvFiles([
      path.join(app.getAppPath(), ".env"),
      path.join(process.cwd(), ".env"),
      path.join(app.getPath("userData"), ".env"),
    ]);
  } catch (error) {
    console.error("Failed to load .env files:", error);
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#12141a",
    title: "REA Viewer",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (isDev) {
    win.loadURL(process.env.REA_DEV_SERVER_URL);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

ipcMain.handle("rea:get-settings", () => loadSettings());

ipcMain.handle("rea:save-settings", (_event, next) => saveSettings(next));

ipcMain.handle("rea:run", (event, payload) => {
  const { runId, argsString, settings } = payload ?? {};
  const effective = { ...loadSettings(), ...(settings ?? {}) };
  const { exe, args } = resolveCommand(argsString, effective);
  const cwd = effective.workdir && effective.workdir.trim() ? effective.workdir : os.homedir();
  const env = { ...process.env };
  if (effective.tempDir && effective.tempDir.trim()) {
    env.TEMP = effective.tempDir;
    env.TMP = effective.tempDir;
  }

  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(exe, args, { cwd, env, windowsHide: true });
    } catch (error) {
      resolve({ code: null, stdout: "", stderr: String(error), error: String(error), exe, args, cwd });
      return;
    }
    running.set(runId, child);

    let stdout = "";
    let stderr = "";
    const send = (stream, text) => {
      if (!event.sender.isDestroyed()) event.sender.send("rea:output", { runId, stream, text });
    };

    child.stdout?.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      send("stdout", text);
    });
    child.stderr?.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      send("stderr", text);
    });
    child.on("error", (error) => {
      stderr += `\n${String(error)}`;
      send("stderr", String(error));
    });
    child.on("close", (code) => {
      running.delete(runId);
      resolve({ code, stdout, stderr, exe, args, cwd });
    });
  });
});

ipcMain.handle("rea:cancel", (_event, runId) => {
  const child = running.get(runId);
  if (!child) return false;
  try {
    child.kill();
  } catch {
    /* ignore */
  }
  running.delete(runId);
  return true;
});

ipcMain.handle("rea:pick-file", async () => {
  const result = await dialog.showOpenDialog({
    title: "选择 REA JSON 输出文件",
    properties: ["openFile"],
    filters: [
      { name: "JSON", extensions: ["json", "jsonl"] },
      { name: "All Files", extensions: ["*"] },
    ],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return readJsonFile(result.filePaths[0]);
});

ipcMain.handle("rea:read-file", (_event, filePath) => readJsonFile(filePath));

ipcMain.handle("rea:collect-source-paths", async (_event, payload) => {
  try {
    const result = await collectRelevantSourcePaths(String(payload?.dir ?? ""));
    return { ok: true, ...result };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle("ai:pick-directory", async () => {
  const result = await dialog.showOpenDialog({
    title: "选择要分析的目录",
    properties: ["openDirectory"],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle("ai:suggest-ignores", async (_event, payload) => {
  try {
    const result = await suggestIgnoreGlobs({ dir: payload?.dir });
    return { ok: true, ...result };
  } catch (error) {
    // Surface a readable message; never leak the API key.
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle("ai:status", () => {
  const keyName = ENV_KEYS.find((name) => (process.env[name] ?? "").trim());
  return {
    hasKey: Boolean(keyName),
    keyName: keyName ?? null,
    model: process.env.DEEPSEEK_MODEL || DEFAULT_MODEL,
    baseUrl: process.env.DEEPSEEK_BASE_URL || DEFAULT_BASE_URL,
    sources: envSources,
  };
});

function readJsonFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    return { path: filePath, content, error: null };
  } catch (error) {
    return { path: filePath, content: "", error: String(error) };
  }
}

app.whenReady().then(() => {
  bootstrapEnv();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  for (const child of running.values()) {
    try {
      child.kill();
    } catch {
      /* ignore */
    }
  }
  if (process.platform !== "darwin") app.quit();
});
