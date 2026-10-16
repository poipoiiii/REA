/** Deterministic colour per node kind so the same category is always the same hue. */
const FIXED: Record<string, string> = {
  // Artifact / application container kinds
  package: "#6ea8fe",
  installer: "#6ea8fe",
  artifact: "#6ea8fe",
  "asar-entry": "#8f7ff5",
  directory: "#8f7ff5",
  file: "#8f7ff5",
  slice: "#8f7ff5",
  symlink: "#8f7ff5",
  // Electron boundaries
  "electron-main": "#f0883e",
  "electron-preload": "#f0b93e",
  "electron-renderer": "#3fb950",
  "electron-utility": "#d29922",
  // JavaScript
  "javascript-asset": "#3fb950",
  "javascript-chunk": "#3fb950",
  "javascript-module": "#2ea043",
  "javascript-expression": "#56d364",
  "source-map": "#a371f7",
  "source-module": "#a371f7",
  // Web runtime
  "browser-window": "#58a6ff",
  frame: "#58a6ff",
  target: "#58a6ff",
  "context-bridge-api": "#db61a2",
  "ipc-channel": "#db61a2",
  "ipc-handler": "#db61a2",
  worker: "#79c0ff",
  "service-worker": "#79c0ff",
  endpoint: "#79c0ff",
  storage: "#d29922",
  // Native / managed
  "native-addon": "#f85149",
  "native-export": "#f85149",
  "managed-assembly": "#ff7b72",
  "managed-module": "#ff7b72",
  "managed-type": "#ffa198",
  "managed-method": "#ffa198",
  "managed-field": "#ffc1bc",
  "managed-pinvoke-import": "#f85149",
  "managed-native-implementation": "#f85149",
  "runtime-script-instance": "#79c0ff",
  unknown: "#8b949e",
};

const PALETTE = [
  "#6ea8fe",
  "#3fb950",
  "#f0883e",
  "#a371f7",
  "#db61a2",
  "#79c0ff",
  "#d29922",
  "#f85149",
  "#56d364",
  "#ffa198",
];

function hash(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) {
    h = (h * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function kindColor(kind: string): string {
  if (!kind) return FIXED.unknown;
  const key = kind.toLowerCase();
  if (FIXED[key]) return FIXED[key];
  const base = key.split(/[/\-:]/)[0] ?? key;
  if (FIXED[base]) return FIXED[base];
  return PALETTE[hash(key) % PALETTE.length];
}
