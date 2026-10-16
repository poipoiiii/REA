const path = require("node:path");
const fsp = require("node:fs/promises");

/**
 * Mirror of REA's own `relevantKind()` in JavaScriptArtifactFiles.js.
 * `--source-path` is rejected outright unless the path is an exact inventoried
 * relevant file, so this list must stay in sync with REA's definition.
 */
const JS_SOURCE_RE = /\.(?:cjs|cts|mjs|mts|js|jsx|ts|tsx)$/i;

function isRelevantSourcePath(relativePath) {
  const lower = relativePath.toLowerCase();
  // ASAR archives are containers, never selectable sources.
  if (lower.endsWith(".asar")) return false;
  if (lower === "package.json" || lower.endsWith("/package.json")) return true;
  if (lower.endsWith(".json")) return true;
  if (JS_SOURCE_RE.test(relativePath)) return true;
  if (/\.html?$/.test(lower)) return true;
  if (lower.endsWith(".map")) return true;
  if (lower.endsWith(".node")) return true;
  return false;
}

/**
 * List every REA-relevant file under `root` as a POSIX-style relative path
 * (the exact form `--source-path` expects). Symlinks are not followed.
 */
async function collectRelevantSourcePaths(root, options = {}) {
  const maxFiles = Number.isInteger(options.maxFiles) ? options.maxFiles : 20000;
  const files = [];
  let truncated = false;

  async function walk(dir, prefix) {
    if (files.length >= maxFiles) {
      truncated = true;
      return;
    }
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= maxFiles) {
        truncated = true;
        return;
      }
      if (entry.isSymbolicLink()) continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(path.join(dir, entry.name), relative);
      } else if (entry.isFile() && isRelevantSourcePath(relative)) {
        files.push(relative);
      }
    }
  }

  const target = String(root ?? "").trim();
  if (!target) throw new Error("未指定目录");
  await walk(target, "");
  files.sort();
  return { files, truncated };
}

module.exports = { isRelevantSourcePath, collectRelevantSourcePaths };
