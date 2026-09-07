// ============================================================================
//  Spotify · Y70 — front-end logic
//  OAuth PKCE (public client) + Web Playback SDK + Web API.
// ============================================================================

const CFG = window.SPOTIFY_CONFIG || {};
const SCOPES = [
  "streaming",
  "user-read-email",
  "user-read-private",
  "user-read-playback-state",
  "user-modify-playback-state",
  "user-read-currently-playing",
  "playlist-read-private",
  "playlist-read-collaborative",
  "user-library-read",
  "user-library-modify",
].join(" ");

const AUTH_URL = "https://accounts.spotify.com/authorize";
const TOKEN_URL = "https://accounts.spotify.com/api/token";
const API = "https://api.spotify.com/v1";

// ---- icons (Material Design paths, styled like Spotify's glyphs) -----------
const P = {
  play: "M8 5v14l11-7z",
  pause: "M6 19h4V5H6v14zm8-14v14h4V5h-4z",
  prev: "M6 6h2v12H6zm3.5 6l8.5 6V6z",
  next: "M6 18l8.5-6L6 6v12zm10-12v12h2V6h-2z",
  shuffle: "M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z",
  repeat: "M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z",
  heartO: "M16.5 3c-1.74 0-3.41.81-4.5 2.09C10.91 3.81 9.24 3 7.5 3 4.42 3 2 5.42 2 8.5c0 3.78 3.4 6.86 8.55 11.54L12 21.35l1.45-1.32C18.6 15.36 22 12.28 22 8.5 22 5.42 19.58 3 16.5 3zm-4.4 15.55l-.1.1-.1-.1C7.14 14.24 4 11.39 4 8.5 4 6.5 5.5 5 7.5 5c1.54 0 3.04.99 3.57 2.36h1.87C13.46 5.99 14.96 5 16.5 5c2 0 3.5 1.5 3.5 3.5 0 2.89-3.14 5.74-7.9 10.05z",
  heartF: "M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z",
  queue: "M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z",
  devices: "M4 6h18V4H4c-1.1 0-2 .9-2 2v11H0v3h14v-3H4V6zm19 2h-6c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h6c.55 0 1-.45 1-1V9c0-.55-.45-1-1-1zm-1 9h-4v-7h4v7z",
  volume: "M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z",
  search: "M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z",
  plus: "M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z",
  close: "M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z",
  check: "M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z",
  // Three stacked bars — the drag grip.
  grip: "M3 6h18v2H3V6zm0 5h18v2H3v-2zm0 5h18v2H3v-2z",
  back: "M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z",
};
function icon(name, size = 22) {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor" aria-hidden="true"><path d="${P[name]}"/></svg>`;
}

// ---- tiny helpers ----------------------------------------------------------
const $ = (sel) => document.querySelector(sel);
const show = (id) => {
  document.querySelectorAll(".screen").forEach((s) => s.classList.add("hidden"));
  $("#" + id).classList.remove("hidden");
};
function fmtTime(ms) {
  if (!ms && ms !== 0) return "0:00";
  const s = Math.floor(ms / 1000);
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
}
let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  requestAnimationFrame(() => t.classList.add("show"));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    t.classList.remove("show");
    setTimeout(() => t.classList.add("hidden"), 250);
  }, 1800);
}

// ---- PKCE ------------------------------------------------------------------
function randString(len) {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  return Array.from(arr, (b) => chars[b % chars.length]).join("");
}
async function sha256(str) {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
}
function base64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function beginLogin() {
  const verifier = randString(64);
  localStorage.setItem("pkce_verifier", verifier);
  const challenge = base64url(await sha256(verifier));
  const state = randString(16);
  localStorage.setItem("auth_state", state);
  const params = new URLSearchParams({
    client_id: CFG.CLIENT_ID,
    response_type: "code",
    redirect_uri: CFG.REDIRECT_URI,
    code_challenge_method: "S256",
    code_challenge: challenge,
    scope: SCOPES,
    state,
  });
  // Spotify's login page refuses to render inside an iframe — when embedded in
  // the shell, navigate the top-level window instead (same origin).
  const nav = window.top && window.top !== window.self ? window.top : window;
  nav.location = AUTH_URL + "?" + params.toString();
}

async function exchangeCode(code) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: CFG.REDIRECT_URI,
    client_id: CFG.CLIENT_ID,
    code_verifier: localStorage.getItem("pkce_verifier"),
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error("Token exchange failed: " + (await res.text()));
  storeTokens(await res.json());
  localStorage.setItem("scopes_granted", SCOPES);
}

async function refreshToken() {
  const rt = localStorage.getItem("refresh_token");
  if (!rt) throw new Error("No refresh token");
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: rt,
    client_id: CFG.CLIENT_ID,
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error("Refresh failed");
  storeTokens(await res.json());
}

function storeTokens(data) {
  localStorage.setItem("access_token", data.access_token);
  if (data.refresh_token) localStorage.setItem("refresh_token", data.refresh_token);
  localStorage.setItem("token_expiry", String(Date.now() + (data.expires_in - 60) * 1000));
}

async function getToken() {
  const tok = localStorage.getItem("access_token");
  const expiry = Number(localStorage.getItem("token_expiry") || 0);
  if (tok && Date.now() < expiry) return tok;
  await refreshToken();
  return localStorage.getItem("access_token");
}

// ---- Web API wrapper -------------------------------------------------------
async function api(path, opts = {}) {
  const token = await getToken();
  const res = await fetch(path.startsWith("http") ? path : API + path, {
    ...opts,
    headers: { Authorization: "Bearer " + token, ...(opts.headers || {}) },
  });
  if (res.status === 401) {
    await refreshToken();
    return api(path, opts); // retry once
  }
  if (res.status === 204) return null;
  if (!res.ok) throw new Error("API " + res.status + ": " + (await res.text()));
  const ct = res.headers.get("content-type") || "";
  return ct.includes("application/json") ? res.json() : null;
}

// ---- State -----------------------------------------------------------------
let player = null;
let deviceId = null;
// Spotify Connect state. This app registers itself as a device but deliberately
// does NOT take playback: whatever is already playing (usually the desktop app)
// stays in charge, and this screen acts as a remote for it.
let activeDeviceId = null;
let activeDeviceName = "";
let activeIsHere = false;
// Remembered so that pressing play after Spotify has gone idle resumes on the
// device you were last using, instead of silently starting music on this panel.
let lastDeviceId = null;
try { lastDeviceId = localStorage.getItem("y70_last_device") || null; } catch (e) {}
let meId = null;
let isPlaying = false;
let currentDuration = 0;
let currentPosition = 0;
let positionTickAt = 0;
let currentTrackId = null;
let currentTrackUri = null;
let currentTrackLiked = false;
let likedRefId = null; // the id Liked Songs actually contains (handles relinked tracks)
let currentTrackIds = [];
// Spotify blocks /me/tracks/contains for this app but allows listing /me/tracks,
// so liked status comes from a locally built index of the user's Liked Songs.
const likedIds = new Set();
let likedIdsReady = false;
let shuffleOn = false;
let repeatMode = 0; // 0 off, 1 context, 2 track
let seekDragging = false;
let likedTracks = []; // cache for the Liked Songs view

// Spotify's Web API cannot reorder, remove from, or clear the playback queue —
// `POST /me/player/queue` only appends. So the app keeps its own ordered "up
// next" list and pushes it to Spotify with `PUT /me/player/play {uris:[…]}`,
// which *is* order-aware. That is the only way drag-to-reorder can work.
let localQueue = [];
let applyTimer = null;

// Playing a playlist is the only way to see inside it (track listing is 403'd),
// so the queue Spotify reports right after a context starts is a reconstruction
// of that playlist. Snapshot it — once we push a custom order the context is
// replaced and that reconstruction is gone for good.
let sourceList = { context: null, name: "", tracks: [] };
let harvesting = false;     // true only while the context is still Spotify's
let dragActive = false;     // don't re-render the list out from under a drag
let autoFill = false;       // mirror the captured playlist until the user edits
// Rewriting the context is what makes playback stutter, so edits only mark the
// queue dirty; the rewrite is deferred to the next track change, where a replay
// from position 0 is inaudible. Reorders sync sooner because you expect to hear
// them take effect.
let queueDirty = false;
let qidSeq = 0;
const withQid = (t) => ({ ...t, qid: "q" + (++qidSeq) });

function saveQueues() {
  try {
    localStorage.setItem("y70_queue", JSON.stringify({ localQueue, sourceList }));
  } catch (e) { /* storage full or unavailable */ }
}
function loadQueues() {
  try {
    const d = JSON.parse(localStorage.getItem("y70_queue") || "null");
    if (d) {
      localQueue = (Array.isArray(d.localQueue) ? d.localQueue : [])
        .map((t) => (t.qid ? t : withQid(t)));   // backfill ids saved before qids existed
      sourceList = d.sourceList && d.sourceList.tracks ? d.sourceList : sourceList;
    }
  } catch (e) { /* ignore malformed */ }
}

// Fold whatever Spotify currently reports into the snapshot, keeping order and
// never dropping anything already captured.
function mergeSource(queue, current) {
  const seen = new Set(sourceList.tracks.map((t) => t.uri));
  const add = (t) => {
    if (!t || !t.uri || seen.has(t.uri)) return false;
    seen.add(t.uri);
    sourceList.tracks.push({
      uri: t.uri, name: t.name, artists: t.artists || [],
      duration_ms: t.duration_ms || 0, album: t.album || {},
    });
    return true;
  };
  let grew = current ? add(current) : false;
  for (const t of queue || []) grew = add(t) || grew;
  if (grew) saveQueues();
  return grew;
}

// Every player command goes to whatever device is actually playing, then to
// the one you last used, and only as a last resort to this web player. Pinning
// them to `deviceId` (the old behaviour) is what made the buttons here do
// nothing while the desktop app held playback.
const targetDevice = () => activeDeviceId || lastDeviceId || deviceId;
const playingHere = () => !!deviceId && activeDeviceId === deviceId;
const devAmp = () => { const d = targetDevice(); return d ? "&device_id=" + d : ""; };

// Send a player command to the target device, retrying on this web player if
// that device has gone away (a remembered device that is now offline answers
// 404 "Device not found"). Without the retry, closing the desktop app would
// leave every button dead until you opened the device picker.
async function playerCmd(path, opts) {
  const d = targetDevice();
  const sep = path.includes("?") ? "&" : "?";
  try {
    return await api(path + (d ? sep + "device_id=" + d : ""), opts);
  } catch (e) {
    const gone = /\b(404|403)\b/.test(String(e && e.message));
    if (!gone || !deviceId || d === deviceId) throw e;
    activeDeviceId = null;
    setLastDevice(null);
    return api(path + sep + "device_id=" + deviceId, opts);
  }
}

function setLastDevice(id) {
  lastDeviceId = id;
  try {
    if (id) localStorage.setItem("y70_last_device", id);
    else localStorage.removeItem("y70_last_device");
  } catch (e) { /* private mode */ }
}

// ============================================================================
//  Web Playback SDK
// ============================================================================
window.onSpotifyWebPlaybackSDKReady = () => { window._sdkReady = true; };

async function initPlayer() {
  if (!window._sdkReady) {
    await new Promise((r) => {
      const iv = setInterval(() => { if (window._sdkReady) { clearInterval(iv); r(); } }, 100);
    });
  }

  player = new Spotify.Player({
    name: CFG.DEVICE_NAME || "HYTE Y70",
    getOAuthToken: (cb) => getToken().then(cb),
    volume: 0.5,
  });

  player.addListener("ready", async ({ device_id }) => {
    deviceId = device_id;
    // Deliberately NOT transferring playback here. Registering the device is
    // all that is needed for it to show up in Spotify Connect. The old code
    // sent `PUT /me/player {device_ids:[this], play:false}` on every load,
    // which yanked playback off the desktop app *and paused it* the moment you
    // opened this screen. Use the device picker to move playback here on purpose.
    await refreshRemoteState();
    refreshQueue();
  });

  player.addListener("not_ready", () => { deviceId = null; });

  player.addListener("player_state_changed", (state) => {
    // The SDK reports null whenever playback is not on this web player, so a
    // non-null state is proof that this device currently owns playback.
    if (!state) return;
    activeDeviceId = deviceId;
    activeDeviceName = CFG.DEVICE_NAME || "HYTE Y70";
    activeIsHere = true;
    setLastDevice(deviceId);
    renderDeviceLabel();
    const track = state.track_window.current_track;
    isPlaying = !state.paused;
    currentDuration = state.duration;
    currentPosition = state.position;
    positionTickAt = Date.now();
    shuffleOn = state.shuffle;
    repeatMode = state.repeat_mode;
    renderNowPlaying(track);
    renderPlayControls();
    updateMediaSession();
    broadcastState();
    refreshQueue();
  });

  player.addListener("initialization_error", ({ message }) => toast("Init error: " + message));
  player.addListener("authentication_error", ({ message }) => toast("Auth error: " + message));
  player.addListener("account_error", () => toast("Premium required for playback control"));

  const ok = await player.connect();
  if (!ok) toast("Could not start player");
}

// ============================================================================
//  Now-playing bar rendering
// ============================================================================
let npTrack = null;

function renderNowPlaying(track) {
  if (!track) return;
  const artistNames = (track.artists || []).map((a) => a.name).join(", ");
  npTrack = { name: track.name, artist: artistNames, art: track.album?.images?.[0]?.url || "" };
  const changed = track.uri && track.uri !== currentTrackUri;
  currentTrackUri = track.uri || currentTrackUri;
  // Drop anything the player has already advanced past.
  const qi = localQueue.findIndex((t) => t.uri === track.uri);
  if (qi >= 0) { localQueue.splice(0, qi + 1); saveQueues(); renderLocalQueue(); markSourceAdded(); }
  // A track boundary is the one moment a context rewrite is inaudible, so any
  // edits made during the last song get flushed here.
  if (changed && queueDirty) setTimeout(applyQueue, 250);
  $("#pb-title").textContent = track.name;
  $("#pb-artist").textContent = artistNames;

  // Tell the shell (and its widgets) what's playing.
  if (window.parent !== window) {
    try {
      window.parent.postMessage(
        { type: "y70:nowplaying", title: track.name, artist: artistNames }, "*");
    } catch (e) { /* not embedded */ }
  }
  updateMediaSession();
  broadcastState();
  const art = track.album?.images?.[0]?.url;
  if (art) $("#pb-art").src = art;
  $("#pb-duration").textContent = fmtTime(track.duration_ms || currentDuration);

  // Spotify "relinks" tracks across markets: the playing copy can have a
  // different id than the one saved in Liked Songs. Check both.
  const ids = [
    track.id || (track.uri || "").split(":").pop(),
    track.linked_from?.id || track.linked_from?.uri?.split(":").pop(),
  ].filter(Boolean);
  if (ids.length && ids[0] !== currentTrackId) {
    currentTrackId = ids[0];
    checkLiked(ids);
  }
}

function renderPlayControls() {
  $("#pb-play").innerHTML = icon(isPlaying ? "pause" : "play", 26);
  $("#pb-shuffle").classList.toggle("on", shuffleOn);
  const rep = $("#pb-repeat");
  rep.classList.toggle("on", repeatMode !== 0);
  rep.innerHTML = icon("repeat") + (repeatMode === 2 ? '<span class="rep-one">1</span>' : "");
}

function renderHeart() {
  const h = $("#pb-heart");
  h.innerHTML = icon(currentTrackLiked ? "heartF" : "heartO", 20);
  h.classList.toggle("on", currentTrackLiked);
}

function checkLiked(ids) {
  currentTrackIds = ids;
  const hit = ids.find((id) => likedIds.has(id));
  currentTrackLiked = !!hit;
  likedRefId = hit || ids[0];
  renderHeart();
}

// Build the local Liked Songs index in the background (up to 2000 tracks).
async function loadLikedIndex() {
  try {
    let url = "/me/tracks?limit=50";
    let n = 0;
    while (url && n < 2000) {
      const page = await api(url);
      for (const it of page.items || []) {
        const t = it?.track;
        if (t?.id) likedIds.add(t.id);
        if (t?.linked_from?.id) likedIds.add(t.linked_from.id);
        n++;
      }
      url = page.next;
    }
    likedIdsReady = true;
    // Re-evaluate the heart for whatever is playing now.
    if (currentTrackIds.length) checkLiked(currentTrackIds);
  } catch (e) {
    console.warn("Liked index failed:", e.message);
  }
}

async function toggleLiked() {
  const id = likedRefId || currentTrackId;
  if (!id) return;
  currentTrackLiked = !currentTrackLiked;
  renderHeart();
  try {
    await api("/me/tracks?ids=" + id, { method: currentTrackLiked ? "PUT" : "DELETE" });
    // Keep the local index in sync.
    if (currentTrackLiked) currentTrackIds.forEach((i) => likedIds.add(i));
    else currentTrackIds.forEach((i) => likedIds.delete(i));
    toast(currentTrackLiked ? "Added to Liked Songs" : "Removed from Liked Songs");
  } catch (e) {
    currentTrackLiked = !currentTrackLiked;
    renderHeart();
    toast("Couldn't update Liked Songs (Spotify may block writes for this app)");
  }
}

// Smooth progress bar between state updates.
setInterval(() => {
  if (!currentDuration || seekDragging) return;
  let pos = currentPosition;
  if (isPlaying) pos += Date.now() - positionTickAt;
  pos = Math.min(pos, currentDuration);
  drawSeek(pos / currentDuration, pos);
}, 400);

function drawSeek(ratio, posMs) {
  const pct = (ratio * 100).toFixed(2) + "%";
  $("#pb-fill").style.width = pct;
  $("#pb-knob").style.left = pct;
  $("#pb-elapsed").textContent = fmtTime(posMs);
}

// ============================================================================
//  Views
// ============================================================================
function go(view) {
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  $("#view-" + view).classList.add("active");
  document.querySelectorAll(".chip").forEach((c) =>
    c.classList.toggle("active", c.dataset.nav === view));
  if (view === "queue") refreshQueue();
}

// ---- Library ---------------------------------------------------------------
async function loadPlaylists() {
  const grid = $("#playlist-grid");
  grid.innerHTML = "";

  // Liked Songs pseudo-playlist card (it's a separate endpoint, not a playlist).
  const likedCard = document.createElement("div");
  likedCard.className = "pl-card";
  likedCard.innerHTML =
    `<div class="liked-cover">${icon("heartF", 48)}</div>` +
    `<div class="pl-name">Liked Songs</div>` +
    `<div class="pl-sub" id="liked-count">&nbsp;</div>`;
  likedCard.onclick = openLiked;
  grid.appendChild(likedCard);
  api("/me/tracks?limit=1")
    .then((d) => { $("#liked-count").textContent = (d?.total ?? 0) + " songs"; })
    .catch(() => { $("#liked-count").textContent = "—"; });

  try {
    let url = "/me/playlists?limit=50";
    const all = [];
    while (url) {
      const page = await api(url);
      all.push(...(page.items || []).filter(Boolean));
      url = page.next;
    }
    for (const pl of all) {
      const card = document.createElement("div");
      card.className = "pl-card";
      const img = pl.images?.[0]?.url || "";
      card.innerHTML =
        `<img src="${img}" alt="" onerror="this.style.visibility='hidden'"/>` +
        `<div class="pl-name"></div>` +
        `<div class="pl-sub">${plSubLabel(pl)}</div>`;
      card.querySelector(".pl-name").textContent = pl.name;
      card.onclick = () => openPlaylist(pl);
      grid.appendChild(card);
    }
    if (!all.length) {
      const msg = document.createElement("div");
      msg.className = "grid-msg";
      msg.textContent = "No playlists found. Note: Spotify blocks its own editorial playlists (Discover Weekly, Daylist, etc.) for new apps — only playlists you made or followed from other users appear here.";
      grid.appendChild(msg);
    }
  } catch (e) {
    console.error(e);
    const msg = document.createElement("div");
    msg.className = "grid-msg";
    msg.textContent = "Couldn't load playlists: " + e.message;
    grid.appendChild(msg);
  }
}

// ---- Playlist detail -------------------------------------------------------
function plSubLabel(pl) {
  if (pl.tracks?.total != null) return pl.tracks.total + " songs";
  if (pl.owner?.id === "spotify") return "Made by Spotify";
  return "By " + (pl.owner?.display_name || "unknown");
}

function tintFromId(id) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h}, 45%, 38%)`;
}

const LIKED_ART =
  "data:image/svg+xml;utf8," + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="#450af5"/><stop offset="0.6" stop-color="#8e8ee5"/>` +
    `<stop offset="1" stop-color="#c4efd9"/></linearGradient></defs>` +
    `<rect width="24" height="24" fill="url(#g)"/>` +
    `<path transform="translate(4.8 4.8) scale(0.6)" fill="#fff" d="${P.heartF}"/></svg>`);

async function openPlaylist(pl) {
  go("playlist");
  $("#pl-head").style.setProperty("--pl-tint", tintFromId(pl.id));
  $("#pl-art").src = pl.images?.[0]?.url || "";
  $("#pl-name").textContent = pl.name;
  $("#pl-count").textContent = plSubLabel(pl);
  const box = $("#pl-tracks");
  box.innerHTML = '<div class="empty">Loading…</div>';
  $("#pl-play").onclick = () => playContext(pl.uri, null, pl.name);

  try {
    const { tracks, raw } = await fetchPlaylistTracks(pl.id);
    box.innerHTML = "";
    tracks.forEach((t, i) => {
      box.appendChild(trackRow(t, {
        index: i + 1,
        onPlay: () => playContext(pl.uri, t.uri, pl.name),
      }));
    });
    if (!tracks.length) {
      const expected = pl.tracks?.total;
      if (expected === 0) box.innerHTML = '<div class="empty">This playlist is empty.</div>';
      else showBlockedPlaylist(pl, box);
    }
  } catch (e) {
    console.error(e);
    if (/API 403/.test(e.message) || pl.owner?.id === "spotify") {
      showBlockedPlaylist(pl, box);
    } else {
      // Unexpected error — find out what the API allows.
      box.innerHTML = '<div class="empty">Couldn\'t list this playlist\'s songs. Testing what Spotify allows…</div>';
      const res = await diag(pl.id);
      box.innerHTML =
        '<div class="empty">Track listing failed (' + e.message.slice(0, 60) + ').<br><br>' +
        "Endpoint check:<br>" +
        Object.entries(res).map(([k, v]) => (v === "OK" ? "✅ " : "⛔ ") + k + " — " + v).join("<br>") +
        "<br><br>The green play button should still work.</div>";
    }
  }
}

// Spotify's developer rules block this app from listing playlist songs, but
// playback and the queue endpoint work — so play it and browse via Queue.
function showBlockedPlaylist(pl, box) {
  box.innerHTML =
    '<div class="empty">Spotify\'s developer rules hide the songs in this playlist ' +
    "from third-party apps.<br><br>" +
    "Tap the green play button — it still plays, and the upcoming songs " +
    "will show in the Queue tab.</div>";
  $("#pl-play").onclick = () => {
    playContext(pl.uri, null, pl.name);
    toast("Playing — opening Queue");
    setTimeout(() => go("queue"), 1200);
  };
}

// Try progressively simpler ways to list a playlist's tracks.
// Returns { tracks, raw } — raw counts placeholder items Spotify sent even if
// it nulled out the actual track objects (its way of hiding content).
async function fetchPlaylistTracks(id) {
  const attempts = [
    `/playlists/${id}/tracks?limit=100&fields=next,items(track(id,uri,name,duration_ms,artists(name),album(images)))`,
    `/playlists/${id}/tracks?limit=100&market=from_token`,
    `/playlists/${id}/tracks?limit=100`,
  ];
  let lastErr;
  for (const first of attempts) {
    try {
      const tracks = [];
      let raw = 0;
      let url = first;
      while (url) {
        const page = await api(url);
        raw += (page.items || []).length;
        tracks.push(...(page.items || []).map((i) => i?.track).filter(Boolean));
        url = page.next;
      }
      console.log("Playlist fetch OK via:", first, { raw, tracks: tracks.length });
      return { tracks, raw };
    } catch (e) {
      console.warn("Playlist fetch failed via:", first, "→", e.message.slice(0, 80));
      lastErr = e;
    }
  }
  try {
    // Last resort: full playlist object embeds the first 100 tracks.
    const meta = await api(`/playlists/${id}`);
    const items = meta.tracks?.items || [];
    return { tracks: items.map((i) => i?.track).filter(Boolean), raw: items.length };
  } catch (e) { lastErr = e; }
  throw lastErr;
}

// Endpoint diagnostics — also callable from the console as diag().
async function diag(plId) {
  const tests = {
    "profile": "/me",
    "playlist list": "/me/playlists?limit=1",
    "playlist meta": plId ? `/playlists/${plId}?fields=name,owner` : null,
    "playlist tracks": plId ? `/playlists/${plId}/tracks?limit=1` : null,
    "liked songs": "/me/tracks?limit=1",
    "liked check": "/me/tracks/contains?ids=4uLU6hMCjMI75M1A2tKUQC",
    "search": "/search?type=track&limit=1&q=test",
    "queue": "/me/player/queue",
  };
  const out = {};
  for (const [name, path] of Object.entries(tests)) {
    if (!path) continue;
    try { await api(path); out[name] = "OK"; }
    catch (e) { out[name] = (e.message.match(/API \d+/) || ["FAIL"])[0]; }
  }
  console.table(out);
  return out;
}
window.diag = diag;

async function openLiked() {
  go("playlist");
  $("#pl-head").style.setProperty("--pl-tint", "#5038a8");
  $("#pl-art").src = LIKED_ART;
  $("#pl-name").textContent = "Liked Songs";
  const box = $("#pl-tracks");
  box.innerHTML = '<div class="empty">Loading…</div>';

  try {
    likedTracks = [];
    let url = "/me/tracks?limit=50";
    let total = 0;
    while (url && likedTracks.length < 1000) {
      const page = await api(url);
      total = page.total;
      likedTracks.push(...(page.items || []).map((i) => i?.track).filter(Boolean));
      url = page.next;
    }
    likedTracks.forEach((t) => { if (t.id) likedIds.add(t.id); });
    $("#pl-count").textContent = total + " songs" +
      (total > likedTracks.length ? ` (showing first ${likedTracks.length})` : "");
    $("#pl-play").onclick = () => playLiked(0);

    box.innerHTML = "";
    likedTracks.forEach((t, i) => {
      box.appendChild(trackRow(t, { index: i + 1, onPlay: () => playLiked(i) }));
    });
    if (!likedTracks.length) box.innerHTML = '<div class="empty">No liked songs yet.</div>';
  } catch (e) {
    console.error(e);
    box.innerHTML = '<div class="empty">Couldn\'t load Liked Songs: ' + e.message + "</div>";
  }
}

async function playLiked(startIndex) {
  // Liked Songs has a special context URI; fall back to a plain URI list.
  try {
    await playerCmd("/me/player/play", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        context_uri: `spotify:user:${meId}:collection`,
        offset: { uri: likedTracks[startIndex].uri },
      }),
    });
  } catch (e) {
    const uris = likedTracks.slice(startIndex, startIndex + 100).map((t) => t.uri);
    await playerCmd("/me/player/play", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uris }),
    }).catch(() => toast("Couldn't start playback"));
  }
  setTimeout(refreshQueue, 600);
}

// ---- Track rows ------------------------------------------------------------
function trackRow(track, { index, onPlay, canQueue = true, subOverride, sortable, onRemove, showCount } = {}) {
  const row = document.createElement("div");
  row.className = "row" + (index == null ? " no-index" : "") + (sortable ? " sortable" : "");
  const img = track.album?.images?.slice(-1)[0]?.url || "";
  row.innerHTML =
    (index != null ? `<div class="row-idx">${index}</div>` : "") +
    `<img src="${img}" alt="" onerror="this.style.visibility='hidden'"/>` +
    `<div class="row-main"><div class="row-title"></div><div class="row-sub"></div></div>` +
    `<div class="row-dur">${track.duration_ms ? fmtTime(track.duration_ms) : ""}</div>` +
    (showCount ? `<span class="row-count"></span>` : "") +
    (onRemove ? `<button class="row-x" aria-label="Remove">${icon("close", 18)}</button>` : "") +
    (canQueue ? `<button class="row-add" aria-label="Add to Up next">${icon("plus", 20)}</button>` : "") +
    // The grab handle sits last, after the duration, so it lines up down the edge.
    (sortable ? `<button class="row-grip" aria-label="Drag to reorder">${icon("grip", 20)}</button>` : "");
  row.querySelector(".row-title").textContent = track.name;
  row.querySelector(".row-sub").textContent =
    subOverride ?? (track.artists || []).map((a) => a.name).join(", ");
  if (onPlay) {
    row.querySelector(".row-main").onclick = onPlay;
    row.querySelector(".row-main").style.cursor = "pointer";
  }
  if (canQueue) {
    row.querySelector(".row-add").onclick = (e) => {
      e.stopPropagation();
      queueTrack(track.uri, track.name, track);
    };
  }
  if (onRemove) {
    row.querySelector(".row-x").onclick = (e) => { e.stopPropagation(); onRemove(); };
  }
  return row;
}

// ---- Drag-to-reorder --------------------------------------------------------
// Pointer-based so it works with touch on the Y70 panel. The row moves in the
// DOM as you drag; on release the new order is read back off the DOM.
function makeSortable(container, onCommit) {
  let dragEl = null;

  const rowsExcept = (el) => [...container.querySelectorAll(".row.sortable")].filter((r) => r !== el);
  const dropTarget = (y) => {
    for (const r of rowsExcept(dragEl)) {
      const b = r.getBoundingClientRect();
      if (y < b.top + b.height / 2) return r;
    }
    return null;
  };

  container.addEventListener("pointerdown", (e) => {
    const grip = e.target.closest(".row-grip");
    if (!grip) return;
    e.preventDefault();
    dragEl = grip.closest(".row");
    dragEl.classList.add("dragging");
    dragActive = true;
    grip.setPointerCapture(e.pointerId);
  });

  container.addEventListener("pointermove", (e) => {
    if (!dragEl) return;
    e.preventDefault();
    const before = dropTarget(e.clientY);
    if (before) container.insertBefore(dragEl, before);
    else container.appendChild(dragEl);
  });

  const end = () => {
    if (!dragEl) return;
    dragEl.classList.remove("dragging");
    dragEl = null;
    dragActive = false;
    onCommit([...container.querySelectorAll(".row.sortable")].map((r) => r.dataset.key));
  };
  container.addEventListener("pointerup", end);
  container.addEventListener("pointercancel", end);
}

// ---- Queue -----------------------------------------------------------------
const label = (text, sub) => {
  const el = document.createElement("div");
  el.className = "section-label";
  el.innerHTML = text + (sub ? ' <span class="section-note">' + sub + "</span>" : "");
  return el;
};

// The reorderable part of the queue — the app's own list.
function renderLocalQueue() {
  const box = $("#local-queue");
  if (!box) return;
  box.innerHTML = "";
  localQueue.forEach((t, i) => {
    const row = trackRow(t, {
      sortable: true,
      canQueue: false,
      onPlay: () => playFromQueue(i),
      onRemove: () => removeFromQueue(i),
    });
    row.dataset.key = t.qid;
    row.dataset.uri = t.uri;
    box.appendChild(row);
  });
  const head = $("#local-queue-head");
  if (head) head.classList.toggle("hidden", localQueue.length === 0);
  const hint = $("#queue-hint");
  if (hint) hint.classList.toggle("hidden", localQueue.length > 0);
}

// Show how many times each source row is queued. Rows are never removed and ＋
// stays live, so the list doesn't shift under your finger and you can add the
// same song again.
function markSourceAdded() {
  document.querySelectorAll("#source-list .row").forEach((r) => {
    const n = localQueue.filter((t) => t.uri === r.dataset.uri).length;
    r.classList.toggle("queued", n > 0);
    const c = r.querySelector(".row-count");
    if (c) c.textContent = n > 1 ? "×" + n : n === 1 ? "✓" : "";
  });
}

function renderSourceList() {
  const box = $("#source-list");
  if (!box) return;
  box.innerHTML = "";
  sourceList.tracks.forEach((t) => {
    const row = trackRow(t, {
      canQueue: true, showCount: true,
      onPlay: () => queueTrack(t.uri, t.name, t),
    });
    row.dataset.uri = t.uri;
    box.appendChild(row);
  });
  markSourceAdded();
  const c = $("#source-count");
  if (c) c.textContent = sourceList.tracks.length + " captured";
}

let queueBuilt = false;

function buildQueueView() {
  const box = $("#queue-list");
  box.innerHTML = "";

  const np = document.createElement("div");
  np.id = "now-playing-row";
  box.appendChild(np);

  const head = document.createElement("div");
  head.id = "local-queue-head";
  head.appendChild(label("Up next", "drag ☰ to reorder"));
  box.appendChild(head);

  const local = document.createElement("div");
  local.id = "local-queue";
  box.appendChild(local);

  const hint = document.createElement("div");
  hint.id = "queue-hint";
  hint.className = "empty";
  hint.textContent = "Tap ＋ below to build a queue you can reorder.";
  box.appendChild(hint);

  const srcHead = document.createElement("div");
  srcHead.id = "source-head";
  const lbl = label("From this playlist", '<span id="source-count"></span>');
  const addAll = document.createElement("button");
  addAll.id = "add-all";
  addAll.className = "btn-primary small";
  addAll.textContent = "Add all";
  addAll.onclick = () => {
    let n = 0;
    for (const t of sourceList.tracks) {
      if (!localQueue.some((q) => q.uri === t.uri)) { localQueue.push(t); n++; }
    }
    autoFill = false;
    saveQueues();
    renderLocalQueue(); markSourceAdded(); scheduleApply();
    toast("Added " + n + " song" + (n === 1 ? "" : "s"));
  };
  srcHead.appendChild(lbl);
  srcHead.appendChild(addAll);
  box.appendChild(srcHead);

  const src = document.createElement("div");
  src.id = "source-list";
  box.appendChild(src);

  makeSortable(local, (order) => {
    const byQid = new Map(localQueue.map((t) => [t.qid, t]));
    localQueue = order.map((k) => byQid.get(k)).filter(Boolean);
    autoFill = false;
    saveQueues();
    renderLocalQueue();
    scheduleApply();
  });
  queueBuilt = true;
}

async function refreshQueue() {
  if (dragActive) return;              // never rebuild mid-drag
  if (!queueBuilt) buildQueueView();

  let data = null;
  try { data = await api("/me/player/queue"); } catch (e) { /* needs an active device */ }

  // Capture the playlist reconstruction while the context is still Spotify's.
  if (data && harvesting) {
    const grew = mergeSource(data.queue, data.currently_playing);
    // Keep Up next mirroring the capture until the user edits it themselves.
    if (autoFill && grew) {
      const playing = data.currently_playing && data.currently_playing.uri;
      localQueue = sourceList.tracks.filter((t) => t.uri !== playing).map(withQid);
      saveQueues();
    }
  }

  const np = $("#now-playing-row");
  np.innerHTML = "";
  if (data && data.currently_playing) {
    np.appendChild(label("Now playing"));
    const r = trackRow(data.currently_playing, { canQueue: false });
    r.querySelector(".row-title").classList.add("playing");
    np.appendChild(r);
  }

  renderLocalQueue();
  renderSourceList();

  const srcHead = $("#source-head");
  if (srcHead) {
    srcHead.classList.toggle("hidden", sourceList.tracks.length === 0);
    const t = srcHead.querySelector(".section-label");
    if (t) {
      t.innerHTML = "From " + (sourceList.name || "this playlist") +
        ' <span class="section-note" id="source-count">' + sourceList.tracks.length + " captured</span>";
    }
  }
}

// ---- Search ----------------------------------------------------------------
let searchTimer;
async function runSearch(q) {
  const box = $("#search-results");
  if (!q) {
    box.classList.add("hidden");
    $("#playlist-grid").classList.remove("hidden");
    return;
  }
  try {
    const data = await api("/search?type=track&limit=30&q=" + encodeURIComponent(q));
    box.innerHTML = "";
    const items = data.tracks?.items || [];
    if (!items.length) box.innerHTML = '<div class="empty">No results.</div>';
    items.forEach((t) => {
      box.appendChild(trackRow(t, {
        onPlay: async () => {
          await playerCmd("/me/player/play", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ uris: [t.uri] }),
          }).catch(() => toast("Couldn't start playback"));
          setTimeout(refreshQueue, 600);
        },
      }));
    });
    box.classList.remove("hidden");
    $("#playlist-grid").classList.add("hidden");
  } catch (e) {
    box.innerHTML = '<div class="empty">Search failed: ' + e.message + "</div>";
    box.classList.remove("hidden");
  }
}

// ============================================================================
//  Playback actions
// ============================================================================
async function playContext(contextUri, offsetUri, name) {
  const body = { context_uri: contextUri };
  if (offsetUri) body.offset = { uri: offsetUri };
  try {
    await playerCmd("/me/player/play", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    // A new context means a fresh reconstruction to capture.
    if (contextUri !== sourceList.context) {
      sourceList = { context: contextUri, name: name || "this playlist", tracks: [] };
      localQueue = [];
      saveQueues();
    }
    harvesting = true;
    // Mirror the playlist into Up next as it is captured — the same result as
    // tapping ＋ on every row, but free: the context already plays this order,
    // so nothing needs syncing and nothing stutters.
    autoFill = true;
    queueDirty = false;
    // The queue endpoint reveals a window of upcoming tracks and fills in over
    // the first few seconds, so sample it a few times.
    [700, 2000, 4000, 7000].forEach((ms) => setTimeout(refreshQueue, ms));
  } catch (e) {
    toast("Couldn't start playback");
  }
}

// Duplicates are allowed — each entry carries its own qid so the same song can
// sit in the queue several times and still drag/remove independently.
function queueTrack(uri, name, track) {
  autoFill = false;
  localQueue.push(withQid(track || { uri, name, artists: [], duration_ms: 0, album: {} }));
  saveQueues();
  const n = localQueue.filter((t) => t.uri === uri).length;
  toast("Added" + (n > 1 ? " (×" + n + ")" : "") + ": " + (name || "track"));
  renderLocalQueue();
  markSourceAdded();
  // No sync here — that is what caused the stutter. Flushed at the next track
  // change instead (see the player_state_changed handler).
  queueDirty = true;
}

// Push the local order to Spotify. Restarting the context is the only
// order-aware call available, so the current track is replayed from its current
// position — a sub-second gap, debounced so a burst of edits costs one apply.
function scheduleApply(delay = 900) {
  clearTimeout(applyTimer);
  applyTimer = setTimeout(applyQueue, delay);
}

async function applyQueue() {
  if (!localQueue.length || !currentTrackUri) { queueDirty = false; return; }
  // From here the context is ours, so Spotify's queue only echoes our own list
  // back — stop folding it into the snapshot or it will pollute it.
  harvesting = false;
  queueDirty = false;
  // Spotify caps a uris list, so send a healthy window rather than everything.
  const uris = [currentTrackUri, ...localQueue.slice(0, 300).map((t) => t.uri)];
  try {
    await playerCmd("/me/player/play", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uris, offset: { position: 0 }, position_ms: Math.floor(livePosition()) }),
    });
    setTimeout(refreshQueue, 800);
  } catch (e) {
    queueDirty = true;
    toast("Couldn't sync the queue to Spotify");
  }
}

// Jump straight to a track in Up next (everything above it is dropped).
async function playFromQueue(i) {
  const rest = localQueue.slice(i);
  if (!rest.length) return;
  localQueue = rest.slice(1);
  harvesting = false;
  autoFill = false;
  queueDirty = false;
  saveQueues();
  renderLocalQueue();
  clearTimeout(applyTimer);
  try {
    await playerCmd("/me/player/play", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uris: rest.map((t) => t.uri), offset: { position: 0 } }),
    });
    setTimeout(refreshQueue, 800);
  } catch (e) { toast("Couldn't start that track"); }
}

function removeFromQueue(i) {
  autoFill = false;
  localQueue.splice(i, 1);
  saveQueues();
  renderLocalQueue();
  markSourceAdded();
  scheduleApply();
}

// The Web Playback SDK object can only ever drive its OWN device, so it is
// used only while playback is actually here. Everywhere else these go through
// the Web API against the active device — which is what turns this screen into
// a working remote for the desktop app rather than a dead set of buttons.
async function togglePlay() {
  if (playingHere() && player) { player.togglePlay(); return; }
  const was = isPlaying;
  isPlaying = !was;                    // optimistic: the button reacts instantly
  renderPlayControls();
  updateMediaSession();
  broadcastState();
  try {
    await playerCmd("/me/player/" + (was ? "pause" : "play"), { method: "PUT" });
  } catch (e) {
    isPlaying = was;                   // put it back if Spotify refused
    renderPlayControls();
    broadcastState();
    toast("Couldn't reach " + (activeDeviceName || "the player"));
  }
  soonRefresh();
}

async function playNext() {
  if (playingHere() && player) { player.nextTrack(); return; }
  await playerCmd("/me/player/next", { method: "POST" }).catch(() => toast("Couldn't skip"));
  soonRefresh();
}

async function playPrev() {
  if (playingHere() && player) { player.previousTrack(); return; }
  await playerCmd("/me/player/previous", { method: "POST" }).catch(() => toast("Couldn't go back"));
  soonRefresh();
}

async function seekTo(ms) {
  currentPosition = ms;
  positionTickAt = Date.now();
  if (playingHere() && player) { player.seek(ms); return; }
  await playerCmd("/me/player/seek?position_ms=" + ms, { method: "PUT" }).catch(() => {});
  soonRefresh();
}

// ---- Spotify Connect: follow whatever device is actually playing ------------
// The SDK only streams state for its own device, so when the desktop app (or a
// phone, or a speaker) owns playback this poll is the only thing keeping the
// now-playing bar, the seek bar, the mini player and the OS media popup honest.
let pollBusy = false;
let soonTimer = null;
// Set once boot has a working session. Without it the 2s poll would fire a
// rejected request forever while the login screen is up.
let connected = false;

// After sending a command, check back quickly — Spotify needs a moment to
// settle before /me/player reflects it.
function soonRefresh() {
  clearTimeout(soonTimer);
  soonTimer = setTimeout(() => refreshRemoteState(), 450);
}

async function refreshRemoteState() {
  if (!connected || pollBusy) return;
  // Nobody is looking at a hidden window; don't spend requests on it.
  if (document.hidden) return;
  pollBusy = true;
  try {
    const cur = await api("/me/player");
    activeDeviceId = (cur && cur.device && cur.device.id) || null;
    activeDeviceName = (cur && cur.device && cur.device.name) || "";
    activeIsHere = playingHere();
    if (activeDeviceId) setLastDevice(activeDeviceId);
    renderDeviceLabel();

    // While playback is on this web player the SDK already pushes state faster
    // and more accurately than this poll can, so don't fight it.
    if (activeIsHere || !cur || !cur.item) return;

    const changed = cur.item.uri !== currentTrackUri;
    isPlaying = !!cur.is_playing;
    currentDuration = cur.item.duration_ms || 0;
    currentPosition = cur.progress_ms || 0;
    positionTickAt = Date.now();
    shuffleOn = !!cur.shuffle_state;
    repeatMode = { off: 0, context: 1, track: 2 }[cur.repeat_state] ?? 0;
    renderNowPlaying(cur.item);
    renderPlayControls();
    updateMediaSession();
    broadcastState();
    if (changed) refreshQueue();
  } catch (e) {
    /* transient — the next tick tries again */
  } finally {
    pollBusy = false;
  }
}

function renderDeviceLabel() {
  const el = $("#pb-device");
  if (!el) return;
  // Only worth saying when the sound is coming out of something else.
  const show = !!activeDeviceName && !playingHere();
  el.textContent = show ? activeDeviceName : "";
  el.classList.toggle("hidden", !show);
  const btn = $("#pb-devices");
  if (btn) {
    btn.classList.toggle("remote", show);
    btn.title = activeDeviceName ? "Playing on " + activeDeviceName : "Devices";
  }
}

// ---- Talk to the shell -----------------------------------------------------
function livePosition() {
  let pos = currentPosition;
  if (isPlaying) pos += Date.now() - positionTickAt;
  return Math.max(0, Math.min(pos, currentDuration || 0));
}

function broadcastState() {
  if (window.parent === window) return;
  try {
    window.parent.postMessage({
      type: "y70:state",
      hasTrack: !!npTrack,
      playing: isPlaying,
      title: npTrack ? npTrack.name : "",
      artist: npTrack ? npTrack.artist : "",
      art: npTrack ? npTrack.art : "",
      position: livePosition(),
      duration: currentDuration || 0,
      at: Date.now(),
    }, "*");
  } catch (e) { /* not embedded */ }
}

// Transport commands coming back from the mini player.
window.addEventListener("message", (e) => {
  const d = e.data;
  if (!d || d.type !== "y70:cmd") return;
  if (d.action === "toggle") togglePlay();
  else if (d.action === "next") playNext();
  else if (d.action === "prev") playPrev();
  else if (d.action === "seek" && currentDuration) seekTo(Math.floor(d.ratio * currentDuration));
});

// ---- Media Session ---------------------------------------------------------
// Lets hardware media keys, headphone buttons, and macro pads that emit media
// keys drive playback while this tab is the active media source.
function setupMediaSession() {
  if (!("mediaSession" in navigator)) return;
  const set = (a, fn) => { try { navigator.mediaSession.setActionHandler(a, fn); } catch (e) {} };
  set("play", () => togglePlay());
  set("pause", () => togglePlay());
  set("nexttrack", () => playNext());
  set("previoustrack", () => playPrev());
  set("stop", () => { if (isPlaying) togglePlay(); });
  set("seekto", (d) => { if (d.seekTime != null) seekTo(Math.floor(d.seekTime * 1000)); });
  set("seekforward", (d) => seekTo(livePosition() + (d.seekOffset || 10) * 1000));
  set("seekbackward", (d) => seekTo(Math.max(0, livePosition() - (d.seekOffset || 10) * 1000)));
}

function updateMediaSession() {
  if (!("mediaSession" in navigator) || !npTrack) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: npTrack.name,
      artist: npTrack.artist,
      artwork: npTrack.art ? [{ src: npTrack.art, sizes: "640x640", type: "image/jpeg" }] : [],
    });
    navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
    if (currentDuration) {
      navigator.mediaSession.setPositionState({
        duration: currentDuration / 1000,
        playbackRate: 1,
        position: Math.min(livePosition(), currentDuration) / 1000,
      });
    }
  } catch (e) { /* metadata is best-effort */ }
}

async function toggleShuffle() {
  shuffleOn = !shuffleOn;
  renderPlayControls();
  await playerCmd("/me/player/shuffle?state=" + shuffleOn, { method: "PUT" })
    .catch(() => toast("Couldn't toggle shuffle"));
}

async function cycleRepeat() {
  repeatMode = (repeatMode + 1) % 3;
  renderPlayControls();
  const state = ["off", "context", "track"][repeatMode];
  await playerCmd("/me/player/repeat?state=" + state, { method: "PUT" })
    .catch(() => toast("Couldn't set repeat"));
}

// ---- Devices ---------------------------------------------------------------
async function toggleDevicesPop() {
  const pop = $("#devices-pop");
  if (!pop.classList.contains("hidden")) { pop.classList.add("hidden"); return; }
  pop.innerHTML = '<div class="pop-title">Connect to a device</div>';
  pop.classList.remove("hidden");
  try {
    const data = await api("/me/player/devices");
    (data.devices || []).forEach((d) => {
      const el = document.createElement("div");
      const here = d.id === deviceId;
      el.className = "dev" + (d.is_active ? " active" : "");
      el.innerHTML = `<span></span>` +
        (here ? '<span class="dev-tag">this screen</span>' : "") +
        (d.is_active ? '<span class="dev-dot"></span>' : "");
      el.querySelector("span").textContent = d.name;
      el.onclick = async () => {
        pop.classList.add("hidden");
        try {
          // `play` preserves what was happening: moving a paused track should
          // not start it, and moving a playing one should not stop it.
          await api("/me/player", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ device_ids: [d.id], play: isPlaying }),
          });
          activeDeviceId = d.id;
          activeDeviceName = d.name;
          setLastDevice(d.id);
          renderDeviceLabel();
          soonRefresh();
        } catch (err) { toast("Couldn't switch device"); }
      };
      pop.appendChild(el);
    });
    if (!data.devices?.length) pop.innerHTML += '<div class="dev">No devices found</div>';
  } catch (e) {
    pop.innerHTML += '<div class="dev">Couldn\'t load devices</div>';
  }
}

// ============================================================================
//  Wire up UI
// ============================================================================
function setVolFill(input) {
  input.style.setProperty("--fill", input.value + "%");
}

function wireUI() {
  $("#login-btn").onclick = beginLogin;
  setupMediaSession();
  loadQueues();

  // Static icons
  $("#search-ico").innerHTML = icon("search", 18);
  $("#pl-back").innerHTML = icon("back", 24);
  $("#q-back").innerHTML = icon("back", 24);
  $("#pb-prev").innerHTML = icon("prev");
  $("#pb-next").innerHTML = icon("next");
  $("#pb-shuffle").innerHTML = icon("shuffle", 20);
  $("#pb-queue").innerHTML = icon("queue", 20);
  $("#pb-devices").innerHTML = icon("devices", 20);
  $("#vol-ico").innerHTML = icon("volume", 18);
  $("#pl-play").innerHTML = icon("play", 26);
  renderPlayControls();
  renderHeart();

  // Transport
  $("#pb-play").onclick = togglePlay;
  $("#pb-next").onclick = playNext;
  $("#pb-prev").onclick = playPrev;
  $("#pb-shuffle").onclick = toggleShuffle;
  $("#pb-repeat").onclick = cycleRepeat;
  $("#pb-heart").onclick = toggleLiked;
  $("#pb-queue").onclick = () => {
    const inQueue = $("#view-queue").classList.contains("active");
    go(inQueue ? "home" : "queue");
  };
  $("#pb-devices").onclick = toggleDevicesPop;

  // Volume
  const vol = $("#pb-vol");
  setVolFill(vol);
  vol.oninput = () => {
    setVolFill(vol);
    const v = Number(vol.value) / 100;
    if (playingHere() && player) player.setVolume(v);
    playerCmd("/me/player/volume?volume_percent=" + vol.value, { method: "PUT" }).catch(() => {});
  };

  // Seek bar: tap or drag
  const bar = $("#pb-bar");
  const ratioFrom = (e) => {
    const r = bar.getBoundingClientRect();
    return Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1);
  };
  bar.addEventListener("pointerdown", (e) => {
    if (!currentDuration) return;
    seekDragging = true;
    bar.classList.add("dragging");
    bar.setPointerCapture(e.pointerId);
    const ratio = ratioFrom(e);
    drawSeek(ratio, ratio * currentDuration);
  });
  bar.addEventListener("pointermove", (e) => {
    if (!seekDragging) return;
    const ratio = ratioFrom(e);
    drawSeek(ratio, ratio * currentDuration);
  });
  bar.addEventListener("pointerup", (e) => {
    if (!seekDragging) return;
    seekDragging = false;
    bar.classList.remove("dragging");
    seekTo(Math.floor(ratioFrom(e) * currentDuration));
  });

  // Nav chips + back buttons
  document.querySelectorAll(".chip").forEach((c) => { c.onclick = () => go(c.dataset.nav); });
  $("#pl-back").onclick = () => go("home");
  $("#q-back").onclick = () => go("home");

  // Search
  const input = $("#search-input");
  input.oninput = () => {
    $("#search-clear").classList.toggle("hidden", !input.value);
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => runSearch(input.value.trim()), 400);
  };
  $("#search-clear").onclick = () => {
    input.value = "";
    $("#search-clear").classList.add("hidden");
    runSearch("");
  };

  // Close device popover when tapping elsewhere
  document.addEventListener("pointerdown", (e) => {
    const pop = $("#devices-pop");
    if (!pop.classList.contains("hidden") &&
        !pop.contains(e.target) && !$("#pb-devices").contains(e.target)) {
      pop.classList.add("hidden");
    }
  });
}

// Periodic queue refresh while the queue view is visible.
setInterval(() => {
  if ($("#view-queue")?.classList.contains("active")) refreshQueue();
}, 8000);

// Keep the shell's mini player in step.
setInterval(broadcastState, 1000);

// Follow the active device. Cheap, and it is the only way this screen notices
// that you pressed play in the desktop app, or moved playback somewhere else.
setInterval(refreshRemoteState, 2000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refreshRemoteState();
});

// ============================================================================
//  Boot
// ============================================================================
async function boot() {
  wireUI();

  if (!CFG.CLIENT_ID) { show("setup"); return; }

  // If the required scopes changed since last login, force a fresh consent.
  if (localStorage.getItem("access_token") &&
      localStorage.getItem("scopes_granted") !== SCOPES) {
    ["access_token", "refresh_token", "token_expiry"].forEach((k) => localStorage.removeItem(k));
    $("#login-note").textContent = "New permissions were added — tap Connect to re-authorize.";
  }

  const params = new URLSearchParams(window.location.search);
  if (params.get("code")) {
    if (params.get("state") !== localStorage.getItem("auth_state")) {
      toast("State mismatch — try again");
    } else {
      try {
        await exchangeCode(params.get("code"));
        // The OAuth redirect lands at top level — hand back to the shell,
        // which re-embeds this app (tokens are shared via localStorage).
        if (window.top === window.self) {
          window.location.replace("/");
          return;
        }
      } catch (e) {
        console.error(e);
        toast("Login failed");
        show("login");
        return;
      }
    }
    window.history.replaceState({}, "", "/index.html");
  }

  if (!localStorage.getItem("access_token")) { show("login"); return; }

  show("app");
  try {
    const me = await api("/me");
    meId = me?.id;
    connected = true;
    await loadPlaylists();
    loadLikedIndex(); // background — powers the heart, since /contains is blocked
    await initPlayer();
    // Adopt whatever is already playing rather than taking it over.
    const cur = await api("/me/player");
    if (cur && cur.device) {
      const vol = $("#pb-vol");
      vol.value = cur.device.volume_percent ?? 50;
      setVolFill(vol);
    }
    await refreshRemoteState();
    refreshQueue();
  } catch (e) {
    console.error(e);
    toast("Load error — check console (F12)");
  }
}

boot();
