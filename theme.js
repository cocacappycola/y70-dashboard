// ============================================================================
//  Y70 theme — one palette shared by the shell and every app/widget iframe.
//
//  Everything is served from the same origin (127.0.0.1:8888), so all frames
//  share one localStorage. Each page therefore *reads the theme itself* on load
//  (no flash of the wrong colour while waiting for a message) and additionally
//  listens for a "y70:theme" postMessage so edits in the settings menu apply
//  live to already-open frames.
//
//  Pages don't consume the raw theme: apply() derives a full set of CSS custom
//  properties from three accents + a background, and the stylesheets read those
//  with their original colours as fallbacks — so a page still looks right if
//  this script never runs.
// ============================================================================
(function (global) {
  const KEY = "y70theme";

  // --- Presets --------------------------------------------------------------
  const PRESETS = [
    {
      id: "main-purple", name: "Main Purple",
      bg: "#000000", trim: "#A85CD6", weather: "#A85CD6", claude: "#A85CD6", pc: "#A85CD6", calc: "#A85CD6", media: "#A85CD6", tools: "#A85CD6", discord: "#A85CD6", web: "#A85CD6",
      tintBg: true,
    },
    {
      id: "default", name: "Default",
      bg: "#0a0a0c", trim: "#1ed760", weather: "#6cb6ff", claude: "#d97757", pc: "#42d6c3", calc: "#7c5cff", media: "#1ed760", tools: "#e8d44d", discord: "#5865f2", web: "#ff3b5c",
      tintBg: false,
    },
    {
      id: "midnight-ice", name: "Midnight Ice",
      bg: "#03060c", trim: "#5ad1ff", weather: "#5ad1ff", claude: "#7aa2ff", pc: "#8fe3d0", calc: "#7aa2ff", media: "#5ad1ff", tools: "#b6c7ff", discord: "#8aa0ff", web: "#8fd4ff",
      tintBg: true,
    },
    {
      id: "ember", name: "Ember",
      bg: "#0a0503", trim: "#ff7a3d", weather: "#ffb648", claude: "#ff5f56", pc: "#ffd166", calc: "#ff9f43", media: "#ff7a3d", tools: "#ffd166", discord: "#ff8f6b", web: "#ff5f56",
      tintBg: true,
    },
  ];

  const DEFAULT_ID = "main-purple";

  // --- Colour maths ---------------------------------------------------------
  function hex2rgb(h) {
    h = String(h || "#000").replace("#", "").trim();
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const n = parseInt(h, 16);
    if (isNaN(n)) return [0, 0, 0];
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgb2hex(r, g, b) {
    const c = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
    return "#" + c(r) + c(g) + c(b);
  }
  function mix(a, b, t) {
    const A = hex2rgb(a), B = hex2rgb(b);
    return rgb2hex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
  }
  function rgba(hex, a) {
    const [r, g, b] = hex2rgb(hex);
    return "rgba(" + r + "," + g + "," + b + "," + a + ")";
  }
  // Relative luminance — decides whether text on top of an accent is black or white.
  function lum(hex) {
    const c = hex2rgb(hex).map((v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  const ink = (hex) => (lum(hex) > 0.42 ? "#000000" : "#ffffff");

  function rgb2hsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let h = 0;
    if (d) {
      if (mx === r) h = ((g - b) / d) % 6;
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    const l = (mx + mn) / 2;
    const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
    return [h, s, l];
  }
  function hsl2hex(h, s, l) {
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; }
    else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; }
    else { r = c; b = x; }
    return rgb2hex((r + m) * 255, (g + m) * 255, (b + m) * 255);
  }

  // Re-hue a colour onto the accent's hue while keeping its own lightness.
  // Used for the weather app's canvas backdrop so "storm" stays darker than
  // "clear" — only the hue family changes.
  function tint(hex, accent, amount) {
    const [, s, l] = rgb2hsl.apply(null, hex2rgb(hex));
    const [ah, as] = rgb2hsl.apply(null, hex2rgb(accent));
    const ns = s + (Math.min(as, 0.6) - s) * (amount == null ? 1 : amount);
    return hsl2hex(ah, Math.max(0, Math.min(1, ns)), l);
  }

  // --- Load / save ----------------------------------------------------------
  function preset(id) {
    return PRESETS.find((p) => p.id === id) || PRESETS.find((p) => p.id === DEFAULT_ID);
  }
  function normalize(t) {
    const base = preset(t && t.id);
    return {
      id: (t && t.id) || base.id,
      name: (t && t.name) || base.name,
      bg: (t && t.bg) || base.bg,
      trim: (t && t.trim) || base.trim,
      weather: (t && t.weather) || base.weather,
      claude: (t && t.claude) || base.claude,
      pc: (t && t.pc) || base.pc,
      calc: (t && t.calc) || base.calc,
      media: (t && t.media) || base.media,
      tools: (t && t.tools) || base.tools,
      discord: (t && t.discord) || base.discord,
      web: (t && t.web) || base.web,
      tintBg: t && typeof t.tintBg === "boolean" ? t.tintBg : base.tintBg,
    };
  }
  function get() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return normalize(JSON.parse(raw));
    } catch (e) { /* fall through to the default preset */ }
    return normalize(preset(DEFAULT_ID));
  }
  function set(t) {
    const theme = normalize(t);
    try { localStorage.setItem(KEY, JSON.stringify(theme)); } catch (e) { /* private mode */ }
    apply(theme);
    return theme;
  }

  // --- Apply ----------------------------------------------------------------
  // Builds one "family" of surface colours around an accent: a background that
  // is the base tinted toward the accent, card fills, borders and text tiers.
  function family(prefix, bg, accent, out) {
    const soft = (w, a) => mix(mix(bg, "#ffffff", w), accent, a);
    out[prefix + "accent"] = accent;
    out[prefix + "accent-ink"] = ink(accent);
    out[prefix + "accent-dim"] = mix(accent, bg, 0.45);
    out[prefix + "accent-soft"] = rgba(accent, 0.16);
    out[prefix + "accent-line"] = rgba(accent, 0.34);
    out[prefix + "bg"] = mix(bg, accent, 0.05);
    out[prefix + "bg-2"] = soft(0.03, 0.05);
    // Top-left corner of the widget backdrop gradients — the one place the
    // accent is allowed to show through the background itself.
    out[prefix + "grad"] = soft(0.05, 0.17);
    out[prefix + "surface"] = soft(0.065, 0.05);
    out[prefix + "surface-2"] = soft(0.125, 0.06);
    out[prefix + "line"] = soft(0.18, 0.1);
    out[prefix + "text"] = mix("#ffffff", accent, 0.06);
    out[prefix + "sub"] = soft(0.66, 0.14);
    out[prefix + "muted"] = soft(0.44, 0.12);
    // Translucent versions for glassy cards stacked over the canvas backdrop.
    out[prefix + "card"] = rgba(mix("#ffffff", accent, 0.25), 0.06);
    out[prefix + "card-line"] = rgba(mix("#ffffff", accent, 0.3), 0.1);
  }

  function vars(t) {
    const out = {};
    out["--t-text"] = "#ffffff";
    family("--t-", t.bg, t.trim, out);       // shell chrome / trim
    family("--w-", t.bg, t.weather, out);    // weather app + weather widget
    family("--c-", t.bg, t.claude, out);     // Claude usage widget
    family("--p-", t.bg, t.pc, out);         // PC stats widget
    family("--k-", t.bg, t.calc, out);       // Calculator widget
    family("--m-", t.bg, t.media, out);      // Universal player + lyrics
    family("--u-", t.bg, t.tools, out);      // Audio hub, timer, notes
    family("--d-", t.bg, t.discord, out);    // Discord widget
    family("--v-", t.bg, t.web, out);        // YouTube / TikTok web apps
    // The shell's own backdrop is the chosen background *exactly* — pick black
    // and you get black. (family() would otherwise leave --t-bg 5% tinted; the
    // widgets keep that tint via --w-bg / --c-bg, which is what gives each one
    // its own faint cast.)
    out["--t-bg"] = t.bg;
    return out;
  }

  // Which family a page belongs to, declared as <html data-surface="discord">.
  // ui.css is written against generic --ui-* names so one set of control
  // styles can dress every surface; this copies the chosen family onto them
  // rather than making each page restate sixteen aliases by hand.
  const SURFACE = {
    trim: "--t-", weather: "--w-", claude: "--c-", pc: "--p-", calc: "--k-",
    media: "--m-", tools: "--u-", discord: "--d-", web: "--v-",
  };
  const UI_KEYS = [
    "accent", "accent-ink", "accent-dim", "accent-soft", "accent-line",
    "bg", "bg-2", "grad", "surface", "surface-2", "line",
    "text", "sub", "muted", "card", "card-line",
  ];

  let current = null;
  const listeners = [];

  function apply(t) {
    current = normalize(t);
    const s = document.documentElement.style;
    const v = vars(current);
    for (const k in v) s.setProperty(k, v[k]);

    const prefix = SURFACE[document.documentElement.getAttribute("data-surface")];
    if (prefix) for (const k of UI_KEYS) s.setProperty("--ui-" + k, v[prefix + k]);
    for (const fn of listeners) { try { fn(current); } catch (e) { /* keep going */ } }
    return current;
  }

  function onChange(fn) {
    listeners.push(fn);
    if (current) { try { fn(current); } catch (e) {} }
  }

  // --- Live updates ---------------------------------------------------------
  // The settings menu posts to every frame; `storage` covers any frame that was
  // not messaged (it only fires in *other* documents, which is exactly right).
  global.addEventListener("message", (e) => {
    const d = e.data;
    if (d && d.type === "y70:theme" && d.theme) apply(d.theme);
  });
  global.addEventListener("storage", (e) => {
    if (e.key === KEY) apply(get());
  });

  global.Y70Theme = {
    KEY, PRESETS, get, set, apply, onChange, preset,
    tint, mix, rgba, hex2rgb, rgb2hex, ink,
    current: () => current || get(),
  };

  apply(get());
})(window);
