# Patches for main.cjs (7)

## Patch 1 from 61a88268-6764-4544-98a8-695204df84b9.jsonl
Path: `D:\downloads\DYLANDOS ULTIMATE CREDIT REPAIR LATEST\newdeepdiveupgradedattempt1\electron\main.cjs`
### OLD (603)
```
const isDev = process.env.ELECTRON_IS_DEV === "true";

// ── GPU / RENDERING STABILITY ────────────────────────────────────────────────
// Keep hardware acceleration disabled for compatibility with older/onboard GPU drivers.
app.disableHardwareAcceleration();
// Also disable the GPU software rasterizer which can cause black screens on
// systems where both HW acceleration AND software rasterizer are unsupported.
app.commandLine.appendSwitch('disable-software-rasterizer');
// Suppress GPU sandbox errors common in packaged apps running on Windows VMs/WINE
app.commandLine.appendSwitch('no-sandbox');
```
### NEW (565)
```
const isDev = process.env.ELECTRON_IS_DEV === "true";

// ── GPU / RENDERING STABILITY ────────────────────────────────────────────────
// Only disable hardware acceleration when explicitly requested. Combining
// disableHardwareAcceleration + disable-software-rasterizer leaves NO valid
// render path on many Windows GPUs and produces a permanent black window.
if (process.env.DYLANDOS_DISABLE_GPU === "1") {
  app.disableHardwareAcceleration();
}
// Avoid Chromium sandbox issues in some packaged Windows environments.
app.commandLine.appendSwitch("no-sandbox");
```

## Patch 2 from 61a88268-6764-4544-98a8-695204df84b9.jsonl
Path: `D:\downloads\DYLANDOS ULTIMATE CREDIT REPAIR LATEST\newdeepdiveupgradedattempt1\electron\main.cjs`
### OLD (470)
```
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      sandbox: true,
      allowRunningInsecureContent: false,
      devTools: isDev,
    },
  });

  Menu.setApplicationMenu(null);

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    if (isDev) mainWindow.webContents.openDevTools({ mode: "detach" });
  });

  // Harden external navigation.
```
### NEW (1296)
```
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      sandbox: false,
      allowRunningInsecureContent: false,
      // Keep DevTools available so black-screen failures can be diagnosed.
      devTools: true,
    },
  });

  Menu.setApplicationMenu(null);

  // Always surface the window — ready-to-show can hang forever on some GPUs.
  const reveal = () => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      mainWindow.show();
    }
  };
  mainWindow.once("ready-to-show", reveal);
  setTimeout(reveal, 2500);

  mainWindow.webContents.on("did-fail-load", (_event, code, desc, url) => {
    console.error("[main] did-fail-load", code, desc, url);
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.loadURL(
      "data:text/html;charset=utf-8," +
        encodeURIComponent(
          `<html><body style="font-family:Segoe UI,sans-serif;background:#111;color:#f66;padding:2rem">` +
            `<h2>Failed to load DylandOs</h2>` +
            `<p>Code ${code}: ${desc}</p><p>${url}</p>` +
            `<p>Press Ctrl+Shift+I for DevTools.</p></body></html>`
        )
    );
    reveal();
  });

  // Harden external navigation.
```

## Patch 3 from 8559bda8-1434-45c3-821e-9ac6a77ac28e.jsonl
Path: `D:\downloads\DYLANDOS ULTIMATE CREDIT REPAIR LATEST\newdeepdiveupgradedattempt1\electron\main.cjs`
### OLD (138)
```
const {
  app,
  BrowserWindow,
  shell,
  Menu,
  dialog,
  ipcMain,
  safeStorage,
  Notification,
  clipboard,
} = require("electron");
```
### NEW (171)
```
const {
  app,
  BrowserWindow,
  shell,
  Menu,
  dialog,
  ipcMain,
  safeStorage,
  Notification,
  clipboard,
  Tray,
  nativeImage,
  screen,
} = require("electron");
```

## Patch 4 from 8559bda8-1434-45c3-821e-9ac6a77ac28e.jsonl
Path: `D:\downloads\DYLANDOS ULTIMATE CREDIT REPAIR LATEST\newdeepdiveupgradedattempt1\electron\main.cjs`
### OLD (135)
```
let mainWindow = null;
let schedulerTimer = null;
let schedulerState = { active: false, nextTriggerDate: null, cycleIntervalMs: null };
```
### NEW (2779)
```
let mainWindow = null;
let letterReviewWindow = null;
let tray = null;
let isQuitting = false;
let schedulerTimer = null;
let schedulerState = { active: false, nextTriggerDate: null, cycleIntervalMs: null };

function getTrayIcon() {
  const iconPath = path.join(__dirname, "icon.ico");
  try {
    if (fs.existsSync(iconPath)) return nativeImage.createFromPath(iconPath);
  } catch {
    /* fall through */
  }
  return nativeImage.createEmpty();
}

function sendToMain(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    {
      label: "Show DylandOs",
      click: () => {
        if (!mainWindow || mainWindow.isDestroyed()) createWindow();
        else {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    {
      label: "Run Cycle Now",
      click: () => {
        if (!mainWindow || mainWindow.isDestroyed()) createWindow();
        else mainWindow.show();
        sendToMain("tray:run-cycle");
      },
    },
    {
      label: "View Audit",
      click: () => {
        if (!mainWindow || mainWindow.isDestroyed()) createWindow();
        else mainWindow.show();
        sendToMain("tray:navigate", { page: "history" });
      },
    },
    {
      label: "Export Letters",
      click: () => {
        if (!mainWindow || mainWindow.isDestroyed()) createWindow();
        else mainWindow.show();
        sendToMain("tray:navigate", { page: "dispute-letters" });
      },
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
}

function setupTray() {
  if (tray) return;
  tray = new Tray(getTrayIcon());
  tray.setToolTip("DylandOs Ultimate Credit Repair Suite");
  tray.setContextMenu(buildTrayMenu());
  tray.on("double-click", () => {
    if (!mainWindow || mainWindow.isDestroyed()) createWindow();
    else {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function updateTrayTooltip(info = {}) {
  if (!tray) return;
  const campaigns = info.activeCampaigns ?? 0;
  const next = info.nextCycleDate ? String(info.nextCycleDate).slice(0, 10) : "—";
  const fraud = info.fraudAlerts ?? 0;
  tray.setToolTip(
    `DylandOs — ${campaigns} campaign(s) · next cycle ${next}` +
      (fraud > 0 ? ` · ${fraud} fraud alert(s)` : "")
  );
  try {
    tray.setContextMenu(buildTrayMenu());
  } catch {
    /* ignore */
  }
}

function pickSecondaryDisplay() {
  const displays = screen.getAllDisplays();
  if (!displays || displays.length < 2) return null;
  const primary = screen.getPrimaryDisplay();
  return displays.find((d) => d.id !== primary.id) || displays[1] || null;
}
```

## Patch 5 from 8559bda8-1434-45c3-821e-9ac6a77ac28e.jsonl
Path: `D:\downloads\DYLANDOS ULTIMATE CREDIT REPAIR LATEST\newdeepdiveupgradedattempt1\electron\main.cjs`
### OLD (177)
```
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
```
### NEW (637)
```
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  // Apex W2 — close to tray (Quit from tray menu exits fully)
  mainWindow.on("close", (event) => {
    if (!isQuitting && process.platform === "win32" && tray) {
      event.preventDefault();
      mainWindow.hide();
      if (Notification.isSupported()) {
        new Notification({
          title: "DylandOs still running",
          body: "App minimized to tray. Use tray menu to Run Cycle, View Audit, or Quit.",
        }).show();
      }
    }
  });

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
```

## Patch 6 from 8559bda8-1434-45c3-821e-9ac6a77ac28e.jsonl
Path: `D:\downloads\DYLANDOS ULTIMATE CREDIT REPAIR LATEST\newdeepdiveupgradedattempt1\electron\main.cjs`
### OLD (405)
```
app.whenReady().then(async () => {
  ensureDirSync(VAULT_BASE);
  ensureDirSync(path.join(VAULT_BASE, "audit"));
  ensureDirSync(path.join(VAULT_BASE, "_deleted"));
  ensureDirSync(path.join(USER_DATA, "autopilot"));
  ensureDirSync(path.join(USER_DATA, "logs"));

  createWindow();
  setupOverdueCycleNotice();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
```
### NEW (490)
```
app.whenReady().then(async () => {
  ensureDirSync(VAULT_BASE);
  ensureDirSync(path.join(VAULT_BASE, "audit"));
  ensureDirSync(path.join(VAULT_BASE, "_deleted"));
  ensureDirSync(path.join(USER_DATA, "autopilot"));
  ensureDirSync(path.join(USER_DATA, "logs"));

  createWindow();
  setupTray();
  setupOverdueCycleNotice();
});

app.on("before-quit", () => {
  isQuitting = true;
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin" && isQuitting) app.quit();
});
```

## Patch 7 from 8559bda8-1434-45c3-821e-9ac6a77ac28e.jsonl
Path: `D:\downloads\DYLANDOS ULTIMATE CREDIT REPAIR LATEST\newdeepdiveupgradedattempt1\electron\main.cjs`
### OLD (88)
```
ipcMain.handle("autopilot:status", async () => ({ success: true, ...schedulerState }));

```
### NEW (2203)
```
ipcMain.handle("autopilot:status", async () => ({ success: true, ...schedulerState }));

// Apex W2 — tray status badge/tooltip
ipcMain.handle("tray:updateStatus", async (_event, info = {}) => {
  updateTrayTooltip(info || {});
  return { success: true };
});

// Apex W3 — multi-monitor letter review
ipcMain.handle("window:openLetterReview", async (_event, htmlContent) => {
  try {
    const secondary = pickSecondaryDisplay();
    const workArea = secondary
      ? secondary.workArea
      : (screen.getPrimaryDisplay()?.workArea || { x: 80, y: 80, width: 1100, height: 800 });

    if (letterReviewWindow && !letterReviewWindow.isDestroyed()) {
      letterReviewWindow.close();
    }

    letterReviewWindow = new BrowserWindow({
      title: "DylandOs Letter Review",
      x: workArea.x + 40,
      y: workArea.y + 40,
      width: Math.min(1100, workArea.width - 80),
      height: Math.min(900, workArea.height - 80),
      backgroundColor: "#0a0a0a",
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });

    const safeHtml = String(htmlContent || "")
      .replace(/<\/script/gi, "<\\/script");
    const page = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Letter Review</title>
<style>body{margin:0;background:#0a0a0a;color:#e5e5e5;font-family:Segoe UI,sans-serif}
.wrap{padding:24px;max-width:900px;margin:0 auto;line-height:1.5}</style></head>
<body><div class="wrap">${safeHtml}</div></body></html>`;

    await letterReviewWindow.loadURL(
      "data:text/html;charset=utf-8," + encodeURIComponent(page)
    );
    letterReviewWindow.show();
    return {
      success: true,
      multiMonitor: !!secondary,
      displayId: secondary?.id ?? screen.getPrimaryDisplay()?.id ?? null,
    };
  } catch (err) {
    return { success: false, error: String(err) };
  }
});

ipcMain.handle("window:getDisplayInfo", async () => {
  const displays = screen.getAllDisplays().map((d) => ({
    id: d.id,
    bounds: d.bounds,
    workArea: d.workArea,
    primary: d.id === screen.getPrimaryDisplay().id,
  }));
  return { success: true, count: displays.length, displays };
});

```
