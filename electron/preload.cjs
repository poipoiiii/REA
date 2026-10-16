const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("rea", {
  getSettings: () => ipcRenderer.invoke("rea:get-settings"),
  saveSettings: (settings) => ipcRenderer.invoke("rea:save-settings", settings),
  run: (payload) => ipcRenderer.invoke("rea:run", payload),
  cancel: (runId) => ipcRenderer.invoke("rea:cancel", runId),
  pickFile: () => ipcRenderer.invoke("rea:pick-file"),
  readFile: (filePath) => ipcRenderer.invoke("rea:read-file", filePath),
  collectSourcePaths: (payload) => ipcRenderer.invoke("rea:collect-source-paths", payload),
  aiPickDirectory: () => ipcRenderer.invoke("ai:pick-directory"),
  aiSuggestIgnores: (payload) => ipcRenderer.invoke("ai:suggest-ignores", payload),
  aiStatus: () => ipcRenderer.invoke("ai:status"),
  onOutput: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on("rea:output", listener);
    return () => ipcRenderer.removeListener("rea:output", listener);
  },
});
