import { useEffect, useRef, useState } from "react";
import { normalize, parseJsonLoose } from "../lib/normalize";
import type { NormGraph } from "../lib/types";

type Props = {
  settings: ReaSettings | null;
  onSettingsChange: (patch: Partial<ReaSettings>) => void;
  onData: (graph: NormGraph, rawText: string, source: string) => void;
  onError: (message: string) => void;
};

type Mode = "run" | "file" | "paste";

const PRESETS: { label: string; args: string }[] = [
  { label: "环境自检 providers", args: "providers" },
  { label: "JS/Electron 应用分析", args: "analyze-javascript-application <应用目录>" },
  { label: "产物清单 inspect-artifact", args: "inspect-artifact <文件或目录>" },
  { label: "托管应用图 (需证据)", args: "project-managed-application-graph <参数>" },
  { label: "引用查询 xrefs", args: "xrefs <地址>" },
  { label: "功能追踪 trace", args: "trace <关键字>" },
];

function uid() {
  return `run_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

export function SourcePanel({ settings, onSettingsChange, onData, onError }: Props) {
  const [mode, setMode] = useState<Mode>("run");
  const [args, setArgs] = useState("");
  const [paste, setPaste] = useState("");
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const runIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (settings && !args) setArgs(settings.lastArgs ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  useEffect(() => {
    return window.rea.onOutput((event) => {
      if (event.runId !== runIdRef.current) return;
      setLog((prev) => (prev + event.text).slice(-8000));
    });
  }, []);

  async function handleRun() {
    const trimmed = args.trim();
    if (!trimmed) {
      onError("请填写 REA 命令参数");
      return;
    }
    const runId = uid();
    runIdRef.current = runId;
    setRunning(true);
    setLog("");
    setStatus("执行中…");
    onSettingsChange({ lastArgs: trimmed });
    try {
      const result = await window.rea.run({ runId, argsString: trimmed, settings: settings ?? undefined });
      const command = `${result.exe ?? "rea"} ${(result.args ?? []).join(" ")}`;
      let graph: NormGraph | null = null;
      try {
        graph = normalize(parseJsonLoose(result.stdout));
      } catch {
        graph = null;
      }
      if (graph && graph.nodes.length > 0) {
        onData(graph, result.stdout, `$ ${command}`);
        if (result.code === 0) {
          setStatus(`完成 (${graph.formatLabel})`);
        } else {
          setStatus(`退出码 ${result.code ?? "?"}，已展示部分结果`);
          onError(
            `REA 退出码 ${result.code ?? "?"}，但仍返回了可可视化的部分结果（已加载）。\n$ ${command}\n${(result.stderr || "").slice(-600)}`,
          );
        }
      } else if (result.code === 0) {
        onError("命令成功但输出无法解析为受支持的 JSON。");
        setStatus("解析失败");
        setLog(result.stdout.slice(-4000));
      } else {
        onError(`命令退出码 ${result.code ?? "?"}\n$ ${command}`);
        setStatus(`失败 (exit ${result.code ?? "?"})`);
        setLog(`${result.stderr}\n${result.stdout}`.slice(-4000));
      }

    } catch (error) {
      onError(String(error));
      setStatus("执行异常");
    } finally {
      setRunning(false);
    }
  }

  async function handleCancel() {
    if (runIdRef.current) await window.rea.cancel(runIdRef.current);
    setRunning(false);
    setStatus("已取消");
  }

  async function handlePickFile() {
    const result = await window.rea.pickFile();
    if (!result) return;
    if (result.error) {
      onError(result.error);
      return;
    }
    loadFromText(result.content, `文件: ${result.path}`);
  }

  function loadFromText(text: string, source: string) {
    try {
      const graph = normalize(parseJsonLoose(text));
      onData(graph, text, source);
      setStatus(`已载入 (${graph.formatLabel})`);
    } catch (error) {
      onError(`无法解析 JSON：${String(error)}`);
    }
  }

  return (
    <div className="panel-section">
      <div className="tabs">
        <button className={mode === "run" ? "tab active" : "tab"} onClick={() => setMode("run")}>
          运行命令
        </button>
        <button className={mode === "file" ? "tab active" : "tab"} onClick={() => setMode("file")}>
          加载文件
        </button>
        <button className={mode === "paste" ? "tab active" : "tab"} onClick={() => setMode("paste")}>
          粘贴 JSON
        </button>
      </div>

      {mode === "run" && (
        <div className="stack">
          <div className="presets">
            {PRESETS.map((preset) => (
              <button key={preset.label} className="chip" onClick={() => setArgs(preset.args)}>
                {preset.label}
              </button>
            ))}
          </div>
          <label className="field">
            <span>命令参数</span>
            <input
              className="input"
              value={args}
              placeholder="例如: analyze-javascript-application D:/apps/example"
              onChange={(event) => setArgs(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !running) void handleRun();
              }}
            />
          </label>
          <div className="row">
            <button className="btn primary" disabled={running} onClick={() => void handleRun()}>
              {running ? "执行中…" : "运行 REA"}
            </button>
            {running && (
              <button className="btn" onClick={() => void handleCancel()}>
                取消
              </button>
            )}
            {status && <span className="muted">{status}</span>}
          </div>
          <p className="hint">命令会自动追加 `--format json`。输出中的 stdout/stderr 见下方日志。</p>
        </div>
      )}

      {mode === "file" && (
        <div className="stack">
          <button className="btn primary" onClick={() => void handlePickFile()}>
            选择 REA JSON 文件…
          </button>
          <p className="hint">
            支持 REA 的 `--format json` 输出，或任何 Evidence/图 JSON（应用关系图、产物清单、调用路径）。
          </p>
        </div>
      )}

      {mode === "paste" && (
        <div className="stack">
          <textarea
            className="textarea"
            value={paste}
            placeholder="粘贴 REA JSON 输出…"
            onChange={(event) => setPaste(event.target.value)}
          />
          <button className="btn primary" onClick={() => loadFromText(paste, "粘贴的 JSON")}>
            解析并加载
          </button>
        </div>
      )}

      <details className="advanced">
        <summary>高级：REA 启动配置</summary>
        <div className="stack">
          <label className="field">
            <span>node 可执行文件</span>
            <input
              className="input"
              value={settings?.nodePath ?? ""}
              onChange={(event) => onSettingsChange({ nodePath: event.target.value })}
            />
          </label>
          <label className="field">
            <span>rea.mjs 脚本路径（留空则用下面的可执行文件）</span>
            <input
              className="input"
              value={settings?.scriptPath ?? ""}
              onChange={(event) => onSettingsChange({ scriptPath: event.target.value })}
            />
          </label>
          <label className="field">
            <span>rea 可执行文件（脚本路径为空时使用）</span>
            <input
              className="input"
              value={settings?.binPath ?? ""}
              onChange={(event) => onSettingsChange({ binPath: event.target.value })}
            />
          </label>
          <label className="field">
            <span>工作目录</span>
            <input
              className="input"
              value={settings?.workdir ?? ""}
              onChange={(event) => onSettingsChange({ workdir: event.target.value })}
            />
          </label>
        </div>
      </details>

      {log && <pre className="log">{log}</pre>}
    </div>
  );
}
