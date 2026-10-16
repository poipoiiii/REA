/* eslint-disable @typescript-eslint/no-explicit-any */

export type RuntimeFact = { label: string; value: string };
export type RuntimeList = { title: string; rows: string[][] };
export type RuntimeReport = {
  operation: string;
  title: string;
  facts: RuntimeFact[];
  lists: RuntimeList[];
  limitations: string[];
  raw: unknown;
};

const MAX_ROWS = 200;

const text = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
};

const clip = (value: string, max = 160) => (value.length > max ? `${value.slice(0, max)}…` : value);

const push = (rows: string[][], row: string[]) => {
  if (rows.length < MAX_ROWS) rows.push(row.map((cell) => clip(cell)));
};

/** Runtime evidence never carries a graph; reject anything that does. */
function isRuntimePayload(payload: any): boolean {
  if (!payload || typeof payload !== "object") return false;
  if (payload.nodes || payload.edges || payload.occurrences) return false;
  if (payload.schema === "JavaScriptApplicationGraph") return false;
  return Boolean(
    payload.messages ||
      payload.execution_contexts ||
      payload.dom ||
      payload.console ||
      payload.network ||
      payload.targets ||
      payload.scripts ||
      payload.runtime ||
      payload.capture_window ||
      payload.browser,
  );
}

/** Runtime results sit under `normalized_result` (sometimes inside an `evidence` wrapper). */
function findPayload(raw: any): any | null {
  const candidates = [
    raw?.normalized_result,
    raw?.evidence?.normalized_result,
    raw?.result?.normalized_result,
    raw?.result,
    raw?.data,
  ];
  for (const candidate of candidates) {
    if (isRuntimePayload(candidate)) return candidate;
  }
  return isRuntimePayload(raw) ? raw : null;
}

function buildContracts(payload: any, operation: string): { title: string; facts: RuntimeFact[] } {
  if (payload.messages || payload.scripts?.[0]?.name !== undefined) {
    return {
      title: "Frida 插桩观察",
      facts: [
        { label: "模式", value: text(payload.mode) },
        { label: "目标", value: text(payload.target) },
        { label: "PID", value: text(payload.pid) },
        { label: "设备", value: text(payload.device_id) },
        { label: "状态", value: text(payload.state) },
        { label: "脚本数", value: text(payload.scripts?.length ?? 0) },
        { label: "消息数", value: text(payload.messages?.length ?? 0) },
      ],
    };
  }
  if (payload.dom || payload.console || payload.network) {
    return {
      title: "页面被动观察",
      facts: [
        { label: "标题", value: text(payload.target?.title) },
        { label: "URL", value: text(payload.target?.url ?? payload.target?.file_path) },
        { label: "观测窗口", value: `${text(payload.capture_window?.observation_ms)} ms` },
        { label: "DOM 节点", value: text(payload.dom?.total_nodes) },
        { label: "完整性", value: text(payload.completeness?.status) },
      ],
    };
  }
  if (payload.execution_contexts) {
    return {
      title: "JS 运行时观察",
      facts: [
        { label: "运行时", value: text(payload.runtime?.product) },
        { label: "目标", value: text(payload.target?.runtime_kind ?? payload.target?.target_id) },
        { label: "观测窗口", value: `${text(payload.capture?.observation_ms)} ms` },
        { label: "事件", value: `${text(payload.capture?.events_observed)} 观测 / ${text(payload.capture?.events_retained)} 保留` },
        { label: "脚本数", value: text(payload.scripts?.items?.length) },
      ],
    };
  }
  if (Array.isArray(payload.targets)) {
    return {
      title: "运行时目标列表",
      facts: [
        { label: "运行时/浏览器", value: text(payload.browser?.product ?? payload.runtime?.product) },
        { label: "目标数", value: text(payload.targets.length) },
      ],
    };
  }
  return { title: operation || "运行时证据", facts: [] };
}

/** Convert any supported REA runtime evidence into a renderable report. */
export function detectRuntime(raw: unknown): RuntimeReport | null {
  const payload = findPayload(raw);
  if (!payload) return null;
  const root = raw as any;
  const operation = text(
    root?.evidence?.operation ?? root?.operation ?? payload.operation ?? root?.evidence?.predicate_type,
  );
  const { title, facts } = buildContracts(payload, operation);
  const lists: RuntimeList[] = [];

  if (Array.isArray(payload.targets)) {
    const rows: string[][] = [];
    for (const target of payload.targets) {
      push(rows, [
        text(target.target_id ?? target.deviceId),
        text(target.type ?? target.type),
        text(target.title ?? target.name),
        text(target.url ?? target.file_path),
      ]);
    }
    lists.push({ title: `目标（${payload.targets.length}）`, rows });
  }

  const scripts = payload.scripts?.items ?? payload.scripts;
  if (Array.isArray(scripts) && scripts.length > 0) {
    const rows: string[][] = [];
    for (const script of scripts) {
      const location = script.location ?? {};
      rows.length < MAX_ROWS &&
        rows.push([
          clip(text(location.specifier ?? location.path ?? location.url ?? location.kind), 90),
          clip(text(location.kind), 20),
          text(script.length),
          text(script.status),
        ]);
    }
    lists.push({ title: `脚本（${scripts.length}${scripts.length > MAX_ROWS ? `，显示前 ${MAX_ROWS}` : ""}）`, rows });
  }

  if (Array.isArray(payload.messages)) {
    const rows: string[][] = [];
    for (const [index, message] of payload.messages.entries()) {
      push(rows, [String(index + 1), text(message.type), clip(text(message.payload), 200)]);
    }
    lists.push({ title: `Frida 消息 / send()（${payload.messages.length}）`, rows });
  }

  if (Array.isArray(payload.execution_contexts)) {
    const rows: string[][] = [];
    for (const context of payload.execution_contexts) {
      push(rows, [text(context.context_key), text(context.state), text(context.name)]);
    }
    lists.push({ title: `执行上下文（${payload.execution_contexts.length}）`, rows });
  }

  const consoleEvents = payload.console?.events;
  if (Array.isArray(consoleEvents) && consoleEvents.length > 0) {
    const rows: string[][] = [];
    for (const event of consoleEvents) {
      const values = event.text_capture?.values ?? [];
      const body = values.map((value: any) => text(value.text)).join(" ") || event.type;
      push(rows, [text(event.type), clip(body, 120), `${text(event.url)}:${text(event.line)}`]);
    }
    lists.push({ title: `控制台（${consoleEvents.length}）`, rows });
  }

  const requests = payload.network?.requests;
  if (Array.isArray(requests) && requests.length > 0) {
    const rows: string[][] = [];
    for (const request of requests) {
      push(rows, [text(request.method), clip(text(request.url), 120), text(request.status)]);
    }
    lists.push({ title: `网络请求（${requests.length}）`, rows });
  }

  if (Array.isArray(payload.resources) && payload.resources.length > 0) {
    const rows: string[][] = [];
    for (const resource of payload.resources) {
      push(rows, [text(resource.type), clip(text(resource.url), 120)]);
    }
    lists.push({ title: `资源（${payload.resources.length}）`, rows });
  }

  const limitations: string[] = [];
  for (const source of [payload.limitations, root?.limitations]) {
    if (Array.isArray(source)) for (const item of source) limitations.push(text(item));
  }

  return {
    operation,
    title,
    facts: facts.filter((fact) => fact.value !== ""),
    lists,
    limitations: [...new Set(limitations)],
    raw,
  };
}
