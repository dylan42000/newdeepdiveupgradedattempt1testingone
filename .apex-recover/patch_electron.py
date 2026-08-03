from pathlib import Path

p = Path("electron/main.cjs")
text = p.read_text(encoding="utf-8")
changed = False

old_imp = """const {
  app,
  BrowserWindow,
  shell,
  Menu,
  dialog,
  ipcMain,
  safeStorage,
  Notification,
  clipboard,
} = require(\"electron\");"""
new_imp = """const {
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
} = require(\"electron\");"""
if "  Tray," not in text and old_imp in text:
    text = text.replace(old_imp, new_imp, 1)
    changed = True
    print("patched imports")

helper = r'''let mainWindow = null;
let letterReviewWindow = null;
let tray = null;
let isQuitting = false;

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

let schedulerTimer = null;'''

if "let letterReviewWindow = null;" not in text:
    old = """let mainWindow = null;
let schedulerTimer = null;"""
    if old not in text:
        raise SystemExit("mainWindow/schedulerTimer marker missing")
    text = text.replace(old, helper, 1)
    changed = True
    print("inserted tray helpers")

if "close to tray" not in text:
    anchor = """  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafe(url);
    return { action: "deny" };
  });
"""
    if anchor not in text:
        raise SystemExit("setWindowOpenHandler anchor missing")
    insert = anchor + """
  // Apex — close to tray (Quit from tray menu exits fully)
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
"""
    text = text.replace(anchor, insert, 1)
    changed = True
    print("inserted close-to-tray")

if "setupTray();" not in text:
    old = """  createWindow();
  setupOverdueCycleNotice();
  restoreSchedulerFromDisk();
"""
    new = """  createWindow();
  setupTray();
  setupOverdueCycleNotice();
  restoreSchedulerFromDisk();
"""
    if old not in text:
        raise SystemExit("whenReady block missing")
    text = text.replace(old, new, 1)
    changed = True
    print("patched whenReady")

if 'app.on("before-quit"' not in text:
    old = """app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});"""
    new = """app.on("before-quit", () => {
  isQuitting = true;
});

app.on("window-all-closed", () => {
  if (process.platform === "darwin") return;
  // Keep process alive only when tray close-to-tray is active.
  if (tray && !isQuitting) return;
  app.quit();
});"""
    if old not in text:
        raise SystemExit("window-all-closed missing")
    text = text.replace(old, new, 1)
    changed = True
    print("patched quit handlers")

if "tray:updateStatus" not in text:
    anchor = 'ipcMain.handle("autopilot:status", async () => ({ success: true, ...schedulerState }));'
    if anchor not in text:
        raise SystemExit("ipc anchor missing")
    extra = anchor + r'''

// Apex — tray status badge/tooltip
ipcMain.handle("tray:updateStatus", async (_event, info = {}) => {
  updateTrayTooltip(info || {});
  return { success: true };
});

// Apex — multi-monitor letter review
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

    const safeHtml = String(htmlContent || "").replace(/<\/script/gi, "<\\/script");
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
'''
    text = text.replace(anchor, extra, 1)
    changed = True
    print("patched IPC")

if changed:
    p.write_text(text, encoding="utf-8")
    print("WROTE", len(text))
else:
    print("no changes needed")
