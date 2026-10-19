import { useEffect, useRef, useState } from "react";
import { normalize, parseJsonLoose } from "../lib/normalize";
import { makeIgnoreMatcher, parseGlobs } from "../lib/filter";
import { detectRuntime, type RuntimeReport } from "../lib/runtime";
import { RuntimePanel } from "./RuntimePanel";
import { NativePanel } from "./NativePanel";
import type { NormGraph } from "../lib/types";

type Props = {
  settings: ReaSettings | null;
  onSettingsChange: (patch: Partial<ReaSettings>) => void;
  onData: (graph: NormGraph, rawText: string, source: string) => void;
  onRuntime: (report: RuntimeReport, rawText: string, source: string) => void;
  onError: (message: string) => void;
  /** Lets the graph click handler reach the native panel's lazy expander. */
  registerExpand?: (fn: ((address: string) => Promise<void>) | null) => void;
};

type Mode = "run" | "file" | "paste";
type StepState = "pending" | "running" | "done" | "empty" | "failed" | "skipped";
type Pipeline = { ai: StepState; rea: StepState };
type Rules = {
  ignore: string[];
  reason: string;
  model: string;
  truncated: boolean;
};

const PRESETS: { label: string; args: string }[] = [
  { label: "环境自检 providers", args: "providers" },
  { label: "JS/Electron 应用分析", args: "analyze-javascript-application <应用目录>" },
  { label: "产物清单 inspect-artifact", args: "inspect-artifact <文件>" },
  { label: "托管应用图 (需证据)", args: "project-managed-application-graph <参数>" },
  { label: "引用查询 xrefs", args: "xrefs <地址>" },
  { label: "功能追踪 trace", args: "trace <关键字>" },
];

const STEP_TEXT: Record<StepState, string> = {
  pending: "待开始",
  running: "进行中",
  done: "完成",
  empty: "无需忽略",
  failed: "失败",
  skipped: "已跳过",
};

function uid() {
  return `run_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

/** REA's Windows native self-test creates a protected-DACL probe in the temp dir. */
const SELF_TEST_HINT =
  "提示：REA 的 Windows 原生自检失败（DACL/临时目录）。请确认进程 TEMP/TMP 指向可写的本地 NTFS 目录，" +
  "并避免在会拦截 AppData\\Local 的沙箱或安全软件下运行，然后重试。也可在“高级”里指定临时目录。";

function selfTestHint(text: string): string {
  return /self-test failed|protected DACL|native-probe/i.test(text) ? `\n\n${SELF_TEST_HINT}` : "";
}

/** Describe where the API key came from, for the AI status line. */
function keySourceLabel(status: ReaAiStatus): string {
  const fromFiles = status.sources
    .filter((source) => !status.keyName || source.keys.includes(status.keyName))
    .map((source) => source.path);
  if (fromFiles.length === 0) return "，来自系统环境变量";
  return `，来自 ${fromFiles.join("、")}`;
}

function Step({ status, label, detail }: { status: StepState; label: string; detail?: string }) {
  return (
    <li className={`step ${status}`}>
      <span className="step-dot" aria-hidden="true" />
      <span className="step-label">{label}</span>
      <span className="step-state">{detail ?? STEP_TEXT[status]}</span>
    </li>
  );
}

/** Windows caps a command line at ~32767 chars; stay well under it. */
const SOURCE_ARG_BUDGET = 20000;

/** Turn the ignore rules into a --source-path selection (the inverse of "ignore"). */
function buildSourceSelection(globs: string[], files: string[]) {
  const isIgnored = makeIgnoreMatcher(globs);
  const kept = files.filter((file) => !isIgnored(file));
  const tokens: string[] = [];
  let chars = 0;
  let truncated = false;
  for (const file of kept) {
    const token = `--source-path "${file}"`;
    if (chars + token.length + 1 > SOURCE_ARG_BUDGET) {
      truncated = true;
      break;
    }
    tokens.push(token);
    chars += token.length + 1;
  }
  return { args: tokens.join(" "), used: tokens.length, candidates: kept.length, truncated };
}

function Skeleton({ lines }: { lines: number }) {
  return (
    <div className="skeleton" aria-hidden="true">
      {Array.from({ length: lines }, (_, index) => (
        <span key={index} className="skeleton-bar" style={{ width: `${100 - index * 14}%` }} />
      ))}
    </div>
  );
}

export function SourcePanel({
  settings,
  onSettingsChange,
  onData,
  onRuntime,
  onError,
  registerExpand,
}: Props) {
  const [mode, setMode] = useState<Mode>("run");
  const [args, setArgs] = useState("");
  const [paste, setPaste] = useState("");
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const runIdRef = useRef<string | null>(null);
  const [aiInfo, setAiInfo] = useState<ReaAiStatus | null>(null);

  const [pipeline, setPipeline] = useState<Pipeline | null>(null);
  const [rules, setRules] = useState<Rules | null>(null);
  const [limitedSources, setLimitedSources] = useState(0);
  const [rerunBusy, setRerunBusy] = useState(false);
  const [pane, setPane] = useState<"dir" | "native" | "runtime">("dir");

  const workdir = settings?.workdir ?? "";

  useEffect(() => {
    if (settings && !args) setArgs(settings.lastArgs ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  useEffect(() => {
    window.rea
      .aiStatus()
      .then(setAiInfo)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    return window.rea.onOutput((event) => {
      if (event.runId !== runIdRef.current) return;
      setLog((prev) => (prev + event.text).slice(-8000));
    });
  }, []);

  /** Run one REA command. `deliver` decides whether the result is pushed to a view. */
  async function executeRea(
    argsString: string,
    options: { persistArgs?: string; deliver?: boolean } = {},
  ): Promise<{ ok: boolean; rejectedSourcePaths: boolean; parsed: unknown }> {
    const { persistArgs, deliver = true } = options;
    const trimmed = argsString.trim();
    if (!trimmed) {
      onError("请填写 REA 命令参数");
      return { ok: false, rejectedSourcePaths: false, parsed: null };
    }
    if (persistArgs) onSettingsChange({ lastArgs: persistArgs });
    const runId = uid();
    runIdRef.current = runId;
    setRunning(true);
    setLog("");
    setStatus("执行中…");
    let ok = false;
    let rejectedSourcePaths = false;
    let parsed: unknown = null;
    try {
      const result = await window.rea.run({ runId, argsString: trimmed, settings: settings ?? undefined });
      const command = `${result.exe ?? "rea"} ${(result.args ?? []).join(" ")}`;
      const hint = selfTestHint(`${result.stdout}\n${result.stderr}`);
      try {
        parsed = parseJsonLoose(result.stdout);
      } catch {
        parsed = null;
      }
      const runtimeReport = parsed === null ? null : detectRuntime(parsed);
      let graph: NormGraph | null = null;
      if (!runtimeReport && parsed !== null) {
        try {
          graph = normalize(parsed);
        } catch {
          graph = null;
        }
      }
      if (parsed !== null && !deliver) {
        // Discovery call: hand the payload back, push nothing to a view.
        ok = result.code === 0;
        setStatus(ok ? "完成" : `失败 (exit ${result.code ?? "?"})`);
      } else if (runtimeReport) {
        onRuntime(runtimeReport, result.stdout, `$ ${command}`);
        ok = true;
        setStatus(`完成（${runtimeReport.title}）`);
      } else if (graph && graph.nodes.length > 0) {
        onData(graph, result.stdout, `$ ${command}`);
        ok = true;
        if (result.code === 0) {
          setStatus(`完成 (${graph.formatLabel})`);
        } else {
          setStatus(`退出码 ${result.code ?? "?"}，已展示部分结果`);
          onError(
            `REA 退出码 ${result.code ?? "?"}，但仍返回了可可视化的部分结果（已加载）。\n$ ${command}\n${(result.stderr || "").slice(-600)}${hint}`,
          );
        }
      } else if (result.code === 0) {
        onError(`命令成功但输出无法解析为受支持的 JSON。${hint}`);
        setStatus("解析失败");
        setLog(result.stdout.slice(-4000));
      } else {
        rejectedSourcePaths = /source_paths|exact relevant file path/i.test(`${result.stdout}\n${result.stderr}`);
        onError(`命令退出码 ${result.code ?? "?"}\n$ ${command}${hint}`);
        setStatus(`失败 (exit ${result.code ?? "?"})`);
        setLog(`${result.stderr}\n${result.stdout}`.slice(-4000));
      }
    } catch (error) {
      onError(String(error));
      setStatus("执行异常");
    } finally {
      setRunning(false);
    }
    return { ok, rejectedSourcePaths, parsed };
  }

  async function handleCancel() {
    if (runIdRef.current) await window.rea.cancel(runIdRef.current);
    setRunning(false);
    setStatus("已取消");
  }

  /** 一键流水线：AI 生成忽略规则 -> REA 分析。 */
  async function handlePipeline() {
    const dir = workdir.trim();
    if (!dir) {
      onError("请先填写工作目录");
      return;
    }
    if (running) return;
    setRules(null);
    setLimitedSources(0);
    setLog("");
    setPipeline({ ai: "pending", rea: "pending" });

    if (aiInfo && !aiInfo.hasKey) {
      setPipeline((prev) => (prev ? { ...prev, ai: "skipped", rea: "running" } : prev));
    } else {
      setPipeline((prev) => (prev ? { ...prev, ai: "running" } : prev));
      const ai = await window.rea.aiSuggestIgnores({ dir });
      if (ai.ok && Array.isArray(ai.ignore)) {
        const proposed = ai.ignore;
        // Only overwrite the current rules when the model actually proposed some.
        if (proposed.length > 0) onSettingsChange({ ignoreGlobs: proposed.join("\n") });
        setRules({
          ignore: proposed,
          reason: ai.reason ?? "",
          model: ai.model ?? "",
          truncated: Boolean(ai.truncated),
        });
        setPipeline((prev) =>
          prev ? { ...prev, ai: proposed.length > 0 ? "done" : "empty", rea: "running" } : prev,
        );
      } else {
        setPipeline((prev) => (prev ? { ...prev, ai: "failed", rea: "running" } : prev));
        onError(`AI 生成忽略规则失败（已继续进行分析）：${ai.error ?? "未返回可用规则"}`);
      }
    }

    // REA has no exclude flag: pass --source-path for every file that survives
    // the ignore rules so REA skips reading/parsing the ignored ones.
    const effectiveGlobs = rules?.ignore.length ? rules.ignore : parseGlobs(settings?.ignoreGlobs ?? "");
    const base = `analyze-javascript-application "${dir}"`;
    let selection = "";
    if (settings?.limitSources !== false && effectiveGlobs.length > 0) {
      const collected = await window.rea.collectSourcePaths({ dir });
      if (collected.ok && collected.files && collected.files.length > 0) {
        const built = buildSourceSelection(effectiveGlobs, collected.files);
        if (built.truncated) {
          // A partial selection would silently drop files from the analysis,
          // so fall back to the complete run instead.
          onError(`需要分析的文件过多（${built.candidates} 个），未启用范围限定，本次为全量分析。`);
        } else {
          selection = built.args;
          setLimitedSources(built.used);
        }
      } else if (!collected.ok) {
        onError(`收集源文件清单失败，改为全量分析：${collected.error ?? "未知错误"}`);
      }
    }

    let outcome = await executeRea(selection ? `${base} ${selection}` : base);
    if (!outcome.ok && outcome.rejectedSourcePaths && selection) {
      // The selection must match REA's inventory exactly; fall back if it does not.
      setStatus("源文件清单被 REA 拒绝，改为全量分析…");
      setLimitedSources(0);
      outcome = await executeRea(base);
    }
    setPipeline((prev) => (prev ? { ...prev, rea: outcome.ok ? "done" : "failed" } : prev));
  }

  async function handlePickWorkdir() {
    const dir = await window.rea.aiPickDirectory();
    if (dir) onSettingsChange({ workdir: dir });
  }

  /** 只重算忽略规则（不跑 REA）。 */
  async function rerunRules() {
    const dir = workdir.trim();
    if (!dir) {
      onError("请先填写工作目录");
      return;
    }
    setRerunBusy(true);
    setStatus("AI 分析中…");
    try {
      const ai = await window.rea.aiSuggestIgnores({ dir });
      if (ai.ok && Array.isArray(ai.ignore)) {
        const proposed = ai.ignore;
        if (proposed.length > 0) onSettingsChange({ ignoreGlobs: proposed.join("\n") });
        setRules({
          ignore: proposed,
          reason: ai.reason ?? "",
          model: ai.model ?? "",
          truncated: Boolean(ai.truncated),
        });
        setStatus(proposed.length > 0 ? `已重算 ${proposed.length} 条忽略规则` : "AI 判断无需忽略，沿用当前规则");
      } else {
        onError(ai.error ?? "AI 未返回可用的忽略规则");
        setStatus("重算失败");
      }
    } catch (error) {
      onError(String(error));
      setStatus("重算异常");
    } finally {
      setRerunBusy(false);
    }
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
      const parsed = parseJsonLoose(text);
      const runtimeReport = detectRuntime(parsed);
      if (runtimeReport) {
        onRuntime(runtimeReport, text, source);
        setStatus(`已载入（${runtimeReport.title}）`);
        return;
      }
      const graph = normalize(parsed);
      onData(graph, text, source);
      setStatus(`已载入 (${graph.formatLabel})`);
    } catch (error) {
      onError(`无法解析 JSON：${String(error)}`);
    }
  }

  return (
    <div className="panel-section">
      <div className="seg">
        <button
          className={pane === "dir" ? "seg-item active" : "seg-item"}
          onClick={() => setPane("dir")}
        >
          目录（静态分析）
        </button>
        <button
          className={pane === "native" ? "seg-item active" : "seg-item"}
          onClick={() => setPane("native")}
        >
          原生 exe
        </button>
        <button
          className={pane === "runtime" ? "seg-item active" : "seg-item"}
          onClick={() => setPane("runtime")}
        >
          运行时（端点 / 目标）
        </button>
      </div>

      <div className="pane" hidden={pane !== "native"}>
        <NativePanel
          settings={settings}
          onSettingsChange={onSettingsChange}
          run={executeRea}
          running={running}
          status={status}
          onCancel={() => void handleCancel()}
          onError={onError}
          onGraph={onData}
          registerExpand={registerExpand}
        />
      </div>

      <div className="pane" hidden={pane !== "runtime"}>
        <RuntimePanel
          settings={settings}
          onSettingsChange={onSettingsChange}
          run={executeRea}
          running={running}
          status={status}
          onCancel={() => void handleCancel()}
          onError={onError}
        />
      </div>

      <div className="pane" hidden={pane !== "dir"}>
      <label className="field">
        <span>工作目录</span>
        <div className="input-row">
          <input
            className="input"
            value={workdir}
            placeholder="例如: D:\\apps\\example"
            onChange={(event) => onSettingsChange({ workdir: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !running) void handlePipeline();
            }}
          />
          <button className="btn" onClick={() => void handlePickWorkdir()}>
            选择…
          </button>
        </div>
      </label>

      <div className="row">
        <button className="btn primary grow" disabled={running} onClick={() => void handlePipeline()}>
          {running ? "分析中…" : "分析此目录"}
        </button>
        {running && (
          <button className="btn" onClick={() => void handleCancel()}>
            取消
          </button>
        )}
      </div>
      <p className="hint">自动依次执行：AI 生成忽略规则 → 运行 REA 应用分析。</p>

      {pipeline && (
        <>
          <h3 className="sub-title">分析过程</h3>
          <ol className="steps">
            <Step
              status={pipeline.ai}
              label="AI 生成忽略规则"
              detail={rules && rules.ignore.length > 0 ? `${rules.ignore.length} 条 · ${rules.model}` : undefined}
            />
            <Step
              status={pipeline.rea}
              label="REA 应用分析"
              detail={limitedSources > 0 ? `已限定 ${limitedSources} 个源文件` : undefined}
            />
          </ol>
        </>
      )}

      {(rules || pipeline) && (
        <details className="advanced" open>
          <summary>忽略规则{rules && rules.ignore.length > 0 ? `（${rules.ignore.length}）` : ""}</summary>
          <div className="block-body">
            {rules ? (
              rules.ignore.length > 0 ? (
                <>
                  <div className="chip-list">
                    {rules.ignore.map((glob) => (
                      <code className="chip static" key={glob}>
                        {glob}
                      </code>
                    ))}
                  </div>
                  {rules.reason && <p className="hint">AI 说明：{rules.reason}</p>}
                  {rules.truncated && <p className="hint">目录过多，AI 只看到了部分目录。</p>}
                </>
              ) : (
                <>
                  <p className="hint">这个目录里没有需要忽略的内容，已沿用当前忽略规则。</p>
                  {rules.reason && <p className="hint">AI 说明：{rules.reason}</p>}
                </>
              )
            ) : pipeline?.ai === "running" ? (
              <Skeleton lines={3} />
            ) : (
              <p className="hint">
                {pipeline?.ai === "skipped" ? "未配置 API key，沿用当前忽略规则。" : "未生成规则，沿用当前忽略规则。"}
              </p>
            )}
          </div>
        </details>
      )}

      {log && <pre className="log">{log}</pre>}
      {status && <p className="hint">{status}</p>}

      <details className="advanced">
        <summary>手动：运行命令 / 加载文件 / 粘贴 JSON</summary>
        <div className="block-body">
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
                    if (event.key === "Enter" && !running) void executeRea(args, { persistArgs: args });
                  }}
                />
              </label>
              <div className="row">
                <button
                  className="btn primary"
                  disabled={running}
                  onClick={() => void executeRea(args, { persistArgs: args })}
                >
                  {running ? "执行中…" : "运行 REA"}
                </button>
                {running && (
                  <button className="btn" onClick={() => void handleCancel()}>
                    取消
                  </button>
                )}
              </div>
              <p className="hint">命令会自动追加 `--format json`；stdout/stderr 见上方日志。</p>
            </div>
          )}

          {mode === "file" && (
            <div className="stack">
              <button className="btn primary" onClick={() => void handlePickFile()}>
                选择 REA JSON 文件…
              </button>
              <p className="hint">支持 REA 的 `--format json` 输出，或任何 Evidence/图 JSON。</p>
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
        </div>
      </details>

      <details className="advanced">
        <summary>高级：REA 启动配置</summary>
        <div className="block-body">
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
            <span>临时目录 TEMP/TMP（留空用系统默认；原生自检报错时可指定健康目录）</span>
            <input
              className="input"
              value={settings?.tempDir ?? ""}
              placeholder="例如: D:\\rea-tmp"
              onChange={(event) => onSettingsChange({ tempDir: event.target.value })}
            />
          </label>
          <label className="field">
            <span>忽略规则（glob，每行一条；匹配到的节点不显示）</span>
            <textarea
              className="textarea small"
              value={settings?.ignoreGlobs ?? ""}
              placeholder={"**/node_modules\n**/.git\n**/.electron-cache"}
              onChange={(event) => onSettingsChange({ ignoreGlobs: event.target.value })}
            />
          </label>
          <div className="row">
            <button className="btn" disabled={rerunBusy || running} onClick={() => void rerunRules()}>
              {rerunBusy ? "分析中…" : "用 AI 重算忽略规则"}
            </button>
          </div>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={settings?.limitSources !== false}
              onChange={(event) => onSettingsChange({ limitSources: event.target.checked })}
            />
            只分析未被忽略的文件（传 --source-path，REA 会跳过 node_modules 等的解析）
          </label>
          {aiInfo?.hasKey ? (
            <p className="hint">
              已检测到 <code>{aiInfo.keyName}</code>（模型 <code>{aiInfo.model}</code>
              {keySourceLabel(aiInfo)}）
            </p>
          ) : (
            <p className="hint">
              未检测到 API key：把 <code>DEEPSEEK_API_KEY=sk-...</code> 写进根目录 <code>.env</code>
              （已 gitignore），或设置环境变量后重启。模型默认 <code>deepseek-v4-flash</code>。
            </p>
          )}
        </div>
      </details>
      </div>
    </div>
  );
}
