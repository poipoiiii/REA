import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GraphView, type LayoutName } from "./components/GraphView";
import { SourcePanel } from "./components/SourcePanel";
import { DetailPanel } from "./components/DetailPanel";
import { RuntimeView } from "./components/RuntimeView";
import { DEFAULT_IGNORE_GLOBS, filterGraph, parseGlobs } from "./lib/filter";
import type { RuntimeReport } from "./lib/runtime";
import type { NormGraph } from "./lib/types";

type View = "app" | "call" | "runtime";

export default function App() {
  const [settings, setSettings] = useState<ReaSettings | null>(null);
  const [graph, setGraph] = useState<NormGraph | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [layout, setLayout] = useState<LayoutName>("cose");
  const [view, setView] = useState<View>("app");
  const [runtime, setRuntime] = useState<RuntimeReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const nativeExpandRef = useRef<((address: string) => Promise<void>) | null>(null);
  const registerExpand = useCallback((fn: ((address: string) => Promise<void>) | null) => {
    nativeExpandRef.current = fn;
  }, []);

  useEffect(() => {
    window.rea.getSettings().then(setSettings).catch(() => undefined);
  }, []);

  const handleSettingsChange = useCallback((patch: Partial<ReaSettings>) => {
    setSettings((prev) => (prev ? { ...prev, ...patch } : prev));
    window.rea.saveSettings(patch).catch(() => undefined);
  }, []);

  const handleData = useCallback((next: NormGraph, _raw: string, from: string) => {
    setGraph(next);
    setRuntime(null);
    setSource(from);
    setSelectedId(null);
    setView(next.view);
    setLayout(next.view === "app" ? "breadthfirst" : "cose");
    setError(null);
  }, []);

  const handleRuntime = useCallback((report: RuntimeReport, _raw: string, from: string) => {
    setRuntime(report);
    setGraph(null);
    setSource(from);
    setSelectedId(null);
    setView("runtime");
    setError(null);
  }, []);

  const handleSelect = useCallback((id: string | null) => {
    setSelectedId(id);
    // Native call graph: clicking a function address lazily fetches its dossier.
    if (id) void nativeExpandRef.current?.(id);
  }, []);

  // Hide dependency/build noise (node_modules, .git, ...) at display time.
  const globs = useMemo(
    () => parseGlobs(settings?.ignoreGlobs ?? DEFAULT_IGNORE_GLOBS),
    [settings?.ignoreGlobs],
  );
  const filtered = useMemo(() => (graph ? filterGraph(graph, globs) : null), [graph, globs]);
  const visible = filtered?.graph ?? null;

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="logo">REA</span>
          <span>Viewer</span>
          <span className="muted">可视化 REA（Reverse Engineer Anything）的 JSON 输出</span>
        </div>
        <div className="view-tabs">
          <button
            className={view === "app" ? "tab active" : "tab"}
            onClick={() => setView("app")}
          >
            应用 / 产物关系图
          </button>
          <button
            className={view === "call" ? "tab active" : "tab"}
            onClick={() => setView("call")}
          >
            调用图 / 调用路径
          </button>
          <button
            className={view === "runtime" ? "tab active" : "tab"}
            onClick={() => setView("runtime")}
          >
            运行时
          </button>
        </div>
      </header>

      {error && (
        <div className="banner error">
          <span className="ellipsis" title={error}>
            {error}
          </span>
          <button className="btn ghost small" onClick={() => setError(null)}>
            关闭
          </button>
        </div>
      )}

      <div className="app-body">
        <aside className="col-left">
          <h2 className="section-title">数据源</h2>
          <SourcePanel
            settings={settings}
            onSettingsChange={handleSettingsChange}
            onData={handleData}
            onRuntime={handleRuntime}
            onError={(message) => setError(message)}
            registerExpand={registerExpand}
          />
        </aside>

        <main className="col-center">
          {view === "runtime" ? (
            runtime ? (
              <RuntimeView report={runtime} />
            ) : (
              <div className="empty">
                <h3>暂无运行时数据</h3>
                <p className="muted">
                  在左侧「手动 → 运行命令」里跑 runtime 相关命令（会自动加 `--format json`）：
                </p>
                <ul className="muted">
                  <li>`instrument-with-frida attach &lt;PID&gt; --script-file probe.js`</li>
                  <li>`list-javascript-runtime-targets http://127.0.0.1:9229`</li>
                  <li>`observe-javascript-runtime &lt;endpoint&gt; &lt;targetId&gt;`</li>
                  <li>`list-electron-targets` / `inspect-electron-page`</li>
                  <li>`list-browser-targets` / `inspect-web-page`</li>
                </ul>
              </div>
            )
          ) : graph && graph.nodes.length > 0 ? (
            visible && visible.nodes.length > 0 ? (
              <>
                {view !== visible.view && (
                  <div className="banner info">
                    当前数据是「{visible.formatLabel}」，与所选视图不同；可按需切换视图以匹配。
                  </div>
                )}
                <GraphView
                  graph={visible}
                  layout={layout}
                  onLayoutChange={setLayout}
                  selectedId={selectedId}
                  onSelect={handleSelect}
                />
              </>
            ) : (
              <div className="empty">
                <h3>全部节点都被忽略规则过滤了</h3>
                <p className="muted">
                  原始 {graph.nodes.length} 个节点全部匹配了忽略规则。请到左侧「高级」调整忽略规则。
                </p>
              </div>
            )
          ) : (
            <div className="empty">
              <h3>暂无图数据</h3>
              <p className="muted">
                在左侧运行 REA 命令（会自动加 `--format json`）、加载 JSON 文件，或粘贴 JSON。
              </p>
              <ul className="muted">
                <li>应用关系图：`analyze-javascript-application` / `project-*-application-graph` / `inspect-artifact`</li>
                <li>调用图：`xrefs` / `trace` / MCP `get_call_graph`、`trace_call_path` 的 JSON 输出</li>
              </ul>
            </div>
          )}
        </main>

        <aside className="col-right">
          <DetailPanel
            graph={view === "runtime" ? null : visible}
            runtime={runtime}
            selectedId={selectedId}
            source={source}
            removedNodes={filtered?.removedNodes ?? 0}
            removedEdges={filtered?.removedEdges ?? 0}
          />
        </aside>
      </div>
    </div>
  );
}
