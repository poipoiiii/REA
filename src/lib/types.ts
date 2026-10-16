export type NormNode = {
  id: string;
  label: string;
  kind: string;
  color: string;
  badge?: string;
  raw: unknown;
};

export type NormEdge = {
  id: string;
  source: string;
  target: string;
  label: string;
  raw: unknown;
};

export type NormPath = {
  nodeIds: string[];
  edgeIds: string[];
};

export type GraphFormat =
  | "application-graph"
  | "artifact-inventory"
  | "call-graph"
  | "generic-graph"
  | "unknown";

export type NormGraph = {
  format: GraphFormat;
  formatLabel: string;
  view: "app" | "call";
  nodes: NormNode[];
  edges: NormEdge[];
  roots: string[];
  paths: NormPath[];
  startId?: string;
  goalId?: string;
  coverage?: string;
  limitations: string[];
  meta: Record<string, unknown>;
};
