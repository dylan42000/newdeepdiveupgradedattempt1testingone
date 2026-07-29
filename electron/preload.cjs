"use strict";

const { contextBridge, ipcRenderer } = require("electron");

function expose(channel, ...args) {
  return ipcRenderer.invoke(channel, ...args);
}

contextBridge.exposeInMainWorld("electronAPI", {
  // API keys
  storeApiKey: (keyName, value) => expose("store-api-key", keyName, value),
  getApiKey: (keyName) => expose("get-api-key", keyName),
  removeApiKey: (keyName) => expose("remove-api-key", keyName),

  // Files
  openFileDialog: (options) => expose("open-file-dialog", options),
  saveFile: (options) => expose("save-file", options),
  readFileAsBase64: (filePath) => expose("read-file-as-base64", filePath),

  // Print / PDF
  printToPDF: (htmlContent, outputPath) => expose("print-to-pdf", htmlContent, outputPath),

  // Notifications
  showNotification: (title, body, urgency) => expose("show-notification", title, body, urgency),

  // App / shell
  getAppVersion: () => expose("get-app-version"),
  getPlatform: () => process.platform,
  openExternal: (url) => expose("open-external", url),
  openExternalUrl: (url) => expose("open-external", url),

  // Clipboard
  readClipboard: () => expose("read-clipboard"),
  pasteText: async () => {
    // 1) Navigator clipboard
    try {
      if (navigator.clipboard?.readText) {
        const text = await navigator.clipboard.readText();
        if (text && text.trim()) return { success: true, text, source: "navigator.clipboard" };
      }
    } catch {
      // continue fallback
    }

    // 2) Native clipboard plain text
    try {
      const plain = await expose("clipboard:readText");
      if (plain?.success && plain.text?.trim()) {
        return { success: true, text: plain.text, source: "native_clipboard" };
      }
    } catch {
      // continue fallback
    }

    // 3) Native clipboard html converted to text
    try {
      const html = await expose("clipboard:readHTML");
      if (html?.success && html.text?.trim()) {
        return { success: true, text: html.text, source: "html_clipboard" };
      }
    } catch {
      // continue fallback
    }

    // 4) Legacy read-clipboard channel
    try {
      const legacy = await expose("read-clipboard");
      if (legacy?.success && legacy.text?.trim()) {
        return { success: true, text: legacy.text, source: "legacy_read_clipboard" };
      }
    } catch {
      // ignore
    }

    return {
      success: false,
      text: "",
      source: "none",
      error: "No clipboard content available. Try Ctrl+V directly in the text area.",
    };
  },

  // Deadline events
  onDeadlineAlert: (callback) => {
    ipcRenderer.on("deadline-alert", (_event, data) => callback(data));
  },
  removeDeadlineAlertListener: () => {
    ipcRenderer.removeAllListeners("deadline-alert");
  },

  // Vault (canonical names)
  getVaultPath: () => expose("vault:getBasePath"),
  writeVaultFile: (relativePath, data) => expose("vault:writeFile", relativePath, data),
  readVaultFile: (relativePath) => expose("vault:readFile", relativePath),
  listVaultDirectory: (relativePath) => expose("vault:listDirectory", relativePath),
  deleteVaultFile: (relativePath) => expose("vault:deleteFile", relativePath),
  appendAuditLog: (entry) => expose("vault:appendAuditLog", entry),
  createExportPackage: (profileId) => expose("vault:createExportPackage", profileId),
  getVaultMasterKey: () => expose("vault:getMasterKey"),

  // Vault (legacy aliases used by existing services)
  vaultGetBasePath: () => expose("vault:getBasePath"),
  vaultWriteFile: (relativePath, data) => expose("vault:writeFile", relativePath, data),
  vaultReadFile: (relativePath) => expose("vault:readFile", relativePath),
  vaultListDirectory: (relativePath) => expose("vault:listDirectory", relativePath),
  vaultDeleteFile: (relativePath) => expose("vault:deleteFile", relativePath),
  vaultAppendAuditLog: (entry) => expose("vault:appendAuditLog", entry),
  vaultCreateExportPackage: (profileId) => expose("vault:createExportPackage", profileId),
  vaultGetMasterKey: () => expose("vault:getMasterKey"),

  // Secure PII
  storeSSN: (profileId, encrypted) => expose("secure:storeSSN", profileId, encrypted),
  getSSN: (profileId) => expose("secure:getSSN", profileId),
  clearSSN: (profileId) => expose("secure:clearSSN", profileId),

  // Legacy SSN aliases
  secureStoreSSN: (profileId, encryptedSSN) => expose("secure:storeSSN", profileId, encryptedSSN),
  secureGetSSN: (profileId) => expose("secure:getSSN", profileId),
  secureClearSSN: (profileId) => expose("secure:clearSSN", profileId),

  // AutoPilot scheduler
  scheduleAutoPilot: (settings) => expose("autopilot:schedule", settings),
  cancelAutoPilot: () => expose("autopilot:cancel"),
  getSchedulerStatus: () => expose("autopilot:status"),

  // Legacy AutoPilot aliases
  autopilotSchedule: (settings) => expose("autopilot:schedule", settings),
  autopilotCancel: () => expose("autopilot:cancel"),
  autopilotStatus: () => expose("autopilot:status"),

  onAutopilotTrigger: (callback) => {
    ipcRenderer.on("autopilot:trigger", () => callback());
  },
  removeAutopilotTriggerListener: () => {
    ipcRenderer.removeAllListeners("autopilot:trigger");
  },

  onAutoPilotCycleOverdue: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("autopilot:cycle-overdue", handler);
    return () => ipcRenderer.removeListener("autopilot:cycle-overdue", handler);
  },

  // Apex — tray + multi-monitor letter review
  updateTrayStatus: (info) => expose("tray:updateStatus", info),
  openLetterReview: (htmlContent) => expose("window:openLetterReview", htmlContent),
  getDisplayInfo: () => expose("window:getDisplayInfo"),
  onTrayNavigate: (callback) => {
    const handler = (_event, payload) => callback(payload || {});
    ipcRenderer.on("tray:navigate", handler);
    return () => ipcRenderer.removeListener("tray:navigate", handler);
  },
  onTrayRunCycle: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("tray:run-cycle", handler);
    return () => ipcRenderer.removeListener("tray:run-cycle", handler);
  },
});
