const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("rea", {
  getSettings: () => ipcRenderer.invoke("rea:get-settings"),
  saveSettings: (settings) => ipcRenderer.invoke("rea:save-settings", settings),
  run: (payload) => ipcRenderer.invoke("rea:run", payload),
  cancel: (runId) => ipcRenderer.invoke("rea:cancel", runId),
  pickFile: () => ipcRenderer.invoke("rea:pick-file"),
  readFile: (filePath) => ipcRenderer.invoke("rea:read-file", filePath),
  collectSourcePaths: (payload) => ipcRenderer.invoke("rea:collect-source-paths", payload),
  pickExecutable: () => ipcRenderer.invoke("rea:pick-executable"),
  pathInfo: (filePath) => ipcRenderer.invoke("rea:path-info", filePath),
  mcp: {
    status: () => ipcRenderer.invoke("mcp:status"),
    open: (filePath) => ipcRenderer.invoke("mcp:open", filePath),
    procedures: () => ipcRenderer.invoke("mcp:procedures"),
    searchProcedures: (pattern) => ipcRenderer.invoke("mcp:search-procedures", { pattern }),
    callGraph: (address, direction) => ipcRenderer.invoke("mcp:call-graph", { address, direction }),
    resolveContaining: (address) => ipcRenderer.invoke("mcp:resolve", address),
    closeBinary: () => ipcRenderer.invoke("mcp:close-binary"),
    shutdown: () => ipcRenderer.invoke("mcp:shutdown"),
  },
  aiPickDirectory: () => ipcRenderer.invoke("ai:pick-directory"),
  aiSuggestIgnores: (payload) => ipcRenderer.invoke("ai:suggest-ignores", payload),
  aiStatus: () => ipcRenderer.invoke("ai:status"),
  onOutput: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on("rea:output", listener);
    return () => ipcRenderer.removeListener("rea:output", listener);
  },
});
