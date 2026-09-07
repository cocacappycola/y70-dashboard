// ============================================================================
//  Y70 Dashboard shell — apps in a frame, pull-down drawer, bottom widgets.
// ============================================================================

const APPS = {
  spotify: { title: "Spotify", src: "/index.html" },
  weather: { title: "Weather", src: "/weather-app.html" },
};

const WIDGETS = {
  claude: { title: "Claude", src: "/widget-claude.html", ico: "claude-ico", glyph: "✳" },
  weather: { title: "Weather", src: "/widget-weather.html", ico: "weather-ico", glyph: "☀" },
  pc: { title: "PC stats", src: "/widget-pc.html", ico: "pc-ico", glyph: "▣" },
  calc: { title: "Calculator", src: "/widget-calc.html", ico: "calc-ico", glyph: "÷" },
  media: { title: "Now playing", src: "/widget-media.html", ico: "media-ico", glyph: "▶" },
  lyrics: { title: "Lyrics", src: "/widget-lyrics.html", ico: "media-ico", glyph: "“”" },
  audio: { title: "Audio", src: "/widget-audio.html", ico: "tools-ico", glyph: "♪" },
  timer: { title: "Timer", src: "/widget-timer.html", ico: "tools-ico", glyph: "⏱" },
  notes: { title: "Notes", src: "/widget-notes.html", ico: "tools-ico", glyph: "✎" },
  discord: { title: "Discord", src: "/widget-discord.html", ico: "discord-ico", glyph: "◉" },
};

// ---- Scenes ----------------------------------------------------------------
// A scene is a whole layout: which app is up front and which widgets are open,
// at what heights. These four ship with the app; each can be overwritten with
// whatever you have on screen, and reset back to this again.
const SCENES = [
  {
    id: "working", name: "Working", icon: "\u2328", app: "spotify",
    widgets: { pc: { h: 330 }, notes: { h: 260 }, timer: { h: 190 } },
  },
  {
    id: "gaming", name: "Gaming", icon: "\u{1F3AE}", app: "spotify",
    widgets: { discord: { h: 300 }, audio: { h: 290 }, pc: { h: 240 } },
  },
  {
    id: "music", name: "Music", icon: "\u266b", app: "spotify",
    widgets: { lyrics: { h: 430 }, media: { h: 170 }, audio: { h: 250 } },
  },
  {
    id: "idle", name: "Idle", icon: "\u{1F319}", app: "weather",
    widgets: { weather: { h: 240 }, media: { h: 150 }, claude: { h: 230 } },
  },
];
const sceneById = (id) => SCENES.find((s) => s.id === id);

const $ = (s) => document.querySelector(s);

// ---- persisted state -------------------------------------------------------
const DEFAULT_STATE = {
  app: "spotify",
  widgets: {
    claude: { on: true, h: null, collapsed: false },
    weather: { on: false, h: null, collapsed: false },
    pc: { on: false, h: null, collapsed: false },
    calc: { on: false, h: null, collapsed: false },
    media: { on: false, h: null, collapsed: false },
    lyrics: { on: false, h: null, collapsed: false },
    audio: { on: false, h: null, collapsed: false },
    timer: { on: false, h: null, collapsed: false },
    notes: { on: false, h: null, collapsed: false },
    discord: { on: false, h: null, collapsed: false },
  },
};
DEFAULT_STATE.scene = null;        // which scene was last applied
DEFAULT_STATE.sceneEdits = {};     // per-scene overrides of the packed layout
// Dock order, top to bottom. The drawer list is this same array, so where a row
// sits in that list is literally where its panel sits on screen.
DEFAULT_STATE.order = Object.keys(WIDGETS);
let state = DEFAULT_STATE;
try {
  const saved = JSON.parse(localStorage.getItem("y70shell") || "null");
  if (saved && saved.widgets) {
    state = { ...DEFAULT_STATE, ...saved };
    // Widgets added by a later version won't be in a saved layout.
    state.widgets = { ...DEFAULT_STATE.widgets, ...saved.widgets };
    state.sceneEdits = saved.sceneEdits || {};
    state.order = normalizeOrder(saved.order);
  }
} catch (e) { /* fresh start */ }

function save() { localStorage.setItem("y70shell", JSON.stringify(state)); }

// Keeps a saved order usable across versions: drop widgets that no longer
// exist, and append any that were added since it was written.
function normalizeOrder(order) {
  const known = Object.keys(WIDGETS);
  const kept = (Array.isArray(order) ? order : []).filter((n) => known.includes(n));
  return kept.concat(known.filter((n) => !kept.includes(n)));
}

// Default panel height: a 16:9 chunk of the screen width, capped at 40% of height.
function defaultH() {
  return Math.min(Math.round(window.innerWidth * 9 / 16), Math.round(window.innerHeight * 0.4));
}
const MIN_H = 80;
const maxH = () => Math.round(window.innerHeight * 0.55);

// ---- app switching ---------------------------------------------------------
// Apps stay mounted once opened and are only hidden — tearing the iframe down
// would kill the Spotify Web Playback SDK and stop the music.
function appFrame(name) {
  let f = document.getElementById("app-" + name);
  if (!f) {
    f = document.createElement("iframe");
    f.id = "app-" + name;
    f.className = "app-frame";
    f.title = APPS[name].title;
    f.src = APPS[name].src;
    $("#appframe").appendChild(f);
  }
  return f;
}

function setApp(name) {
  if (!APPS[name]) return;
  state.app = name;
  save();
  appFrame(name);
  for (const key of Object.keys(APPS)) {
    const f = document.getElementById("app-" + key);
    if (f) f.classList.toggle("active", key === name);
  }
  document.querySelectorAll(".app-tile").forEach((t) =>
    t.classList.toggle("active", t.dataset.app === name));
  renderMini();
}

// ---- widget dock -----------------------------------------------------------
function renderDock() {
  const dock = $("#dock");
  dock.innerHTML = "";
  for (const name of normalizeOrder(state.order)) {
    const def = WIDGETS[name];
    const w = state.widgets[name];
    if (!def || !w || !w.on) continue;

    const panel = document.createElement("div");
    panel.className = "panel" + (w.collapsed ? " collapsed" : "");
    panel.dataset.widget = name;

    const bar = document.createElement("div");
    bar.className = "panel-bar";
    bar.innerHTML =
      `<span class="grip"></span><span class="panel-title">${def.title}</span>` +
      `<span class="panel-spacer"></span>` +
      `<button class="panel-collapse">${w.collapsed ? "▲" : "▼"}</button>`;

    const iframe = document.createElement("iframe");
    iframe.src = def.src;
    iframe.title = def.title;

    panel.appendChild(bar);
    panel.appendChild(iframe);
    panel.style.height = w.collapsed ? "auto" : (w.h || defaultH()) + "px";
    dock.appendChild(panel);

    wirePanelDrag(panel, bar, name);
    bar.querySelector(".panel-collapse").addEventListener("pointerup", (e) => {
      e.stopPropagation();
      toggleCollapse(name);
    });
  }
  renderWidgetList();
}

function toggleCollapse(name) {
  const w = state.widgets[name];
  w.collapsed = !w.collapsed;
  save();
  renderDock();
}

// Drag the panel bar to resize; drag it down to the bottom to collapse.
function wirePanelDrag(panel, bar, name) {
  let startY = 0, startH = 0, dragging = false, moved = false;

  bar.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".panel-collapse")) return;
    dragging = true; moved = false;
    startY = e.clientY;
    const w = state.widgets[name];
    startH = w.collapsed ? 0 : panel.getBoundingClientRect().height;
    bar.setPointerCapture(e.pointerId);
    document.getElementById("shell").classList.add("shielded");
  });

  bar.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dy = startY - e.clientY; // drag up = positive = taller
    if (Math.abs(dy) > 4) moved = true;
    const w = state.widgets[name];
    let h = Math.max(0, Math.min(startH + dy, maxH()));
    if (h > MIN_H && w.collapsed) {
      w.collapsed = false;
      panel.classList.remove("collapsed");
      bar.querySelector(".panel-collapse").textContent = "▼";
    }
    if (!w.collapsed) panel.style.height = h + "px";
  });

  bar.addEventListener("pointerup", (e) => {
    if (!dragging) return;
    dragging = false;
    document.getElementById("shell").classList.remove("shielded");
    const w = state.widgets[name];
    const h = panel.getBoundingClientRect().height;

    if (!moved) {
      // Plain tap on the bar: expand if collapsed.
      if (w.collapsed) toggleCollapse(name);
      return;
    }
    if (h <= MIN_H) {
      // Dragged down to the bottom -> collapse.
      w.collapsed = true;
      save();
      renderDock();
    } else {
      w.h = Math.round(h);
      w.collapsed = false;
      save();
    }
  });
}

// ---- drawer ----------------------------------------------------------------
const drawer = $("#drawer");
const backdrop = $("#drawer-backdrop");

function openDrawer(open) {
  drawer.classList.toggle("open", open);
  backdrop.classList.toggle("hidden", !open);
  // Always reopen on the main view, never mid-settings.
  if (!open) showSettings(false);
}

function wireDrawer() {
  const topbar = $("#topbar");
  let startY = 0, dragging = false, moved = false;

  topbar.addEventListener("pointerdown", (e) => {
    dragging = true; moved = false; startY = e.clientY;
    drawer.classList.add("dragging");
    topbar.setPointerCapture(e.pointerId);
    document.getElementById("shell").classList.add("shielded");
  });
  topbar.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dy = e.clientY - startY;
    if (dy > 6) moved = true;
    const h = drawer.getBoundingClientRect().height;
    const t = Math.min(0, -h + Math.max(0, dy));
    drawer.style.transform = `translateY(${t}px)`;
    if (dy > 10) backdrop.classList.remove("hidden");
  });
  topbar.addEventListener("pointerup", (e) => {
    if (!dragging) return;
    dragging = false;
    drawer.classList.remove("dragging");
    drawer.style.transform = "";
    document.getElementById("shell").classList.remove("shielded");
    const dy = e.clientY - startY;
    openDrawer(moved ? dy > 70 : !drawer.classList.contains("open"));
  });

  backdrop.addEventListener("pointerup", () => openDrawer(false));
  $("#drawer-close").addEventListener("pointerup", () => openDrawer(false));

  // Tiles
  document.querySelectorAll(".app-tile").forEach((t) => {
    t.addEventListener("pointerup", () => { setApp(t.dataset.app); openDrawer(false); });
  });
}

// ---- Widget list: toggle + drag to reorder ---------------------------------
// The rows ARE the dock, in order. The grip drags; anywhere else toggles.
function renderWidgetList() {
  const box = $("#widget-list");
  if (!box) return;
  box.innerHTML = "";
  for (const name of normalizeOrder(state.order)) {
    const def = WIDGETS[name];
    if (!def) continue;
    const w = state.widgets[name] || (state.widgets[name] = { on: false, h: null, collapsed: false });
    const row = document.createElement("div");
    row.className = "wrow" + (w.on ? " on" : "");
    row.dataset.widget = name;
    row.innerHTML =
      '<span class="wgrip" aria-label="Reorder"></span>' +
      '<span class="tile-ico ' + (def.ico || "") + '"></span>' +
      '<span class="wname"></span>' +
      '<span class="wcheck"></span>';
    row.querySelector(".wgrip").textContent = "\u2630";
    row.querySelector(".tile-ico").textContent = def.glyph || "";
    row.querySelector(".wname").textContent = def.title;
    row.addEventListener("pointerup", (e) => {
      if (justDragged || e.target.closest(".wgrip")) return;
      w.on = !w.on;
      save();
      renderDock();
    });
    box.appendChild(row);
  }
  wireReorder(box);
}

let dragRow = null, justDragged = false;

function wireReorder(box) {
  for (const grip of box.querySelectorAll(".wgrip")) {
    grip.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      dragRow = grip.closest(".wrow");
      dragRow.classList.add("dragging");
      grip.setPointerCapture(e.pointerId);
      $("#shell").classList.add("shielded");
    });
    grip.addEventListener("pointermove", (e) => {
      if (!dragRow) return;
      justDragged = true;
      // Swap against row midpoints so the list settles as you cross a boundary
      // instead of flickering back and forth on it.
      for (const other of box.querySelectorAll(".wrow")) {
        if (other === dragRow) continue;
        const r = other.getBoundingClientRect();
        if (e.clientY > r.top && e.clientY < r.bottom) {
          if (e.clientY < r.top + r.height / 2) box.insertBefore(dragRow, other);
          else box.insertBefore(dragRow, other.nextSibling);
          break;
        }
      }
    });
    const end = () => {
      if (!dragRow) return;
      dragRow.classList.remove("dragging");
      dragRow = null;
      $("#shell").classList.remove("shielded");
      // Once the drag ends the DOM is the source of truth.
      state.order = [...box.querySelectorAll(".wrow")].map((r) => r.dataset.widget);
      save();
      renderDock();
      // Stops the pointerup that ended the drag from also toggling the row.
      setTimeout(() => { justDragged = false; }, 0);
    };
    grip.addEventListener("pointerup", end);
    grip.addEventListener("pointercancel", end);
  }
}

// ---- Scenes: apply, save, reset ---------------------------------------------
// The packed layout is the fallback; an edit saved on top of it wins. Applying
// a scene is deliberately total — widgets it doesn't mention are turned OFF, so
// switching to Gaming can't leave yesterday's notes panel hanging around.
function sceneLayout(id) {
  const base = sceneById(id);
  if (!base) return null;
  const edit = state.sceneEdits && state.sceneEdits[id];
  // A packed scene's order is simply the order its widgets are written in.
  return edit
    ? { app: edit.app || base.app, widgets: edit.widgets || base.widgets, order: edit.order }
    : { app: base.app, widgets: base.widgets, order: Object.keys(base.widgets) };
}

function applyScene(id) {
  const layout = sceneLayout(id);
  if (!layout) return;
  for (const name of Object.keys(WIDGETS)) {
    const want = layout.widgets[name];
    const w = state.widgets[name] || (state.widgets[name] = { on: false, h: null, collapsed: false });
    w.on = !!want;
    if (want) {
      if (want.h) w.h = want.h;
      w.collapsed = !!want.collapsed;
    }
  }
  if (layout.order) state.order = normalizeOrder(layout.order);
  state.scene = id;
  save();
  setApp(layout.app || state.app);
  renderDock();
  renderScenes();
}

function saveScene(id) {
  const widgets = {};
  for (const name of normalizeOrder(state.order)) {
    const w = state.widgets[name];
    if (w && w.on) widgets[name] = { h: w.h || undefined, collapsed: !!w.collapsed };
  }
  state.sceneEdits[id] = {
    app: state.app,
    widgets,
    order: normalizeOrder(state.order).filter((n) => widgets[n]),
  };
  state.scene = id;
  save();
  renderScenes();
}

function resetScene(id) {
  delete state.sceneEdits[id];
  save();
  applyScene(id);
}

function renderScenes() {
  const row = $("#scene-row");
  if (!row) return;
  row.innerHTML = "";
  for (const sc of SCENES) {
    const b = document.createElement("button");
    const edited = !!(state.sceneEdits && state.sceneEdits[sc.id]);
    b.className = "tile scene-tile" + (state.scene === sc.id ? " active" : "");
    b.innerHTML =
      '<span class="tile-ico scene-ico">' + sc.icon + "</span>" +
      "<span>" + sc.name + "</span>" +
      (edited ? '<span class="tile-sub">yours</span>' : "");
    b.addEventListener("pointerup", () => { applyScene(sc.id); openDrawer(false); });
    row.appendChild(b);
  }
  const cur = state.scene ? sceneById(state.scene) : null;
  $("#scene-save").textContent = cur ? "Save layout \u2192 " + cur.name : "Save layout";
  $("#scene-save").disabled = !cur;
  $("#scene-reset").disabled = !cur || !(state.sceneEdits && state.sceneEdits[state.scene]);
}

function wireScenes() {
  $("#scene-save").addEventListener("pointerup", () => { if (state.scene) saveScene(state.scene); });
  $("#scene-reset").addEventListener("pointerup", () => { if (state.scene) resetScene(state.scene); });
  renderScenes();
}

// ---- Settings: theme / appearance ------------------------------------------
// theme.js owns the colour maths and persistence; this is just the UI. Every
// frame reads the saved theme itself on load, so new iframes come up correct;
// the broadcast below is what updates frames that are *already* open.
const ACCENT_SWATCHES = [
  "#A85CD6", "#7C5CFF", "#5AA9FF", "#42D6C3", "#1ED760",
  "#E8D44D", "#FFB03D", "#FF5F56", "#FF5CA8", "#F2F2F7",
];
const BG_SWATCHES = ["#000000", "#07070a", "#0a0a0c", "#0d0812", "#080d14", "#0d0906", "#050d0a"];

let theme = Y70Theme.get();
const sameColor = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

function broadcastTheme(t) {
  document.querySelectorAll("iframe").forEach((f) => {
    try { f.contentWindow.postMessage({ type: "y70:theme", theme: t }, "*"); } catch (e) { /* ignore */ }
  });
}

// If an edited theme happens to match a preset again, show it as that preset
// rather than leaving it stuck on "Custom".
function retag(t) {
  const m = Y70Theme.PRESETS.find((p) =>
    sameColor(p.bg, t.bg) && sameColor(p.trim, t.trim) &&
    sameColor(p.weather, t.weather) && sameColor(p.claude, t.claude) &&
    sameColor(p.pc, t.pc) && sameColor(p.calc, t.calc) &&
    sameColor(p.media, t.media) && sameColor(p.tools, t.tools) &&
    sameColor(p.discord, t.discord) && p.tintBg === t.tintBg);
  return { ...t, id: m ? m.id : "custom", name: m ? m.name : "Custom" };
}

function applyTheme(next, rerender) {
  theme = Y70Theme.set(next);
  broadcastTheme(theme);
  const nameEl = $("#theme-name");
  if (nameEl) nameEl.textContent = theme.name;
  if (rerender !== false) renderSettings();
}

const setSlot = (slot, color) => applyTheme(retag({ ...theme, [slot]: color }));

function renderSettings() {
  const pr = $("#preset-row");
  if (!pr) return;
  pr.innerHTML = "";
  for (const p of Y70Theme.PRESETS) {
    const b = document.createElement("button");
    b.className = "preset" + (p.id === theme.id ? " on" : "");
    b.innerHTML =
      '<span class="preset-dots">' +
        '<i style="background:' + p.trim + '"></i>' +
        '<i style="background:' + p.weather + '"></i>' +
        '<i style="background:' + p.claude + '"></i>' +
      '<i style="background:' + p.pc + '"></i>' +
      '<i style="background:' + p.calc + '"></i>' +
      "</span>" +
      '<span class="preset-name">' + p.name + "</span>";
    b.addEventListener("pointerup", () => applyTheme({ ...Y70Theme.preset(p.id) }));
    pr.appendChild(b);
  }

  document.querySelectorAll(".swatches").forEach((row) => {
    const slot = row.dataset.slot;
    row.innerHTML = "";
    for (const c of (slot === "bg" ? BG_SWATCHES : ACCENT_SWATCHES)) {
      const b = document.createElement("button");
      b.className = "sw" + (sameColor(c, theme[slot]) ? " on" : "");
      b.style.background = c;
      b.style.setProperty("--sw-ink", Y70Theme.ink(c));
      b.addEventListener("pointerup", () => setSlot(slot, c));
      row.appendChild(b);
    }
    // Native picker for anything not in the row. It fires `input` continuously
    // while the user drags, so preview live but only re-render on `change` —
    // re-rendering mid-drag would delete the input being interacted with.
    const wrap = document.createElement("label");
    wrap.className = "sw-custom";
    const inp = document.createElement("input");
    inp.type = "color";
    inp.value = theme[slot];
    inp.addEventListener("input", () => applyTheme(retag({ ...theme, [slot]: inp.value }), false));
    inp.addEventListener("change", () => renderSettings());
    wrap.appendChild(inp);
    row.appendChild(wrap);
  });

  $("#tint-bg").checked = !!theme.tintBg;
}

function showSettings(on) {
  $("#settings-view").classList.toggle("hidden", !on);
  $(".drawer-inner").classList.toggle("hidden", on);
  if (on) renderSettings();
}

function wireSettings() {
  $("#theme-name").textContent = theme.name;
  $("#open-settings").addEventListener("pointerup", () => showSettings(true));
  $("#settings-back").addEventListener("pointerup", () => showSettings(false));
  $("#settings-close").addEventListener("pointerup", () => openDrawer(false));
  $("#settings-reset").addEventListener("pointerup", () =>
    applyTheme({ ...Y70Theme.PRESETS[0] }));
  $("#tint-bg").addEventListener("change", (e) =>
    applyTheme(retag({ ...theme, tintBg: e.target.checked })));
}

// ---- Native shell (V2) -----------------------------------------------------
// window.y70native only exists when the dashboard is running inside the V2
// Electron shell. In a plain browser every one of these is a no-op and the
// native-only controls stay hidden, so one set of pages serves both.
const native = window.y70native || null;
let keyboardMode = false;

function wireNative() {
  document.body.classList.toggle("is-native", !!native);
  if (!native) return;
  native.getKeyboardMode().then(setKeyboardIndicator);
  native.onKeyboardMode(setKeyboardIndicator);
  $("#kb-toggle").addEventListener("pointerup", () => native.setKeyboardMode(!keyboardMode));
  $("#native-reload").addEventListener("pointerup", () => native.reload());
  $("#native-quit").addEventListener("pointerup", () => native.quit());
}

function setKeyboardIndicator(on) {
  keyboardMode = !!on;
  document.body.classList.toggle("keyboard-mode", keyboardMode);
  const t = $("#kb-toggle");
  if (t) t.textContent = keyboardMode ? "Keyboard mode: ON" : "Keyboard mode: off";
}

// A widget that needs typing (Notes) asks through the shell, since preload is
// only injected into this top-level frame.
function relayKeyboardRequest(on) {
  if (!native) return;
  native.setKeyboardMode(!!on);
}

// ---- Mini player -----------------------------------------------------------
// A slim now-playing strip that appears automatically whenever you leave the
// Spotify app while something is loaded, and disappears when you go back.
let playback = { hasTrack: false, playing: false };
let lastState = null;

function renderMini() {
  const dock = $("#dock");
  const want = state.app !== "spotify" && playback.hasTrack;
  let panel = document.getElementById("mini-panel");

  if (!want) { if (panel) panel.remove(); return; }
  if (panel) return;

  panel = document.createElement("div");
  panel.id = "mini-panel";
  const f = document.createElement("iframe");
  f.src = "/widget-miniplayer.html";
  f.title = "Now playing";
  f.addEventListener("load", () => {
    if (lastState) { try { f.contentWindow.postMessage(lastState, "*"); } catch (e) {} }
  });
  panel.appendChild(f);
  dock.insertBefore(panel, dock.firstChild);
}

// ---- message relay ---------------------------------------------------------
//   app  -> widgets   (playback state)
//   widget -> app     (transport commands)
window.addEventListener("message", (e) => {
  const d = e.data;
  if (!d || typeof d.type !== "string" || !d.type.startsWith("y70:")) return;

  // A widget asking to borrow the keyboard (see the Notes widget).
  if (d.type === "y70:keyboard") { relayKeyboardRequest(d.on); return; }

  if (d.type === "y70:cmd") {
    const sp = document.getElementById("app-spotify");
    if (sp) { try { sp.contentWindow.postMessage(d, "*"); } catch (err) {} }
    return;
  }

  if (d.type === "y70:state") {
    lastState = d;
    const was = playback.hasTrack;
    playback = { hasTrack: !!d.hasTrack, playing: !!d.playing };
    if (was !== playback.hasTrack) renderMini();
  }

  document.querySelectorAll("#dock iframe").forEach((f) => {
    try { f.contentWindow.postMessage(d, "*"); } catch (err) { /* ignore */ }
  });
});

// ---- boot ------------------------------------------------------------------
wireDrawer();
wireSettings();
wireScenes();
wireNative();
setApp(state.app);
renderDock();
window.addEventListener("resize", () => renderDock());
