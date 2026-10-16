# 雷点记录（Pitfalls）· 工作前必读

> **给所有 agent 的强制规则：在本仓库做任何事之前，先完整读一遍本文件。**
> 本项目踩过的坑都记在这里，避免重复踩。遇到新的坑，追加到「一、雷点清单」，并写明现象 / 原因 / 处置。

---

## 0. 项目是什么

- 项目名：`rea-viewer`（REA Viewer）。
- 作用：给 **REA（Reverse Engineer Anything，`rea-agents`）** 的 CLI/MCP JSON 输出做可视化。两个视图：**应用/产物关系图**、**调用图/调用路径**。
- 技术栈：Electron（主进程用 CJS）+ Vite + React + TypeScript + Cytoscape。
- 关键目录：
  - `electron/main.cjs`：主进程，负责 spawn `rea` 命令、文件读取、设置持久化。
  - `electron/preload.cjs`：contextBridge 暴露 `window.rea`。
  - `src/lib/normalize.ts`：把各种 REA JSON 归一化成统一 `nodes/edges`。
  - `src/components/`：`GraphView`（Cytoscape 图）、`SourcePanel`（数据源）、`DetailPanel`（详情）。

### 常用命令

```bash
npm install          # 首次；Electron 走镜像（见雷点 #1）
npm run typecheck    # tsc --noEmit
npm run build        # vite build -> dist/
npm run dev          # Vite + Electron 开发模式
npm start            # 用 dist/ 启动 Electron（需先 build）
```

---

## 一、雷点清单

### #1 Electron 二进制下载失败（GitHub 不可达）

- **现象**：`npm install` 报 `RequestError: connect ETIMEDOUT 20.205.243.166:443`，或 `EPERM ... mkdir 'C:\Users\...\AppData\Local\electron'`。
- **原因**：Electron 的二进制托管在 GitHub，本机网络不可达；且默认缓存目录可能被沙箱/系统拦截。
- **处置**：安装前设置镜像 + 把缓存改到工作区内：
  ```powershell
  $env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
  $env:ELECTRON_CACHE="D:\REA_Test\.electron-cache"
  npm install
  ```
  缓存目录 `.electron-cache` 不要删，否则重装要重新下载。

### #2 REA Windows 原生自检报 DACL 错（"Private object requires a present protected DACL"，Win32 5 拒绝访问）

- **现象**：跑 `analyze-javascript-application` 等命令时，输出里出现
  `REA Windows native self-test failed: Private object requires a present protected DACL [...\Temp\rea-native-probe-...] (Win32 5): 拒绝访问。`
- **原因**：这是 REA 的 **Windows 原生插件自检**（`dist/windows/WindowsNativeLoader.js` 里 `binding.call("inspect", [])`）。它会在**进程临时目录**建一个要求"受保护 DACL"的探针对象。当时 **agent 沙箱正在拦截 `C:\Users\USER\AppData\Local\*`**（同期 `npm install` 写 `AppData\Local\electron` 也被拒），于是探针创建被拒 → 误报为 DACL 问题。
- **性质**：**这是环境问题，不是 REA 的 bug**；REA 已把该失败标记为 `retryable`，换个正常上下文重跑即可（实测同环境重跑 20 次全过）。
- **处置**：
  1. 确认进程 `TEMP`/`TMP` 是可写的**本地 NTFS** 目录（不要网络盘 / OneDrive / 被安全软件接管的目录）。查看：`node -e "console.log(require('os').tmpdir())"`。
  2. 别在会拦截 `AppData\Local` 的沙箱 / EDR 下跑 REA。
  3. **重试**即可。
  4. 本项目 Viewer 的「数据源 → 高级：REA 启动配置 → 临时目录 TEMP/TMP」可显式指定健康目录，并会在这条错误出现时给出提示。

### #3 REA 退出码非 0，但输出里仍有可用的图

- **现象**：命令 `exit=1`，但 stdout 是一段 `{"error":...,"partial_observation":{...,"normalized_result":{"graph":{...}}}}`。
- **原因**：当分析被中断（如雷点 #2）时，REA 会在错误信封里保留**部分图**（partial graph）。
- **处置**：不要一看到非 0 退出码就丢弃输出。`src/lib/normalize.ts` 已经会**深挖信封**（`deepFindGraph`）把内嵌图提取出来；Viewer 会照常渲染并弹警告。人工排查时也先看 `partial_observation.normalized_result.graph`。

### #4 `rea doctor` 查不出原生自检问题

- **现象**：`rea doctor` 显示 node/host 正常，但实际用到原生能力时自检失败。
- **原因**：Windows 原生自检是**惰性加载**的，`doctor` 只检查 node/host/Hopper/Ghidra/IDA/JADX/skill/注册，不加载原生插件。
- **处置**：别用 `rea doctor` 判断雷点 #2；要直接跑目标命令，或直接压测原生插件：
  ```js
  const b = require("<rea-agents>/native/windows/build/rea-windows-x64.node");
  b.call("inspect", []);   // 成功会返回 { privateDacl: true, ... }
  ```

### #5 读 REA 输出时：进度在 stderr，结果在 stdout

- **现象**：终端刷一堆 `{"rea_progress":...}`，但重定向到文件里的却是干净的 JSON。
- **原因**：进度 JSON 走 **stderr**，结果 JSON 走 **stdout**；`--format json` 时 stdout 就是纯 JSON。
- **处置**：解析只认 stdout；但仍要容错（`normalize.ts` 的 `scanJsonValues` 会从混杂文本里挑出最像图的那个 JSON）。JSON 开关两者都行：`--json` 与 `--format json` 都验证可用。

### #6 provider 已装好却报「未配置」：`setx` 不影响已运行的进程

- **现象**：想跑 `decompile` / `xrefs` 等原生命令时不可用；`rea providers --format json` 里 `analysis_provider_candidates` 中 `id=ghidra` 报
  `status: unavailable` / `code: not_configured` / `reason: Set GHIDRA_INSTALL_DIR ...`，且 `diagnostics.install_dir = null`、`java_home` 指向 **JDK 17**。
- **原因**：REA 只从**子进程环境变量**读 `GHIDRA_INSTALL_DIR` / `JAVA_HOME`。本机 Ghidra + JDK 其实都装好了，用户级变量也用 `setx` 写进去了（`GHIDRA_INSTALL_DIR=D:\Ghidra_\ghidra_12.1.4_PUBLIC`、`JAVA_HOME=D:\jdk-21`，见 `REA-MCP-调用文档.md` 8.1），但 **`setx` 只写注册表、不影响已经启动的进程**——IDE / 终端会话仍继承旧环境（`GHIDRA_INSTALL_DIR` 为空 + 系统级 JDK 17），于是 REA 判定「未配置」。这不是 Ghidra 没装，是**当前进程看不见变量**。（`rea doctor` 也查不出，理由同 #4：惰性加载。）
- **现状（2026-10-16 实测，REA 6.5.0）**：
  - `ghidra`：已安装；**只要进程能看到上面两个变量就是 `available`**（本次在同一会话内 `$env:GHIDRA_INSTALL_DIR=...` 后，实测由 `not_configured` → `available`）。
  - `hopper`：`unsupported_host` —— **Windows 上直接不支持**，不是「没配」。
  - `ida`：`not_configured`（需 `REA_IDA_MCP_CONFIG`）。
  - `jadx`：不在 `PATH`，Android 反编译不可用。
- **处置**：
  1. **新开终端 / 重启 IDE**，让进程拿到新的用户级变量；验证：`"$env:GHIDRA_INSTALL_DIR"` 非空、`"$env:JAVA_HOME"` 指向 `D:\jdk-21`。
  2. 不想重启就在**当前会话**先设置再跑：
     ```powershell
     $env:GHIDRA_INSTALL_DIR="D:\Ghidra_\ghidra_12.1.4_PUBLIC"; $env:JAVA_HOME="D:\jdk-21"
     ```
  3. 或用 MCP 注册 / 本项目 Viewer 的 `env` 字段注入（只对 REA 子进程生效，见调用文档 8.1）。
  4. **JDK 必须 21+**：Ghidra 12.1.4 的硬要求；JDK 17 会让 8 项检查里只有 `java` 失败（`unsupported_version`）。
  5. 纯静态的 JavaScript/Electron 分析（`analyze-javascript-application`）**不需要** provider，可直接用。
- **排查一行命令**（别用 `rea doctor`；本机 `rea` 不在 PATH，走固定 node + `rea.mjs`）：
  ```powershell
  $rea = "C:\Users\USER\.workbuddy\binaries\node\versions\22.22.2-6\node.exe"
  $mjs = "C:\Users\USER\.workbuddy\binaries\node\versions\22.22.2-6\node_modules\rea-agents\scripts\rea.mjs"
  $j = & $rea $mjs providers --format json | ConvertFrom-Json
  $j.analysis_provider_candidates | ForEach-Object { "{0} => {1} / {2}" -f $_.provider.id, $_.availability.status, $_.availability.code }
  ```

### #7 主进程 CJS / 渲染层 ESM，别混用

- **原因**：`package.json` 未设 `"type": "module"`，`electron/*.cjs` 是 CommonJS；`src/**` 由 Vite 按 ESM 处理。
- **处置**：改主进程只用 `require`；改渲染层只用 `import`。新增 Electron 侧文件请继续用 `.cjs`。

### #8 终端跑 npm 报"因为在此系统上禁止运行脚本"（PSSecurityException / UnauthorizedAccess）

- **现象**：在 PowerShell 里 `npm install` 报
  `npm : 无法加载文件 E:\code_\node_\npm.ps1，因为在此系统上禁止运行脚本 ... FullyQualifiedErrorId : UnauthorizedAccess`。
- **原因**：该 PowerShell 会话的执行策略为 `Restricted`。**关键坑：Windows PowerShell 5.1 与 PowerShell 7 的执行策略分开存储**——在 `pwsh` 里设过，`powershell.exe`(5.1) 不一定生效（反之亦然，本机就踩了这个：pwsh 显示 RemoteSigned，5.1 仍是 Restricted）。
- **处置**（三选一）：
  1. **持久修复**（当前用户，无需管理员）：在**你实际用的那个** shell 里执行——
     5.1：`powershell.exe -Command "Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned -Force"`
     7：`Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned -Force`
  2. **仅当前窗口**：`Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass`
  3. **不改策略**：直接用 `npm.cmd install`（.cmd 批处理不走 PS 脚本策略）。
- **回退**：`Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy Undefined`。
- **排查**：`Get-ExecutionPolicy -List`；怀疑两者不一致时，分别用 `powershell.exe -NoProfile -Command "Get-ExecutionPolicy"` 与 `pwsh -NoProfile -Command "Get-ExecutionPolicy"` 对比。
- **验证**：新开窗口后 `npm -v` 能正常输出版本号即可。

### #9 `analyze-javascript-application` 不排除 node_modules，指到仓库根会"扫爆"

- **现象**：`analyze-javascript-application D:\REA_Test`（仓库根）会把 `node_modules` / `.electron-cache` / `dist` 等全部清单化，图巨大、耗时长。
- **原因**：REA 的 JS 应用清单**没有内置排除**（实测：含 `node_modules` 的目录，`relevant_files` 把里面的文件也算进去，图里出现 `node_modules/...` 节点）。该命令也**没有** `--exclude`/`--ignore` 参数，只有 `--source-path`（白名单，需逐一列出）和 `--max-semantic-nodes` 之类的上限。
- **处置**：
  1. **优先缩小扫描根**：把路径指向应用源码根，而不是仓库根。
  2. **限定分析范围（本项目已实现，首选）**：REA 没有 exclude，只有 `--source-path` **白名单**。Viewer 现在会按忽略规则**反推**出"要分析的文件"，生成 `--source-path` 列表传给 `analyze-javascript-application`，REA 便不再读取/解析 `node_modules` 等。
     - 实现：`electron/sources.cjs`（复刻 REA 的 `relevantKind()` 相关文件判定：`package.json` / `*.json` / `cjs|cts|mjs|mts|js|jsx|ts|tsx` / `*.html` / `*.map` / `*.node`，`.asar` 是容器不算）+ `SourcePanel.tsx` 的 `buildSourceSelection()`。
     - 开关：「高级 → 只分析未被忽略的文件」（设置项 `limitSources`，默认开）。
     - **硬约束**：`--source-path` 必须是 REA 清单里的**精确相关文件路径**；传一个不存在的路径会直接 `invalid_request` 报错（实测）。所以 Viewer 有兜底：一旦被拒就自动改为全量分析。
     - **省的是哪一段**：清单（inventory）仍会遍历全部文件（快），省掉的是**读取与解析**（慢）—— 即 progress 里 `Parsing and projecting N` 的 N。
  3. **展示层过滤**：`src/lib/filter.ts` 仍保留，用于过滤已经拿到的图（对已生成的大图依然有用）。
  4. 其它限流：`--max-semantic-nodes` 等。

### #10 AI 生成忽略规则需要 API key（环境变量）

- **现象**：点「高级 → AI 分析目录并生成忽略规则…」报"未找到 API key"。
- **原因**：该功能在 **Electron 主进程**里调用 DeepSeek（逻辑在 `electron/ai.cjs`），key **只从环境变量读取**，不落盘、不传给渲染层。
- **处置**（两种都行，改完重启应用生效）：
  1. 直接写进**仓库根目录 `.env`**（该文件已加入 `.gitignore`）：
     ```
     DEEPSEEK_API_KEY=sk-...
     ```
  2. 或用环境变量：`$env:DEEPSEEK_API_KEY="sk-..."; npm run dev`
- **加载顺序**（`electron/env.cjs`）：真实环境变量**优先**，不会被 `.env` 覆盖；`.env` 候选顺序为 `appPath/.env` → `cwd/.env` → `userData/.env`，同一个 key 先命中的生效。UI 上会显示"已检测到 key（来自 xxx）"，可直接看来源。
- **可覆盖项**：`REA_VIEWER_AI_KEY`（等价 key）、`DEEPSEEK_MODEL`（默认 `deepseek-v4-flash`，**已实测有效**）、`DEEPSEEK_BASE_URL`（默认 `https://api.deepseek.com`）。
- **设计说明**：目录树是**有界**的（默认深 2 层、最多 200 个目录，且不跟随符号链接），并且**不钻进** `node_modules`/`.git`/`dist` 等必然是噪音的目录（只列名字、不展开）——既避免大仓库把 prompt 撑爆，也让 UI 更快。返回值会归一化 glob（裸目录名自动变成 `**/名字`）并去重。

### #11 重跑前先停掉上一次启动的目标进程（electron / rea）

- **现象**：再次 `npm run dev` 或跑 `rea` 命令时报文件/端口被占用（`EBUSY` / `EPERM` / `EADDRINUSE`），或界面一直显示上一次的旧图。
- **原因**：上一次 spawn 出的 `rea` 子进程和 Electron 窗口没有真正结束，仍持有输出文件、`.electron-cache`、TEMP 探针对象的句柄；同时 Vite devserver 的端口也被占着。
- **处置**：
  1. **先停掉目标进程再重跑**：Windows 上用任务管理器结束残留的 `electron.exe` / `node.exe`；本项目里就是先停掉上一次 `npm run dev` / `npm start` 所在终端。
  2. agent 环境里用 `StopCommand` 停掉对应命令，不要新开终端硬跑（新命令会顶掉旧终端里的进程）。
  3. **浏览器/Electron 会留下子进程**：`StopCommand` 只停住启动它的那个命令，Chrome 等会继续跑子进程并锁住 `--user-data-dir`（本项目实测：headless Chrome 残留 8 个 chrome.exe，导致 `.tmp/chrome-profile` 删不掉）。清理前先按命令行过滤，**只杀自己的**：
     ```powershell
     Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" |
       Where-Object { $_.CommandLine -like '*REA_Test*' } |
       ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
     ```

### #12 REA runtime 被动观察：endpoint 必须是 URL，且不含调用边

- **现象1**：`list-javascript-runtime-targets 127.0.0.1:9229` 报 `Invalid CDP endpoint URL`。
- **原因/处置**：endpoint 必须写成 URL：`http://127.0.0.1:9229`（或 `ws://127.0.0.1:PORT/devtools/browser/ID`）。
- **现象2**：观察结果里**没有调用关系**——`require/import` 调用边、EventEmitter、Electron IPC、运行时值都出现在 `unavailable_without_instrumentation`。
- **原因**：被动模式**只发** `Runtime.enable` + `Debugger.enable`，不注入、不执行、不暂停、不改目标。它回答的是「运行时**加载了哪些脚本** / 执行上下文生命周期」，**不是**调用链。
- **用法**：
  1. 起目标：`node --inspect=127.0.0.1:9229 <script>`
  2. 列目标：`rea list-javascript-runtime-targets http://127.0.0.1:9229 --format json` → 取 `target_id`
  3. 观察：`rea observe-javascript-runtime http://127.0.0.1:9229 <target_id> --runtime-kind node --observation-ms 2000 --format json`
  4. 要调用链 / 运行时值：改用 Frida 主动插桩（`instrument-with-frida`）或其它 provider。

### #13 Frida 未随包安装；且它只能用「动态 import」加载

- **现象**：`list-frida-devices` / `instrument-with-frida` 不可用（`frida` 是 optionalDependency，本机首次安装时没装上）。
- **原因**：REA 里是 `await import("frida")`（见 `dist/frida/FridaInstrumentationManager.js`），**动态 import 不认 `NODE_PATH`**，所以必须放在 REA 自己能解析到的 `node_modules` 里。
- **处置**（本机已这样做过）：
  ```powershell
  # 1) 用镜像装（GitHub 直连会超时；npmmirror 可下到 prebuild）
  $env:FRIDA_BINARY_HOST_MIRROR="https://npmmirror.com/mirrors/frida/"
  npm install frida@17.23.2 --prefix <临时目录> --registry=https://registry.npmmirror.com
  # 2) 把 frida 拷到 REA 的解析链里（与 rea-agents 同级的 node_modules）
  Copy-Item -Recurse -Force <临时目录>\node_modules\frida <node版本的>\node_modules\frida
  ```
- **验证**：`rea list-frida-devices --format json` 应返回 `local` / `socket` / `barebone`。
- **注意**：脚本用 `send({...})` 输出，REA 会把它录成 `normalized_result.messages`；`send` 之外的东西不会进证据。

---

## 二、维护约定

- 新增雷点：追加到「一、雷点清单」，编号顺延，必须包含**现象 / 原因 / 处置**三要素。
- 本文件就是"工作前先读"的那个文件；不要删、不要改名。
