import { useState } from "react";

/* eslint-disable @typescript-eslint/no-explicit-any */

type RunResult = { ok: boolean; parsed: unknown };

type Props = {
  settings: ReaSettings | null;
  onSettingsChange: (patch: Partial<ReaSettings>) => void;
  run: (args: string, options?: { persistArgs?: string; deliver?: boolean }) => Promise<RunResult>;
  running: boolean;
  status: string | null;
  onCancel: () => void;
  onError: (message: string) => void;
};

type Channel = "inspector" | "electron" | "browser" | "frida";

const CHANNELS: {
  id: Channel;
  label: string;
  endpointKey: "endpointInspector" | "endpointElectron" | "endpointBrowser" | null;
  fallback: string;
}[] = [
  { id: "inspector", label: "Node / Electron Inspector", endpointKey: "endpointInspector", fallback: "http://127.0.0.1:9229" },
  { id: "electron", label: "Electron CDP", endpointKey: "endpointElectron", fallback: "http://127.0.0.1:9222" },
  { id: "browser", label: "浏览器 CDP", endpointKey: "endpointBrowser", fallback: "http://127.0.0.1:9223" },
  { id: "frida", label: "Frida 进程", endpointKey: null, fallback: "" },
];

type Choice = { id: string; label: string; detail: string };

/** list-*-targets results: `normalized_result.targets[]`. */
export function extractTargets(parsed: any): Choice[] {
  const list = parsed?.normalized_result?.targets;
  if (!Array.isArray(list)) return [];
  return list
    .map((target: any) => ({
      id: String(target.target_id ?? target.deviceId ?? ""),
      label: String(target.title ?? target.name ?? target.type ?? target.target_id ?? ""),
      detail: String(
        target.url ??
          target.file_path ??
          target.location?.reported_url ??
          target.protocol_type ??
          "",
      ),
    }))
    .filter((choice: Choice) => choice.id.length > 0);
}

/** list-frida-processes result: `normalized_result.processes[]`. */
export function extractProcesses(parsed: any): Choice[] {
  const list = parsed?.normalized_result?.processes;
  if (!Array.isArray(list)) return [];
  return list
    .map((process: any) => ({
      id: String(process.pid ?? ""),
      label: String(process.name ?? ""),
      detail: `pid ${String(process.pid ?? "")}`,
    }))
    .filter((choice: Choice) => choice.id.length > 0);
}

function listCommand(channel: Channel, endpoint: string): string {
  switch (channel) {
    case "inspector":
      return `list-javascript-runtime-targets "${endpoint}"`;
    case "electron":
      return `list-electron-targets "${endpoint}"`;
    case "browser":
      return `list-browser-targets "${endpoint}"`;
    default:
      return "list-frida-processes";
  }
}

function observeCommand(
  channel: Channel,
  endpoint: string,
  targetId: string,
  observationMs: number,
  frida: { mode: string; script: string },
): string {
  switch (channel) {
    case "inspector":
      return `observe-javascript-runtime "${endpoint}" ${targetId} --runtime-kind node --observation-ms ${observationMs}`;
    case "electron":
      return `inspect-electron-page "${endpoint}" ${targetId} --observation-ms ${observationMs}`;
    case "browser":
      return `inspect-web-page "${endpoint}" ${targetId} --observation-ms ${observationMs} --include-console-text`;
    default: {
      const script = frida.script ? ` --script-file "${frida.script}"` : "";
      return `instrument-with-frida ${frida.mode || "attach"} ${targetId}${script} --duration-ms ${observationMs}`;
    }
  }
}

export function RuntimePanel({
  settings,
  onSettingsChange,
  run,
  running,
  status,
  onCancel,
  onError,
}: Props) {
  const [choices, setChoices] = useState<Choice[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [discovering, setDiscovering] = useState(false);

  const channel = (settings?.runtimeChannel as Channel) || "inspector";
  const descriptor = CHANNELS.find((entry) => entry.id === channel) ?? CHANNELS[0];
  const endpoint = descriptor.endpointKey
    ? settings?.[descriptor.endpointKey] || descriptor.fallback
    : "";
  const observationMs = settings?.observationMs ?? 2000;
  const fridaMode = settings?.fridaMode || "attach";
  const fridaTarget = settings?.fridaTarget ?? "";
  const fridaScript = settings?.fridaScript ?? "";

  function switchChannel(next: Channel) {
    onSettingsChange({ runtimeChannel: next });
    setChoices([]);
    setSelected("");
  }

  async function discover() {
    if (descriptor.endpointKey && !endpoint.trim()) {
      onError("请先填写端点，例如 http://127.0.0.1:9229");
      return;
    }
    setDiscovering(true);
    setChoices([]);
    setSelected("");
    try {
      const result = await run(listCommand(channel, endpoint.trim()), { deliver: false });
      const found = channel === "frida" ? extractProcesses(result.parsed) : extractTargets(result.parsed);
      setChoices(found);
      if (found.length === 0) onError("没有发现可用目标（检查端点和目标进程是否在运行）。");
    } finally {
      setDiscovering(false);
    }
  }

  async function observe() {
    const targetId = channel === "frida" ? fridaTarget.trim() : selected;
    if (!targetId) {
      onError(channel === "frida" ? "请先填写 PID 或选择进程" : "请先在列表里选择一个目标");
      return;
    }
    const command = observeCommand(channel, endpoint.trim(), targetId, observationMs, {
      mode: fridaMode,
      script: fridaScript,
    });
    await run(command, { persistArgs: command });
  }

  async function pickScript() {
    const file = await window.rea.pickFile();
    if (file && !file.error) onSettingsChange({ fridaScript: file.path });
  }

  const busy = running || discovering;

  return (
    <div className="panel-section">
      <div className="seg">
        {CHANNELS.map((entry) => (
          <button
            key={entry.id}
            className={channel === entry.id ? "seg-item active" : "seg-item"}
            onClick={() => switchChannel(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {descriptor.endpointKey && (
        <label className="field">
          <span>端点（endpoint，必须是 URL）</span>
          <input
            className="input"
            value={endpoint}
            placeholder={descriptor.fallback}
            onChange={(event) => onSettingsChange({ [descriptor.endpointKey!]: event.target.value })}
          />
        </label>
      )}

      {channel === "frida" && (
        <>
          <div className="seg">
            {[
              { id: "attach", label: "attach（PID）" },
              { id: "spawn", label: "spawn（程序路径）" },
            ].map((entry) => (
              <button
                key={entry.id}
                className={fridaMode === entry.id ? "seg-item active" : "seg-item"}
                onClick={() => onSettingsChange({ fridaMode: entry.id })}
              >
                {entry.label}
              </button>
            ))}
          </div>
          <label className="field">
            <span>{fridaMode === "spawn" ? "程序路径" : "目标 PID"}</span>
            <input
              className="input"
              value={fridaTarget}
              placeholder={fridaMode === "spawn" ? "例如: C:\\path\\to\\app.exe" : "例如: 26948"}
              onChange={(event) => onSettingsChange({ fridaTarget: event.target.value })}
            />
          </label>
          <div className="row">
            <button className="btn" onClick={() => void pickScript()}>
              选择脚本文件…
            </button>
            <span className="muted ellipsis" title={fridaScript}>
              {fridaScript || "未选择脚本（可留空）"}
            </span>
          </div>
        </>
      )}

      <div className="row">
        <button className="btn" disabled={busy} onClick={() => void discover()}>
          {discovering ? "发现中…" : channel === "frida" ? "列出进程" : "发现目标"}
        </button>
        <label className="field inline">
          <span>窗口 (ms)</span>
          <input
            className="input ms-input"
            type="number"
            min={100}
            step={100}
            value={observationMs}
            onChange={(event) =>
              onSettingsChange({ observationMs: Number(event.target.value) || 2000 })
            }
          />
        </label>
      </div>

      {choices.length > 0 && (
        <ul className="target-list">
          {choices.map((choice) => (
            <li key={choice.id}>
              <button
                className={selected === choice.id ? "target-item selected" : "target-item"}
                onClick={() => {
                  setSelected(choice.id);
                  if (channel === "frida") onSettingsChange({ fridaTarget: choice.id });
                }}
              >
                <span className="target-label ellipsis">{choice.label || choice.id}</span>
                <span className="target-detail ellipsis">{choice.detail || choice.id}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="row">
        <button className="btn primary grow" disabled={busy} onClick={() => void observe()}>
          {running ? "进行中…" : channel === "frida" ? "插桩并采集" : "观察选中目标"}
        </button>
        {running && (
          <button className="btn" onClick={onCancel}>
            取消
          </button>
        )}
      </div>

      {status && <p className="hint">{status}</p>}
      <p className="hint">
        目标从列表点选，不用手抄 ID；结果展示在中间「运行时」视图。这里不涉及目录与忽略规则。
      </p>
    </div>
  );
}
