import { useEffect, useMemo, useRef, useState } from "react";
import cytoscape from "cytoscape";
import type { NormGraph } from "../lib/types";

export const LAYOUTS = ["cose", "breadthfirst", "concentric", "circle", "grid"] as const;
export type LayoutName = (typeof LAYOUTS)[number];

type Props = {
  graph: NormGraph;
  layout: LayoutName;
  onLayoutChange: (layout: LayoutName) => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
};

function runLayout(cy: cytoscape.Core, name: LayoutName) {
  const options: Record<string, unknown> = { name, animate: false, padding: 40 };
  if (name === "cose") {
    options.nodeRepulsion = 9000;
    options.idealEdgeLength = 90;
    options.numIter = 800;
    options.nodeOverlap = 12;
  }
  if (name === "breadthfirst") {
    options.directed = true;
    options.spacingFactor = 1.2;
  }
  const layout = cy.layout(options as unknown as cytoscape.LayoutOptions);
  layout.one("layoutstop", () => cy.fit(undefined, 40));
  layout.run();
}

export function GraphView({ graph, layout, onLayoutChange, selectedId, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  const onSelectRef = useRef(onSelect);
  const [showLabels, setShowLabels] = useState(true);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    if (!containerRef.current) return undefined;
    const cy = cytoscape({
      container: containerRef.current,
      wheelSensitivity: 0.2,
      style: [
        {
          selector: "node",
          style: {
            "background-color": "data(color)",
            label: "data(label)",
            color: "#e6edf3",
            "font-size": 10,
            "text-valign": "bottom",
            "text-halign": "center",
            "text-margin-y": 4,
            "text-max-width": "150px",
            "text-wrap": "ellipsis",
            width: 22,
            height: 22,
            "border-width": 1,
            "border-color": "#0d1117",
          },
        },
        {
          selector: "edge",
          style: {
            width: 1.2,
            "line-color": "#30363d",
            "target-arrow-color": "#30363d",
            "target-arrow-shape": "triangle",
            "arrow-scale": 0.8,
            "curve-style": "bezier",
          },
        },
        {
          selector: "node.pathnode",
          style: { "border-width": 3, "border-color": "#58a6ff" },
        },
        {
          selector: "edge.pathedge",
          style: {
            "line-color": "#58a6ff",
            "target-arrow-color": "#58a6ff",
            width: 2.2,
          },
        },
        {
          selector: "node.start",
          style: { "border-width": 4, "border-color": "#3fb950" },
        },
        {
          selector: "node.goal",
          style: { "border-width": 4, "border-color": "#f85149" },
        },
        {
          selector: "node.selected",
          style: { "border-width": 4, "border-color": "#ffffff" },
        },
      ],
    });
    cy.on("tap", "node", (event) => onSelectRef.current(event.target.id()));
    cy.on("tap", (event) => {
      if (event.target === cy) onSelectRef.current(null);
    });
    cyRef.current = cy;
    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, []);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const elements: cytoscape.ElementDefinition[] = [
      ...graph.nodes.map((n) => ({
        data: { id: n.id, label: n.label, kind: n.kind, color: n.color },
      })),
      ...graph.edges.map((e) => ({
        data: { id: e.id, source: e.source, target: e.target, label: e.label },
      })),
    ];
    cy.elements().remove();
    cy.add(elements);
    cy.batch(() => {
      for (const path of graph.paths) {
        for (const id of path.nodeIds) cy.getElementById(id).addClass("pathnode");
        for (const id of path.edgeIds) cy.getElementById(id).addClass("pathedge");
      }
      if (graph.startId) cy.getElementById(graph.startId).addClass("start");
      if (graph.goalId) cy.getElementById(graph.goalId).addClass("goal");
    });
    if (cy.elements().length > 0) runLayout(cy, layout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || cy.elements().length === 0) return;
    runLayout(cy, layout);
  }, [layout]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.elements().removeClass("selected");
    if (!selectedId) return;
    const el = cy.getElementById(selectedId);
    if (el.length > 0) {
      el.addClass("selected");
      cy.animate({ center: { eles: el }, duration: 200 });
    }
  }, [selectedId]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.style().selector("node").style("text-opacity", showLabels ? 1 : 0).update();
  }, [showLabels]);

  const legend = useMemo(() => {
    const seen = new Map<string, string>();
    for (const node of graph.nodes) {
      if (!seen.has(node.kind)) seen.set(node.kind, node.color);
      if (seen.size >= 14) break;
    }
    return [...seen.entries()];
  }, [graph]);

  return (
    <div className="graph-wrap">
      <div className="graph-toolbar">
        <select
          className="select"
          value={layout}
          onChange={(event) => onLayoutChange(event.target.value as LayoutName)}
        >
          {LAYOUTS.map((name) => (
            <option key={name} value={name}>
              布局: {name}
            </option>
          ))}
        </select>
        <button className="btn ghost" onClick={() => cyRef.current?.fit(undefined, 40)}>
          适应窗口
        </button>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={showLabels}
            onChange={(event) => setShowLabels(event.target.checked)}
          />
          显示标签
        </label>
        <span className="muted">
          {graph.nodes.length} 节点 / {graph.edges.length} 边
        </span>
      </div>
      <div className="graph-canvas" ref={containerRef} />
      <div className="legend">
        {legend.map(([kind, color]) => (
          <span className="legend-item" key={kind}>
            <i style={{ background: color }} />
            {kind}
          </span>
        ))}
      </div>
    </div>
  );
}
