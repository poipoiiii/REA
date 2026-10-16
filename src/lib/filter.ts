import type { NormEdge, NormGraph, NormNode, NormPath } from "./types";

/** Default ignore patterns: dependency/build dirs nobody wants in the graph. */
export const DEFAULT_IGNORE_GLOBS = ["**/node_modules", "**/.git", "**/.electron-cache"].join("\n");

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Split user ignore text (newline / comma / semicolon separated) into glob patterns. */
export function parseGlobs(text: string): string[] {
  return (text ?? "")
    .split(/[\n,;]+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * Translate a glob into an anchored RegExp.
 * Supports `**` (any segments), `*` and `?`; a pattern also matches everything
 * beneath it, so `**​/node_modules` hides `node_modules/foo/bar.js`.
 */
function globToRegExp(pattern: string): RegExp {
  const p = pattern.trim().replace(/\\/g, "/");
  let source = "";
  for (let i = 0; i < p.length; i += 1) {
    const ch = p[i];
    if (ch === "*") {
      if (p[i + 1] === "*") {
        i += 1;
        if (p[i + 1] === "/") {
          i += 1;
          source += "(?:.*/)?";
        } else {
          source += ".*";
        }
      } else {
        source += "[^/]*";
      }
    } else if (ch === "?") {
      source += "[^/]";
    } else {
      source += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${source}(?:/.*)?$`, "i");
}

/** Build a predicate reporting whether a path is ignored by any pattern. */
export function makeIgnoreMatcher(globs: string[]): (path: string) => boolean {
  const patterns = globs.map(globToRegExp);
  if (patterns.length === 0) return () => false;
  return (path: string) => {
    if (!path) return false;
    const normalized = path.replace(/\\/g, "/");
    return patterns.some((pattern) => pattern.test(normalized));
  };
}

/** Best-effort path of a node, used for ignore matching. */
export function nodePath(node: NormNode): string {
  const raw = node.raw as any;
  const properties = raw?.observations?.[0]?.properties;
  if (properties && typeof properties.path === "string" && properties.path) return properties.path;
  if (raw && typeof raw.logical_path === "string" && raw.logical_path) return raw.logical_path;
  if (raw && typeof raw.identity?.path === "string" && raw.identity.path) return raw.identity.path;
  return node.label ?? "";
}

export type FilterResult = {
  graph: NormGraph;
  removedNodes: number;
  removedEdges: number;
};

/** Drop nodes whose path matches an ignore pattern, plus their now-dangling edges. */
export function filterGraph(graph: NormGraph, globs: string[]): FilterResult {
  const isIgnored = makeIgnoreMatcher(globs);
  if (globs.length === 0) return { graph, removedNodes: 0, removedEdges: 0 };

  const keptNodes: NormNode[] = [];
  const removed = new Set<string>();
  for (const node of graph.nodes) {
    if (isIgnored(nodePath(node))) removed.add(node.id);
    else keptNodes.push(node);
  }
  if (removed.size === 0) return { graph, removedNodes: 0, removedEdges: 0 };

  const keptIds = new Set(keptNodes.map((node) => node.id));
  const keptEdges: NormEdge[] = graph.edges.filter(
    (edge) => keptIds.has(edge.source) && keptIds.has(edge.target),
  );
  const keptEdgeIds = new Set(keptEdges.map((edge) => edge.id));
  const paths: NormPath[] = graph.paths
    .map((path) => ({
      nodeIds: path.nodeIds.filter((id) => keptIds.has(id)),
      edgeIds: path.edgeIds.filter((id) => keptEdgeIds.has(id)),
    }))
    .filter((path) => path.nodeIds.length > 0);

  return {
    graph: {
      ...graph,
      nodes: keptNodes,
      edges: keptEdges,
      paths,
      roots: graph.roots.filter((id) => keptIds.has(id)),
    },
    removedNodes: removed.size,
    removedEdges: graph.edges.length - keptEdges.length,
  };
}
