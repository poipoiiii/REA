import type { RuntimeReport } from "../lib/runtime";

function rawJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function RuntimeView({ report }: { report: RuntimeReport }) {
  return (
    <div className="runtime">
      <div className="runtime-head">
        <h2 className="runtime-title">{report.title}</h2>
        {report.operation && <code className="chip static">{report.operation}</code>}
      </div>

      {report.facts.length > 0 && (
        <div className="kv-grid">
          {report.facts.map((fact) => (
            <div className="kv" key={fact.label}>
              <span>{fact.label}</span>
              <b className="ellipsis" title={fact.value}>
                {fact.value}
              </b>
            </div>
          ))}
        </div>
      )}

      {report.lists.map((list) => (
        <details className="advanced" key={list.title} open>
          <summary>{list.title}</summary>
          <div className="block-body">
            {list.rows.length === 0 ? (
              <p className="hint">无数据。</p>
            ) : (
              <div className="table-wrap">
                <table className="rt-table">
                  <tbody>
                    {list.rows.map((row, rowIndex) => (
                      <tr key={rowIndex}>
                        {row.map((cell, cellIndex) => (
                          <td key={cellIndex} title={cell}>
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </details>
      ))}

      {report.limitations.length > 0 && (
        <>
          <h3 className="sub-title">限制说明（{report.limitations.length}）</h3>
          <ul className="limitations">
            {report.limitations.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </>
      )}

      <details className="advanced">
        <summary>原始 JSON</summary>
        <div className="block-body">
          <pre className="code">{rawJson(report.raw)}</pre>
        </div>
      </details>
    </div>
  );
}
