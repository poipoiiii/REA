import { useMemo } from "react";
import type { NormGraph } from "../lib/types";

type Props = {
  graph: NormGraph | null;
  selectedId: string | null;
  source: string | null;
};

function renderValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

export function DetailPanel({ graph, selectedId, source }: Props) {
  const selected = useMemo(
    () => graph?.nodes.find((node) => node.id === selectedId) ?? null,
    [graph, selectedId],
  );

  const pretty = useMemo(() => {
    if (!selected) return "";
    try {
      return JSON.stringify(selected.raw, null, 2);
    } catch {
      return String(selected.raw);
    }
  }, [selected]);

  if (!graph) {
    return (
      <div className="panel-section">
        <p className="hint">还没有数据。请在左侧运行命令、加载文件或粘贴 JSON。</p>
      </div>
    );
  }

  return (
    <div className="panel-section">
      <h2 className="section-title">数据概览</h2>
      <div className="kv">
        <span>格式</span>
        <b>{graph.formatLabel}</b>
      </div>
      {source && (
        <div className="kv">
          <span>来源</span>
          <b className="ellipsis" title={source}>
            {source}
          </b>
        </div>
      )}
      <div className="kv">
        <span>节点 / 边</span>
        <b>
          {graph.nodes.length} / {graph.edges.length}
        </b>
      </div>
      {graph.coverage && (
        <div className="kv">
          <span>覆盖度</span>
          <b>{graph.coverage}</b>
        </div>
      )}
      {Object.entries(graph.meta)
        .filter(([, v]) => v !== undefined && v !== null && v !== "")
        .map(([key, value]) => (
          <div className="kv" key={key}>
            <span>{key}</span>
            <b className="ellipsis" title={renderValue(value)}>
              {renderValue(value)}
            </b>
          </div>
        ))}

      {graph.limitations.length > 0 && (
        <>
          <h2 className="section-title">限制说明 ({graph.limitations.length})</h2>
          <ul className="limitations">
            {graph.limitations.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </>
      )}

      <h2 className="section-title">选中节点</h2>
      {selected ? (
        <>
          <div className="kv">
            <span>标签</span>
            <b className="ellipsis" title={selected.label}>
              {selected.label}
            </b>
          </div>
          <div className="kv">
            <span>类型</span>
            <b>
              <i className="dot" style={{ background: selected.color }} /> {selected.kind}
            </b>
          </div>
          {selected.badge && (
            <div className="kv">
              <span>标识</span>
              <b className="ellipsis">{selected.badge}</b>
            </div>
          )}
          <div className="row">
            <button
              className="btn ghost"
              onClick={() => navigator.clipboard.writeText(pretty).catch(() => undefined)}
            >
              复制原始 JSON
            </button>
          </div>
          <pre className="code">{pretty}</pre>
        </>
      ) : (
        <p className="hint">在右侧图上点击一个节点查看原始 JSON 细节。</p>
      )}
    </div>
  );
}
