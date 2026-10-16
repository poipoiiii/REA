import { kindColor } from "./colors";
import type { GraphFormat, NormEdge, NormGraph, NormNode, NormPath } from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Scan a text stream for every balanced top-level JSON value (handles JSONL + log noise). */
function scanJsonValues(text: string): unknown[] {
  const values: unknown[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{" || ch === "[") {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === "}" || ch === "]") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        try {
          values.push(JSON.parse(text.slice(start, i + 1)));
        } catch {
          /* skip malformed value */
        }
        start = -1;
      }
      if (depth < 0) depth = 0;
    }
  }
  return values;
}

/** Parse stdout that should be JSON, tolerating progress lines and trailing noise. */
export function parseJsonLoose(text: string): unknown {
  const trimmed = (text ?? "").trim();
  if (!trimmed) throw new Error("空输出");
  try {
    return JSON.parse(trimmed);
  } catch {
    /* fall through to scanning */
  }
  const values = scanJsonValues(trimmed);
  if (values.length === 0) throw new Error("输出不是合法 JSON");
  const graphLike = values.find(isGraphLike);
  if (graphLike !== undefined) return graphLike;
  // Otherwise keep the largest value, which is normally the real result.
  return values.reduce((best, current) =>
    JSON.stringify(current).length > JSON.stringify(best).length ? current : best,
  );
}

const shortId = (value: string, n = 12) => {
  if (!value) return "";
  return value.length > n ? `${value.slice(0, n)}…` : value;
};

function isGraphLike(o: any): boolean {
  if (!o || typeof o !== "object") return false;
  if (o.schema === "JavaScriptApplicationGraph") return true;
  if (Array.isArray(o.paths)) return true;
  if (Array.isArray(o.occurrences)) return true;
  if (Array.isArray(o.nodes) && Array.isArray(o.edges)) return true;
  return false;
}

/** Peel common REA/CLI envelopes (result/data/output) until a graph-shaped payload is found. */
function unwrap(input: any): any {
  let cur = input;
  for (let depth = 0; depth < 5; depth += 1) {
    if (!isGraphLike(cur)) {
      const next = ["result", "data", "output", "payload", "value"]
        .map((key) => (cur && typeof cur === "object" ? cur[key] : undefined))
        .find((v) => v && typeof v === "object");
      if (!next) return cur;
      cur = next;
      continue;
    }
    return cur;
  }
  return cur;
}

/**
 * Breadth-first search for the first graph-shaped payload anywhere in the tree.
 * REA can return an error envelope that still carries a usable partial graph
 * (e.g. `...normalized_result.graph`), so shallow unwrapping is not enough.
 */
function deepFindGraph(root: unknown): any | null {
  const queue: unknown[] = [root];
  const seen = new Set<unknown>();
  let visited = 0;
  while (queue.length > 0 && visited < 20000) {
    const current = queue.shift();
    visited += 1;
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    if (isGraphLike(current)) return current;
    for (const value of Object.values(current as Record<string, unknown>)) {
      if (value && typeof value === "object") queue.push(value);
    }
  }
  return null;
}

function findPayload(raw: unknown): any {
  const shallow = unwrap(raw);
  if (isGraphLike(shallow)) return shallow;
  const deep = deepFindGraph(shallow) ?? deepFindGraph(raw);
  return deep ?? shallow;
}

function detectFormat(o: any): GraphFormat | null {
  if (!o || typeof o !== "object") return null;
  if (o.schema === "JavaScriptApplicationGraph") return "application-graph";
  if (
    Array.isArray(o.paths) ||
    (typeof o.start === "string" && typeof o.goal === "string" && "explored" in o)
  ) {
    return "call-graph";
  }
  if (Array.isArray(o.occurrences) && o.manifest) return "artifact-inventory";
  const first = Array.isArray(o.nodes) ? o.nodes[0] : undefined;
  if (first && (first.node_id !== undefined || first.source_node_id !== undefined)) {
    return "application-graph";
  }
  if (first && first.artifact_id !== undefined) return "artifact-inventory";
  if (Array.isArray(o.nodes) && Array.isArray(o.edges)) return "generic-graph";
  return null;
}

/** Best-effort display label for an application-graph node. */
function appNodeLabel(node: any): string {
  const label = node?.observations?.[0]?.label;
  if (typeof label === "string" && label) return label;
  const identity = node?.identity ?? {};
  for (const key of ["path", "original_source", "name", "module", "type_name", "method", "key", "value"]) {
    if (typeof identity[key] === "string" && identity[key]) return identity[key];
  }
  if (typeof identity.url === "string" && identity.url) return identity.url;
  for (const key of ["path", "original_source", "source_name", "name", "url", "id"]) {
    const props = node?.observations?.[0]?.properties;
    if (props && typeof props[key] === "string" && props[key]) return props[key];
  }
  return shortId(String(node?.node_id ?? ""), 16);
}

function identityHint(node: any): string | undefined {
  const identity = node?.identity ?? {};
  if (typeof identity.sha256 === "string") return `sha256:${shortId(identity.sha256, 10)}`;
  if (typeof identity.strategy === "string") return identity.strategy;
  return undefined;
}

function buildApplicationGraph(g: any): NormGraph {
  const nodes: NormNode[] = (g.nodes ?? []).map((node: any) => ({
    id: node.node_id,
    label: appNodeLabel(node),
    kind: node.kind ?? "unknown",
    color: kindColor(node.kind ?? "unknown"),
    badge: identityHint(node),
    raw: node,
  }));
  const ids = new Set(nodes.map((n) => n.id));
  const edges: NormEdge[] = (g.edges ?? [])
    .filter((e: any) => ids.has(e.source_node_id) && ids.has(e.target_node_id))
    .map((e: any) => ({
      id: e.edge_id ?? `${e.source_node_id}->${e.target_node_id}:${e.relation}`,
      source: e.source_node_id,
      target: e.target_node_id,
      label: e.relation ?? "",
      raw: e,
    }));
  const limitations: string[] = Array.isArray(g.limitations) ? g.limitations : [];
  return {
    format: "application-graph",
    formatLabel: "应用关系图 (Application Graph)",
    view: "app",
    nodes,
    edges,
    roots: Array.isArray(g.root_node_ids) ? g.root_node_ids : [],
    paths: [],
    coverage: g.coverage?.status,
    limitations,
    meta: {
      graph_id: g.graph_id,
      schema: g.schema,
      node_count: nodes.length,
      edge_count: edges.length,
    },
  };
}

function buildArtifactInventory(inv: any): NormGraph {
  const occurrences: any[] = Array.isArray(inv.occurrences) ? inv.occurrences : [];
  const nodes: NormNode[] = occurrences.map((occ: any) => {
    const kind = occ.artifact_format ? `${occ.artifact_kind}/${occ.artifact_format}` : occ.artifact_kind ?? "file";
    return {
      id: occ.occurrence_id,
      label: occ.logical_path ?? shortId(String(occ.occurrence_id ?? "")),
      kind,
      color: kindColor(kind),
      badge: occ.entry_kind,
      raw: occ,
    };
  });
  const ids = new Set(nodes.map((n) => n.id));
  const edges: NormEdge[] = occurrences
    .filter((occ: any) => occ.parent_occurrence_id && ids.has(occ.parent_occurrence_id))
    .map((occ: any) => ({
      id: `occ::${occ.occurrence_id}`,
      source: occ.parent_occurrence_id,
      target: occ.occurrence_id,
      label: "contains",
      raw: occ,
    }));
  const roots = occurrences
    .filter((occ: any) => !occ.parent_occurrence_id)
    .map((occ: any) => occ.occurrence_id);
  const limitations: string[] = Array.isArray(inv.limitations) ? inv.limitations : [];
  return {
    format: "artifact-inventory",
    formatLabel: "产物/目录清单图 (Artifact Inventory)",
    view: "app",
    nodes,
    edges,
    roots,
    paths: [],
    coverage: inv.coverage_status ?? inv.coverage?.status,
    limitations,
    meta: {
      manifest_id: inv.manifest?.manifest_id,
      root_format: inv.manifest?.root_format,
      node_count: nodes.length,
      edge_count: edges.length,
    },
  };
}

function buildCallGraph(o: any): NormGraph {
  const nodeMap = new Map<string, NormNode>();
  const edgeList: NormEdge[] = [];
  const edgeSeen = new Set<string>();
  const paths: NormPath[] = [];

  const addNode = (address: string, name: string | null | undefined, raw: unknown) => {
    if (!address) return;
    if (!nodeMap.has(address)) {
      nodeMap.set(address, {
        id: address,
        label: name ? `${name}` : address,
        kind: "function",
        color: kindColor("function"),
        badge: address,
        raw: raw ?? { address, name },
      });
    } else if (name && nodeMap.get(address)!.label === address) {
      nodeMap.get(address)!.label = name;
    }
  };
  const addEdge = (source: string, target: string, raw: unknown) => {
    const id = `${source}->${target}`;
    if (edgeSeen.has(id)) return id;
    edgeSeen.add(id);
    edgeList.push({ id, source, target, label: "", raw: raw ?? { source, target } });
    return id;
  };

  for (const path of Array.isArray(o.paths) ? o.paths : []) {
    const nodeIds: string[] = [];
    for (const n of path.nodes ?? []) {
      addNode(n.address, n.name, n);
      nodeIds.push(n.address);
    }
    const edgeIds: string[] = [];
    for (const e of path.edges ?? []) {
      edgeIds.push(addEdge(e.source, e.target, e));
    }
    paths.push({ nodeIds, edgeIds });
  }

  // Generic call graph (nodes/edges) without explicit paths.
  if (paths.length === 0 && Array.isArray(o.nodes)) {
    for (const n of o.nodes) {
      const addr = n.address ?? n.id ?? n.node_id;
      addNode(String(addr), n.name ?? n.label ?? n.display_name, n);
    }
    for (const e of Array.isArray(o.edges) ? o.edges : []) {
      const source = String(e.source ?? e.source_address ?? e.from ?? "");
      const target = String(e.target ?? e.target_address ?? e.to ?? "");
      if (source && target) addEdge(source, target, e);
    }
  }

  const startId = typeof o.start === "string" ? o.start : undefined;
  const goalId = typeof o.goal === "string" ? o.goal : undefined;
  if (startId) addNode(startId, undefined, { address: startId });
  if (goalId) addNode(goalId, undefined, { address: goalId });

  const nodes = [...nodeMap.values()];
  const limitations: string[] = Array.isArray(o.limitations) ? o.limitations : [];
  return {
    format: "call-graph",
    formatLabel: "调用图 / 调用路径 (Call Graph)",
    view: "call",
    nodes,
    edges: edgeList,
    roots: startId ? [startId] : [],
    paths,
    startId,
    goalId,
    coverage: undefined,
    limitations,
    meta: {
      status: o.status,
      shortest_hops: o.shortest_hops,
      explored: o.explored,
      path_count: paths.length,
      node_count: nodes.length,
      edge_count: edgeList.length,
    },
  };
}

function buildGenericGraph(o: any): NormGraph {
  const nodes: NormNode[] = (o.nodes ?? []).map((n: any, i: number) => {
    const id = String(n.id ?? n.node_id ?? n.name ?? `node_${i}`);
    const kind = String(n.kind ?? n.type ?? "node");
    return {
      id,
      label: String(n.label ?? n.name ?? n.title ?? id),
      kind,
      color: kindColor(kind),
      raw: n,
    };
  });
  const ids = new Set(nodes.map((n) => n.id));
  const edges: NormEdge[] = (o.edges ?? [])
    .map((e: any, i: number) => {
      const source = String(e.source ?? e.source_node_id ?? e.from ?? "");
      const target = String(e.target ?? e.target_node_id ?? e.to ?? "");
      return {
        id: String(e.id ?? e.edge_id ?? `edge_${i}`),
        source,
        target,
        label: String(e.label ?? e.relation ?? e.type ?? ""),
        raw: e,
      };
    })
    .filter((e: NormEdge) => ids.has(e.source) && ids.has(e.target));
  const limitations: string[] = Array.isArray(o.limitations) ? o.limitations : [];
  return {
    format: "generic-graph",
    formatLabel: "通用图 (Generic Graph)",
    view: "call",
    nodes,
    edges,
    roots: Array.isArray(o.root_node_ids) ? o.root_node_ids : [],
    paths: [],
    limitations,
    meta: { node_count: nodes.length, edge_count: edges.length },
  };
}

/** Convert any supported REA JSON payload into the viewer's unified graph shape. */
export function normalize(raw: unknown): NormGraph {
  const payload = findPayload(raw);
  const format = detectFormat(payload);
  switch (format) {
    case "application-graph":
      return buildApplicationGraph(payload);
    case "artifact-inventory":
      return buildArtifactInventory(payload);
    case "call-graph":
      return buildCallGraph(payload);
    case "generic-graph":
      return buildGenericGraph(payload);
    default:
      return {
        format: "unknown",
        formatLabel: "未识别的结构",
        view: "app",
        nodes: [],
        edges: [],
        roots: [],
        paths: [],
        limitations: [],
        meta: {},
      };
  }
}
