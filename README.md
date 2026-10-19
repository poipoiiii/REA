# REA Viewer

给 [REA（Reverse Engineer Anything）](https://github.com/morluto/rea) 的 CLI / MCP JSON 输出做可视化的桌面工具。

REA 负责分析（全部本地执行、不上传目标），本仓库负责把它的 JSON 变成**图、表、运行时报告**，并提供"点选即跑命令"的编排层。

技术栈：Electron（主进程 CJS）+ Vite + React + TypeScript + Cytoscape。

## 三个视图

| 视图 | 吃的是什么输出 |
| --- | --- |
| 应用 / 产物关系图 | `analyze-javascript-application`、`project-*-application-graph`、`inspect-artifact` |
| 调用图 / 调用路径 | `trace` / `build-call-path` 形态（含 `start` / `goal` / `explored` / `paths`）的 JSON |
| 运行时 | Frida 插桩、V8 Inspector 被动观察、浏览器 CDP 的报告（facts + 列表 + limitations，不渲染图） |

归一化是格式驱动的，认不出形态时会退化成"通用图"或提示未识别结构。

## 数据源面板（左栏）

- **运行 REA 命令**：自动追加 `--format json`（若你已显式指定则不追加），实时 stdout / stderr 日志，可取消
- **预设命令**、**加载 JSON 文件**、**直接粘贴 JSON**
- **分析过程**分步展示
- **高级 · REA 启动配置**：node 路径、`rea.mjs` 脚本路径、回退可执行、工作目录、TEMP/TMP 覆盖
- **高级 · 忽略规则**：glob（默认 `**/node_modules`、`**/.git`、`**/.electron-cache`），只影响显示
- **高级 · 只分析未被忽略的文件**：按忽略规则反推白名单，生成 `--source-path` 传给 REA，减少读取与解析量
- **高级 · AI 分析目录并生成忽略规则**：调用 DeepSeek，key 只从环境变量 / `.env` 读取，不落盘、不下发到渲染层

中间是 Cytoscape 图（多种布局可切），右侧详情面板显示选中节点的**原始 JSON**、数据来源、被过滤的节点/边统计。

## 依赖

- Node.js（构建 + 启动 REA CLI）
- `rea-agents`（REA 本体）
- 可选：Ghidra + JDK 21+（原生 PE/DLL 分析）、Frida（动态插桩）、Chrome 系浏览器（网页 / CDP）、adb + JADX（Android）

## 快速开始

```powershell
# Electron 二进制走镜像（直连 GitHub 不可达时）
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
$env:ELECTRON_CACHE="D:\REA_Test\.electron-cache"
npm install
```

```bash
npm run dev        # Vite + Electron 开发模式
npm run typecheck  # tsc --noEmit
npm run build      # vite build -> dist/
npm start          # 用 dist/ 启动 Electron（需先 build）
npm run preview    # build + 启动
```

首次进入后到左栏「高级 → REA 启动配置」确认 node 路径与 `rea.mjs` 脚本路径（默认值指向本机的 node + rea-agents 安装位置）。

## 配置

设置持久化在 `<userData>/rea-viewer-settings.json`。

| 设置 | 说明 |
| --- | --- |
| `nodePath` / `scriptPath` | 设置了 scriptPath 时按 `<nodePath> <scriptPath> <args>` 启动 REA |
| `binPath` | scriptPath 为空时的回退可执行文件（例如全局安装的 `rea`） |
| `workdir` | 子进程工作目录，同时也是 `.env` 的候选位置 |
| `tempDir` | 覆盖子进程的 `TEMP` / `TMP`（REA 的 Windows 原生自检要求可写的本地 NTFS 目录） |
| `ignoreGlobs` | 忽略 glob，换行 / 逗号 / 分号分隔 |
| `limitSources` | 只分析未被忽略的文件（默认开） |
| `runtimeChannel` / `endpoint*` / `frida*` / `observationMs` | 运行时视图的通道、各端点（Inspector / Electron / 浏览器）、Frida 模式与脚本、观察时长 |

环境变量：

| 变量 | 用途 |
| --- | --- |
| `DEEPSEEK_API_KEY`（或 `REA_VIEWER_AI_KEY`） | AI 生成忽略规则 |
| `DEEPSEEK_MODEL` | 默认 `deepseek-v4-flash` |
| `DEEPSEEK_BASE_URL` | 默认 `https://api.deepseek.com` |
| `GHIDRA_INSTALL_DIR` / `JAVA_HOME` | 原生分析 provider；Ghidra 12.1.4 要求 JDK 21+ |

`.env` 候选顺序：`appPath/.env` → `cwd/.env` → `userData/.env`，真实环境变量优先，同一个 key 先命中的生效。

## 典型用法

1. **JS / Electron 应用**：`analyze-javascript-application <应用目录>` → 应用关系图
2. **原生 exe / dll**：`analyze <exe>` 取概览 → `search <exe> --kind procedures` 列函数 → `function <exe> <地址>` 拿 callers / callees / 伪代码。建议带 `--snapshot <文件>` 复用 Ghidra 会话，否则每条命令都要重新分析
3. **运行时观察**：`list-javascript-runtime-targets http://127.0.0.1:9229` → `observe-javascript-runtime <endpoint> <targetId>`；动态插桩用 Frida `instrument-with-frida attach <PID> --script-file hook.js`
4. **只看已有结果**：把 JSON 文件拖进来或直接粘贴到文本框

## 目录结构

```
electron/
  main.cjs      spawn REA、读文件、设置持久化、把 --format json 补上
  preload.cjs   contextBridge 暴露 window.rea
  env.cjs       .env 加载
  ai.cjs        DeepSeek 调用（生成忽略规则）
  sources.cjs   相关文件判定（反推 --source-path 白名单）
src/
  App.tsx       视图切换、过滤、选中态
  components/   SourcePanel（数据源）· GraphView（Cytoscape）· DetailPanel · RuntimePanel · RuntimeView
  lib/          normalize（JSON→图）· filter（忽略 glob）· runtime（运行时报告）· colors · types
```

## 已知限制

- Windows 上的 Ghidra provider 只接受 PE x86 / x86-64（外加显式选定的 raw 6502 镜像），不支持托管(.NET)目标、敌意/敏感目标、可变路径目标；会话内的重命名、注释等写操作不可用
- CLI **没有**「整程序调用图」命令（`get_call_graph`、`build_call_path` 等是 MCP-only），当前只能在 Viewer 里逐函数取 callers / callees 自行拼图
- `observe-native-calls` 依赖 macOS + LLDB；Windows 上做动态追踪只能走 Frida，且 hook 脚本需要自己写（脚本用 `send({...})` 回传才会被 REA 记进证据）
- REA 的进度输出在 **stderr**、结果在 **stdout**，非 0 退出码也可能带着可用的部分图
- 首次原生分析要启动 Ghidra，可能耗时较久（可用 `REA_GHIDRA_STARTUP_TIMEOUT_MS` 调整）

## 文档

- [`AGENTS.md`](./AGENTS.md)：雷点记录 —— **改这个仓库之前先读**
- [`REA-MCP-调用文档.md`](./REA-MCP-调用文档.md)：REA 的 MCP / CLI 能力、工具目录、本机 Ghidra 配置
