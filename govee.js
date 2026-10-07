// ============================================================================
//  Govee lights, for Jarvis.
//
//  Govee Desktop has no API another program can use. Checked on this PC
//  (v2.40.60): it listens on no TCP port and opens no named pipe; its
//  GoveeAPI folder is a client library for its own plumbing. What it does use
//  is Govee's documented LAN API, and that is open to anyone on the network:
//
//    scan        {"msg":{"cmd":"scan","data":{"account_topic":"reserve"}}}
//                to multicast 239.255.255.250:4001; devices answer to port 4002
//    turn        {"msg":{"cmd":"turn","data":{"value":1}}}         to <ip>:4003
//    brightness  {"msg":{"cmd":"brightness","data":{"value":1-100}}}
//    colorwc     {"msg":{"cmd":"colorwc","data":{"color":{"r","g","b"},"colorTemInKelvin":0}}}
//    devStatus   {"msg":{"cmd":"devStatus","data":{}}}             answer on 4002
//
//  It needs "LAN Control" on for the device in the Govee Home app (it is, for
//  the H619E strip here). Device names come from Govee Desktop's own list.
//
//  Govee Desktop holds 0.0.0.0:4002 for itself — a wildcard bind fails with
//  EACCES (measured). Binding the LAN interface's own address on 4002 works,
//  and Windows hands a datagram to the most specific bind, so answers reach
//  this socket while it is open; it is opened only for a scan or a status
//  check. When nothing answers, the strip's Wi-Fi MAC (also from Govee
//  Desktop's list) is looked up in the ARP table instead.
//
//  The LAN API has no scenes. With a Govee Developer API key (Govee Home app
//  > Profile > Settings > Apply for API Key) the cloud API adds them, and is
//  the fallback when the LAN cannot reach a device.
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
//  { id, sku, name, mac, lanOn, ip, seenAt, cloud }
let cache = null;
function loadCache() {
  if (cache) return cache;
  try { cache = JSON.parse(fs.readFileSync(cacheFile(), "utf8")); } catch (e) { cache = { devices: [] }; }
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
    f.seenAt = Date.now();
  }
  // Anything still without an address: its MAC in the ARP table (the scan
  // above makes the strip talk to this PC, which puts it there).
  if (found.some((f) => !f.ip && f.mac)) {
    const arp = await arpTable();
    for (const f of found) if (!f.ip && f.mac && arp.has(f.mac)) { f.ip = arp.get(f.mac); f.seenAt = Date.now(); f.viaArp = true; }
  }
  return merge(found);
}

async function lanStatus(ip) {
  const replies = await listen(1500, () => { sendTo(ip, { cmd: "devStatus", data: {} }); });
  const r = replies.find((x) => x.from === ip && x.msg && x.msg.cmd === "devStatus");
  return r ? r.msg.data : null;
}

// ---- cloud (optional) ----------------------------------------------------------
async function cloud(method, p, body) {
  const key = readKey();
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
    if (!r.ok || (j.code && j.code !== 200)) return { ok: false, error: (j.message || j.msg || "HTTP " + r.status) };
    return { ok: true, data: j };
  } catch (e) { return { ok: false, error: e.message }; }
  finally { clearTimeout(t); }
}
async function cloudDevices() {
  const r = await cloud("GET", "/user/devices");
  if (!r.ok) return [];
  return (r.data.data || []).map((d) => ({ id: d.device, sku: d.sku, name: d.deviceName, cloud: true }));
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
  if (!list.length || list.every((d) => !d.ip)) list = await scan();
  if (readKey() && list.some((d) => !d.ip)) merge(await cloudDevices());
  list = loadCache().devices;
  const n = String(name || "").trim().toLowerCase();
  if (!n || /^(all|every|everything|lights?|the lights)$/.test(n)) return list;
  return list.filter((d) => (d.name || "").toLowerCase().includes(n) || (d.sku || "").toLowerCase() === n);
}

// UDP has no receipt: "sent" says nothing about whether the strip heard it.
// So a device not heard from in the last few minutes has to prove it is there
// (answer a status ping, or turn up in a fresh scan) before anything is sent.
const FRESH_MS = 5 * 60 * 1000;
async function reachable(d) {
  if (!d.ip) return false;
  if (d.seenAt && Date.now() - d.seenAt < FRESH_MS) return true;
  if (await lanStatus(d.ip)) { d.seenAt = Date.now(); saveCache(); return true; }
  const again = (await scan()).find((x) => x.id === d.id);
  if (again && again.ip && again.seenAt && Date.now() - again.seenAt < 10000) { Object.assign(d, again); return true; }
  return false;
}

async function act(d, action, a) {
  const lanOk = action === "scene" ? false : await reachable(d);
  const viaLan = async (msg) => (lanOk ? sendTo(d.ip, msg) : false);
  switch (action) {
    case "on":
    case "off": {
      const v = action === "on" ? 1 : 0;
      if (await viaLan({ cmd: "turn", data: { value: v } })) return { ok: true, via: "lan" };
      const c = await cloudControl(d, "devices.capabilities.on_off", "powerSwitch", v);
      return c.ok ? { ok: true, via: "cloud" } : { ok: false, error: unreachable(d, c) };
    }
    case "brightness": {
      const v = Math.max(1, Math.min(100, Math.round(Number(a.level) || 50)));
      if (await viaLan({ cmd: "brightness", data: { value: v } })) return { ok: true, via: "lan", level: v };
      const c = await cloudControl(d, "devices.capabilities.range", "brightness", v);
      return c.ok ? { ok: true, via: "cloud", level: v } : { ok: false, error: unreachable(d, c) };
    }
    case "color":
    case "white": {
      const col = action === "white" ? { kelvin: Math.max(2000, Math.min(9000, Number(a.kelvin) || 4000)) } : parseColor(a.color);
      if (!col) return { ok: false, error: "I don't know the colour " + a.color };
      const data = col.kelvin
        ? { color: { r: 255, g: 255, b: 255 }, colorTemInKelvin: col.kelvin }
        : { color: { r: col.rgb[0], g: col.rgb[1], b: col.rgb[2] }, colorTemInKelvin: 0 };
      if (await viaLan({ cmd: "colorwc", data })) return { ok: true, via: "lan", ...col };
      const c = col.kelvin
        ? await cloudControl(d, "devices.capabilities.color_setting", "colorTemperatureK", col.kelvin)
        : await cloudControl(d, "devices.capabilities.color_setting", "colorRgb", (col.rgb[0] << 16) + (col.rgb[1] << 8) + col.rgb[2]);
      return c.ok ? { ok: true, via: "cloud", ...col } : { ok: false, error: unreachable(d, c) };
    }
    case "scene": {
      if (!readKey()) return { ok: false, error: "Scenes need a Govee API key (Jarvis settings > Lights). The LAN API has none." };
      return cloudScene(d, a.scene);
    }
    case "status": {
      if (lanOk) { const s = await lanStatus(d.ip); if (s) return { ok: true, via: "lan", ...s }; }
      const c = await cloud("POST", "/device/state", { requestId: crypto.randomUUID(), payload: { sku: d.sku, device: d.id } });
      if (c.ok) return { ok: true, via: "cloud", state: c.data.payload };
      return { ok: false, error: unreachable(d, c) };
    }
    default: return { ok: false, error: "unknown action " + action };
  }
}

function unreachable(d, c) {
  return (d.name || d.sku) + " isn't on the network (is it plugged in?)" + (readKey() ? " and the cloud said: " + (c && c.error) : "");
}

// One call for Jarvis: { action, device, level, color, kelvin, scene }.
async function control(a) {
  const action = String(a.action || "").toLowerCase();
  if (action === "scan" || action === "list") {
    const list = await scan();
    if (readKey()) merge(await cloudDevices());
    return { ok: true, devices: loadCache().devices.map(publicDevice) };
  }
  const list = await targets(a.device);
  if (!list.length) return { ok: false, error: a.device ? "no Govee light called " + a.device : "no Govee lights found" };
  const results = [];
  for (const d of list) results.push({ device: d.name || d.sku, ...(await act(d, action, a)) });
  return { ok: results.some((r) => r.ok), results };
}

function publicDevice(d) {
  return { name: d.name, sku: d.sku, ip: d.ip || null, lanOn: d.lanOn, seen: d.seenAt || null, cloud: !!d.cloud };
}
function status() {
  const list = loadCache().devices.length ? loadCache().devices : desktopDevices();
  return { hasKey: !!readKey(), desktop: desktopDevices().length > 0, devices: list.map(publicDevice) };
}

module.exports = { init, control, scan, status, writeKey, parseColor, STATE_FILES: ["govee-key.txt", "govee.json"] };
