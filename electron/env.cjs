const fs = require("node:fs");

/**
 * Parse a .env file's text into key/value pairs.
 * Handles comments (#), blank lines, an optional `export ` prefix and
 * single/double quoted values. Malformed lines are ignored.
 */
function parseEnv(text) {
  const out = {};
  for (const rawLine of String(text ?? "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, "");
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = line.slice(eq + 1).trim();
    const quoted =
      (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));
    if (quoted && value.length >= 2) value = value.slice(1, -1);
    out[key] = value;
  }
  return out;
}

/**
 * Load one .env file into `env`. Existing non-empty variables are never
 * overwritten, so a real environment variable always wins over the file.
 */
function loadEnvFile(filePath, env = process.env) {
  let text;
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch {
    return { loaded: false, keys: [] };
  }
  const parsed = parseEnv(text);
  const applied = [];
  for (const [key, value] of Object.entries(parsed)) {
    if (env[key] !== undefined && env[key] !== "") continue;
    env[key] = value;
    applied.push(key);
  }
  return { loaded: true, keys: applied };
}

/** Load several .env files in order; the first file defining a key wins. */
function loadEnvFiles(paths, env = process.env) {
  const sources = [];
  const seen = new Set();
  for (const filePath of paths) {
    if (!filePath || seen.has(filePath)) continue;
    seen.add(filePath);
    const result = loadEnvFile(filePath, env);
    if (result.loaded) sources.push({ path: filePath, keys: result.keys });
  }
  return sources;
}

module.exports = { parseEnv, loadEnvFile, loadEnvFiles };
