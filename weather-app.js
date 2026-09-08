// ============================================================================
//  Y70 Weather app
//    · Open-Meteo forecast + air quality  (free, no key)
//    · RainViewer radar tiles             (free, no key)
//    · Esri dark basemap, no key         (CARTO now watermarks key-less tiles)
//  Everything below is client-side; nothing here costs money.
// ============================================================================

const $ = (s) => document.querySelector(s);

// ---------- WMO weather codes ----------------------------------------------
const WMO = {
  0: ["Clear", "☀️", "clear"], 1: ["Mostly clear", "🌤️", "clear"],
  2: ["Partly cloudy", "⛅", "cloud"], 3: ["Overcast", "☁️", "cloud"],
  45: ["Fog", "🌫️", "fog"], 48: ["Rime fog", "🌫️", "fog"],
  51: ["Light drizzle", "🌦️", "rain"], 53: ["Drizzle", "🌦️", "rain"], 55: ["Heavy drizzle", "🌧️", "rain"],
  56: ["Freezing drizzle", "🌧️", "rain"], 57: ["Freezing drizzle", "🌧️", "rain"],
  61: ["Light rain", "🌧️", "rain"], 63: ["Rain", "🌧️", "rain"], 65: ["Heavy rain", "🌧️", "rain"],
  66: ["Freezing rain", "🌧️", "rain"], 67: ["Freezing rain", "🌧️", "rain"],
  71: ["Light snow", "🌨️", "snow"], 73: ["Snow", "🌨️", "snow"], 75: ["Heavy snow", "❄️", "snow"],
  77: ["Snow grains", "❄️", "snow"],
  80: ["Showers", "🌦️", "rain"], 81: ["Showers", "🌧️", "rain"], 82: ["Heavy showers", "⛈️", "rain"],
  85: ["Snow showers", "🌨️", "snow"], 86: ["Snow showers", "❄️", "snow"],
  95: ["Thunderstorm", "⛈️", "storm"], 96: ["Storm + hail", "⛈️", "storm"], 99: ["Storm + hail", "⛈️", "storm"],
};
const wmo = (c) => WMO[c] || ["—", "🌡️", "cloud"];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// ---------- AQI (US EPA categories) -----------------------------------------
const AQI_CATS = [
  [50,  "Good",            "#00c853", "Air quality is satisfactory; little or no risk."],
  [100, "Moderate",        "#ffd600", "Acceptable, though unusually sensitive people may notice symptoms."],
  [150, "Sensitive groups","#ff8f00", "Sensitive groups may feel effects; the general public likely won't."],
  [200, "Unhealthy",       "#e53935", "Everyone may begin to feel effects; sensitive groups more seriously."],
  [300, "Very unhealthy",  "#8e24aa", "Health alert — everyone may experience serious effects."],
  [1e9, "Hazardous",       "#7b1741", "Emergency conditions — the entire population is likely affected."],
];
function aqiCat(v) {
  for (const c of AQI_CATS) if (v <= c[0]) return c;
  return AQI_CATS[AQI_CATS.length - 1];
}

// ---------- State ------------------------------------------------------------
let coords = { lat: 40.71, lon: -74.01, label: "New York" };
let weather = null, air = null;
let bgState = { kind: "cloud", night: false, aqi: 0 };

// ============================================================================
//  Location
// ============================================================================
function resolveCoords() {
  return new Promise((resolve) => {
    const cfg = (window.SPOTIFY_CONFIG && window.SPOTIFY_CONFIG.WEATHER) || {};
    if (cfg.LAT != null && cfg.LON != null) {
      return resolve({ lat: cfg.LAT, lon: cfg.LON, label: cfg.LABEL || "" });
    }
    if (!navigator.geolocation) return resolve({ ...coords, label: "New York (default)" });
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, label: "" }),
      () => resolve({ ...coords, label: "New York (set coords in config.js)" }),
      { timeout: 6000 }
    );
  });
}

// Reverse-geocode for a friendly place name (Open-Meteo, no key).
async function placeName(lat, lon) {
  try {
    const r = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?latitude=${lat}&longitude=${lon}&count=1&language=en&format=json`);
    const d = await r.json();
    const g = d.results && d.results[0];
    if (g) return g.name + (g.admin1 ? ", " + g.admin1 : "");
  } catch (e) { /* fall through */ }
  return null;
}

// ============================================================================
//  Data
// ============================================================================
async function loadAll() {
  $("#refresh").classList.add("spin");
  try {
    const fUrl = "https://api.open-meteo.com/v1/forecast?latitude=" + coords.lat + "&longitude=" + coords.lon +
      "&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m," +
      "wind_direction_10m,wind_gusts_10m,surface_pressure,is_day,dew_point_2m,visibility,uv_index" +
      "&hourly=temperature_2m,weather_code,precipitation_probability" +
      "&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max,sunrise,sunset,uv_index_max" +
      "&timezone=auto&forecast_days=7&temperature_unit=fahrenheit&wind_speed_unit=mph";
    const aUrl = "https://air-quality-api.open-meteo.com/v1/air-quality?latitude=" + coords.lat +
      "&longitude=" + coords.lon +
      "&current=us_aqi,pm2_5,pm10,ozone,nitrogen_dioxide,sulphur_dioxide,carbon_monoxide&timezone=auto";

    const [fRes, aRes] = await Promise.all([fetch(fUrl), fetch(aUrl)]);
    weather = await fRes.json();
    air = await aRes.json().catch(() => null);

    renderCurrent();
    renderHourly();
    renderDaily();
    renderAir();
    updateBackground();
  } catch (e) {
    console.error(e);
    $("#now-cond").textContent = "Couldn't load weather";
    $("#now-feels").textContent = "Check the internet connection.";
  } finally {
    $("#refresh").classList.remove("spin");
  }
}

// ============================================================================
//  Render — current
// ============================================================================
const timeFmt = (iso) => {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
};

function renderCurrent() {
  const c = weather.current, d = weather.daily;
  const [txt, ico, kind] = wmo(c.weather_code);
  bgState.kind = kind;
  bgState.night = !c.is_day;
  bg.set({ kind: kind, night: !c.is_day });

  $("#now-icon").textContent = ico;
  $("#now-temp").textContent = Math.round(c.temperature_2m) + "°";
  $("#now-cond").textContent = txt;
  $("#now-feels").textContent = "Feels like " + Math.round(c.apparent_temperature) + "°";
  $("#now-hilo").textContent = "H " + Math.round(d.temperature_2m_max[0]) + "°  ·  L " + Math.round(d.temperature_2m_min[0]) + "°";

  const dirs = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
  const dir = dirs[Math.round(c.wind_direction_10m / 22.5) % 16];
  $("#d-wind").textContent = Math.round(c.wind_speed_10m) + " mph " + dir;
  $("#d-hum").textContent = c.relative_humidity_2m + "%";
  $("#d-uv").textContent = Math.round(d.uv_index_max[0]);
  $("#d-pres").textContent = Math.round(c.surface_pressure) + " hPa";
  $("#d-vis").textContent = c.visibility != null ? (c.visibility / 1609).toFixed(1) + " mi" : "—";
  $("#d-dew").textContent = Math.round(c.dew_point_2m) + "°";
  $("#d-sunrise").textContent = timeFmt(d.sunrise[0]);
  $("#d-sunset").textContent = timeFmt(d.sunset[0]);
}

function renderHourly() {
  const h = weather.hourly;
  const box = $("#hourly");
  box.innerHTML = "";
  const now = Date.now();
  let start = h.time.findIndex((t) => new Date(t).getTime() >= now - 36e5);
  if (start < 0) start = 0;
  for (let i = start; i < Math.min(start + 24, h.time.length); i++) {
    const dt = new Date(h.time[i]);
    const [, ico] = wmo(h.weather_code[i]);
    const pop = h.precipitation_probability ? h.precipitation_probability[i] : 0;
    const el = document.createElement("div");
    el.className = "hr" + (i === start ? " now" : "");
    el.innerHTML =
      '<div class="hr-t">' + (i === start ? "Now" : dt.toLocaleTimeString([], { hour: "numeric" }).replace(" ", "")) + "</div>" +
      '<div class="hr-i">' + ico + "</div>" +
      '<div class="hr-v">' + Math.round(h.temperature_2m[i]) + "°</div>" +
      '<div class="hr-p">' + (pop >= 15 ? pop + "%" : "") + "</div>";
    box.appendChild(el);
  }
}

function renderDaily() {
  const d = weather.daily;
  const box = $("#daily");
  box.innerHTML = "";
  const lo = Math.min(...d.temperature_2m_min), hi = Math.max(...d.temperature_2m_max);
  const span = Math.max(1, hi - lo);
  for (let i = 0; i < d.time.length; i++) {
    const dt = new Date(d.time[i] + "T12:00:00");
    const [, ico] = wmo(d.weather_code[i]);
    const pop = d.precipitation_probability_max ? d.precipitation_probability_max[i] : 0;
    const l = d.temperature_2m_min[i], hgh = d.temperature_2m_max[i];
    const left = ((l - lo) / span) * 100, width = Math.max(6, ((hgh - l) / span) * 100);
    const el = document.createElement("div");
    el.className = "dy";
    el.innerHTML =
      '<div class="dy-n">' + (i === 0 ? "Today" : DOW[dt.getDay()]) + "</div>" +
      '<div class="dy-i">' + ico + "</div>" +
      '<div class="dy-p">' + (pop >= 15 ? pop + "%" : "") + "</div>" +
      '<div class="dy-r"><span class="dy-lo">' + Math.round(l) + "°</span>" +
      '<span class="dy-bar"><span class="dy-seg" style="left:' + left + "%;width:" + width + '%"></span></span>' +
      '<span class="dy-hi">' + Math.round(hgh) + "°</span></div>";
    box.appendChild(el);
  }
}

// ---------- Air quality ------------------------------------------------------
const POLLUTANTS = [
  ["pm2_5", "PM2.5", "µg/m³", 55],
  ["pm10", "PM10", "µg/m³", 155],
  ["ozone", "Ozone", "µg/m³", 180],
  ["nitrogen_dioxide", "NO₂", "µg/m³", 200],
  ["sulphur_dioxide", "SO₂", "µg/m³", 200],
  ["carbon_monoxide", "CO", "µg/m³", 10000],
];

function renderAir() {
  if (!air || !air.current) return;
  const v = air.current.us_aqi;
  if (v == null) return;
  const [, label, color, desc] = aqiCat(v);
  bgState.aqi = v;

  $("#aq-big").textContent = Math.round(v);
  $("#aq-big").style.color = color;
  $("#aq-label").textContent = label;
  $("#aq-label").style.color = color;
  $("#aq-desc").textContent = desc;
  $("#aq-marker").style.left = "calc(" + Math.min(100, (Math.min(v, 300) / 300) * 100) + "% - 2px)";

  const badge = $("#aqi-badge");
  badge.classList.remove("hidden");
  $("#aqi-num").textContent = Math.round(v);
  $("#aqi-dot").style.background = color;

  const box = $("#pollutants");
  box.innerHTML = "";
  for (const [key, name, unit, ref] of POLLUTANTS) {
    const val = air.current[key];
    if (val == null) continue;
    const pct = Math.min(100, (val / ref) * 100);
    const el = document.createElement("div");
    el.className = "pol";
    el.innerHTML =
      '<div class="pol-h"><span class="pol-n">' + name + '</span>' +
      '<span class="pol-v">' + (val >= 100 ? Math.round(val) : val.toFixed(1)) + ' <span class="pol-u">' + unit + "</span></span></div>" +
      '<div class="pol-bar"><span class="pol-fill" style="width:' + pct + "%;background:" + aqiCat(pct * 2)[2] + '"></span></div>';
    box.appendChild(el);
  }
}

// ============================================================================
//  Reactive background
//  The drawing itself lives in weather-bg.js, shared with the dock widget so
//  both surfaces react to the sky identically. This file owns only the AQI
//  haze tint, which is app-only, and drives bg.draw() from its own rAF loop
//  (the same loop that paints the wind particles) rather than letting the
//  module run a second one.
// ============================================================================
const bg = WeatherBg.create($("#bg-canvas"), { density: 1 });

const sizeBg = () => bg.resize();
const drawBg = (t) => bg.draw(t);

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")";
}

function updateBackground() {
  bg.set({ kind: bgState.kind, night: bgState.night });
  bg.seed();
  // AQI haze tint over everything
  const v = bgState.aqi || 0;
  if (v > 60) {
    const [, , color] = aqiCat(v);
    const strength = Math.min(0.3, (v - 60) / 320);
    $("#bg-tint").style.background =
      "radial-gradient(120% 90% at 50% 100%, " + hexA(color, strength) + " 0%, transparent 72%)";
  } else {
    $("#bg-tint").style.background = "transparent";
  }
}

// ============================================================================
//  Map — tiny slippy map (no libraries)
// ============================================================================
const mapEl = $("#map"), worldEl = $("#map-world"), fx = $("#map-fx");
const fxCtx = fx.getContext("2d");
let aqiLayer = document.createElement("div");
aqiLayer.id = "map-aqi";
aqiLayer.style.cssText =
  "position:absolute;inset:0;pointer-events:none;filter:blur(22px);opacity:.42;mix-blend-mode:screen";
mapEl.insertBefore(aqiLayer, fx);

const MAXZ = 17, MINZ = 3;
// RainViewer's public tiles are only rendered up to z7 — above that every tile
// is a transparent placeholder, so it must be overzoomed client-side.
// IEM's NEXRAD mosaic (NOAA 1km data, CONUS only) renders at every zoom, so it
// is the better source whenever the view is over the US.
const RAINVIEWER_MAX_Z = 7;
// Past ~×16 an upscaled RainViewer tile is just coloured mush, so it drops out
// and only the sharp NEXRAD layer remains.
const RAINVIEWER_SHOW_MAX_Z = 11;
let mz = 8, mCenter = { lat: 0, lon: 0 }, mBase = { x: 0, y: 0 };
const overlays = { rain: true, wind: false, aqi: false };
let radarPath = null, radarTime = 0, windGrid = null, aqiGrid = null;
// Both radar layers are drawn together: NEXRAD (sharp, US-only) sits on top of
// RainViewer (coarse, global). Wherever NEXRAD has no data its tiles are
// transparent and the global layer shows through — so no coverage test is
// needed and border regions like southern Canada are not silently blanked.
let iemLive = true;

const lon2x = (lon, z) => ((lon + 180) / 360) * 256 * 2 ** z;
const lat2y = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 256 * 2 ** z;
};
const x2lon = (x, z) => (x / (256 * 2 ** z)) * 360 - 180;
const y2lat = (y, z) => {
  const n = Math.PI - (2 * Math.PI * y) / (256 * 2 ** z);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
};

function mapTransform() {
  const W = mapEl.clientWidth, H = mapEl.clientHeight;
  const dx = mBase.x - (lon2x(mCenter.lon, mz) - W / 2);
  const dy = mBase.y - (lat2y(mCenter.lat, mz) - H / 2);
  worldEl.style.transform = "translate3d(" + dx + "px," + dy + "px,0)";
}

// Each layer can draw from a different source zoom. A layer whose source tops
// out below the map zoom is overzoomed: one source tile is stretched to cover
// 2^(mz-sz) map tiles, so the overlay stays visible instead of vanishing.
// ---------------------------------------------------------------------------
//  Basemaps. All of these are key-less today, but a tile host can start
//  demanding an API key at any time — CARTO already did, which is why it is no
//  longer the default — so the map keeps a fallback chain: if the current source
//  returns nothing but errors, it moves to the next one on its own. The picker
//  in the map header switches manually and the choice is remembered.
//
//  Esri serves tiles as /tile/{z}/{y}/{x} — row before column, unlike the
//  {z}/{x}/{y} of every other source here.
// ---------------------------------------------------------------------------
const ESRI = "https://services.arcgisonline.com/ArcGIS/rest/services/";
const CARTO_KEY = ((window.SPOTIFY_CONFIG || {}).WEATHER || {}).CARTO_KEY || "";
const BASEMAPS = [
  {
    // Default. Dark Gray is split into a base and a separate labels layer, and
    // tops out at z16 — past that it is overzoomed like any other capped layer.
    id: "esri-dark", name: "Esri Dark", maxZ: 16,
    url: (z, x, y) => ESRI + "Canvas/World_Dark_Gray_Base/MapServer/tile/" + z + "/" + y + "/" + x,
    labels: (z, x, y) => ESRI + "Canvas/World_Dark_Gray_Reference/MapServer/tile/" + z + "/" + y + "/" + x,
    attr: "© Esri · HERE · Garmin",
  },
  {
    id: "esri-sat", name: "Satellite", maxZ: 18,
    url: (z, x, y) => ESRI + "World_Imagery/MapServer/tile/" + z + "/" + y + "/" + x,
    attr: "© Esri · Maxar · Earthstar",
  },
  {
    // Light tiles under a dark UI, so they get dimmed with a CSS filter.
    id: "osm", name: "OpenStreetMap", maxZ: 19, dim: true,
    url: (z, x, y) => "https://tile.openstreetmap.org/" + z + "/" + x + "/" + y + ".png",
    attr: "© OpenStreetMap contributors",
  },
];

// CARTO's dark basemap is the best-looking of the lot but it now stamps
// "API KEY REQUIRED" across every tile unless you register one — note that the
// request still returns HTTP 200 with a valid PNG, so nothing errors; the
// watermark is baked into the image. It is only offered once a key is set in
// config.js (WEATHER.CARTO_KEY), otherwise it would just look broken.
if (CARTO_KEY) {
  BASEMAPS.push({
    id: "carto", name: "Carto Dark", maxZ: 20,
    url: (z, x, y) => "https://basemaps.cartocdn.com/dark_all/" + z + "/" + x + "/" + y +
      "@2x.png?api_key=" + encodeURIComponent(CARTO_KEY),
    attr: "© OpenStreetMap · CARTO",
  });
}

let baseIdx = 0;
try {
  const savedBase = localStorage.getItem("y70_basemap");
  const i = BASEMAPS.findIndex((b) => b.id === savedBase);
  if (i >= 0) baseIdx = i;
} catch (e) { /* default */ }

// Failover bookkeeping: only abandon a source that has produced no tile at all.
let baseErrors = 0, baseLoaded = 0;

function basemap() { return BASEMAPS[baseIdx] || BASEMAPS[0]; }

function setBasemap(i, automatic) {
  baseIdx = ((i % BASEMAPS.length) + BASEMAPS.length) % BASEMAPS.length;
  baseErrors = 0; baseLoaded = 0;
  try { localStorage.setItem("y70_basemap", basemap().id); } catch (e) {}
  const btn = $("#map-base");
  if (btn) btn.textContent = basemap().name;
  $("#map-attr").textContent = basemap().attr + " · RainViewer";
  // Drop every basemap tile so the new source is fetched immediately.
  for (const c of [...worldEl.children]) {
    if (c.dataset.k && /^(base|labels):/.test(c.dataset.k)) c.remove();
  }
  renderTiles();
  if (automatic) $("#map-status").textContent = "switched to " + basemap().name;
}

function baseTileFailed() {
  baseErrors++;
  if (baseLoaded === 0 && baseErrors >= 6) setBasemap(baseIdx + 1, true);
}

function layerSpecs() {
  const B = basemap();
  const bz = Math.min(mz, B.maxZ);
  const layers = [{ kind: "base", sz: bz, z: 1, url: B.url, dim: B.dim, base: true }];
  if (B.labels) layers.push({ kind: "labels", sz: bz, z: 2, url: B.labels, base: true });
  if (overlays.rain) {
    // Global coarse radar underneath …
    if (radarPath && mz <= RAINVIEWER_SHOW_MAX_Z) {
      layers.push({
        kind: "rv", sz: Math.min(mz, RAINVIEWER_MAX_Z), z: 3, fade: true,
        // Colour scheme 6 = "NEXRAD Level-III", so this layer uses the same
        // dBZ colour scale as the NEXRAD layer stacked on top of it.
        url: (z, x, y) => radarPath + "/512/" + z + "/" + x + "/" + y + "/6/1_1.png",
      });
    }
    // … sharp 1 km NEXRAD on top wherever it has coverage.
    if (iemLive) {
      layers.push({
        kind: "nexrad", sz: mz, z: 4, fade: true,
        url: (z, x, y) =>
          "https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/" + z + "/" + x + "/" + y + ".png",
      });
    }
  }
  return layers;
}

function renderTiles() {
  const W = mapEl.clientWidth, H = mapEl.clientHeight;
  if (!W || !H) return;
  const left = lon2x(mCenter.lon, mz) - W / 2, top = lat2y(mCenter.lat, mz) - H / 2;
  mBase = { x: Math.floor(left / 256) * 256, y: Math.max(0, Math.floor(top / 256)) * 256 };

  const want = new Set();
  const frag = document.createDocumentFragment();
  const have = new Set([...worldEl.children].map((c) => c.dataset.k));

  for (const L of layerSpecs()) {
    const scale = 2 ** (mz - L.sz);         // >1 when the layer is overzoomed
    const span = 256 * scale;               // on-screen size of one source tile
    const n = 2 ** L.sz;
    const t0x = Math.floor(left / span), t1x = Math.floor((left + W) / span);
    const t0y = Math.max(0, Math.floor(top / span)), t1y = Math.min(n - 1, Math.floor((top + H) / span));

    for (let ty = t0y; ty <= t1y; ty++) {
      for (let tx = t0x; tx <= t1x; tx++) {
        const wx = ((tx % n) + n) % n;
        const k = L.kind + ":" + L.sz + ":" + tx + ":" + ty;
        want.add(k);
        if (have.has(k)) continue;
        const img = document.createElement("img");
        img.dataset.k = k;
        img.dataset.span = span;
        img.className = (L.fade ? "radar " : "") + (L.dim ? "dim" : "");
        img.style.cssText =
          "left:" + (tx * span - mBase.x) + "px;top:" + (ty * span - mBase.y) +
          "px;width:" + span + "px;height:" + span + "px;z-index:" + L.z;
        img.src = L.url(L.sz, wx, ty);
        if (L.base) {
          img.onload = () => { baseLoaded++; };
          img.onerror = () => { img.remove(); baseTileFailed(); };
        } else {
          img.onerror = () => img.remove();
        }
        frag.appendChild(img);
      }
    }
  }

  for (const c of [...worldEl.children]) if (!want.has(c.dataset.k)) c.remove();
  // Reposition survivors against the new base.
  for (const c of worldEl.children) {
    const [, , tx, ty] = c.dataset.k.split(":").map(Number);
    const span = Number(c.dataset.span);
    c.style.left = tx * span - mBase.x + "px";
    c.style.top = ty * span - mBase.y + "px";
  }
  worldEl.appendChild(frag);
  // Zoomed-in radar bins are huge; fade them so the basemap reads through.
  mapEl.style.setProperty("--radar-op", mz >= 13 ? ".5" : mz >= 11 ? ".62" : mz >= 10 ? ".72" : ".8");
  mapTransform();
  updateRadarStatus();
}

function updateRadarStatus() {
  const el = $("#map-status");
  if (!overlays.rain) { el.textContent = "z" + mz; return; }
  const parts = [];
  if (iemLive) parts.push("NEXRAD 1 km");
  if (radarPath && mz <= RAINVIEWER_SHOW_MAX_Z) {
    const over = mz > RAINVIEWER_MAX_Z;
    const age = radarTime ? Math.round((Date.now() / 1000 - radarTime) / 60) : null;
    parts.push("global" + (over ? " ×" + 2 ** (mz - RAINVIEWER_MAX_Z) : "") +
      (age != null ? " " + (age <= 1 ? "live" : age + "m") : ""));
  }
  el.textContent = (parts.join(" + ") || "radar unavailable") + " · z" + mz;
}

async function loadRadar() {
  try {
    const r = await fetch("https://api.rainviewer.com/public/weather-maps.json");
    const d = await r.json();
    const past = d.radar && d.radar.past;
    if (past && past.length) {
      radarPath = d.host + past[past.length - 1].path;
      radarTime = past[past.length - 1].time;
    }
  } catch (e) { radarPath = null; }
  updateRadarStatus();
}

// ---------- Grid data for wind / AQI overlays -------------------------------
function mapBounds() {
  const W = mapEl.clientWidth, H = mapEl.clientHeight;
  const left = lon2x(mCenter.lon, mz) - W / 2, top = lat2y(mCenter.lat, mz) - H / 2;
  return {
    n: y2lat(top, mz), s: y2lat(top + H, mz),
    w: x2lon(left, mz), e: x2lon(left + W, mz),
  };
}

function gridPoints(cols, rows) {
  const b = mapBounds();
  const pts = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      pts.push({
        lat: b.n + ((b.s - b.n) * j) / (rows - 1),
        lon: b.w + ((b.e - b.w) * i) / (cols - 1),
      });
    }
  }
  return { pts, cols, rows, b };
}

async function loadWindGrid() {
  const g = gridPoints(5, 4);
  const lats = g.pts.map((p) => p.lat.toFixed(3)).join(",");
  const lons = g.pts.map((p) => p.lon.toFixed(3)).join(",");
  try {
    const r = await fetch("https://api.open-meteo.com/v1/forecast?latitude=" + lats +
      "&longitude=" + lons + "&current=wind_speed_10m,wind_direction_10m&wind_speed_unit=ms");
    let d = await r.json();
    if (!Array.isArray(d)) d = [d];
    g.pts.forEach((p, i) => {
      const c = d[i] && d[i].current;
      const spd = c ? c.wind_speed_10m : 0, dir = c ? c.wind_direction_10m : 0;
      const rad = (dir * Math.PI) / 180;
      p.u = -spd * Math.sin(rad);   // east component
      p.v = -spd * Math.cos(rad);   // north component
      p.spd = spd;
    });
    windGrid = g;
  } catch (e) { windGrid = null; }
}

async function loadAqiGrid() {
  const g = gridPoints(5, 4);
  const lats = g.pts.map((p) => p.lat.toFixed(3)).join(",");
  const lons = g.pts.map((p) => p.lon.toFixed(3)).join(",");
  try {
    const r = await fetch("https://air-quality-api.open-meteo.com/v1/air-quality?latitude=" + lats +
      "&longitude=" + lons + "&current=us_aqi");
    let d = await r.json();
    if (!Array.isArray(d)) d = [d];
    g.pts.forEach((p, i) => { p.aqi = (d[i] && d[i].current && d[i].current.us_aqi) || 0; });
    aqiGrid = g;
    paintAqi();
  } catch (e) { aqiGrid = null; }
}

function paintAqi() {
  aqiLayer.innerHTML = "";
  if (!overlays.aqi || !aqiGrid) return;
  const W = mapEl.clientWidth, H = mapEl.clientHeight;
  const left = lon2x(mCenter.lon, mz) - W / 2, top = lat2y(mCenter.lat, mz) - H / 2;
  const r = Math.max(W, H) / 3.2;
  for (const p of aqiGrid.pts) {
    const x = lon2x(p.lon, mz) - left, y = lat2y(p.lat, mz) - top;
    const el = document.createElement("div");
    el.style.cssText =
      "position:absolute;left:" + (x - r) + "px;top:" + (y - r) + "px;width:" + r * 2 + "px;height:" + r * 2 +
      "px;border-radius:50%;background:radial-gradient(circle," + hexA(aqiCat(p.aqi)[2], 0.85) + " 0%, transparent 70%)";
    aqiLayer.appendChild(el);
  }
}

// ---------- Wind particles ---------------------------------------------------
let windParts = [];
function sampleWind(x, y) {
  if (!windGrid) return null;
  const W = mapEl.clientWidth, H = mapEl.clientHeight;
  const left = lon2x(mCenter.lon, mz) - W / 2, top = lat2y(mCenter.lat, mz) - H / 2;
  const lon = x2lon(left + x, mz), lat = y2lat(top + y, mz);
  const { b, cols, rows, pts } = windGrid;
  let fi = ((lon - b.w) / (b.e - b.w)) * (cols - 1);
  let fj = ((lat - b.n) / (b.s - b.n)) * (rows - 1);
  fi = Math.max(0, Math.min(cols - 1.001, fi));
  fj = Math.max(0, Math.min(rows - 1.001, fj));
  const i0 = Math.floor(fi), j0 = Math.floor(fj), di = fi - i0, dj = fj - j0;
  const at = (i, j) => pts[j * cols + i];
  const a = at(i0, j0), bb = at(i0 + 1, j0), c = at(i0, j0 + 1), d = at(i0 + 1, j0 + 1);
  const lerp = (p, q, t) => p + (q - p) * t;
  return {
    u: lerp(lerp(a.u, bb.u, di), lerp(c.u, d.u, di), dj),
    v: lerp(lerp(a.v, bb.v, di), lerp(c.v, d.v, di), dj),
    spd: lerp(lerp(a.spd, bb.spd, di), lerp(c.spd, d.spd, di), dj),
  };
}

function seedWind() {
  const W = mapEl.clientWidth, H = mapEl.clientHeight;
  windParts = [];
  for (let i = 0; i < 260; i++) {
    windParts.push({ x: Math.random() * W, y: Math.random() * H, age: Math.random() * 90 });
  }
}

function sizeFx() {
  const r = window.devicePixelRatio || 1;
  fx.width = mapEl.clientWidth * r; fx.height = mapEl.clientHeight * r;
  fxCtx.setTransform(r, 0, 0, r, 0, 0);
  seedWind();
}

function drawWind() {
  const W = mapEl.clientWidth, H = mapEl.clientHeight;
  if (!overlays.wind || !windGrid) { fxCtx.clearRect(0, 0, W, H); return; }
  fxCtx.globalCompositeOperation = "destination-out";
  fxCtx.fillStyle = "rgba(0,0,0,.12)";
  fxCtx.fillRect(0, 0, W, H);
  fxCtx.globalCompositeOperation = "source-over";

  fxCtx.lineWidth = 1.3;
  for (const p of windParts) {
    const w = sampleWind(p.x, p.y);
    if (!w) continue;
    const sc = 1.6;
    const nx = p.x + w.u * sc, ny = p.y - w.v * sc;
    const a = Math.min(0.85, 0.25 + w.spd / 22);
    fxCtx.strokeStyle = "rgba(150,215,255," + a + ")";
    fxCtx.beginPath(); fxCtx.moveTo(p.x, p.y); fxCtx.lineTo(nx, ny); fxCtx.stroke();
    p.x = nx; p.y = ny; p.age++;
    if (p.age > 90 || p.x < 0 || p.x > W || p.y < 0 || p.y > H) {
      p.x = Math.random() * W; p.y = Math.random() * H; p.age = 0;
    }
  }
}

function renderLegend() {
  const lg = $("#map-legend");
  if (overlays.aqi) {
    lg.classList.remove("hidden");
    lg.innerHTML = '<div class="lg-title">Air quality index</div>' +
      AQI_CATS.slice(0, 5).map((c, i) =>
        '<div class="lg-row"><span class="lg-sw" style="background:' + c[2] + '"></span>' +
        '<span class="lg-lab">' + (i === 0 ? "0–50" : (AQI_CATS[i - 1][0] + 1) + "–" + c[0]) + " " + c[1] + "</span></div>"
      ).join("");
  } else if (overlays.wind) {
    lg.classList.remove("hidden");
    lg.innerHTML = '<div class="lg-title">Wind</div><div class="lg-row"><span class="lg-lab">' +
      "streaks follow flow · brighter = faster</span></div>";
  } else if (overlays.rain) {
    lg.classList.remove("hidden");
    lg.innerHTML = '<div class="lg-title">' +
      "Reflectivity (dBZ)" + "</div>" +
      '<div class="lg-row"><span class="lg-sw" style="background:linear-gradient(90deg,#04e9e7,#019ff4,#02fd02,#fdf802,#fd9500,#fd0000,#bc0000,#f800fd)"></span>' +
      '<span class="lg-lab">light → heavy</span></div>';
  } else lg.classList.add("hidden");
}

// ---------- Map interaction --------------------------------------------------
const pointers = new Map();
let lastPt = null, gridTimer = null, pinch = null;

function scheduleGrids() {
  clearTimeout(gridTimer);
  gridTimer = setTimeout(() => {
    if (overlays.wind) loadWindGrid();
    if (overlays.aqi) loadAqiGrid();
  }, 500);
}

function settle() {
  renderTiles(); paintAqi(); scheduleGrids(); renderLegend();
}

mapEl.addEventListener("pointerdown", (e) => {
  if (e.target.closest("#map-zoom")) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  mapEl.setPointerCapture(e.pointerId);
  if (pointers.size === 1) lastPt = { x: e.clientX, y: e.clientY };
  else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), z0: mz };
  }
});

mapEl.addEventListener("pointermove", (e) => {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (pointers.size >= 2 && pinch) {
    // Pinch: step integer zoom, anchored at the midpoint between fingers.
    const [a, b] = [...pointers.values()];
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    const want = Math.round(pinch.z0 + Math.log2(dist / pinch.dist));
    if (want !== mz) {
      const r = mapEl.getBoundingClientRect();
      zoomAt(want, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
    }
    return;
  }

  if (!lastPt) return;
  const dx = e.clientX - lastPt.x, dy = e.clientY - lastPt.y;
  lastPt = { x: e.clientX, y: e.clientY };
  mCenter.lon = x2lon(lon2x(mCenter.lon, mz) - dx, mz);
  mCenter.lat = Math.max(-85, Math.min(85, y2lat(lat2y(mCenter.lat, mz) - dy, mz)));
  mapTransform();
  paintAqi();
});

function endPointer(e) {
  if (!pointers.has(e.pointerId)) return;
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch = null;
  if (pointers.size === 1) lastPt = [...pointers.values()][0];
  if (pointers.size === 0) { lastPt = null; settle(); }
}
mapEl.addEventListener("pointerup", endPointer);
mapEl.addEventListener("pointercancel", endPointer);

mapEl.addEventListener("wheel", (e) => {
  e.preventDefault();
  const r = mapEl.getBoundingClientRect();
  zoomAt(mz + (e.deltaY < 0 ? 1 : -1), e.clientX - r.left, e.clientY - r.top);
}, { passive: false });

// Zoom while keeping the geographic point under (px,py) pinned to that pixel.
function zoomAt(z, px, py) {
  const nz = Math.max(MINZ, Math.min(MAXZ, z));
  if (nz === mz) return;
  const W = mapEl.clientWidth, H = mapEl.clientHeight;
  const left = lon2x(mCenter.lon, mz) - W / 2, top = lat2y(mCenter.lat, mz) - H / 2;
  const gLon = x2lon(left + px, mz), gLat = y2lat(top + py, mz);
  mz = nz;
  mCenter.lon = x2lon(lon2x(gLon, nz) - px + W / 2, nz);
  mCenter.lat = Math.max(-85, Math.min(85, y2lat(lat2y(gLat, nz) - py + H / 2, nz)));
  settle();
}

$("#map-base").textContent = basemap().name;
$("#map-attr").textContent = basemap().attr + " · RainViewer";
$("#map-base").addEventListener("click", () => setBasemap(baseIdx + 1));

function setZoom(z) { zoomAt(z, mapEl.clientWidth / 2, mapEl.clientHeight / 2); }
$("#zoom-in").addEventListener("click", () => setZoom(mz + 1));
$("#zoom-out").addEventListener("click", () => setZoom(mz - 1));
$("#recenter").addEventListener("click", () => {
  mCenter = { lat: coords.lat, lon: coords.lon }; mz = 8;
  renderTiles(); paintAqi(); scheduleGrids(); renderLegend();
});

document.querySelectorAll(".ov-btn").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const k = btn.dataset.ov;
    overlays[k] = !overlays[k];
    btn.classList.toggle("is-on", overlays[k]);
    if (k === "rain") { if (overlays.rain && !radarPath) await loadRadar(); renderTiles(); }
    if (k === "wind") { if (overlays.wind && !windGrid) await loadWindGrid(); seedWind(); }
    if (k === "aqi") { if (overlays.aqi && !aqiGrid) await loadAqiGrid(); paintAqi(); }
    renderLegend();
  });
});

// ============================================================================
//  Animation loop
// ============================================================================
function frame(t) {
  drawBg(t);
  drawWind();
  requestAnimationFrame(frame);
}

// ============================================================================
//  Boot
// ============================================================================
async function boot() {
  sizeBg();
  requestAnimationFrame(frame);

  coords = await resolveCoords();
  mCenter = { lat: coords.lat, lon: coords.lon };
  $("#place-name").textContent = coords.label || "Your location";
  $("#place-sub").textContent = coords.lat.toFixed(3) + "°, " + coords.lon.toFixed(3) + "°";
  if (!coords.label) {
    placeName(coords.lat, coords.lon).then((n) => { if (n) $("#place-name").textContent = n; });
  }

  await loadAll();
  await loadRadar();
  sizeFx();
  renderTiles();
  renderLegend();
  setInterval(loadAll, 10 * 60 * 1000);   // conditions every 10 min
  setInterval(() => { loadRadar().then(renderTiles); }, 5 * 60 * 1000); // radar every 5 min
}

window.addEventListener("resize", () => { sizeBg(); sizeFx(); renderTiles(); paintAqi(); });
$("#refresh").addEventListener("click", () => { loadAll(); loadRadar().then(renderTiles); });

boot();
