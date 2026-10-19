import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parseTrace, type NativeTrace } from "../lib/native";
import {
  emptyMcpGraph,
  mcpGraphToNorm,
  mergeMcpCallGraph,
  type Direction,
  type McpGraphState,
} from "../lib/mcpGraph";
import type { NormGraph } from "../lib/types";

type Props = {
  settings: ReaSettings | null;
  onSettingsChange: (patch: Partial<ReaSettings>) => void;
  run: (args: string, options?: { persistArgs?: string; deliver?: boolean }) => Promise<{ ok: boolean; parsed: unknown }>;
  running: boolean;
  status: string | null;
  onCancel: () => void;
  onError: (message: string) => void;
  onGraph: (graph: NormGraph, rawText: string, source: string) => void;
  registerExpand?: (fn: ((address: string) => Promise<void>) | null) => void;
};

type StepState = "pending" | "running" | "done" | "failed";
type Steps = { open: StepState; procedures: StepState; graph: StepState };
type Procedure = { address: string; name: string; external: boolean };

const STEP_TEXT: Record<StepState, string> = {
  pending: "待开始",
  running: "进行中",
  done: "完成",
  failed: "失败",
};

const MAX_SEEDS = 20;
const LIST_ROWS = 400;
const BUDGET_ERROR = /stdio response budget|response budget/i;

/** REA refuses to truncate oversized MCP responses; translate that into advice. */
function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (BUDGET_ERROR.test(message)) {
    return "结果超出 MCP 单次响应预算（清单/图太大）。请按名字筛选函数，或换一个更具体的函数作起点。";
  }
  return message;
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

export function NativePanel({
  settings,
  onSettingsChange,
  run,
  running,
  status,
  onCancel,
  onError,
  onGraph,
  registerExpand,
}: Props) {
  const [steps, setSteps] = useState<Steps | null>(null);
  const [procedures, setProcedures] = useState<Procedure[]>([]);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [graphState, setGraphState] = useState<McpGraphState>(emptyMcpGraph);
  const [roots, setRoots] = useState<string[]>([]);
  const [direction, setDirection] = useState<Direction>("forward");
  const [filter, setFilter] = useState("");
  const [query, setQuery] = useState("");
  const [overflow, setOverflow] = useState(false);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState<{ format: string; architecture: string; sha256: string } | null>(null);
  const [exeSize, setExeSize] = useState<number | null>(null);

  const [xrefQuery, setXrefQuery] = useState("");
  const [xref, setXref] = useState<NativeTrace | null>(null);
  const [xrefBusy, setXrefBusy] = useState(false);

  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const graphRef = useRef(graphState);
  graphRef.current = graphState;
  const namesRef = useRef(names);
  namesRef.current = names;
  const targetRef = useRef(target);
  targetRef.current = target;

  const exe = settings?.nativeExe ?? "";

  /** Bind the binary on demand so a graph click never depends on a prior manual connect. */
  const ensureSession = useCallback(async (): Promise<boolean> => {
    if (targetRef.current) return true;
    if (!exe.trim()) {
      onError("请先选择一个可执行文件");
      return false;
    }
    const opened = await window.rea.mcp.open(exe);
    setTarget({ format: opened.format, architecture: opened.architecture, sha256: opened.sha256 });
    return true;
  }, [exe, onError]);

  useEffect(() => {
    if (startedAt === null) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const info = exe ? await window.rea.pathInfo(exe) : null;
      if (alive) setExeSize(info?.size ?? null);
    })();
    return () => {
      alive = false;
    };
  }, [exe]);

  const elapsedSeconds = startedAt === null ? 0 : Math.max(0, Math.floor((now - startedAt) / 1000));
  const elapsedText = `${String(Math.floor(elapsedSeconds / 60)).padStart(2, "0")}:${String(
    elapsedSeconds % 60,
  ).padStart(2, "0")}`;

  // Rebuild the graph whenever new call-graph data lands.
  useEffect(() => {
    if (graphState.nodes.size === 0) return;
    onGraph(mcpGraphToNorm(graphState, namesRef.current, roots, exe), "", `$ mcp get_call_graph ${exe}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphState]);

  /** One call graph query per function; after the first analysis these are milliseconds. */
  const expandAddress = useCallback(
    async (address: string) => {
      if (!address.startsWith("0x")) return;
      const known = graphRef.current.nodes.get(address);
      if (known && known.coverage !== "unknown") return;
      setBusy(true);
      setStartedAt(Date.now());
      setSteps((prev) =>
        prev ? { ...prev, graph: "running" } : { open: "done", procedures: "pending", graph: "running" },
      );
      try {
        if (!(await ensureSession())) return;
        const body = await window.rea.mcp.callGraph(address, "forward");
        setGraphState((prev) => mergeMcpCallGraph(prev, body, "forward"));
        setSteps((prev) => (prev ? { ...prev, graph: "done" } : prev));
      } catch (error) {
        setSteps((prev) => (prev ? { ...prev, graph: "failed" } : prev));
        onError(`展开 ${address} 失败：${describeError(error)}`);
      } finally {
        setStartedAt(null);
        setBusy(false);
      }
    },
    [ensureSession, onError],
  );

  useEffect(() => {
    if (!registerExpand) return undefined;
    registerExpand(expandAddress);
    return () => registerExpand(null);
  }, [registerExpand, expandAddress]);

  async function pickExe() {
    const picked = await window.rea.pickExecutable();
    if (picked) onSettingsChange({ nativeExe: picked });
  }

  /** open_binary + list_procedures; the first query pays the full analysis cost. */
  async function connect() {
    if (!exe.trim()) {
      onError("请先选择一个可执行文件");
      return;
    }
    setBusy(true);
    setProcedures([]);
    setNames(new Map());
    setSelected(new Set());
    setGraphState(emptyMcpGraph());
    setRoots([]);
    setTarget(null);
    setOverflow(false);
    setSteps({ open: "running", procedures: "pending", graph: "pending" });
    setStartedAt(Date.now());

    try {
      const opened = await window.rea.mcp.open(exe);
      setTarget({ format: opened.format, architecture: opened.architecture, sha256: opened.sha256 });
      setSteps({ open: "done", procedures: "running", graph: "pending" });

      const result = await window.rea.mcp.procedures();
      const list: Procedure[] = result.items.map((item) => ({
        address: item.address,
        name: item.value || item.address,
        external: item.procedure?.external === true || item.address.startsWith("EXTERNAL:"),
      }));
      setProcedures(list);
      setNames(new Map(list.map((item) => [item.address, item.name])));
      setSelected(new Set(list.filter((item) => !item.external).slice(0, 1).map((item) => item.address)));
      setOverflow(false);
      setSteps({ open: "done", procedures: "done", graph: "pending" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (BUDGET_ERROR.test(message)) {
        // Too many procedures for one stdio response: switch to name search.
        setOverflow(true);
        setSteps({ open: "done", procedures: "pending", graph: "pending" });
        onError("该目标函数过多，MCP 单次响应超出预算。请用下面的搜索框按名字加载子集（例如 main）。");
        return;
      }
      setSteps((prev) => (prev ? { ...prev, open: prev.open === "running" ? "failed" : prev.open, procedures: prev.procedures === "running" ? "failed" : prev.procedures } : prev));
      onError(`MCP 分析失败：${message}`);
    } finally {
      setStartedAt(null);
      setBusy(false);
    }
  }

  /** Server-side procedure search; the only way in when `list_procedures` overflows. */
  async function searchProcedures() {
    const pattern = query.trim();
    if (!pattern) {
      onError("请输入函数名片段（例如 main）");
      return;
    }
    setSearching(true);
    try {
      const result = await window.rea.mcp.searchProcedures(pattern);
      const list: Procedure[] = result.items.map((item) => ({
        address: item.address,
        name: item.value || item.address,
        external: item.procedure?.external === true || item.address.startsWith("EXTERNAL:"),
      }));
      setProcedures(list);
      setNames((prev) => new Map([...prev, ...list.map((item) => [item.address, item.name] as const)]));
      setSelected(new Set(list.filter((item) => !item.external).slice(0, 1).map((item) => item.address)));
      setSteps((prev) => (prev ? { ...prev, procedures: "done" } : prev));
      if (list.length === 0) onError(`没有匹配「${pattern}」的函数。`);
    } catch (error) {
      onError(`搜索失败：${describeError(error)}`);
    } finally {
      setSearching(false);
    }
  }

  /** Fetch one call graph per selected seed and merge them. */
  async function buildGraph() {
    const seeds = procedures.filter((item) => selected.has(item.address)).map((item) => item.address);
    if (seeds.length === 0) {
      onError("请先勾选至少一个种子函数");
      return;
    }
    const capped = seeds.slice(0, MAX_SEEDS);
    setBusy(true);
    setSteps((prev) => (prev ? { ...prev, graph: "running" } : prev));
    setStartedAt(Date.now());
    let state = emptyMcpGraph();
    let failures = 0;
    let firstError: unknown = null;
    try {
      if (!(await ensureSession())) return;
      for (const address of capped) {
        try {
          const body = await window.rea.mcp.callGraph(address, direction);
          state = mergeMcpCallGraph(state, body, direction);
        } catch (error) {
          failures += 1;
          if (firstError === null) firstError = error;
        }
      }
      setRoots(capped);
      setGraphState(state);
      setSteps((prev) => (prev ? { ...prev, graph: failures === capped.length ? "failed" : "done" } : prev));
      if (failures > 0) onError(`${failures} / ${capped.length} 个种子失败：${describeError(firstError)}`);
    } finally {
      setStartedAt(null);
      setBusy(false);
    }
  }

  /** trace 仍然走 CLI：它能直接给出「引用点 → 所属函数」。 */
  async function searchXrefs() {
    const query = xrefQuery.trim();
    if (!query) {
      onError("请输入要追踪的字符串或 API 名");
      return;
    }
    if (!exe.trim()) {
      onError("请先选择一个可执行文件");
      return;
    }
    setXrefBusy(true);
    try {
      const result = await run(`trace "${exe}" "${query}"`, { deliver: false });
      const parsed = parseTrace(result.parsed);
      setXref(parsed);
      if (!result.ok || !parsed) onError("trace 失败：检查 provider 是否可用。");
    } finally {
      setXrefBusy(false);
    }
  }

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const matched = needle
      ? procedures.filter(
          (item) => item.name.toLowerCase().includes(needle) || item.address.toLowerCase().includes(needle),
        )
      : procedures;
    return matched.slice(0, LIST_ROWS);
  }, [procedures, filter]);

  const internalCount = procedures.filter((item) => !item.external).length;

  return (
    <div className="panel-section">
      <label className="field">
        <span>原生可执行文件（exe / dll / node / so）</span>
        <div className="input-row">
          <input
            className="input"
            value={exe}
            placeholder="选择或粘贴绝对路径"
            onChange={(event) => onSettingsChange({ nativeExe: event.target.value })}
          />
          <button className="btn" onClick={() => void pickExe()}>
            选择…
          </button>
        </div>
      </label>

      <details className="advanced">
        <summary>Provider 环境（可选）</summary>
        <div className="block-body">
          <label className="field">
            <span>GHIDRA_INSTALL_DIR</span>
            <input
              className="input"
              value={settings?.ghidraDir ?? ""}
              placeholder="留空则继承当前进程环境"
              onChange={(event) => onSettingsChange({ ghidraDir: event.target.value })}
            />
          </label>
          <label className="field">
            <span>JAVA_HOME（需 21+）</span>
            <input
              className="input"
              value={settings?.javaHome ?? ""}
              placeholder="留空则继承当前进程环境"
              onChange={(event) => onSettingsChange({ javaHome: event.target.value })}
            />
          </label>
          <label className="field">
            <span>REA_GHIDRA_DISABLED_ANALYZERS（逗号分隔）</span>
            <input
              className="input"
              value={settings?.disabledAnalyzers ?? ""}
              placeholder="Decompiler Parameter ID,Decompiler Switch Analysis"
              onChange={(event) => onSettingsChange({ disabledAnalyzers: event.target.value })}
            />
          </label>
          <p className="hint">
            这两个分析器不影响调用图（实测函数数不变），但能缩短首次分析时间（873KB 样本：35.7s → 28.1s）。
            留空则用 Ghidra 默认全量。
          </p>
          <p className="hint">
            以上三项只注入 REA 子进程；改完需重新连接目标生效（见 AGENTS.md #6）。
          </p>
        </div>
      </details>

      <p className="hint">
        {exeSize != null ? `目标 ${(exeSize / 1024 / 1024).toFixed(1)} MB · ` : ""}
        MCP 会话模式：<b>首次查询</b>要完整分析一次，之后每次调用毫秒级；换目标会重新分析。
      </p>

      <div className="row">
        <button className="btn primary grow" disabled={busy || running} onClick={() => void connect()}>
          {busy ? "进行中…" : target ? "重新连接并分析" : "连接并分析"}
        </button>
        {(busy || running) && (
          <button className="btn" onClick={onCancel}>
            取消
          </button>
        )}
      </div>

      {steps && (
        <>
          <h3 className="sub-title">分析过程</h3>
          <ol className="steps">
            <Step
              status={steps.open}
              label="打开目标（open_binary）"
              detail={steps.open === "running" ? `已用时 ${elapsedText}` : target ? target.format : undefined}
            />
            <Step
              status={steps.procedures}
              label="枚举函数（首次触发完整分析）"
              detail={
                overflow && procedures.length === 0
                  ? "函数过多，请用搜索加载子集"
                  : procedures.length
                    ? `${procedures.length} 个（内部 ${internalCount}）`
                    : steps.procedures === "running"
                      ? `已用时 ${elapsedText}`
                      : undefined
              }
            />
            <Step
              status={steps.graph}
              label="获取调用图（get_call_graph）"
              detail={
                graphState.nodes.size
                  ? `${graphState.nodes.size} 节点 / ${graphState.edges.size} 边`
                  : steps.graph === "running"
                    ? `已用时 ${elapsedText}`
                    : undefined
              }
            />
          </ol>
          {steps.procedures === "running" && (
            <p className="hint">
              首次查询会启动 Ghidra 做完整分析，且 REA 不输出进度（实测 stderr 为空）——
              这里只能显示已用时，不是卡死。
            </p>
          )}
        </>
      )}

      {target && (
        <>
          <p className="hint">
            {target.format} · {target.architecture} · sha256 {target.sha256.slice(0, 12)}…
          </p>
          <div className="row">
            <input
              className="input"
              value={query}
              placeholder="按名字搜索函数（如 main / napi）"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !searching) void searchProcedures();
              }}
            />
            <button className="btn" disabled={searching || busy} onClick={() => void searchProcedures()}>
              {searching ? "搜索中…" : "搜索"}
            </button>
          </div>
          {overflow && (
            <p className="hint">
              该目标函数数量超出 MCP 单次响应预算，必须按名字搜索加载子集（Go 二进制可试{" "}
              <code>main</code>）。
            </p>
          )}
        </>
      )}

      <h3 className="sub-title">交叉引用（字符串 / API → 引用点）</h3>
      <div className="row">
        <input
          className="input"
          value={xrefQuery}
          placeholder="例如 napi_register_module_v1"
          onChange={(event) => setXrefQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !xrefBusy) void searchXrefs();
          }}
        />
        <button className="btn primary" disabled={xrefBusy || running} onClick={() => void searchXrefs()}>
          {xrefBusy ? "追踪中…" : "搜索引用"}
        </button>
      </div>

      {xref && (
        <>
          <p className="hint">
            匹配 {xref.matches.length} · 引用 {xref.references.length}
            {xref.truncated ? " · 结果已截断" : ""}
          </p>
          <div className="table-wrap">
            <table className="rt-table">
              <tbody>
                {xref.matches.map((match) => (
                  <tr key={`m-${match.type}-${match.address}`}>
                    <td>{match.type}</td>
                    <td title={match.value}>{match.value}</td>
                    <td>{match.address}</td>
                  </tr>
                ))}
                {xref.references.map((reference) => (
                  <tr key={`r-${reference.sourceAddress}-${reference.targetAddress}`}>
                    <td>{reference.procedure ? "引用点" : "数据引用"}</td>
                    <td>
                      {reference.procedure ? (
                        <button
                          className="link"
                          onClick={() => {
                            if (reference.procedure) void expandAddress(reference.procedure.address);
                          }}
                        >
                          {reference.procedure.name}
                        </button>
                      ) : (
                        <span className="muted">{reference.reason || "未找到所属函数"}</span>
                      )}
                    </td>
                    <td>{reference.sourceAddress}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint">
            点「引用点」里的函数名会在调用图中展开它（若尚未连接目标，会自动 open_binary 并触发首次分析，
            大文件可能较久）。数据引用（如 IAT 指针）没有所属函数，属正常。
          </p>
        </>
      )}

      {procedures.length > 0 && (
        <>
          <div className="row">
            <input
              className="input"
              value={filter}
              placeholder="过滤函数名 / 地址"
              onChange={(event) => setFilter(event.target.value)}
            />
            <button
              className="btn"
              onClick={() =>
                setSelected(new Set(visible.filter((item) => !item.external).map((item) => item.address)))
              }
            >
              全选可见
            </button>
            <button className="btn ghost" onClick={() => setSelected(new Set())}>
              清空
            </button>
          </div>

          <div className="seg">
            {[
              { id: "forward" as Direction, label: "forward（被调）" },
              { id: "backward" as Direction, label: "backward（调用方）" },
            ].map((entry) => (
              <button
                key={entry.id}
                className={direction === entry.id ? "seg-item active" : "seg-item"}
                onClick={() => setDirection(entry.id)}
              >
                {entry.label}
              </button>
            ))}
          </div>

          <p className="hint">
            已选 {selected.size} 个（最多 {MAX_SEEDS} 个）。首次分析之后每次查询都是毫秒级；
            但 `get_call_graph` 会一直遍历到可达图穷尽，大函数可能返回很多节点。
            {procedures.length > LIST_ROWS ? ` 列表只显示前 ${LIST_ROWS} 个，请用过滤缩小。` : ""}
          </p>

          <div className="table-wrap">
            <table className="rt-table">
              <tbody>
                {visible.map((item) => (
                  <tr key={item.address}>
                    <td style={{ width: 28 }}>
                      <input
                        type="checkbox"
                        checked={selected.has(item.address)}
                        onChange={(event) => {
                          setSelected((prev) => {
                            const next = new Set(prev);
                            if (event.target.checked) next.add(item.address);
                            else next.delete(item.address);
                            return next;
                          });
                        }}
                      />
                    </td>
                    <td title={item.name}>{item.name}</td>
                    <td title={item.address}>{item.address}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="row">
            <button className="btn primary grow" disabled={busy} onClick={() => void buildGraph()}>
              {busy ? "进行中…" : "生成调用图"}
            </button>
          </div>
          <p className="hint">
            生成后，在图上<b>点击任意函数节点</b>会按需拉取它的调用关系并继续长图（毫秒级）。
          </p>
        </>
      )}

      {status && <p className="hint">{status}</p>}
    </div>
  );
}
