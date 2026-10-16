export {};

declare global {
  interface ReaRunResult {
    code: number | null;
    stdout: string;
    stderr: string;
    error?: string;
    exe?: string;
    args?: string[];
    cwd?: string;
  }

  interface ReaSettings {
    nodePath: string;
    scriptPath: string;
    binPath: string;
    workdir: string;
    tempDir: string;
    ignoreGlobs: string;
    limitSources: boolean;
    runtimeChannel: string;
    endpointInspector: string;
    endpointElectron: string;
    endpointBrowser: string;
    fridaMode: string;
    fridaTarget: string;
    fridaScript: string;
    observationMs: number;
    lastArgs: string;
  }

  interface ReaOutputEvent {
    runId: string;
    stream: "stdout" | "stderr";
    text: string;
  }

  interface ReaFileResult {
    path: string;
    content: string;
    error: string | null;
  }

  interface ReaAiSuggestion {
    ok: boolean;
    ignore?: string[];
    reason?: string;
    model?: string;
    dir?: string;
    dirCount?: number;
    truncated?: boolean;
    usage?: unknown;
    error?: string;
  }

  interface ReaSourcePaths {
    ok: boolean;
    files?: string[];
    truncated?: boolean;
    error?: string;
  }

  interface ReaAiStatus {
    hasKey: boolean;
    keyName: string | null;
    model: string;
    baseUrl: string;
    sources: { path: string; keys: string[] }[];
  }

  interface Window {
    rea: {
      getSettings(): Promise<ReaSettings>;
      saveSettings(settings: Partial<ReaSettings>): Promise<ReaSettings>;
      run(payload: {
        runId: string;
        argsString: string;
        settings?: Partial<ReaSettings>;
      }): Promise<ReaRunResult>;
      cancel(runId: string): Promise<boolean>;
      pickFile(): Promise<ReaFileResult | null>;
      readFile(filePath: string): Promise<ReaFileResult>;
      collectSourcePaths(payload: { dir: string }): Promise<ReaSourcePaths>;
      aiPickDirectory(): Promise<string | null>;
      aiSuggestIgnores(payload: { dir: string }): Promise<ReaAiSuggestion>;
      aiStatus(): Promise<ReaAiStatus>;
      onOutput(callback: (event: ReaOutputEvent) => void): () => void;
    };
  }
}
