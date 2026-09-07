// ============================================================================
//  Y70 reactive weather backdrop — shared by the full weather app and the
//  bottom-dock weather widget so both react to the sky the same way.
//
//  Draws a condition-coloured gradient plus, depending on the weather: drifting
//  clouds, rain streaks or snow, twinkling stars at night, a sun/moon glow on
//  clear skies, and lightning flashes in a storm.
//
//    const bg = WeatherBg.create(canvasEl, { density: 0.4 });
//    bg.set({ kind: "rain", night: false });
//    bg.start();
//
//  `density` scales particle and cloud counts — the dock widget is a fraction of
//  the app's height, so the app's counts would look like a blizzard in it.
// ============================================================================
(function (global) {
  const PALETTES = {
    clear:  { day: ["#1b4d7a", "#0d2439", "#081018"], night: ["#0b1836", "#070f22", "#04060f"] },
    cloud:  { day: ["#2b3a4a", "#161f2b", "#0a0f16"], night: ["#141c28", "#0b111a", "#05080d"] },
    rain:   { day: ["#1e2c3a", "#131c26", "#080c11"], night: ["#101720", "#0a0f15", "#04070a"] },
    storm:  { day: ["#221f33", "#14121f", "#08070d"], night: ["#171426", "#0d0b16", "#05040a"] },
    snow:   { day: ["#33414f", "#1d2731", "#0d1218"], night: ["#161d26", "#0d1218", "#05080b"] },
    fog:    { day: ["#39424b", "#232a31", "#10151a"], night: ["#1a2027", "#11161b", "#070a0d"] },
  };

  // WMO weather code -> which backdrop to draw.
  const KINDS = {
    0: "clear", 1: "clear", 2: "cloud", 3: "cloud",
    45: "fog", 48: "fog",
    51: "rain", 53: "rain", 55: "rain", 56: "rain", 57: "rain",
    61: "rain", 63: "rain", 65: "rain", 66: "rain", 67: "rain",
    71: "snow", 73: "snow", 75: "snow", 77: "snow",
    80: "rain", 81: "rain", 82: "rain",
    85: "snow", 86: "snow",
    95: "storm", 96: "storm", 99: "storm",
  };
  const kindFor = (code) => KINDS[code] || "cloud";

  function create(canvas, opts) {
    const o = opts || {};
    const density = o.density == null ? 1 : o.density;
    const ctx = canvas.getContext("2d");
    const state = { kind: "cloud", night: false };
    let parts = [], stars = [], clouds = [];
    let W = 0, H = 0, flash = 0, raf = null, running = false;

    // Themed palettes: when the theme asks for a tint, every palette colour is
    // re-hued onto the weather accent while keeping its own lightness, so storm
    // still reads darker than clear — only the hue family changes.
    let palettes = PALETTES;
    function rebuild(t) {
      if (!t || !t.tintBg || !global.Y70Theme) { palettes = PALETTES; return; }
      const out = {};
      for (const k in PALETTES) {
        out[k] = {
          day: PALETTES[k].day.map((c) => global.Y70Theme.tint(c, t.weather, 0.9)),
          night: PALETTES[k].night.map((c) => global.Y70Theme.tint(c, t.weather, 0.9)),
        };
      }
      palettes = out;
    }
    if (global.Y70Theme) global.Y70Theme.onChange(rebuild);

    function seed() {
      const k = state.kind;
      const scale = Math.max(0.15, density);
      parts = [];
      const n = Math.round((k === "rain" ? 150 : k === "storm" ? 200 : k === "snow" ? 90 : 0) * scale);
      for (let i = 0; i < n; i++) {
        parts.push({
          x: Math.random() * W, y: Math.random() * H,
          v: k === "snow" ? 0.4 + Math.random() * 0.8 : 5 + Math.random() * 7,
          len: k === "snow" ? 1.6 + Math.random() * 2 : 8 + Math.random() * 14,
          drift: (Math.random() - 0.5) * (k === "snow" ? 0.7 : 0.5),
          o: 0.15 + Math.random() * 0.35,
        });
      }
      stars = [];
      if (state.night && (k === "clear" || k === "cloud")) {
        for (let i = 0; i < Math.round(70 * scale); i++) {
          stars.push({
            x: Math.random() * W, y: Math.random() * H * 0.75,
            r: Math.random() * 1.2 + 0.3, tw: Math.random() * Math.PI * 2,
          });
        }
      }
      clouds = [];
      if (k === "cloud" || k === "fog" || k === "rain" || k === "storm") {
        const cn = Math.max(2, Math.round((k === "fog" ? 7 : 5) * scale));
        // Cloud radius is tied to the canvas so they stay clouds rather than
        // one flat wash across a short widget.
        const base = Math.max(60, Math.min(190, H * 0.75));
        for (let i = 0; i < cn; i++) {
          clouds.push({
            x: Math.random() * W, y: Math.random() * H * 0.6,
            r: base * (0.6 + Math.random() * 0.9),
            v: 0.06 + Math.random() * 0.16,
            o: (k === "fog" ? 0.1 : 0.055) + Math.random() * 0.05,
          });
        }
      }
    }

    function resize() {
      const r = global.devicePixelRatio || 1;
      W = canvas.clientWidth; H = canvas.clientHeight;
      if (!W || !H) return;
      canvas.width = W * r; canvas.height = H * r;
      ctx.setTransform(r, 0, 0, r, 0, 0);
      seed();
    }

    function draw(t) {
      if (!W || !H) return;
      const pal = (palettes[state.kind] || palettes.cloud)[state.night ? "night" : "day"];
      const g = ctx.createLinearGradient(0, 0, W * 0.4, H);
      g.addColorStop(0, pal[0]); g.addColorStop(0.55, pal[1]); g.addColorStop(1, pal[2]);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);

      // Sun / moon glow on clear skies
      if (state.kind === "clear") {
        const gx = W * 0.78, gy = H * 0.16;
        const gl = ctx.createRadialGradient(gx, gy, 0, gx, gy, Math.max(W, H) * 0.45);
        gl.addColorStop(0, state.night ? "rgba(180,200,255,.20)" : "rgba(255,206,120,.30)");
        gl.addColorStop(1, "transparent");
        ctx.fillStyle = gl;
        ctx.fillRect(0, 0, W, H);
      }

      // Stars
      for (const s of stars) {
        const a = 0.35 + Math.sin(t / 900 + s.tw) * 0.3;
        ctx.globalAlpha = Math.max(0, a);
        ctx.fillStyle = "#dfe9ff";
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 6.283); ctx.fill();
      }
      ctx.globalAlpha = 1;

      // Clouds
      for (const c of clouds) {
        c.x += c.v;
        if (c.x - c.r > W) c.x = -c.r;
        const cg = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, c.r);
        cg.addColorStop(0, "rgba(190,210,235," + c.o + ")");
        cg.addColorStop(1, "transparent");
        ctx.fillStyle = cg;
        ctx.beginPath(); ctx.arc(c.x, c.y, c.r, 0, 6.283); ctx.fill();
      }

      // Precipitation
      const snow = state.kind === "snow";
      ctx.strokeStyle = "rgba(190,220,255,.55)";
      ctx.fillStyle = "rgba(255,255,255,.8)";
      ctx.lineWidth = 1.1;
      for (const p of parts) {
        p.y += p.v; p.x += p.drift;
        if (p.y > H) { p.y = -10; p.x = Math.random() * W; }
        if (p.x > W) p.x = 0; else if (p.x < 0) p.x = W;
        ctx.globalAlpha = p.o;
        if (snow) { ctx.beginPath(); ctx.arc(p.x, p.y, p.len * 0.5, 0, 6.283); ctx.fill(); }
        else { ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + p.drift * 2, p.y + p.len); ctx.stroke(); }
      }
      ctx.globalAlpha = 1;

      // Lightning
      if (state.kind === "storm") {
        if (flash <= 0 && Math.random() < 0.004) flash = 1;
        if (flash > 0) {
          ctx.fillStyle = "rgba(200,215,255," + (flash * 0.22) + ")";
          ctx.fillRect(0, 0, W, H);
          flash -= 0.05;
        }
      }
    }

    function loop(t) {
      if (!running) return;
      draw(t);
      raf = global.requestAnimationFrame(loop);
    }

    const api = {
      state,
      set(next) {
        let changed = false;
        for (const k of ["kind", "night"]) {
          if (next && next[k] !== undefined && next[k] !== state[k]) { state[k] = next[k]; changed = true; }
        }
        if (changed) seed();
        return api;
      },
      setCode(code, isDay) {
        return api.set({ kind: kindFor(code), night: !isDay });
      },
      resize, seed, draw,
      start() {
        if (running) return api;
        running = true;
        resize();
        raf = global.requestAnimationFrame(loop);
        return api;
      },
      stop() {
        running = false;
        if (raf) global.cancelAnimationFrame(raf);
        raf = null;
        return api;
      },
    };
    return api;
  }

  global.WeatherBg = { create, kindFor, PALETTES };
})(window);
