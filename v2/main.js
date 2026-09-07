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

// Where the dashboard's pages and server live. When packaged they are copied
// in as an extraResource, because __dirname points inside app.asar and the
// parent folder no longer exists on the user's machine.
const ROOT = app.isPackaged
  ? path.join(process.resourcesPath, "dashboard")
  : path.join(__dirname, "..");
const ICON_PATH = app.isPackaged
  ? path.join(process.resourcesPath, "build", "icon.ico")
  : path.join(__dirname, "build", "icon.ico");
const TRAY_PATH = app.isPackaged
  ? path.join(process.resourcesPath, "build", "tray.png")
  : path.join(__dirname, "build", "tray.png");

const PORT = 8888;
const URL = "http://127.0.0.1:" + PORT;

// Without this Windows groups the window under "Electron" and shows Electron's
// icon in the taskbar and notifications instead of ours.
app.setAppUserModelId("com.cappy.y70dashboard");

// Which monitor the panel is. 1 matches the .bat's SCREEN=1; "smallest" is the
// fallback, because the Y70 is by far the smallest display attached.
const TARGET_DISPLAY = process.env.Y70_DISPLAY || "smallest";

let win = null;
let authWin = null;
let tray = null;
let serverProc = null;
let keyboardMode = false;
let showInTaskbar = false;

// Off by default on purpose: a taskbar button is a thing you click, and
// clicking it would activate the window — the one behaviour V2 exists to avoid.
// It is here because being able to find the app matters too.
function setShowInTaskbar(on) {
  showInTaskbar = !!on;
  if (win && !win.isDestroyed()) win.setSkipTaskbar(!showInTaskbar);
  updateTray();
  return showInTaskbar;
}

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
    icon: ICON_PATH,
    title: "Y70 Dashboard",
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
    if (url.startsWith(URL)) return;
    // Never navigate the panel off-site. A sign-in that tries anyway (an older
    // page, or a provider that redirects the top frame) is rerouted into the
    // proper popup rather than silently doing nothing — which is exactly how
    // "Connect Spotify" ended up dead in the first place.
    e.preventDefault();
    if (/^https:\/\/(accounts\.spotify\.com|discord\.com)\//.test(url)) openAuth(url);
  });
  // If the renderer ever dies, come back rather than leaving a black panel.
  win.webContents.on("render-process-gone", () => {
    setTimeout(() => win && !win.isDestroyed() && win.reload(), 1500);
  });
}

// ---------------------------------------------------------------- sign-in ---
// The panel is non-focusable by design, so it can never accept a password.
// Sign-in therefore happens in an ordinary window: framed, focusable, centred on
// the main monitor where the keyboard is. It shares the default session, so the
// tokens it stores land in the same localStorage the panel reads.
function openAuth(url) {
  if (authWin && !authWin.isDestroyed()) {
    authWin.show();
    authWin.focus();
    return { ok: true, reused: true };
  }
  const area = screen.getPrimaryDisplay().workArea;
  const w = 520, h = 780;
  authWin = new BrowserWindow({
    width: w, height: Math.min(h, area.height - 40),
    x: Math.round(area.x + (area.width - w) / 2),
    y: Math.round(area.y + Math.max(0, (area.height - h) / 2)),
    title: "Sign in",
    autoHideMenuBar: true,
    alwaysOnTop: true,
    icon: ICON_PATH,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  authWin.setMenu(null);
  authWin.loadURL(url);

  // The dashboard's callback page exchanges the code and then sends itself to
  // the site root. That hop is the signal that sign-in worked.
  const finishOn = (target) => target === URL || target === URL + "/";
  authWin.webContents.on("will-navigate", (e, target) => {
    if (!finishOn(target)) return;
    e.preventDefault();
    finishAuth();
  });
  authWin.webContents.on("did-navigate", (_e, target) => {
    if (finishOn(target)) finishAuth();
  });
  authWin.on("closed", () => { authWin = null; });
  return { ok: true };
}

function finishAuth() {
  if (authWin && !authWin.isDestroyed()) { authWin.destroy(); }
  authWin = null;
  // Reload so the panel picks up the tokens that were just written.
  if (win && !win.isDestroyed()) win.reload();
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

// Native start-at-login: this writes the Run key itself, so V2 needs none of
// V1's Startup-folder shortcut plus VBScript plus batch-file chain.
//
// Unpackaged, Electron writes the entry under the generic name
// "electron.app.Electron" while getLoginItemSettings() looks for the product
// name — so it always reads back false even though the key really was written.
// Packaged, both agree. Trust our own intent while developing, and Windows
// once installed.
let autoStartWanted = false;
function getAutoStart() {
  try {
    const s = app.getLoginItemSettings();
    return app.isPackaged ? !!s.openAtLogin : autoStartWanted;
  } catch (e) { return false; }
}
function setAutoStart(on) {
  autoStartWanted = !!on;
  try {
    app.setLoginItemSettings({
      openAtLogin: !!on,
      // Start minimised to the tray; the panel shows itself without activating.
      args: ["--autostart"],
    });
  } catch (e) { /* nothing we can do about a locked-down policy */ }
  updateTray();
  return getAutoStart();
}

function updateTray() {
  if (!tray) return;
  tray.setToolTip("Y70 Dashboard" + (keyboardMode ? " — keyboard mode" : " — passive (no focus steal)"));
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: keyboardMode ? "Keyboard mode: ON" : "Keyboard mode: off",
      type: "checkbox", checked: keyboardMode, click: () => setKeyboardMode(!keyboardMode) },
    { type: "separator" },
    { label: "Start with Windows", type: "checkbox", checked: getAutoStart(),
      click: () => setAutoStart(!getAutoStart()) },
    { label: "Show in taskbar", type: "checkbox", checked: !!showInTaskbar,
      click: () => setShowInTaskbar(!showInTaskbar) },
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
  const img = nativeImage.createFromPath(TRAY_PATH);
  tray = new Tray(img.isEmpty() ? nativeImage.createFromPath(ICON_PATH) : img);
  updateTray();
  // A plain click toggles keyboard mode: the one thing you reach for often.
  tray.on("click", () => setKeyboardMode(!keyboardMode));
}

// ---------------------------------------------------------------- boot -----
ipcMain.handle("y70:auth", (_e, url) => openAuth(String(url)));
ipcMain.handle("y70:autostart", (_e, on) => (on === undefined ? getAutoStart() : setAutoStart(on)));
ipcMain.handle("y70:taskbar", (_e, on) => (on === undefined ? showInTaskbar : setShowInTaskbar(on)));
ipcMain.handle("y70:keyboard", (_e, on) => setKeyboardMode(on));
ipcMain.handle("y70:keyboard-state", () => keyboardMode);
ipcMain.handle("y70:quit", () => { app.isQuiting = true; app.quit(); });
ipcMain.handle("y70:reload", () => { if (win) win.reload(); });
ipcMain.handle("y70:packaged", () => app.isPackaged);
ipcMain.handle("y70:displays", () => screen.getAllDisplays().map((d, i) => ({
  index: i, bounds: d.bounds, primary: d.id === screen.getPrimaryDisplay().id,
})));

// One instance only — a second launch should just wake the existing panel.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => { if (win) win.showInactive(); });

  app.whenReady().then(async () => {
    try { autoStartWanted = !!app.getLoginItemSettings().openAtLogin; } catch (e) {}
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
