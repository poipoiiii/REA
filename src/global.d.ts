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
      onOutput(callback: (event: ReaOutputEvent) => void): () => void;
    };
  }
}
