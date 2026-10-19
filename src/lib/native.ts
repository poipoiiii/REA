import { kindColor } from "./colors";
import type { NormEdge, NormGraph, NormNode } from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */

export type NativeProcedure = {
  address: string;
  name: string;
  external: boolean;
  signature: string;
};

export type NativeDossier = {
  address: string;
  name: string;
  signature: string;
  callers: NativeProcedure[];
  callees: NativeProcedure[];
  incomingCalls: number;
  outgoingReferences: number;
  unresolvedCalls: number;
  basicBlocks: number;
  pseudocode: string;
  assembly: string[];
  limitations: string[];
};

function toProcedure(value: any): NativeProcedure | null {
  const address = typeof value?.address === "string" ? value.address : "";
  if (!address) return null;
  return {
    address,
    name: typeof value?.name === "string" ? value.name : address,
    external: value?.classification?.external === true || address.startsWith("EXTERNAL:"),
    signature: typeof value?.signature === "string" ? value.signature : "",
  };
}

/** `search --kind procedures` returns a bare array of `{ address, value }`. */
export function parseProcedures(parsed: any): NativeProcedure[] {
  const list = parsed?.normalized_result;
  if (!Array.isArray(list)) return [];
  const out: NativeProcedure[] = [];
  for (const item of list) {
    const address = typeof item?.address === "string" ? item.address : "";
    if (!address) continue;
    out.push({
      address,
      name: typeof item?.value === "string" && item.value ? item.value : address,
      external: address.startsWith("EXTERNAL:"),
      signature: "",
    });
  }
  return out;
}

/** `function <exe> <addr>` returns a complete function dossier. */
export function parseDossier(parsed: any): NativeDossier | null {
  const result = parsed?.normalized_result;
  if (!result || !result.procedure) return null;
  const self = toProcedure(result.procedure);
  if (!self) return null;
  return {
    address: self.address,
    name: self.name,
    signature: typeof result.procedure.signature === "string" ? result.procedure.signature : "",
    callers: (Array.isArray(result.callers) ? result.callers : [])
      .map(toProcedure)
      .filter((item: NativeProcedure | null): item is NativeProcedure => item !== null),
    callees: (Array.isArray(result.callees) ? result.callees : [])
      .map(toProcedure)
      .filter((item: NativeProcedure | null): item is NativeProcedure => item !== null),
    // Count only references whose kind says they are real calls.
    incomingCalls: (Array.isArray(result.incoming_references) ? result.incoming_references : []).filter(
      (reference: any) => reference?.kind?.call === true,
    ).length,
    outgoingReferences: Array.isArray(result.outgoing_references) ? result.outgoing_references.length : 0,
    unresolvedCalls: Array.isArray(result.unresolved_calls) ? result.unresolved_calls.length : 0,
    basicBlocks: Array.isArray(result.basic_blocks) ? result.basic_blocks.length : 0,
    pseudocode: typeof result.pseudocode === "string" ? result.pseudocode : "",
    assembly: (Array.isArray(result.assembly) ? result.assembly : []).map((line: any) => String(line)),
    limitations: (Array.isArray(result.limitations) ? result.limitations : []).map((line: any) => String(line)),
  };
}

const nodeKind = (procedure: NativeProcedure) => (procedure.external ? "external" : "function");

/** Build a call graph from every dossier fetched so far. */
export function buildCallGraph(
  dossiers: Map<string, NativeDossier>,
  roots: string[],
  source: string,
): NormGraph {
  const nodes = new Map<string, NormNode>();
  const edges = new Map<string, NormEdge>();

  const addNode = (procedure: NativeProcedure) => {
    if (nodes.has(procedure.address)) return;
    const kind = nodeKind(procedure);
    nodes.set(procedure.address, {
      id: procedure.address,
      label: procedure.name,
      kind,
      color: kindColor(kind),
      badge: procedure.external ? "external" : procedure.signature || undefined,
      raw: procedure,
    });
  };

  for (const dossier of dossiers.values()) {
    const self: NativeProcedure = {
      address: dossier.address,
      name: dossier.name,
      external: false,
      signature: dossier.signature,
    };
    addNode(self);
    for (const callee of dossier.callees) {
      addNode(callee);
      const id = `${dossier.address}->${callee.address}`;
      if (!edges.has(id)) {
        edges.set(id, {
          id,
          source: dossier.address,
          target: callee.address,
          label: "calls",
          raw: { source: dossier.address, target: callee.address },
        });
      }
    }
    for (const caller of dossier.callers) {
      addNode(caller);
      // `callers` already tells us "caller calls this function", so the edge is known.
      const id = `${caller.address}->${dossier.address}`;
      if (!edges.has(id)) {
        edges.set(id, {
          id,
          source: caller.address,
          target: dossier.address,
          label: "calls",
          raw: { source: caller.address, target: dossier.address, inferred_from: "callers" },
        });
      }
    }
  }

  const nodeList = [...nodes.values()];
  const edgeList = [...edges.values()];
  const limitations = [
    "调用图由 REA 的 per-function dossier（callers/callees）在 Viewer 侧拼装，不是 REA 的权威整图。",
    "只包含已展开函数的调用边；未展开函数的关系未知。",
    "间接调用（函数指针）无法解析，计入每个函数的 unresolved_calls。",
  ];
  for (const dossier of dossiers.values()) {
    for (const line of dossier.limitations) if (!limitations.includes(line)) limitations.push(line);
  }

  return {
    format: "call-graph",
    formatLabel: "原生调用图（自拼）",
    view: "call",
    nodes: nodeList,
    edges: edgeList,
    roots: roots.filter((address) => nodes.has(address)),
    paths: [],
    limitations,
    meta: {
      source,
      expanded_functions: dossiers.size,
      node_count: nodeList.length,
      edge_count: edgeList.length,
    },
  };
}

/** `trace <exe> <query>`: matches plus referencing addresses with their containing function. */
export type NativeMatch = { type: string; address: string; value: string };

export type NativeReference = {
  targetAddress: string;
  sourceAddress: string;
  procedure: NativeProcedure | null;
  reason: string;
};

export type NativeTrace = {
  query: string;
  matches: NativeMatch[];
  references: NativeReference[];
  truncated: boolean;
  unknowns: string[];
};

export function parseTrace(parsed: any): NativeTrace | null {
  const result = parsed?.normalized_result;
  if (!result || !Array.isArray(result.matches)) return null;
  return {
    query: typeof result.query === "string" ? result.query : "",
    matches: result.matches.map((match: any) => ({
      type: typeof match?.type === "string" ? match.type : "?",
      address: typeof match?.address === "string" ? match.address : "",
      value: typeof match?.value === "string" ? match.value : "",
    })),
    references: (Array.isArray(result.references) ? result.references : []).map((reference: any) => ({
      targetAddress: typeof reference?.target_address === "string" ? reference.target_address : "",
      sourceAddress: typeof reference?.source_address === "string" ? reference.source_address : "",
      procedure: toProcedure(reference?.containing_procedure?.procedure),
      reason: typeof reference?.containing_procedure?.reason === "string"
        ? reference.containing_procedure.reason
        : "",
    })),
    truncated: result.truncated === true,
    unknowns: (Array.isArray(result.residual_unknowns) ? result.residual_unknowns : []).map((item: any) =>
      String(item),
    ),
  };
}

/** Snapshot lives next to the target so repeat runs reuse the Ghidra analysis. */
export function defaultSnapshotPath(exePath: string): string {
  const normalized = exePath.replace(/\\/g, "/");
  const slash = normalized.lastIndexOf("/");
  const dir = slash >= 0 ? normalized.slice(0, slash) : ".";
  const base = slash >= 0 ? normalized.slice(slash + 1) : normalized;
  return `${dir}/.rea-viewer/${base}.snapshot.json`;
}
