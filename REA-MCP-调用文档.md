# REA MCP 调用文档

| 项目 | 内容 |
| --- | --- |
| MCP 服务名 | `rea`（注册名可自定） |
| 上游包 | `rea-agents` **6.5.0**（MIT） |
| MCP 注册 ID | `io.github.morluto/rea` |
| 本机安装位置 | `C:\Users\USER\.workbuddy\binaries\node\versions\22.22.2-6\node_modules\rea-agents` |
| 启动入口 | `scripts\rea.mjs --mcp`（等价 `scripts\rea.mjs mcp`） |
| 传输方式 | **stdio**（JSON-RPC 2.0，换行分隔） |
| 工具数量 | **207** 个 |
| 仓库 / 文档 | https://github.com/morluto/rea · https://rea.tools/ |

REA（Reverse Engineer Anything）把「逆向分析」包装成一个 MCP 服务：静态反汇编/反编译、动态调试插桩、JavaScript/Electron 源码还原、浏览器与抓包观测、Android/ADB、以及带 Evidence 结论与 unknown 账本的证据体系。所有分析在本地执行。

---

## 1. 能力范围

| 目标类型 | 主要产出 | 额外依赖 |
| --- | --- | --- |
| 原生二进制 | 伪代码、汇编、字符串、符号、调用与引用 | Hopper / Ghidra / IDA 之一 |
| Go 二进制 | 编译器版本、模块、依赖、构建设置 | 无（内置静态解析） |
| Rust 二进制 | cargo-auditable 依赖清单 | 无 |
| WASM | 校验、section、导入导出 WAT | WABT 1.0.42 |
| EVM 字节码 | 选择器分发、参数与可变性推断 | Linux x64 本地载体 |
| SQLite | 表/列/索引/视图/触发器与样例行 | Node 24.x ≥24.15 或 26+ |
| .NET 程序集 | 元数据、CIL 指令、P/Invoke 边界 | 无（仅静态） |
| JavaScript / Electron | 模块、导入、source map、路由、IPC | Node（Linux 另需 procps `ps`） |
| 网页 | 页面结构、脚本、网络观测、截图 | Chrome 系浏览器 |
| 抓包（HAR / SAZ / qlog） | 请求响应、载荷与来源位置 | mitmdump（Linux） |
| Android APK | Manifest、类、方法反编译、引用 | JADX + 完整 JDK |
| Android 设备 | 设备/包/进程/日志/截图/文件传输 | adb |
| JEB 工程 | 单元、摘要、类型/方法伪代码 | 需 `REA_JEB_MCP_URL` |
| Flutter 应用 | Dart 快照哈希、各 ABI 摘要 | 无 |
| 固件 / 信号 / 数据包 | 区域、提取结果、字段与解码 | Binwalk、sigrok、TShark（Linux） |
| 进程行为 | 终端输出、交互、退出码、文件系统观测 | Linux/macOS PTY |
| 任意包体 / 资源 | 文件清单、摘要、plist、Apple bundle 结构 | — |

---

## 2. 安装到客户端

### 2.1 Trae（本机 IDE）

Trae 读取两处配置，二选一即可。

**用户级（对所有工作区生效）**：`C:\Users\USER\AppData\Roaming\Trae CN\User\mcp.json`

**工作区级（仅当前项目，需要开启 `trae.mcp.enableWorkspaceMcp`）**：`<项目根>\.trae\mcp.json`

两处内容相同：

```json
{
  "mcpServers": {
    "rea": {
      "command": "C:\\Users\\USER\\.workbuddy\\binaries\\node\\versions\\22.22.2-6\\node.exe",
      "args": [
        "C:\\Users\\USER\\.workbuddy\\binaries\\node\\versions\\22.22.2-6\\node_modules\\rea-agents\\scripts\\rea.mjs",
        "--mcp"
      ]
    }
  }
}
```

字段说明（Trae 的 mcp 配置 schema）：

- `command` **必填**，可执行文件路径。
- `args` 参数数组，默认 `[]`。
- `env` 可选，键值均为字符串，用于注入环境变量（如 `REA_JEB_MCP_URL`）。
- `cwd` 可选，子进程工作目录。
- `disabled` 可选，`true` 时该服务被禁用而不被删除。
- 不支持 `command` 与 `url` 同时出现。

写入后需要 **重载窗口 / 新开会话**，MCP 工具才会加入会话工具集。

### 2.2 其他支持自动注册的 agent

```bash
npx rea-agents setup            # 交互式选择 agent，自动写入 MCP 注册 + 工作流说明
npx rea-agents@latest setup     # 升级后刷新注册
npx rea-agents@latest --llms    # 打印 LLM 可读的能力清单
```

### 2.3 全局 CLI（可选）

```bash
npm install --global rea-agents
rea --help
```

---

## 3. 自检与验证

```bash
# 1) 直接以 MCP stdio 模式启动（正常表现：阻塞等待 stdin，无输出即为正常）
"C:\Users\USER\.workbuddy\binaries\node\versions\22.22.2-6\node.exe" ^
  "C:\Users\USER\.workbuddy\binaries\node\versions\22.22.2-6\node_modules\rea-agents\scripts\rea.mjs" --mcp

# 2) MCP 注册诊断
node <...>\rea-agents\scripts\rea.mjs mcp doctor

# 3) 就绪状态 / 已配置的深度分析 provider / 能力与副作用
rea doctor
rea providers
rea capabilities
```

手工握手（把三行 JSON 通过 stdin 送入，可验证服务可用与工具总量）：

```jsonl
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"probe","version":"1.0"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}
```

实测：`initialize` 与 `tools/list` 均正常返回，`tools/list` 返回 207 个工具。

---

## 4. 三种调用方式

### 4.1 在 agent 中用自然语言触发（推荐）

MCP 工具会被 agent 自动路由，不需要手写 JSON：

```text
用 REA 打开 D:\targets\demo.exe，列出字符串里包含 "license" 的项，
追踪它们的交叉引用，把关键函数反编译出来并说明校验逻辑。
```

### 4.2 直接调用 MCP（JSON-RPC over stdio）

```jsonl
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"client","version":"1.0"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"open_binary","arguments":{"path":"D:\\targets\\demo.exe"}}}
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"search_strings","arguments":{"pattern":"license","mode":"literal"}}}
{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"procedure_pseudo_code","arguments":{"procedure":"0x100001230"}}}
```

要点：工具名与参数名即第 6 章的名称；`arguments` 省略必填参数会直接报错。

### 4.3 CLI 等价调用

绝大多数 `inspect_* / list_* / capture_* / *-adb-* / compare-*` 工具都有同名 kebab-case 命令，例如 `inspect-macho`、`list-adb-devices`、`capture-web-screenshot`、`compare-web-captures`。

核心工作流另有语义化命令：

| CLI 命令 | 作用 |
| --- | --- |
| `analyze` / `inspect` | 打开目标并给出概览 |
| `decompile` | 读取某个部分的代码 |
| `function` | 分析一个完整函数（带证据） |
| `instructions` | 读取原始指令（不反编译） |
| `search` | 搜索全部字符串或过程名 |
| `xrefs` | 列出指向某地址的引用 |
| `trace` | 按字面量追踪一处特性 |
| `compare` | 比较两个规范 Evidence 包 |
| `read-bytes` | 读取指定分析地址的内存字节 |
| `capture-process` | 捕获一个进程场景 |
| `debug-with-gdb` / `debug-with-rizin` | 临时调试器会话执行命令 |
| `capabilities` / `providers` / `doctor` | 能力、provider、就绪状态 |
| `setup` / `update` / `uninstall` | 注册、升级、卸载 |
| `mcp add` / `mcp doctor` | MCP 注册与其诊断 |

示例与全局输出选项：

```bash
rea analyze-javascript-application "D:/apps/example" --json
rea inspect-macho --format md
rea list-procedures --filter-output "procedures,a[0,3]"
rea xrefs --schema            # 打印该命令的 JSON Schema
rea --llms-full               # 打印完整 LLM 清单
```

全局选项：`--format <toon|json|yaml|md|jsonl>`、`--filter-output <keys>`、`--token-count` / `--token-limit` / `--token-offset`、`--full-output`、`--schema`、`--llms` / `--llms-full`、`--help`。

---

## 5. 典型调用流程

### 5.1 原生二进制：定位字符串 → 追引用 → 反编译

```text
open_binary(path="D:\targets\demo.exe")
  → binary_overview()                     # 目标、过程/字符串数量、段信息
  → search_strings(pattern="license", mode="literal")
  → xrefs(address="0x1000A1B0")           # 指向该字符串的引用
  → resolve_containing_procedure(address="0x100001230")
  → procedure_pseudo_code(procedure="sub_100001230")
  → procedure_assembly(procedure="sub_100001230")
  → inspect_native_instruction(address="0x10000123C")
  → set_comment(address="0x10000123C", comment="校验入口")
  → batch_decompile()                     # 批量反编译
```

补充：`procedure_callers/procedure_callees/procedure_references`、`get_call_graph`、`find_xrefs_to_name`、`read_function_instructions`、`search_bytes`、`trace_native_values`、`analyze_function`、`annotate_native_function`。

### 5.2 JavaScript / Electron：静态还原 + 运行时对账

```text
analyze_javascript_application(input_path="D:\apps\example")
  → inspect_analysis_view(source=<Evidence>, view=...)      # 分页查看应用图
  → trace_javascript_semantics(application=<Evidence>, query="clipboard")
  → recover_javascript_sources(path=..., output_directory=...)
  # 运行时（Node/Electron 需先用 --inspect 暴露 Inspector 端点）
  → list_javascript_runtime_targets(inspector_endpoint="http://127.0.0.1:9229")
  → observe_javascript_runtime(inspector_endpoint=..., target_id=...)
  → reconcile_javascript_runtime(static_layers=..., runtime_observations=...)
```

关键参数：`input_path` **必填**；`detail=summary|complete` 控制内联体积；`max_semantic_nodes`、`max_heap_mb`、`analysis_timeout_ms` 控制资源与超时。

### 5.3 网页：被动观测 → 截图 → 抽脚本做静态分析

```text
list_browser_targets(cdp_endpoint="http://127.0.0.1:9222")
  → inspect_web_page(cdp_endpoint=..., target_id=...)       # 不执行页面 JS、不导航
  → inspect_web_event_listeners(cdp_endpoint=..., target_id=..., selector="#submit")
  → capture_web_screenshot(cdp_endpoint=..., target_id=...)  # 仅当前视口，不滚动
  → observe_web_execution(cdp_endpoint=..., target_id=...)
  → export_web_scripts(capture_path=..., output_directory=...)
  → analyze_web_bundle(cdp_endpoint=..., target_id=...)
```

注意：`cdp_endpoint` 只接受回环地址（`http://127.0.0.1:PORT` 或 `ws://127.0.0.1:PORT/devtools/browser/ID`）；`target_id` 必须来自该端点的目标列表。

### 5.4 结论治理：unknown 账本 + Evidence 包 + 重建验证

```text
record_unknown(question="校验常量的来源与生成规则", severity="high", domain="native",
               required_authority="controlled-replay", required_confidence="observed",
               required_environment=null, recommended_probes=[...], relationships=[])
  → list_unknowns(status="open", limit=20)
  → update_unknown(unknown_id="unk_<64hex>", expected_revision=1, status="resolved", ...)
  → verify_unknown_resolution(unknown_id="unk_<64hex>")
  → export_evidence_bundle(path="D:\evidence\demo.json")
  → import_evidence_bundle(path="D:\evidence\demo.json")
  → verify_reconstruction(specification={...})
  → build_reconstruction_obligation_ledger(evidence_bundle=..., reviewed_obligations=..., manifest=...)
  → evaluate_reconstruction_coverage(coverage=..., boundary_id=...)
```

`update_unknown` 采用乐观并发：必须携带精确的 `expected_revision`，过期写入会被拒绝而不是覆盖。ID 形式固定为 `unk_[a-f0-9]{64}`、Evidence 为 `ev_[a-f0-9]{64}`。

---

## 6. 工具目录（207 个）

标注「必填：…」的参数缺失时会直接失败；其余参数均可选。

### 6.1 会话与目标管理（7）

- `open_binary`（必填：path）
- `close_binary`
- `binary_session`
- `binary_overview`
- `list_documents`
- `current_document`
- `get_navigation_context`

### 6.2 导航、命名、注释与书签（18）

- `current_address`
- `current_procedure`
- `goto_address`（必填：address）
- `next_address`
- `prev_address`
- `address_to_file_offset`（必填：address）
- `inspect_address_context`（必填：address）
- `resolve_containing_procedure`（必填：address）
- `list_bookmarks`
- `set_bookmark`（必填：address）
- `unset_bookmark`（必填：address）
- `comment`
- `set_comment`（必填：address, comment）
- `inline_comment`
- `set_inline_comment`（必填：address, comment）
- `address_name`
- `set_address_name`（必填：address, name）
- `set_addresses_names`（必填：names）

### 6.3 原生反汇编、反编译与内存（32）

- `analyze_function`（必填：procedure）
- `procedure_pseudo_code`（必填：procedure）
- `procedure_assembly`（必填：procedure）
- `procedure_info`（必填：procedure）
- `procedure_address`（必填：procedure）
- `procedure_callers`（必填：procedure）
- `procedure_callees`（必填：procedure）
- `procedure_references`（必填：procedure）
- `read_function_instructions`（必填：procedure）
- `batch_decompile`
- `list_procedures`
- `list_names`
- `list_strings`
- `list_segments`
- `search_procedures`（必填：pattern）
- `search_strings`（必填：pattern）
- `search_bytes`（必填：pattern）
- `read_bytes`（必填：address）
- `inspect_native_instruction`（必填：address）
- `inspect_native_api`（必填：procedure）
- `inspect_native_data_type`
- `inspect_native_dispatch_metadata`
- `inspect_native_load_image`
- `resolve_native_call_targets`（必填：address）
- `annotate_native_function`（必填：procedure）
- `trace_native_values`（必填：procedure）
- `execute_rizin_command`（必填：path, command）
- `xrefs`
- `find_xrefs_to_name`（必填：name）
- `get_call_graph`（必填：address）
- `analyze_swift_types`
- `demangle_swift`（必填：symbols）

### 6.4 动态调试与插桩（20）

- `start_frida_session`（必填：mode）
- `resume_frida_session`（必填：session_id）
- `close_frida_session`（必填：session_id）
- `frida_session_status`（必填：session_id）
- `load_frida_script`（必填：session_id, source_kind）
- `unload_frida_script`（必填：session_id, script_id）
- `instrument_with_frida`（必填：mode, source_kind）
- `list_frida_devices`
- `list_frida_processes`
- `start_gdb_session`
- `gdb_console`（必填：session_id, command）
- `gdb_session_status`（必填：session_id）
- `close_gdb_session`（必填：session_id）
- `start_rizin_debug_session`（必填：path, inferior_tty）
- `rizin_debug_command`（必填：session_id, command）
- `rizin_debug_session_status`（必填：session_id）
- `close_rizin_debug_session`（必填：session_id）
- `cutter_command`（必填：session_id, expected_generation, command）
- `list_cutter_sessions`
- `observe_native_calls`（必填：breakpoints）

### 6.5 进程与原生 UI 观察（4）

- `capture_process_scenario`（必填：executable）
- `capture_native_ui_scenario`（必填：pid, window_id, steps）
- `observe_native_ui`（必填：pid, window_id）
- `trace_native_ui_action`（必填：action）

### 6.6 二进制与包体格式检查（16）

- `inspect_binary_layout`（必填：path）
- `inspect_analysis_view`（必填：source, view）
- `list_architectures`
- `inspect_macho`
- `inspect_pe_resources`（必填：path）
- `inspect_plist`
- `inspect_signature`
- `inspect_artifact`
- `extract_artifact`
- `inspect_with_objdump`（必填：operation）
- `inspect_keyed_archive`
- `inspect_asset_catalog`
- `decode_interface_builder`
- `trace_dylib_resolution`
- `get_objc_classes`
- `get_objc_protocols`

### 6.7 Go / Rust / WASM / EVM / 托管(.NET) / SQLite（10）

- `inspect_go_binary`（必填：path）
- `inspect_rust_binary`（必填：path）
- `inspect_wasm_artifact`（必填：path）
- `inspect_evm_interface`（必填：path, encoding）
- `inspect_sqlite_database`（必填：path）
- `inspect_managed_artifact`
- `inspect_managed_members`
- `inspect_managed_native_boundaries`
- `import_managed_reconstruction`（必填：static_members, decompiler, methods）
- `verify_managed_native_boundaries`（必填：managed_boundaries, native_observations）

### 6.8 应用图投影（4）

- `project_android_application_graph`（必填：inventory_evidence）
- `project_apple_application_graph`（必填：inventory_evidence）
- `project_harmony_application_graph`（必填：inventory_evidence）
- `project_managed_application_graph`

### 6.9 Android / APK / Flutter / JEB（13）

- `inspect_android_package`（必填：path）
- `inspect_android_class`（必填：path, class_name）
- `inspect_android_method`（必填：path, class_name, method_name）
- `search_android_classes`（必填：path, query）
- `trace_android_references`（必填：path, class_name）
- `decode_android_resources`（必填：path）
- `inspect_apktool_client`
- `identify_flutter_build`（必填：path）
- `inspect_dart_aot`（必填：path）
- `inspect_jeb_client`
- `open_jeb_project`（必填：path）
- `list_jeb_units`
- `decompile_jeb_item`（必填：item_address, item_kind）

### 6.10 ADB 设备（24）

- `inspect_adb_client`
- `list_adb_devices`
- `inspect_adb_device`（必填：serial）
- `resolve_adb_packages`（必填：serial, query）
- `list_adb_packages`（必填：serial）
- `inspect_adb_package`（必填：serial, package）
- `list_adb_processes`（必填：serial）
- `list_adb_services`（必填：serial）
- `list_adb_features`（必填：serial）
- `inspect_adb_display`（必填：serial）
- `inspect_adb_window`（必填：serial）
- `read_adb_setting`（必填：serial, namespace, key）
- `list_adb_directory`（必填：serial, device_path）
- `pull_adb_file`（必填：serial, device_path, output_directory）
- `push_adb_file`（必填：serial, local_path, device_path）
- `pull_adb_package`（必填：serial, package, output_directory）
- `install_adb_package`（必填：serial, apk_path）
- `uninstall_adb_package`（必填：serial, package）
- `start_adb_app`（必填：serial, package）
- `start_adb_activity`（必填：serial, action）
- `stop_adb_app`（必填：serial, package）
- `read_adb_logcat`（必填：serial）
- `capture_adb_screen`（必填：serial, output_directory）
- `collect_adb_bugreport`（必填：serial, output_directory）

### 6.11 JavaScript / Electron（12）

- `analyze_javascript_application`（必填：input_path）
- `analyze_web_bundle`（必填：cdp_endpoint, target_id）
- `recover_javascript_sources`（必填：path, output_directory）
- `trace_javascript_semantics`（必填：application, query）
- `compare_javascript_export_shapes`（必填：left_module_path, left_export_name, right_module_path, right_export_name, left, right）
- `list_javascript_runtime_targets`（必填：inspector_endpoint）
- `observe_javascript_runtime`（必填：inspector_endpoint, target_id）
- `reconcile_javascript_runtime`（必填：static_layers, runtime_observations）
- `inspect_electron_fuses`（必填：path）
- `list_electron_targets`（必填：cdp_endpoint）
- `inspect_electron_page`（必填：cdp_endpoint, target_id）
- `capture_electron_scenario`（必填：executable_path, application_path）

### 6.12 浏览器与网页（12）

- `list_browser_targets`（必填：cdp_endpoint）
- `inspect_web_page`（必填：cdp_endpoint, target_id）
- `capture_web_screenshot`（必填：cdp_endpoint, target_id）
- `inspect_web_event_listeners`（必填：cdp_endpoint, target_id, selector）
- `observe_web_execution`（必填：cdp_endpoint, target_id）
- `observe_web_session`（必填：cdp_endpoint, target_id）
- `discover_webmcp_tools`（必填：cdp_endpoint, target_id）
- `capture_browser_scenario`（必填：browser, start_url, actions）
- `export_web_scripts`（必填：capture_path, output_directory）
- `trace_web_module_imports`（必填：manifest_path, script_index）
- `trace_web_source_location`（必填：manifest_path, script_index, source_map, generated_position）
- `inspect_web_network_capture`（必填：capture_path, format）

### 6.13 抓包、固件、信号与崩溃（9）

- `inspect_packet_capture`（必填：path, fields）
- `inspect_packet_fields`
- `inspect_pcap_capture`（必填：path）
- `inspect_pcap_client`
- `inspect_firmware_regions`（必填：path）
- `extract_firmware`（必填：path, output_directory）
- `decode_signal_recording`（必填：path, decoders）
- `inspect_signal_decoders`
- `inspect_recorded_crash`（必填：path）

### 6.14 对比、追踪与变更（16）

- `compare_functions`（必填：left, right）
- `compare_artifacts`（必填：left, right）
- `compare_bundles`（必填：left_bundle_path, right_bundle_path）
- `compare_application_versions`（必填：left, right）
- `compare_process_captures`（必填：left, right）
- `compare_managed_members`（必填：left, right）
- `compare_wasm_interfaces`（必填：left, right, scope）
- `compare_web_captures`
- `compare_web_screenshots`（必填：before, after）
- `compare_source_to_bundle`（必填：reference, application）
- `find_changed_behavior`（必填：comparisons）
- `correlate_static_and_runtime`（必填：static_comparisons, runtime_comparisons, mappings）
- `trace_feature`（必填：query）
- `trace_application_feature`（必填：seed, application）
- `trace_call_path`（必填：start）
- `build_call_path`（必填：functions, start, goal）

### 6.15 证据账本与重建验证（10）

- `record_unknown`（必填：question, severity, domain, required_authority, required_confidence, required_environment, recommended_probes, relationships）
- `list_unknowns`
- `update_unknown`（必填：unknown_id, expected_revision, status, severity, supporting_evidence_ids, contradicting_evidence_ids, required_authority, required_confidence, required_environment, recommended_probes, relationships, resolution）
- `verify_unknown_resolution`（必填：unknown_id）
- `get_evidence_bundle`
- `export_evidence_bundle`（必填：path）
- `import_evidence_bundle`（必填：path）
- `verify_reconstruction`（必填：specification）
- `build_reconstruction_obligation_ledger`（必填：evidence_bundle, reviewed_obligations, manifest）
- `evaluate_reconstruction_coverage`（必填：coverage, boundary_id）

---

## 7. 参数与结果约定

**通用参数**

- `document`：目标文档名（provider 文档身份），省略时使用当前活动目标；用 `open_binary` 切换目标。
- `address`：provider 规范化地址，默认内存地址用 `0x` 前缀十六进制；Ghidra 还接受 `file-offset:0x...` 选择器。
- `procedure`：过程名或十六进制地址，二者皆可。
- `path`：多数情况要求**绝对路径**，相对路径会被拒绝。
- `detail`：`complete` 内联返回完整 Evidence；`summary` 把完整结果保留在本次会话中并只返回摘要，再用 `inspect_analysis_view` 分页取回。适合大目标（大框架、整站脚本、整包 APK）。
- 分页：如 `list_unknowns` 的 `offset` / `limit`。
- 证据身份：unknown 为 `unk_[a-f0-9]{64}`，Evidence 为 `ev_[a-f0-9]{64}`。
- 复杂对象参数（如 `specification`、`coverage`、`reviewed_obligations`）请先 `rea <command> --schema` 获取精确 JSON Schema。
- 每个工具在 MCP 元数据中带有 `readOnlyHint / destructiveHint / idempotentHint / openWorldHint` 注解，可用它判断是否需要确认副作用。

**结果形态**

- 文本类结果内联返回；写文件类操作（`extract_*`、`recover_javascript_sources`、`export_*`、`capture_*`）返回落盘路径与摘要。
- 截图/证据为内容寻址（content-addressed）产物，可用 `compare_web_screenshots` 等做差异比较。

---

## 8. 依赖与环境变量

**运行时要求**

- Node.js `^22.19.0 || ^24.11.0 || >=26.0.0`（本机 22.22.2，满足）。
- `inspect_sqlite_database` 需要 Node 24.x ≥24.15 或 26+，在 22.x 上不可用。
- 平台差异：固件（binwalk/unblob）、信号（sigrok）、数据包（TShark）、进程捕获（PTY）、mitmproxy、pwntools/pwndbg 相关能力以 **Linux** 为主；Windows 已验证的能力集中在原生二进制（Hopper/Ghidra/IDA）、Go/Rust/.NET、WASM、JavaScript/Electron、浏览器、Android APK（JADX + JDK）、ADB。

**环境变量**

| 变量 | 用途 |
| --- | --- |
| `GHIDRA_INSTALL_DIR` | Ghidra 安装根目录（**必须是绝对路径**，本机为 `D:\Ghidra_\ghidra_12.1.4_PUBLIC`）。未设置时 REA 退化为在 `PATH` 里找 `ghidra.bat` / `ghidraRun.bat` / `ghidra.exe` / `ghidraRun.exe` 自动发现 |
| `JAVA_HOME` | Ghidra provider 用它的 `bin\java.exe` 做 JDK 校验（区分 jdk/jre，不接受相对路径）。Ghidra 12.1.4 要求 **JDK 21+** |
| `REA_JEB_MCP_URL` | 指向已启动的 JEB MCP 客户端 |
| `REA_GHIDRA_STARTUP_TIMEOUT_MS` | Ghidra provider 启动超时（大二进制） |
| `REA_HOPPER_STARTUP_TIMEOUT_MS` | Hopper provider 启动超时（大二进制） |

可选调优项：`REA_GHIDRA_LANGUAGE_ID` / `REA_GHIDRA_COMPILER_SPEC_ID`（指定语言，后者必须与前者同用）、`REA_GHIDRA_SEED_FILE`（种子文件，绝对路径）、`REA_GHIDRA_DISABLED_ANALYZERS`、`REA_GHIDRA_NATIVEAOT_JAR`。

### 8.1 本机 Ghidra（原生分析 provider）

| 项目 | 值 |
| --- | --- |
| 安装根目录 | `D:\Ghidra_\ghidra_12.1.4_PUBLIC` |
| 版本 | `12.1.4`（取自 `Ghidra\application.properties` 的 `application.version`）——**正是 REA 6.5.0 已验证的构建**（`SUPPORTED_GHIDRA_VERSION = 12.1.4`） |
| headless 入口 | `D:\Ghidra_\ghidra_12.1.4_PUBLIC\support\analyzeHeadless.bat` |
| 原生反编译器 | `Ghidra\Features\Decompiler\os\win_x86_64\decompile.exe` |
| Java 要求 | `application.java.min=21`、`application.java.max=`（空 = 无上限）→ **需要 64 位完整 JDK 21+** |
| 本机 JDK | `D:\jdk-21`（Temurin **JDK 21.0.12.1+1 LTS**，便携解压，含 `javac.exe`；原有的 JDK 17 未改动） |
| 环境变量 | 用户级，`setx` 写入：`JAVA_HOME=D:\jdk-21`、`GHIDRA_INSTALL_DIR=D:\Ghidra_\ghidra_12.1.4_PUBLIC` |
| 当前状态 | ✅ `available`（8/8 检查通过，`java_version=21.0.12.1`） |

**定位顺序**：`GHIDRA_INSTALL_DIR`（显式设置优先级最高，即使路径失效也不会回退自动发现）→ 否则在 `PATH` 中查找 `ghidra.bat` / `ghidraRun.bat` / `ghidra.exe` / `ghidraRun.exe`，且要求同级存在 `Ghidra\application.properties` 与 `support\analyzeHeadless.bat`。本机该目录**不在 PATH**，所以必须显式设置 `GHIDRA_INSTALL_DIR`。

本机已用**用户级**环境变量配置完成：

```powershell
setx JAVA_HOME "D:\jdk-21"
setx GHIDRA_INSTALL_DIR "D:\Ghidra_\ghidra_12.1.4_PUBLIC"
```

若不想动全局环境变量，也可只用 MCP 注册的 `env` 字段覆盖（只对 REA 子进程生效）：

```json
"env": {
  "GHIDRA_INSTALL_DIR": "D:\\Ghidra_\\ghidra_12.1.4_PUBLIC",
  "JAVA_HOME": "D:\\jdk-21"
}
```

验证：

```powershell
rea providers --format json     # 看 analysis_provider_candidates 里 id=ghidra 的 availability
```

**实测（2026-10-16，REA 6.5.0）**：`id=ghidra` → `status: available`，8 项检查全部通过：

```
configuration / platform=win32 / architecture=x64 / installation / version=12.1.4
/ headless / native_decompiler（decompile.exe 报告 pe x86_64）/ java（21.0.12.1）
install_dir = D:/Ghidra_/ghidra_12.1.4_PUBLIC
```

踩坑记录：配置前 `JAVA_HOME` 指向 Temurin **JDK 17.0.17**，当时 Ghidra 前 7 项全过、**只有 `java` 失败**——

```
code:   unsupported_version
reason: Update JAVA_HOME to the root of a 64-bit full JDK 21 or newer installation.
```

换成 `D:\jdk-21` 即通过，**Ghidra 安装路径本身不需要改动，卡点只在 JDK 版本**。校验要求 **64 位完整 JDK**（JRE 不行，会区分 jdk/jre；也不接受相对路径）。

**生效时机**：`setx` 写入 `HKCU\Environment`，**只对之后新启动的进程生效**；已开着的 IDE / 终端不会自动继承（实测同一台机器上旧终端里 `$env:JAVA_HOME` 仍是 JDK 17），需**重启 Trae / 新开终端**。另外 `setx` 会保留写入时的正斜杠形式（`D:/jdk-21`、`D:/Ghidra_/ghidra_12.1.4_PUBLIC`），实测 REA 能正常解析。

**Windows Ghidra P0 的能力边界**（取自 `rea providers` 的 capabilities）：

- 接受原生 **x86 / x86-64 PE 应用与 DLL**，以及显式选择的 raw 6502 镜像。
- **不支持**：托管（.NET）目标、敌意/敏感目标、可变路径（mutable-path）目标。
- 依赖：匹配的 Windows x64 原生 addon、本地 NTFS 目标与运行时、Windows 10+；原生句柄会做路径准入、私有 DACL 与 Job Object 归属。
- 会话内元数据写操作 `set_address_name` / `set_addresses_names` 在 Windows 上**不可用**（`availability_code: unsupported_host`，"Windows Ghidra P0 does not admit database mutation"）；其余读操作（assembly / pseudo_code / xrefs / search_* / read_bytes 等）均 `available: true`。
- Windows 桥接走认证的 IPv4 回环（Node 的 path-based IPC 不暴露 Java AF_UNIX socket），端点文件内不含 bearer token。

同一份 `providers` 输出里的另两个原生 provider：Hopper `unsupported_host`（Windows 不支持），IDA `not_configured`（需 `REA_IDA_MCP_CONFIG`）。

**重要的使用边界**

- REA 只本地分析，不上传目标；目标是否被执行取决于具体工具（静态类不执行，`*_scenario`、调试、进程捕获会以你的用户权限运行目标）。
- 商用工具（IDA Pro/Hex-Rays、Hopper、JEB）需自行获得合法授权，REA 不提供任何授权或绕过能力。
- 定位：仅用于合法研究、教育、互操作、软件保存，以及你拥有或获授权分析的软件。

---

## 9. 故障排查

| 现象 | 处理 |
| --- | --- |
| agent 中看不到 `rea` 工具 | 确认 `mcp.json` 路径与 JSON 合法，然后重载窗口/新开会话（会话工具集在启动时固定） |
| 启动即退出并提示 "compiled runtime is missing" | 该安装的 `dist` 不完整，重装 `rea-agents` |
| Windows 路径问题 | `command` / `args` 用双反斜杠转义；`path` 参数用绝对路径 |
| 原生命令报无 provider | `rea providers` 查看已配置 provider，安装 Hopper/Ghidra/IDA 或指定 `provider_id` |
| `rea providers` 里 Ghidra 报 `unsupported_version` | `JAVA_HOME` 落到了低于 Ghidra 声明下限的 JDK（12.1.4 要 JDK 21+）。本机已用 `setx JAVA_HOME "D:\jdk-21"` 修好；复现时先确认**当前进程**拿到的 `JAVA_HOME` 是新值（详见 8.1） |
| 改了 `JAVA_HOME` / `GHIDRA_INSTALL_DIR` 但状态没变 | `setx` 只对之后新启动的进程生效；重启 Trae（MCP 子进程随之重启）或在新终端里用 `rea providers` 复核 |
| Ghidra 检测不到（candidates 里没有 ghidra） | 显式设 `GHIDRA_INSTALL_DIR` 为安装根目录的绝对路径；仅当它在 `PATH` 中时才可省略 |
| 大目标请求超时 | 用 `detail=summary`，或调大 `REA_GHIDRA_STARTUP_TIMEOUT_MS` / `REA_HOPPER_STARTUP_TIMEOUT_MS`，JS 分析可调 `analysis_timeout_ms` / `max_heap_mb` |
| `update_unknown` 报 stale | 重新 `list_unknowns` 取最新 `expected_revision` 再写 |
| 结果被截断 | 用 `--filter-output` / `--token-limit` / `--token-offset`（CLI），或 `inspect_analysis_view` 分页（MCP） |

---

## 10. 参考

- 仓库：https://github.com/morluto/rea
- 官网 / 指南 / 案例：https://rea.tools/ · https://rea.tools/guides/ · https://rea.tools/showcase/
- 包：https://www.npmjs.com/package/rea-agents
- 本机随包说明：`C:\Users\USER\.workbuddy\binaries\node\versions\22.22.2-6\node_modules\rea-agents\README.md`
- 能力与命令清单（动态生成）：`rea --help`、`rea --llms-full`、`rea <command> --schema`
