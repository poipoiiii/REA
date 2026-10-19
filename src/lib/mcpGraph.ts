import { kindColor } from "./colors";
import type { NormEdge, NormGraph, NormNode } from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */

export type McpGraphNode = { address: string; coverage: string };
export type McpGraphEdge = { source: string; target: string };
export type McpGraphState = { nodes: Map<string, McpGraphNode>; edges: Map<string, McpGraphEdge> };

export const emptyMcpGraph = (): McpGraphState => ({ nodes: new Map(), edges: new Map() });

export type Direction = "forward" | "backward";

/**
 * Merge one `get_call_graph` payload into the accumulated state.
 *
 * The payload nests nodes by BFS depth and stores neighbours in `calls`.
 * `calls` is direction-relative: for "backward" the neighbours are callers,
 * so the edge must be reversed (AGENTS.md #15).
 */
export function mergeMcpCallGraph(
  state: McpGraphState,
  body: any,
  direction: Direction = "forward",
): McpGraphState {
  const graph = body?.normalized_result?.graph;
  if (!graph || typeof graph !== "object") return state;
  const nodes = new Map(state.nodes);
  const edges = new Map(state.edges);

  for (const list of Object.values(graph)) {
    if (!Array.isArray(list)) continue;
    for (const node of list) {
      const address = String(node?.address ?? "");
      if (!address) continue;
      nodes.set(address, {
        address,
        coverage: String(node?.relationship_coverage?.status ?? node?.status ?? "unknown"),
      });
      for (const call of Array.isArray(node?.calls) ? node.calls : []) {
        const neighbour = String(call);
        const source = direction === "forward" ? address : neighbour;
        const target = direction === "forward" ? neighbour : address;
        const id = `${source}->${target}`;
        if (!edges.has(id)) edges.set(id, { source, target });
        if (!nodes.has(neighbour)) nodes.set(neighbour, { address: neighbour, coverage: "unknown" });
      }
    }
  }

  return { nodes, edges };
}

export function mcpGraphToNorm(
  state: McpGraphState,
  names: Map<string, string>,
  roots: string[],
  source: string,
): NormGraph {
  const nodes: NormNode[] = [];
  for (const node of state.nodes.values()) {
    const external = node.address.startsWith("EXTERNAL:");
    const kind = external ? "external" : "function";
    nodes.push({
      id: node.address,
      label: names.get(node.address) ?? node.address,
      kind,
      color: kindColor(kind),
      badge: node.coverage === "partial" ? "partial" : undefined,
      raw: node,
    });
  }

  const edges: NormEdge[] = [...state.edges.values()].map((edge) => ({
    id: `${edge.source}->${edge.target}`,
    source: edge.source,
    target: edge.target,
    label: "calls",
    raw: edge,
  }));

  const partial = nodes.filter((node) => node.badge === "partial").length;
  const limitations = [
    "调用图来自 REA MCP 的 get_call_graph（会话复用，非 CLI），不是全程序 CFG。",
    "间接调用/函数指针可能缺失；relation_coverage 为 partial 的节点存在未解析目标。",
  ];
  if (partial > 0) limitations.push(`${partial} 个节点的调用关系为 partial（有目标未解析）。`);

  return {
    format: "call-graph",
    formatLabel: "原生调用图（MCP）",
    view: "call",
    nodes,
    edges,
    roots: roots.filter((address) => state.nodes.has(address)),
    paths: [],
    limitations,
    meta: {
      source,
      node_count: nodes.length,
      edge_count: edges.length,
      expanded_functions: state.nodes.size,
    },
  };
}
