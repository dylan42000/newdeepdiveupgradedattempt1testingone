# Patches for preload.cjs (1)

## Patch 1 from 8559bda8-1434-45c3-821e-9ac6a77ac28e.jsonl
Path: `D:\downloads\DYLANDOS ULTIMATE CREDIT REPAIR LATEST\newdeepdiveupgradedattempt1\electron\preload.cjs`
### OLD (249)
```
  onAutoPilotCycleOverdue: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("autopilot:cycle-overdue", handler);
    return () => ipcRenderer.removeListener("autopilot:cycle-overdue", handler);
  },
});

```
### NEW (902)
```
  onAutoPilotCycleOverdue: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("autopilot:cycle-overdue", handler);
    return () => ipcRenderer.removeListener("autopilot:cycle-overdue", handler);
  },

  // Apex W2 / W3 — tray + multi-monitor
  updateTrayStatus: (info) => expose("tray:updateStatus", info),
  openLetterReviewWindow: (html) => expose("window:openLetterReview", html),
  getDisplayInfo: () => expose("window:getDisplayInfo"),
  onTrayRunCycle: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("tray:run-cycle", handler);
    return () => ipcRenderer.removeListener("tray:run-cycle", handler);
  },
  onTrayNavigate: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("tray:navigate", handler);
    return () => ipcRenderer.removeListener("tray:navigate", handler);
  },
});

```
