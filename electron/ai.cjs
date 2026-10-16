const path = require("node:path");
const fsp = require("node:fs/promises");

/** Model / endpoint defaults; both overridable through environment variables. */
const DEFAULT_MODEL = "deepseek-v4-flash";
const DEFAULT_BASE_URL = "https://api.deepseek.com";

const ENV_KEYS = ["DEEPSEEK_API_KEY", "REA_VIEWER_AI_KEY"];

const SYSTEM_PROMPT = [
  "你是逆向工程 / 代码审计的目录清理助手。用户会给出一个项目目录树。",
  "请判断哪些目录属于“分析时应忽略”的噪音，例如：",
  "依赖目录（node_modules、vendor、venv、site-packages、Pods、.yarn）、",
  "构建产物（dist、build、out、target、release、coverage、.next、.nuxt、.turbo）、",
  "缓存与临时目录（.cache、__pycache__、.pytest_cache、.electron-cache）、",
  "版本控制与 IDE（.git、.svn、.hg、.idea、.vscode）。",
  "不要忽略应用自身的源码目录。",
  "只输出 JSON，不要输出其它文字，格式为：",
  '{"ignore":["**/node_modules","**/dist"],"reason":"简要中文说明"}',
  "ignore 里的每一项是 glob；目录名请写成 **/名字，以便匹配任意层级。",
].join("\n");

/**
 * Directory names that are near-certain noise: they are still listed for the
 * model, but never descended into. This keeps listing fast on huge repos
 * (node_modules is by far the most expensive subtree).
 */
const PRUNED_DIRECTORY_NAMES = new Set([
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  "vendor",
  "dist",
  "build",
  "out",
  "target",
  "coverage",
  "__pycache__",
  ".cache",
  ".next",
  ".nuxt",
  ".turbo",
  ".venv",
  "venv",
  "site-packages",
  "pods",
  ".yarn",
  ".gradle",
  ".idea",
]);

/** Read a bounded directory tree so the prompt stays small even for huge repos. */
async function summarizeDirectory(root, options = {}) {
  const maxDepth = Number.isInteger(options.maxDepth) ? options.maxDepth : 2;
  const maxDirs = Number.isInteger(options.maxDirs) ? options.maxDirs : 200;
  const lines = [];
  let dirCount = 0;
  let truncated = false;

  async function visit(dir, depth, label) {
    if (dirCount >= maxDirs) {
      truncated = true;
      return;
    }
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    dirCount += 1;
    const fileCount = entries.filter((entry) => entry.isFile()).length;
    const dirs = entries
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
      .sort((a, b) => a.name.localeCompare(b.name));
    lines.push(`${"  ".repeat(depth)}${label}${fileCount ? ` (${fileCount} files)` : ""}`);
    if (depth >= maxDepth) {
      if (dirs.length > 0) lines.push(`${"  ".repeat(depth + 1)}… (${dirs.length} 个子目录未展开)`);
      return;
    }
    for (const dirEntry of dirs) {
      if (PRUNED_DIRECTORY_NAMES.has(dirEntry.name.toLowerCase())) {
        lines.push(`${"  ".repeat(depth + 1)}${dirEntry.name}/ (未展开)`);
        continue;
      }
      if (dirCount >= maxDirs) {
        truncated = true;
        lines.push(`${"  ".repeat(depth + 1)}… (目录过多，已截断)`);
        return;
      }
      await visit(path.join(dir, dirEntry.name), depth + 1, `${dirEntry.name}/`);
    }
  }

  await visit(root, 0, `${path.basename(root)}/`);
  return { tree: lines.join("\n"), dirCount, truncated };
}

/** Pull a JSON value out of a model reply (plain, fenced, or embedded). */
function extractJsonValue(text) {
  const raw = (text ?? "").trim();
  if (!raw) return null;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : raw).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    /* fall through */
  }
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch {
      /* fall through */
    }
  }
  return null;
}

/** Normalize an AI-provided pattern so a bare name matches at any depth. */
function normalizeGlob(pattern) {
  const trimmed = String(pattern ?? "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+$/, "");
  if (!trimmed) return "";
  if (trimmed.startsWith("/")) return trimmed.slice(1);
  const hasGlob = /[?*]/.test(trimmed);
  const hasSlash = trimmed.includes("/");
  if (!hasGlob && !hasSlash) return `**/${trimmed}`;
  return trimmed;
}

/** Normalize + de-duplicate a list of patterns, preserving order. */
function normalizeGlobList(list) {
  const seen = new Set();
  const out = [];
  for (const item of Array.isArray(list) ? list : []) {
    const glob = normalizeGlob(item);
    if (!glob || seen.has(glob.toLowerCase())) continue;
    seen.add(glob.toLowerCase());
    out.push(glob);
  }
  return out;
}

function resolveApiKey(env = process.env) {
  for (const name of ENV_KEYS) {
    const value = env[name];
    if (value && value.trim()) return value.trim();
  }
  return "";
}

/**
 * List a directory, ask the model which folders should be ignored, and return
 * normalized glob patterns. Throws on missing key or a failed request.
 */
async function suggestIgnoreGlobs({ dir, maxDepth, maxDirs } = {}, env = process.env) {
  if (!dir || !dir.trim()) throw new Error("未指定要分析的目录");
  const apiKey = resolveApiKey(env);
  if (!apiKey) {
    throw new Error(`未找到 API key：请设置环境变量 ${ENV_KEYS[0]}（或 ${ENV_KEYS[1]}）后重启应用。`);
  }
  const baseUrl = (env.DEEPSEEK_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const model = env.DEEPSEEK_MODEL || DEFAULT_MODEL;

  const { tree, dirCount, truncated } = await summarizeDirectory(dir, { maxDepth, maxDirs });

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `项目根目录: ${dir}\n\n目录树:\n${tree}` },
      ],
    }),
    signal: AbortSignal.timeout(60000),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`AI 请求失败 (HTTP ${response.status})：${body.slice(0, 400)}`);
  }
  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content ?? "";
  const parsed = extractJsonValue(content);
  if (!parsed || !Array.isArray(parsed.ignore)) {
    throw new Error(`AI 未返回可用的忽略规则（原始回复：${String(content).slice(0, 200)}）`);
  }
  // An empty list is a valid answer: the model judged nothing needs ignoring.
  const ignore = normalizeGlobList(parsed.ignore);
  return {
    ignore,
    reason: typeof parsed.reason === "string" ? parsed.reason : "",
    model,
    dir,
    dirCount,
    truncated,
    usage: payload?.usage ?? null,
  };
}

module.exports = {
  DEFAULT_MODEL,
  DEFAULT_BASE_URL,
  ENV_KEYS,
  SYSTEM_PROMPT,
  PRUNED_DIRECTORY_NAMES,
  summarizeDirectory,
  extractJsonValue,
  normalizeGlob,
  normalizeGlobList,
  resolveApiKey,
  suggestIgnoreGlobs,
};
