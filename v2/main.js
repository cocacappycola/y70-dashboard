// ============================================================================
//  Y70 Dashboard — V2 native shell
//
//  V1 ran in a Brave window, which meant every tap on the panel ACTIVATED that
//  window: Windows moved the foreground to it, and whatever game was running
//  lost focus (and with it, mouse capture — which is why the cursor appeared to
//  jump over). No Chromium command-line flag can prevent that, because the
//  browser owns the window.
//
//  So V2 owns the window itself and creates it with `focusable: false`, which on
//  Windows is the WS_EX_NOACTIVATE extended style: "a top-level window created
//  with this style does not become the foreground window when the user clicks
//  it." Taps still arrive as pointer events — they simply never steal focus.
//
//  Everything else is unchanged: this loads the same local server and the same
//  pages V1 used, so there is one copy of the dashboard, not two.
// ============================================================================
const { app, BrowserWindow, screen, ipcMain, Tray, Menu, nativeImage, shell } = require("electron");
const path = require("path");
const net = require("net");
const { spawn } = require("child_process");

const ROOT = path.join(__dirname, "..");     // the V1 folder: server.js + pages
const PORT = 8888;
const URL = "http://127.0.0.1:" + PORT;

// Which monitor the panel is. 1 matches the .bat's SCREEN=1; "smallest" is the
// fallback, because the Y70 is by far the smallest display attached.
const TARGET_DISPLAY = process.env.Y70_DISPLAY || "smallest";

let win = null;
let tray = null;
let serverProc = null;
let keyboardMode = false;

// ---------------------------------------------------------------- server ---
function portOpen() {
  return new Promise((resolve) => {
    const s = net.createConnection({ host: "127.0.0.1", port: PORT });
    const done = (v) => { try { s.destroy(); } catch (e) {} resolve(v); };
    s.on("connect", () => done(true));
    s.on("error", () => done(false));
    setTimeout(() => done(false), 1200);
  });
}

async function ensureServer() {
  if (await portOpen()) return "already running";
  serverProc = spawn(process.execPath, [path.join(ROOT, "server.js")], {
    cwd: ROOT,
    windowsHide: true,
    // ELECTRON_RUN_AS_NODE makes the bundled Electron binary behave as plain
    // node, so there is no separate Node install to depend on.
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    stdio: "ignore",
  });
  serverProc.on("exit", () => { serverProc = null; });
  // Wait for it rather than racing it — V1's bug was opening the page too early.
  for (let i = 0; i < 40; i++) {
    if (await portOpen()) return "started";
    await new Promise((r) => setTimeout(r, 250));
  }
  return "failed to start";
}

// ---------------------------------------------------------------- window ---
function pickDisplay() {
  const all = screen.getAllDisplays();
  if (/^\d+$/.test(TARGET_DISPLAY)) {
    const i = Number(TARGET_DISPLAY);
    if (all[i]) return all[i];
  }
  return all.slice().sort((a, b) =>
    (a.bounds.width * a.bounds.height) - (b.bounds.width * b.bounds.height))[0];
}

function createWindow() {
  const d = pickDisplay();
  const b = d.bounds;

  win = new BrowserWindow({
    x: b.x, y: b.y, width: b.width, height: b.height,
    frame: false,
    // Frameless windows on Windows still get WS_THICKFRAME, an invisible ~8px
    // resize border that extends the window rect past the panel and onto the
    // main monitor — a dead strip that would swallow clicks meant for the game.
    // Turning it off costs only the drop shadow, which a full-bleed panel has
    // no use for anyway.
    thickFrame: false,
    // The whole point of V2. On Windows this is WS_EX_NOACTIVATE.
    focusable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    // NOT resizable:false here. Electron turns that into min/max size
    // constraints that clamp the window smaller than asked for (682 wide came
    // out 634, and each setBounds only crept closer). It is applied in
    // placeOnPanel() once the real bounds are in place.
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    backgroundColor: "#000000",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,   // the dock keeps updating while unfocused
    },
  });

  // "screen-saver" is the highest ordinary level, so the panel stays visible
  // over a borderless-fullscreen game. (Exclusive-fullscreen games own the
  // whole GPU output and will still cover it — use borderless.)
  win.setAlwaysOnTop(true, "screen-saver");
  win.setMenu(null);

  win.loadURL(URL);
  win.once("ready-to-show", () => {
    // showInactive, not show: show() would activate the window once at startup,
    // which is exactly the thing we are here to avoid.
    win.showInactive();
    placeOnPanel();
  });

  // Never let the page navigate away or spawn windows; this is a kiosk.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(URL)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith(URL)) e.preventDefault();
  });
  // If the renderer ever dies, come back rather than leaving a black panel.
  win.webContents.on("render-process-gone", () => {
    setTimeout(() => win && !win.isDestroyed() && win.reload(), 1500);
  });
}

// ---------------------------------------------------------------- keyboard --
// A non-focusable window cannot receive keystrokes — that is the trade for not
// stealing focus. Notes and the calculator still want a keyboard sometimes, so
// the page can ask for it explicitly and give it back.
function setKeyboardMode(on) {
  if (!win || win.isDestroyed()) return keyboardMode;
  keyboardMode = !!on;
  win.setFocusable(keyboardMode);
  if (keyboardMode) win.focus();
  else win.blur();
  win.webContents.send("y70:keyboard-mode", keyboardMode);
  updateTray();
  return keyboardMode;
}

// ---------------------------------------------------------------- tray -----
// With no frame and no taskbar button, the tray is the only way to quit.
const TRAY_ICON =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAgUlEQVQ4jbXTsQ2AIBCF4Q" +
  "+dwAWcwAmcwAmcwAmcwAmcwAmcwAmcwAlcwAmcwAn0EqIhFxNe8pILd/+9CwcxKrDhwIYVc0xIsWPHhBFTTNixYcQY" +
  "E3ZsGDDEhB0bBvQxYceGHl1M2LGhQxsTdmxo0cSEHRsa1DFhx4YaVUzYsaFCGRN2/PkAJ8kQ4dEAAAAASUVORK5CYII=";

function updateTray() {
  if (!tray) return;
  tray.setToolTip("Y70 Dashboard" + (keyboardMode ? " — keyboard mode" : " — passive (no focus steal)"));
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: keyboardMode ? "Keyboard mode: ON" : "Keyboard mode: off",
      type: "checkbox", checked: keyboardMode, click: () => setKeyboardMode(!keyboardMode) },
    { type: "separator" },
    { label: "Reload", click: () => win && win.reload() },
    { label: "Move to this display",
      click: () => {
        const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).bounds;
        win.setResizable(true);
        win.setBounds({ x: d.x, y: d.y, width: d.width, height: d.height });
        win.setResizable(false);
      } },
    { type: "separator" },
    { label: "Quit", click: () => { app.isQuiting = true; app.quit(); } },
  ]));
}

function createTray() {
  tray = new Tray(nativeImage.createFromDataURL(TRAY_ICON));
  updateTray();
  // A plain click toggles keyboard mode: the one thing you reach for often.
  tray.on("click", () => setKeyboardMode(!keyboardMode));
}

// ---------------------------------------------------------------- boot -----
ipcMain.handle("y70:keyboard", (_e, on) => setKeyboardMode(on));
ipcMain.handle("y70:keyboard-state", () => keyboardMode);
ipcMain.handle("y70:quit", () => { app.isQuiting = true; app.quit(); });
ipcMain.handle("y70:reload", () => { if (win) win.reload(); });
ipcMain.handle("y70:displays", () => screen.getAllDisplays().map((d, i) => ({
  index: i, bounds: d.bounds, primary: d.id === screen.getPrimaryDisplay().id,
})));

// One instance only — a second launch should just wake the existing panel.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => { if (win) win.showInactive(); });

  app.whenReady().then(async () => {
    await ensureServer();
    createWindow();
    createTray();
    // Displays come and go (the Y70 sleeps with the PC); re-place the window.
    screen.on("display-added", reposition);
    screen.on("display-removed", reposition);
    screen.on("display-metrics-changed", reposition);
  });
}

// Fills the panel exactly. The resizable dance is required: a window that is
// already non-resizable refuses to grow to the size we want.
function placeOnPanel() {
  if (!win || win.isDestroyed()) return;
  const b = pickDisplay().bounds;
  win.setResizable(true);
  win.setBounds({ x: b.x, y: b.y, width: b.width, height: b.height });
  win.setResizable(false);
}

const reposition = () => placeOnPanel();

app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => {
  // Only stop the server if we were the ones who started it.
  if (serverProc) { try { serverProc.kill(); } catch (e) {} }
});
