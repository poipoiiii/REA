import { useCallback, useEffect, useState } from "react";
import { GraphView, type LayoutName } from "./components/GraphView";
import { SourcePanel } from "./components/SourcePanel";
import { DetailPanel } from "./components/DetailPanel";
import type { NormGraph } from "./lib/types";

type View = "app" | "call";

export default function App() {
  const [settings, setSettings] = useState<ReaSettings | null>(null);
  const [graph, setGraph] = useState<NormGraph | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [layout, setLayout] = useState<LayoutName>("cose");
  const [view, setView] = useState<View>("app");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.rea.getSettings().then(setSettings).catch(() => undefined);
  }, []);

  const handleSettingsChange = useCallback((patch: Partial<ReaSettings>) => {
    setSettings((prev) => (prev ? { ...prev, ...patch } : prev));
    window.rea.saveSettings(patch).catch(() => undefined);
  }, []);

  const handleData = useCallback((next: NormGraph, _raw: string, from: string) => {
    setGraph(next);
    setSource(from);
    setSelectedId(null);
    setView(next.view);
    setLayout(next.view === "app" ? "breadthfirst" : "cose");
    setError(null);
  }, []);

  const handleSelect = useCallback((id: string | null) => setSelectedId(id), []);

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
            onError={(message) => setError(message)}
          />
        </aside>

        <main className="col-center">
          {graph && graph.nodes.length > 0 ? (
            <>
              {view !== graph.view && (
                <div className="banner info">
                  当前数据是「{graph.formatLabel}」，与所选视图不同；可按需切换视图以匹配。
                </div>
              )}
              <GraphView
                graph={graph}
                layout={layout}
                onLayoutChange={setLayout}
                selectedId={selectedId}
                onSelect={handleSelect}
              />
            </>
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
          <DetailPanel graph={graph} selectedId={selectedId} source={source} />
        </aside>
      </div>
    </div>
  );
}
