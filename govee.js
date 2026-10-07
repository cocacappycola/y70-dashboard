// ============================================================================
//  Govee lights, for Jarvis.
//
//  Two ways to reach a light:
//
//  1. Govee's LAN API, straight to the light, for lights with "LAN Control":
//
//    scan        {"msg":{"cmd":"scan","data":{"account_topic":"reserve"}}}
//                to multicast 239.255.255.250:4001; devices answer to port 4002
//    turn        {"msg":{"cmd":"turn","data":{"value":1}}}         to <ip>:4003
//    brightness  {"msg":{"cmd":"brightness","data":{"value":1-100}}}
//    colorwc     {"msg":{"cmd":"colorwc","data":{"color":{"r","g","b"},"colorTemInKelvin":0}}}
//    devStatus   {"msg":{"cmd":"devStatus","data":{}}}             answer on 4002
//
//  2. Govee's cloud API (openapi.api.govee.com), with a Govee API key from the
//     Govee Home app (Profile > Settings > Apply for API Key). This is the only
//     way to reach a Wi-Fi-only light, and the only way to set scenes. Unlike
//     UDP it says whether the command landed.
//
//  Govee Desktop (v2.40.60) does have an API for other programs — GoveeAPI.dll,
//  JSON over \\.\pipe\GoveeDesktopPipe after a GUID from its Settings > API —
//  but measured, it adds nothing here: the DLL gets the device list from Govee
//  Desktop and then sends the very LAN packets above, refusing (102) any light
//  that isn't on LAN. (Careful with that pipe: a message with
//  "ExecutionRGB":null crashes Govee Desktop.) What Jarvis does take from it
//  is its device list file: names, SKUs and the Wi-Fi MAC.
//
//  Govee Desktop may hold 0.0.0.0:4002 for itself — a wildcard bind then fails
//  with EACCES (measured). Binding the LAN interface's own address on 4002
//  works, and Windows hands a datagram to the most specific bind. When nothing
//  answers a scan, the light's Wi-Fi MAC is looked up in the ARP table — which
//  gives its address but proves nothing about LAN control, so only an answer
//  from the light itself counts as "LAN works".
// ============================================================================
const dgram = require("dgram");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execFile } = require("child_process");

const CLOUD = "https://openapi.api.govee.com/router/api/v1";
let DATA = __dirname;

function init(dataDir) { DATA = dataDir || __dirname; }
const keyFile = () => path.join(DATA, "govee-key.txt");
const cacheFile = () => path.join(DATA, "govee.json");

function readKey() {
  try { const k = fs.readFileSync(keyFile(), "utf8").trim(); return k || null; } catch (e) { return null; }
}
function writeKey(k) {
  if (!k) { try { fs.unlinkSync(keyFile()); } catch (e) {} return; }
  fs.writeFileSync(keyFile(), k + "\n", "utf8");
}

// ---- what we know about each device -----------------------------------------
//  { id, sku, name, mac, lanOn, ip, lanAt, noLanAt, cloud }
//  lanAt   = the light last answered over LAN
//  noLanAt = the light was asked over LAN and said nothing
let cache = null;
function loadCache() {
  if (cache) return cache;
  try { cache = JSON.parse(fs.readFileSync(cacheFile(), "utf8")); } catch (e) { cache = { devices: [] }; }
  // seenAt used to be set by an ARP hit too, which proved nothing.
  for (const d of cache.devices) { delete d.seenAt; delete d.viaArp; }
  return cache;
}
function saveCache() { try { fs.writeFileSync(cacheFile(), JSON.stringify(cache, null, 2)); } catch (e) {} }

// Govee Desktop's own device list: names, SKUs, the Wi-Fi MAC.
function desktopDevices() {
  const file = path.join(process.env.LOCALAPPDATA || "", "GoveeDesktop", "config", "device_info.ini");
  let text = "";
  try { text = fs.readFileSync(file, "utf8"); } catch (e) { return []; }
  const line = text.split(/\r?\n/).find((l) => l.startsWith("Device="));
  if (!line) return [];
  try {
    return JSON.parse(line.slice(7)).map((d) => ({
      id: d.DeviceId, sku: d.SkuId, name: d.Name, mac: (d.WifiMacId || "").toUpperCase(), lanOn: !!d.IsLanOn,
    }));
  } catch (e) { return []; }
}

function merge(found) {
  const c = loadCache();
  for (const f of found) {
    let d = c.devices.find((x) => x.id === f.id);
    if (!d) { d = { id: f.id }; c.devices.push(d); }
    for (const [k, v] of Object.entries(f)) if (v != null && v !== "") d[k] = v;
  }
  saveCache();
  return c.devices;
}

function lanAddress() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === "IPv4" && !a.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)) return a.address;
    }
  }
  return null;
}

// ---- LAN ---------------------------------------------------------------------
const FRESH_MS = 5 * 60 * 1000;     // a LAN answer this recent: just send
const NO_LAN_MS = 30 * 60 * 1000;   // a LAN silence this recent: don't wait on LAN again

function sendTo(ip, msg) {
  return new Promise((resolve) => {
    const s = dgram.createSocket("udp4");
    const buf = Buffer.from(JSON.stringify({ msg }));
    s.send(buf, 4003, ip, (err) => { try { s.close(); } catch (e) {} resolve(!err); });
  });
}

// Opens the answer port on the LAN address for a moment and collects what
// comes back.
function listen(ms, onOpen) {
  return new Promise((resolve) => {
    const addr = lanAddress();
    const got = [];
    if (!addr) return resolve(got);
    const s = dgram.createSocket({ type: "udp4", reuseAddr: true });
    s.on("message", (buf, r) => {
      try { got.push({ from: r.address, msg: JSON.parse(buf.toString()).msg }); } catch (e) {}
    });
    s.on("error", () => { try { s.close(); } catch (e) {} resolve(got); });
    s.bind(4002, addr, () => {
      try { s.setMulticastInterface(addr); } catch (e) {}
      onOpen(s);
      setTimeout(() => { try { s.close(); } catch (e) {} resolve(got); }, ms);
    });
  });
}

function arpTable() {
  return new Promise((resolve) => {
    execFile("arp", ["-a"], { windowsHide: true, timeout: 5000 }, (err, out) => {
      const map = new Map();
      for (const m of String(out || "").matchAll(/(\d+\.\d+\.\d+\.\d+)\s+([0-9a-f]{2}(?:-[0-9a-f]{2}){5})/gi)) {
        map.set(m[2].toUpperCase().replace(/-/g, ":"), m[1]);
      }
      resolve(map);
    });
  });
}

async function scan() {
  const replies = await listen(2500, (s) => {
    const scanMsg = Buffer.from(JSON.stringify({ msg: { cmd: "scan", data: { account_topic: "reserve" } } }));
    s.send(scanMsg, 4001, "239.255.255.250");
    setTimeout(() => { try { s.send(scanMsg, 4001, "239.255.255.250"); } catch (e) {} }, 800);
  });
  const found = desktopDevices().map((d) => ({ ...d }));
  for (const r of replies) {
    const d = r.msg && r.msg.data;
    if (!r.msg || r.msg.cmd !== "scan" || !d) continue;
    let f = found.find((x) => x.id === d.device);
    if (!f) { f = { id: d.device, sku: d.sku, name: d.sku }; found.push(f); }
    f.ip = d.ip || r.from;
    f.lanAt = Date.now();
  }
  // Anything still without an address: its MAC in the ARP table (the scan
  // above makes the light talk to this PC, which puts it there). That is an
  // address only — whether it speaks LAN is for lanStatus to find out.
  if (found.some((f) => !f.ip && f.mac)) {
    const arp = await arpTable();
    for (const f of found) if (!f.ip && f.mac && arp.has(f.mac)) f.ip = arp.get(f.mac);
  }
  return merge(found);
}

async function lanStatus(ip) {
  const replies = await listen(1500, () => { sendTo(ip, { cmd: "devStatus", data: {} }); });
  const r = replies.find((x) => x.from === ip && x.msg && x.msg.cmd === "devStatus");
  return r ? r.msg.data : null;
}

const lanFresh = (d) => !!(d.ip && d.lanAt && Date.now() - d.lanAt < FRESH_MS);
const lanSilent = (d) => !!(d.noLanAt && Date.now() - d.noLanAt < NO_LAN_MS && !lanFresh(d));

// Asks the light itself for its state. Records the answer either way and
// returns the state, or null.
async function probeLan(d) {
  if (!d.ip) {
    const again = (await scan()).find((x) => x.id === d.id);
    if (again) Object.assign(d, again);
  }
  const s = d.ip ? await lanStatus(d.ip) : null;
  if (s) { d.lanAt = Date.now(); delete d.noLanAt; } else d.noLanAt = Date.now();
  saveCache();
  return s;
}

// ---- cloud ---------------------------------------------------------------------
async function cloud(method, p, body, key) {
  key = key || readKey();
  if (!key) return { ok: false, error: "no Govee API key" };
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 10000);
  try {
    const r = await fetch(CLOUD + p, {
      method, signal: ctl.signal,
      headers: { "Govee-API-Key": key, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    if (r.status === 429) return { ok: false, error: "Govee's cloud says too many requests; try again in a minute", status: 429 };
    if (!r.ok || (j.code && j.code !== 200)) return { ok: false, error: (j.message || j.msg || "HTTP " + r.status), status: r.status };
    return { ok: true, data: j };
  } catch (e) { return { ok: false, error: e.name === "AbortError" ? "Govee's cloud didn't answer" : e.message }; }
  finally { clearTimeout(t); }
}

let cloudListAt = 0;
async function cloudDevices(key) {
  const r = await cloud("GET", "/user/devices", null, key);
  if (!r.ok) return r;
  cloudListAt = Date.now();
  const devices = (r.data.data || []).map((d) => ({ id: d.device, sku: d.sku, name: d.deviceName, cloud: true }));
  return { ok: true, devices };
}
async function refreshCloud(force) {
  if (!readKey() || (!force && Date.now() - cloudListAt < 10 * 60 * 1000)) return;
  const r = await cloudDevices();
  if (r.ok) merge(r.devices);
}
function cloudControl(d, type, instance, value) {
  return cloud("POST", "/device/control", {
    requestId: crypto.randomUUID(),
    payload: { sku: d.sku, device: d.id, capability: { type, instance, value } },
  });
}
async function cloudScene(d, name) {
  const r = await cloud("POST", "/device/scenes", { requestId: crypto.randomUUID(), payload: { sku: d.sku, device: d.id } });
  if (!r.ok) return r;
  const caps = (r.data.payload && r.data.payload.capabilities) || [];
  const opts = caps.flatMap((c) => ((c.parameters && c.parameters.options) || []).map((o) => ({ ...o, type: c.type, instance: c.instance })));
  if (!name) return { ok: true, scenes: opts.map((o) => o.name) };
  const want = String(name).toLowerCase();
  const hit = opts.find((o) => o.name.toLowerCase() === want) || opts.find((o) => o.name.toLowerCase().includes(want));
  if (!hit) return { ok: false, error: "no scene called " + name, scenes: opts.map((o) => o.name).slice(0, 40) };
  const c = await cloudControl(d, hit.type, hit.instance, hit.value);
  return c.ok ? { ok: true, scene: hit.name } : c;
}

// Saving a key checks it with Govee first, and learns the cloud's device list.
async function saveKey(k) {
  const r = await cloudDevices(k);
  // A wrong key gets a bare 401 with an empty body (measured).
  if (!r.ok) return { ok: false, error: r.status === 401 || r.status === 403 ? "Govee didn't accept that key. Check it was copied whole from Govee's email." : "Couldn't check the key with Govee: " + r.error };
  writeKey(k);
  merge(r.devices);
  return { ok: true, count: r.devices.length };
}

// ---- colours -----------------------------------------------------------------
const NAMED = {
  red: [255, 0, 0], crimson: [220, 20, 60], orange: [255, 100, 0], amber: [255, 150, 0], gold: [255, 180, 0],
  yellow: [255, 220, 0], lime: [150, 255, 0], green: [0, 255, 0], teal: [0, 180, 150], cyan: [0, 255, 255],
  aqua: [0, 255, 220], blue: [0, 40, 255], navy: [0, 0, 140], indigo: [80, 0, 255], violet: [170, 60, 255],
  purple: [168, 92, 214], magenta: [255, 0, 255], pink: [255, 70, 170], "hot pink": [255, 20, 147],
  white: [255, 255, 255],
};
const WHITES = { "warm white": 2700, "soft white": 3000, "neutral white": 4000, "cool white": 6500, daylight: 5600, "candle": 2000 };

function parseColor(s) {
  const t = String(s || "").trim().toLowerCase();
  if (!t) return null;
  if (WHITES[t]) return { kelvin: WHITES[t] };
  if (NAMED[t]) return { rgb: NAMED[t] };
  const hex = t.match(/^#?([0-9a-f]{6})$/);
  if (hex) return { rgb: [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)) };
  const rgb = t.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/);
  if (rgb) return { rgb: [rgb[1], rgb[2], rgb[3]].map((n) => Math.max(0, Math.min(255, Number(n)))) };
  const k = t.match(/^(\d{4})\s*k?$/);
  if (k) return { kelvin: Number(k[1]) };
  // "dark blue", "light purple": the colour word, darker or lighter.
  for (const [name, v] of Object.entries(NAMED)) {
    if (t.endsWith(name)) {
      const f = /dark|deep/.test(t) ? 0.55 : /light|pale|pastel/.test(t) ? 1 : 1;
      const mix = /light|pale|pastel/.test(t) ? 0.45 : 0;
      return { rgb: v.map((c) => Math.round(Math.min(255, c * f + (255 - c * f) * mix))) };
    }
  }
  return null;
}

// ---- doing things ----------------------------------------------------------------
async function targets(name) {
  let list = loadCache().devices;
  if (!list.length || (!readKey() && list.every((d) => !d.ip))) list = await scan();
  if (readKey() && list.some((d) => !d.cloud)) await refreshCloud();
  list = loadCache().devices;
  const n = String(name || "").trim().toLowerCase();
  if (!n || /^(all|every|everything|lights?|the lights)$/.test(n)) return list;
  return list.filter((d) => (d.name || "").toLowerCase().includes(n) || (d.sku || "").toLowerCase() === n);
}

// The command in both dialects.
function commands(d, action, a) {
  switch (action) {
    case "on":
    case "off": {
      const v = action === "on" ? 1 : 0;
      return { lan: { cmd: "turn", data: { value: v } }, cloud: ["devices.capabilities.on_off", "powerSwitch", v] };
    }
    case "brightness": {
      const v = Math.max(1, Math.min(100, Math.round(Number(a.level) || 50)));
      return { lan: { cmd: "brightness", data: { value: v } }, cloud: ["devices.capabilities.range", "brightness", v], extra: { level: v } };
    }
    case "color":
    case "white": {
      const col = action === "white" ? { kelvin: Math.max(2000, Math.min(9000, Number(a.kelvin) || 4000)) } : parseColor(a.color);
      if (!col) return { error: "I don't know the colour " + a.color };
      const data = col.kelvin
        ? { color: { r: 255, g: 255, b: 255 }, colorTemInKelvin: col.kelvin }
        : { color: { r: col.rgb[0], g: col.rgb[1], b: col.rgb[2] }, colorTemInKelvin: 0 };
      const cl = col.kelvin
        ? ["devices.capabilities.color_setting", "colorTemperatureK", col.kelvin]
        : ["devices.capabilities.color_setting", "colorRgb", (col.rgb[0] << 16) + (col.rgb[1] << 8) + col.rgb[2]];
      return { lan: { cmd: "colorwc", data }, cloud: cl, extra: col };
    }
    default: return null;
  }
}

// LAN when the light has answered on LAN lately (instant); otherwise the cloud
// when there is a key (it confirms); otherwise ask the light over LAN — once,
// then remember the silence so the next command doesn't wait on it again.
async function act(d, action, a) {
  if (action === "scene") {
    if (!readKey()) return { ok: false, error: "Scenes need a Govee API key (Jarvis settings > Lights)." };
    return cloudScene(d, a.scene);
  }
  if (action === "status") {
    const s = lanFresh(d) ? await lanStatus(d.ip) : !lanSilent(d) && !readKey() ? await probeLan(d) : null;
    if (s) return { ok: true, via: "lan", ...s };
    if (!readKey()) return { ok: false, error: unreachable(d) };
    const c = await cloud("POST", "/device/state", { requestId: crypto.randomUUID(), payload: { sku: d.sku, device: d.id } });
    if (c.ok) return { ok: true, via: "cloud", state: c.data.payload };
    return { ok: false, error: unreachable(d, c) };
  }
  const cmd = commands(d, action, a);
  if (!cmd) return { ok: false, error: "unknown action " + action };
  if (cmd.error) return { ok: false, error: cmd.error };

  if (lanFresh(d) && await sendTo(d.ip, cmd.lan)) return { ok: true, via: "lan", ...cmd.extra };
  if (readKey()) {
    const c = await cloudControl(d, ...cmd.cloud);
    if (c.ok) {
      // Learn, without making anyone wait, whether LAN would have done.
      if (d.ip && !lanSilent(d)) probeLan(d).catch(() => {});
      return { ok: true, via: "cloud", ...cmd.extra };
    }
    if (!lanSilent(d) && await probeLan(d) && await sendTo(d.ip, cmd.lan)) return { ok: true, via: "lan", ...cmd.extra };
    return { ok: false, error: unreachable(d, c) };
  }
  if (!lanSilent(d) && await probeLan(d) && await sendTo(d.ip, cmd.lan)) return { ok: true, via: "lan", ...cmd.extra };
  return { ok: false, error: unreachable(d) };
}

function unreachable(d, c) {
  const nm = d.name || d.sku;
  if (readKey()) return "Govee's cloud couldn't reach " + nm + ": " + ((c && c.error) || "no answer");
  if (d.ip) {
    return nm + " is on Wi-Fi (" + d.ip + ") but doesn't answer Govee's LAN control, so Jarvis has to go through Govee's cloud — that needs a Govee API key "
      + "(Govee Home app › Profile › Settings › Apply for API Key; it's emailed), pasted into Jarvis settings › Lights.";
  }
  return nm + " didn't answer on the network, and without a Govee API key Jarvis can't try Govee's cloud.";
}

// One call for Jarvis: { action, device, level, color, kelvin, scene }.
async function control(a) {
  const action = String(a.action || "").toLowerCase();
  if (action === "scan" || action === "list") {
    const list = await scan();
    await refreshCloud(true);
    // Lights with an address but no LAN answer yet: ask them now.
    await Promise.all(list.filter((d) => d.ip && !lanFresh(d)).map((d) => probeLan(d)));
    return { ok: true, devices: loadCache().devices.map(publicDevice) };
  }
  const list = await targets(a.device);
  if (!list.length) return { ok: false, error: a.device ? "no Govee light called " + a.device : "no Govee lights found" };
  const results = await Promise.all(list.map(async (d) => ({ device: d.name || d.sku, ...(await act(d, action, a)) })));
  return { ok: results.some((r) => r.ok), results };
}

function publicDevice(d) {
  const lan = lanFresh(d) ? "yes" : d.noLanAt ? "no" : "unknown";
  return { name: d.name, sku: d.sku, ip: d.ip || null, lanOn: d.lanOn, lan, cloud: !!d.cloud };
}
function status() {
  const list = loadCache().devices.length ? loadCache().devices : desktopDevices();
  return { hasKey: !!readKey(), desktop: desktopDevices().length > 0, devices: list.map(publicDevice) };
}

module.exports = { init, control, scan, status, writeKey, saveKey, parseColor, STATE_FILES: ["govee-key.txt", "govee.json"] };
