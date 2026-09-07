# HYTE Y70 · Dashboard

> **V2 — the native app.** Tapping the panel no longer takes focus off whatever
> you are doing. Run **[`launch-v2.bat`](launch-v2.bat)**; quit from the tray icon.
> V1 (the browser build) is still here and still works — it is tagged `v1` in git.

## V2: a window that doesn't steal focus

In V1 the dashboard was a Brave window. Every tap **activated** that window:
Windows moved the foreground to it, the game lost focus, and with it lost mouse
capture — which is why the cursor appeared to jump across. No Chromium flag can
prevent this, because the browser owns the window and always activates on click.

V2 owns its own window and creates it with **`focusable: false`**, which on
Windows is the `WS_EX_NOACTIVATE` extended style — *"a top-level window created
with this style does not become the foreground window when the user clicks it."*
Taps still arrive as ordinary pointer events. They simply never take focus.

Measured on this machine, launching V2 while another window was in front:

```
foreground before : 'Claude'
foreground after  : 'Claude'      <- focus kept
window rect       : 3840,0  682x2560   <- exactly the panel, no overlap
WS_EX_NOACTIVATE  : True
WS_EX_TOPMOST     : True
```

It also:

- **starts the server itself** and waits for the port properly — no launcher
  chain, no browser, no PowerShell window placement,
- sits **always-on-top at `screen-saver` level**, so it stays visible over a
  borderless-fullscreen game,
- **skips the taskbar** and has no frame, so it is a panel rather than a window,
- re-places itself when displays come and go (the Y70 sleeps with the PC),
- reloads itself if the renderer ever dies.

### The keyboard trade-off

A window that never takes focus also never receives keystrokes. That is the
deal, and it is the right default for a screen you tap while playing something.

When you do need to type — the Notes widget, the calculator — the panel borrows
the keyboard and gives it straight back:

- **Tapping into Notes turns keyboard mode on automatically**, and tapping away
  turns it off. You never think about it.
- A **band across the top bar** says *keyboard mode — this window has focus*, so
  the one state where the panel does hold focus is never a surprise.
- The drawer's **Panel** row and a click on the **tray icon** toggle it manually.

Verified against Windows itself:

```
passive (focusable:false) : noactivate=True   foreground=Claude
keyboard mode ON          : noactivate=False  foreground=<panel>
back to passive           : noactivate=True
```

### Setup

```bash
cd v2 && npm install
```

Then run [`launch-v2.bat`](launch-v2.bat). ~350 MB of Electron lives in
`v2/node_modules` and is git-ignored.

[`install-autostart.bat`](install-autostart.bat) now prefers V2 automatically
whenever `v2/node_modules` exists; force either build with `/v1` or `/v2`.

**Known limit:** a game running in *exclusive* fullscreen owns the whole GPU
output and will cover even a topmost window. Borderless windowed is fine — which
is what you want anyway for a second screen.

---

The app is now a **dashboard shell** (`shell.html`) served at `http://127.0.0.1:8888`:

- **Apps** run in the main frame — Spotify (default) and Weather. Switch apps from
  the pull-down drawer: **drag down (or tap) the bar at the very top** of the screen.
  Apps stay **mounted in the background** once opened, so leaving Spotify does not
  stop the music.
- **Mini player** — leave Spotify while something is loaded and a slim 60px now-playing
  strip appears at the top of the dock (art, title/artist, prev/play/next, seekable
  progress). It disappears when you return to Spotify or playback ends. Fully automatic;
  it is not a drawer toggle.
- **Hardware controls** — the Spotify app registers the **Media Session API**, so
  headphone play/pause/skip buttons, keyboard media keys, and any Nexus macro that
  emits a media key drive playback (play, pause, next, previous, seek), and the track
  shows up in the OS media popup with album art.
- **Pull-up widgets** dock at the bottom as 16:9 panels — **Claude** (your local
  Claude Code usage stats — free, nothing leaves the machine), **Weather**
  (Open-Meteo, no key needed, with a clock + date and a live sky behind it),
  **PC stats** (RAM, CPU, GPU, live network throughput and what is talking to the
  internet right now), **Calculator**, **Now playing**, **Lyrics**, **Audio**,
  **Timer**, **Notes** and **Discord**.
  In the drawer they are a **list**: tap a row to turn it on or off, and **drag its
  ☰ grip to reorder** — where a row sits in that list is exactly where its panel
  sits on screen, top to bottom. **Drag a panel's title bar** up/down to resize it;
  drag it to the bottom (or tap ▼) to collapse it to a slim bar; tap the bar to reopen.
- **Scenes** — whole layouts (which app is up front, which widgets are open, at
  what height) in one tap, at the top of the drawer. Four ship with the app;
  each can be overwritten with your own arrangement and reset back again.
- **Appearance** — pull down the drawer → **Settings → Appearance** to recolour the
  dashboard. See below.

### Appearance / themes

The drawer's **Settings → Appearance** page recolours the whole dashboard. Four
things are adjustable, each with a swatch row plus a full colour picker:

| Slot | What it paints |
|------|----------------|
| **Trim** | shell chrome — grips, drawer, dock title bars, panel hairlines, mini player |
| **Weather palette** | the weather app *and* the weather widget |
| **Claude palette** | the Claude usage widget |
| **PC stats palette** | the PC stats widget |
| **Calculator palette** | the calculator widget |
| **Media palette** | now playing + lyrics |
| **Tools palette** | audio hub, timer, notes |
| **Discord palette** | the Discord widget |
| **Background** | the base colour everything is derived from |

**Presets** set all four at once. **Main Purple** is the default: black background
with `#A85CD6` as the accent throughout. Also included: Default (the original
green/blue/orange look), Midnight Ice and Ember. Editing any slot switches the
theme to *Custom*; edit it back and it re-labels itself as the matching preset
again. **Reset** returns to Main Purple.

**Tint weather backdrop** re-hues the weather app's animated sky onto the weather
accent. Each condition keeps its own lightness, so a storm still reads darker than
a clear day — only the hue family changes. Turn it off to get the real
meteorological blues and greys back.

Colours live in [`theme.js`](theme.js), which derives a full set of CSS custom
properties (surfaces, borders, text tiers, contrast-correct ink on accents) from
those four values. Everything is served from one origin, so every frame reads the
saved theme itself on load — no flash of the wrong colour — and edits are also
broadcast live to frames that are already open. Every stylesheet keeps its
original colour as the `var()` fallback, so the dashboard still renders correctly
if that script ever fails to load.

The Spotify app deliberately keeps Spotify's own green — it's styled to look like
Spotify, so it doesn't follow the trim.

> The Claude widget shows **local Claude Code usage** read off this machine's
> transcripts (`GET /api/claude-stats`). It costs nothing and needs no API key;
> `claude-key.txt` is only used by the old, unused fun-facts proxy.

### Scenes

At the top of the drawer. A scene sets the front app *and* the whole dock at once:

| Scene | What it opens |
|---|---|
| **Working** | PC stats · Notes · Timer |
| **Gaming** | Discord · Audio · PC stats |
| **Music** | Lyrics · Now playing · Audio |
| **Idle** | Weather app · Weather · Now playing · Claude usage |

Applying a scene is deliberately **total** — widgets it doesn't list get closed,
so switching to Gaming can't leave yesterday's notes panel hanging around.

Rearrange the dock however you like — including the **order**, by dragging grips in
the widget list — then **Save layout → ‹scene›** and that scene
is yours from then on (it shows a *yours* tag). **Reset to packed** puts the
original back. Everything is stored per-scene, so customising Gaming never
touches Music.

### Discord

Real Discord state on the panel: **mute and deafen that actually are Discord's**,
which voice channel you are in, who is in it, and a green ring around whoever is
talking — synced both ways, so muting in Discord lights up here within a second.

This talks to the Discord desktop client over its local named pipe
(`\\.\pipe\discord-ipc-0`). Nothing is sent to Discord's servers except the
one-time token exchange.

#### Setup (about three minutes, once)

1. Go to **discord.com/developers/applications** → **New Application**. Name it
   anything, e.g. *Y70 Dashboard*.
   Creating it makes you its **owner**, which is the part that matters — see the
   note below.
2. Open the **OAuth2** tab. Copy the **Client ID**. Hit **Reset Secret** and copy
   the **Client Secret**.
3. Still on OAuth2, under **Redirects**, add exactly `http://localhost` and
   **Save Changes**. It is never actually opened; it only has to be registered and
   to match what the token exchange sends.
4. Copy [`discord-app.example.json`](discord-app.example.json) to
   **`discord-app.json`** in the dashboard folder and paste both values in:
   ```json
   { "clientId": "...", "clientSecret": "..." }
   ```
5. Restart `node server.js`.
6. Make sure the **Discord desktop app** is running and signed in. The browser
   version has no local socket, so there is nothing to connect to.
7. Open the **Discord** widget → **Link Discord** → **approve the popup that appears
   inside Discord**. That is the only prompt; it does not open a browser.

#### What it asks for, and what it doesn't

| Scope | Why |
|---|---|
| `rpc` | permission to talk to your local Discord client at all |
| `rpc.voice.read` | read your voice settings and current channel |
| `rpc.voice.write` | change mute / deafen |
| `identify` | know which account approved it, to mark *you* in the member list |

**No bot, no server invite, no guild permissions.** This is a user-level
authorisation to your own running client — it cannot post messages, join servers,
read chat, or do anything outside your voice settings.

> **Why this works without Discord whitelisting you:** the `rpc.*` scopes are
> normally restricted to approved applications. The exception is that an
> application's **owner** may always authorise it against their own account.
> You created the app, so you are the owner. The corollary is that this is
> strictly personal — the same client id will not work for anyone else, and there
> is no point sharing it.

**Where the secrets live.** `discord-app.json` (your client secret) and
`discord-token.json` (the access + refresh token, written automatically) both sit
in the dashboard folder, and the web server **refuses to serve either** — they
never reach the browser. To revoke: **Forget token** in the widget, or Discord →
*User Settings → Authorized Apps*.

**If it won't connect:** the widget says which step failed. A wrong client id gets
`Invalid Client ID` from Discord and the dashboard then stops retrying rather than
hammering the pipe — fix the id and tap **Try again**.

> Muting yourself is available two ways and they are different things. The
> **Discord** widget mutes you *in Discord* (the real self-mute, and Discord knows
> about it). The **Audio** widget's Mic button mutes the microphone at the Windows
> level — broader, works everywhere, but Discord still shows you as unmuted.

### Audio hub

The thing a case screen is best in the world at: changing audio without leaving
the game.

- **One-tap output switching.** Tap any output to move Windows onto it — Console,
  Multimedia *and* Communications roles together, so chat follows the music
  instead of being left behind on the old device.
- **Per-app mixer** with live level bars — Spotify, Discord, the game, each with
  its own volume and mute. Muting an app hits *every* session it owns (Discord
  keeps several), so it actually goes quiet.
- **Mic mute** as an unmissable red state. It mutes the default *capture* device,
  which is system-wide — that is what mutes you in Discord, in a call, everywhere.
- **Discord** gets its own button: that one mutes what you *hear* from Discord.
- Master volume, and a live meter on the active output so you can see sound
  flowing even when you can't hear it.

Virtual endpoints are filtered out of the list (numbered Voicemeeter strips, VB
CABLE, Steam Streaming) unless one is somehow the active device — in which case it
has to stay visible or you could never switch off it.

> **On Discord:** this widget's buttons are the Windows-level ones — the Mic
> button mutes the microphone for everything, and the Discord button mutes what
> you *hear* from Discord. For Discord's own mute/deafen state, use the
> **Discord** widget above.

### Now playing (universal)

Reads **GSMTC**, the same Windows media bus that powers the Win+G overlay, so the
panel shows and controls **whatever is playing** — Spotify, a YouTube tab in
Brave, VLC, a game's own player. Title, artist, album, source app, transport, and
a seek bar when the source supports seeking. Position is interpolated between
polls, because Windows reports it only when it feels like it.

> Album art is the one thing GSMTC won't give up here: opening its thumbnail
> stream returns a bare COM object that Windows PowerShell 5.1 refuses to project
> onto the WinRT interface. When the source is Spotify the widget borrows the
> artwork the Spotify app already publishes; otherwise it shows a themed
> placeholder.

### Lyrics

Time-synced, from **LRCLIB** — free, no key, no account. The current line is
highlighted and the view scrolls itself; **tap any line to seek the real player
to it**, whatever app that is. Falls back to unsynced lyrics, then says plainly
that it found none. Scrolling by hand pauses the auto-follow for six seconds so
you can read ahead. Lookups are proxied and cached by the server, so a repeated
track costs nothing.

### Timer

Presets from 1 minute to an hour, plus a 25-minute Pomodoro. Several can run at
once, each with its own name and a progress fill that runs underneath the row.

Timers are stored as **absolute end times**, never as a countdown that has to be
ticked — so they stay correct across a reload, a collapsed panel, or a browser
that throttled its timers while the window was hidden. When one finishes the row
pulses and it beeps every few seconds until you tap **Silence**.

### Notes

A scratchpad that saves itself to **`notes.txt`** in the dashboard folder — a real
file, so it survives clearing site data and you can open it in an editor. Writes
are debounced, flushed on blur, and flushed again with `sendBeacon` if the panel
is torn down mid-sentence. **＋ date** stamps the cursor position.

### Calculator widget

A touch keypad with a real expression display, so you can see the whole sum
rather than one number at a time.

- **Correct precedence** — `2+3×4` is `14`, not `20`. It tokenises what you typed
  and evaluates with a shunting-yard pass; it never calls `eval()`.
- **Unary minus** — `±` negates the number you are typing, and `2×−3` is `−6`.
- **`%`** is postfix and always means "divide this number by 100", so `200×50%`
  is `100`. (It is deliberately not the "50% *of* the previous number" behaviour
  some calculators use, which changes meaning depending on the operator before it.)
- **`=` then an operator** keeps calculating from the answer; **`=` then a digit**
  starts fresh.
- **Keyboard works too** — digits, `+ - * /`, `%`, `.`, Enter, Backspace, Esc.
- Divide-by-zero and half-finished sums say so instead of showing `NaN`.

### PC stats widget

Live machine telemetry, refreshed every 2 seconds:

- **History** — every tile carries a sparkline of the same series its number came
  from, so the value on screen is always the right-hand end of the line. Six
  minutes at 2-second resolution, sampled on the server's own timer so the shape
  is right whether or not the widget was on screen.
- **Per-core strip** — one bar per logical processor (16 on a 7800X3D), with a
  count of how many are working hard.
- **RAM** — percent used plus the actual GB in use / installed
- **CPU** — load percent (from `os.cpus()` deltas) and die temperature *if a
  source exists* — see the note below
- **GPU** — temperature, utilisation and VRAM in use, via `nvidia-smi`
- **Network** — real down/up throughput summed across adapters, from
  `Get-NetAdapterStatistics` byte counters
- **Network activity** — every process holding an established connection to
  another machine, with its connection count, distinct remote hosts, a sample
  remote endpoint, and its I/O rate. The list is rebuilt from scratch each tick,
  so it shows what is happening *now* — which is how you catch the things that
  chatter while you are doing nothing at all.

> **On the rate column:** Windows publishes no per-process *network* byte counter
> (there is no such performance counter; only an ETW trace session can attribute
> bytes to a process). The rate shown is that process's total I/O, which is why
> it is labelled "per-process I/O". The connection count and remote endpoint
> beside it *are* network-specific and exact, and the down/up figures at the top
> are true adapter throughput.

**CPU temperature needs a helper.** Windows exposes no CPU die temperature on
most desktops — on AMD in particular `MSAcpi_ThermalZoneTemperature` answers
"Not supported", because reading it requires a kernel driver. Install
[LibreHardwareMonitor](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor)
(free) and leave it running **as administrator**; it publishes sensors over WMI
and the widget picks them up on its own within a minute — no restart, no config.
OpenHardwareMonitor and an ACPI thermal zone are also tried, in that order.
Everything else on the widget works with nothing installed.

**How it works.** Spawning PowerShell per request would cost ~1s (module load +
WMI connect), so [`server.js`](server.js) starts **one** long-lived sampler
([`pcstats.ps1`](pcstats.ps1)) that streams raw cumulative counters as JSON lines;
`GET /api/pcstats` answers instantly from the newest sample and differentiates it
against the previous one. The sampler shuts down after 60s with no requests — so
it costs nothing while the widget is off — and it watches the server's PID, so it
can never survive as an orphan `powershell.exe` even if node is force-killed.

### Weather

Two surfaces, both free and key-less (Open-Meteo + RainViewer + Esri/OSM tiles):

- **Widget** ([`widget-weather.html`](widget-weather.html)) — compact current + 5-day strip
  for the dock, with a **clock and date** filling the gap on the right, over the same
  **live reactive sky** the full app uses: rain and snow, drifting cloud, stars at night,
  a sun/moon glow on clear skies and lightning in a storm. Both surfaces share one
  engine ([`weather-bg.js`](weather-bg.js)) so they always agree; the widget just runs it
  at a lower particle density, since the app's counts read as a blizzard in a dock panel. The clock re-aligns
  itself to the top of each minute rather than free-running on a 60s timer, so it never
  drifts a beat behind. The date line drops out automatically if you squash the panel.
- **App** ([`weather-app.html`](weather-app.html)) — the full thing:
  - Current conditions + 8 detail tiles (wind, humidity, UV, pressure, visibility, dew point, sunrise/sunset)
  - 24-hour scroller and 7-day forecast with temperature-range bars
  - **Air quality**: US AQI with category, colored scale, and 6 pollutant bars (PM2.5, PM10, O₃, NO₂, SO₂, CO)
  - **Map** (hand-rolled slippy map, no map library), zoom **3–17**.
    Drag to pan, **pinch or wheel to zoom** (anchored at the pointer/pinch midpoint), ◎ recenters.
    The button in the map header cycles the **basemap**: **Esri Dark** (default),
    **Satellite**, **OpenStreetMap** — all key-less. If a source starts failing
    outright the map switches to the next one by itself and remembers the change.

    > **CARTO is no longer the default.** Its dark basemap now stamps
    > "API KEY REQUIRED" diagonally across every tile unless you register one.
    > Note that the request still returns **HTTP 200 with a valid PNG** — nothing
    > errors and no failover can detect it; the watermark is baked into the image.
    > If you get a free key at carto.com, put it in `WEATHER.CARTO_KEY` in
    > [`config.js`](config.js) and "Carto Dark" reappears in the picker.
    Three togglable overlays:
    - **Rain** — two stacked radar sources: **NEXRAD 1 km** (IEM's NOAA mosaic, sharp at every zoom,
      US coverage) layered over **RainViewer** (global, but its public tiles only render to z7, so it is
      upscaled client-side and drops out past z11). Wherever NEXRAD has no data the global layer shows
      through, so border regions aren't silently blank. Both use the same dBZ colour scale.
      Radar fades as you zoom in so the streets underneath stay readable.
    - **Wind** — animated particle streaks advected through a live wind grid
    - **AQI** — blended heat layer from a live AQI grid
  - **Reactive background** — gradient, cloud drift, rain/snow particles, stars at night,
    lightning flashes in storms, plus an AQI haze tint when air quality is poor.

Set `WEATHER: { LAT, LON, LABEL }` in [`config.js`](config.js) — otherwise it uses
browser geolocation (and reverse-geocodes a place name), falling back to New York.

---

# Spotify Controller

A touch-optimized Spotify **playlist + queue** controller made to run fullscreen
on the **HYTE Y70 Touch** built-in display. Browse your playlists, tap to play,
add tracks to the queue, and control playback — all from the case screen.

> **Note on "Nexus plugins":** HYTE Nexus has **no public plugin SDK**, so there's
> no way to install a native third-party plugin *inside* Nexus. Instead this is a
> small local web app you run fullscreen on the Y70 screen (which Windows sees as
> a second display). If your Nexus build has a web/URL widget you can point it at
> `http://127.0.0.1:8888`.

Requires **Spotify Premium** (needed for playback control via the Web Playback SDK)
and **Node.js** installed.

---

## 1. Create a Spotify app (one time, ~2 min)

1. Go to **https://developer.spotify.com/dashboard** → **Create app**
2. Name/description: anything (e.g. "Y70 Spotify")
3. **Redirect URI** — add exactly:
   ```
   http://127.0.0.1:8888/callback
   ```
4. Under "Which API/SDKs are you planning to use", check **Web API** and **Web Playback SDK**
5. Save. Open the app → **Settings** → copy the **Client ID**

## 2. Add your Client ID

Open [`config.js`](config.js) and paste the Client ID:

```js
CLIENT_ID: "paste-your-client-id-here",
```

## 3. Run it

From this folder:

```bash
node server.js
```

Then open **http://127.0.0.1:8888** in a browser and click **Connect Spotify**.

## 4. Launching it

Run **[`launch-dashboard.bat`](launch-dashboard.bat)** (double-click it, or point a Nexus
**Macro Touchpad** button at it). It:

1. finds `node` (even when PATH isn't inherited, e.g. from Task Scheduler or a Nexus macro),
2. starts `server.js` if nothing is listening on 8888,
3. **waits until the port actually accepts connections** — this is what prevents
   "127.0.0.1 refused to connect",
4. opens the dashboard **fullscreen on the small screen** (Windows display 1) in **Brave**,
   using your normal profile so it's already signed in to Spotify.

Screen placement is handled by [`open-dashboard.ps1`](open-dashboard.ps1), which moves the
window onto the target monitor with `SetWindowPos` and then sends F11. Browser
`--window-position` flags alone are unreliable — once the profile has saved window state,
Chromium restores the old placement and ignores them.

Change the monitor by editing `set "SCREEN=1"` at the top of the .bat (it falls back to the
physically smallest screen if that display doesn't exist). Press **F11** to leave fullscreen.

### Auto-start at logon

```
install-autostart.bat            install
install-autostart.bat /remove    uninstall
```

Adds a Startup-folder shortcut to [`autostart-hidden.vbs`](autostart-hidden.vbs), which waits
**30 seconds** for Windows to settle and then launches everything with no console window.
No administrator rights needed (a Scheduled Task would have required elevation).

Test the unattended path without waiting:

```
wscript "autostart-hidden.vbs" 0
```

> **Reality check on "Nexus plugins":** Nexus 2.0 has a *fixed* set of built-in widgets and
> **no web/URL widget and no plugin SDK**, so this can't be embedded inside the Nexus canvas.
> A Macro Touchpad button that launches the .bat is the closest supported integration.

---

## What works

- OAuth login (PKCE — no client secret stored)
- This app registers itself as a Spotify device named **"HYTE Y70"**

- **It behaves like a Spotify Connect remote, not a thief.** Opening this screen
  while the desktop app is playing leaves playback exactly where it is — the
  panel just follows along and controls it. Play/pause, skip, previous, seek,
  volume, shuffle, repeat, playing a playlist and every queue edit are sent to
  **whichever device is actually playing**. When the sound *is* coming from
  somewhere else, its name appears next to the devices button so you always know
  where you are pointing.

  > This used to be broken in both directions: the app sent
  > `PUT /me/player {device_ids:[this screen], play:false}` the moment the web
  > player registered, which yanked playback off the desktop app **and paused
  > it** — and every transport button called the Web Playback SDK object, which
  > can only ever drive its own device, so pressing play here did nothing at all
  > while the desktop app held playback.

  To deliberately move the music onto the panel, use the **devices button** and
  pick the one tagged *this screen*. Transfers keep the current play/pause state,
  so moving a paused track no longer starts it playing.

  If the device you last used has gone away (desktop app closed), the command is
  retried on this screen's player rather than failing silently.
- Playlist grid → open → tap a track to play, or **＋** to queue
- **Reorderable queue** — the Queue tab's **Up next** list has a ☰ grip after each
  track length: drag it to reorder, tap a row to jump to it, **×** to remove.

  > Spotify's public Web API **cannot reorder, remove from, or clear the queue** —
  > `POST /me/player/queue` only appends, and the `set_queue` call their own apps use
  > is private. So the app keeps its own ordered list and pushes it to Spotify with
  > `PUT /me/player/play {uris:[…]}`, the one order-aware endpoint. Applying an edit
  > therefore replays the current track from its current position — a sub-second gap,
  > debounced so a burst of edits costs one sync.

- **Captured playlist list** — since playlist track listings are 403'd for new apps,
  hitting play on a playlist and reading the queue is the only way to see what's inside
  it. The app **snapshots that reconstruction** into a saved list shown under
  **From &lt;playlist&gt;**, so it survives taking over the queue (and survives reloads).
  Tap **＋** on any row to add it to Up next — rows are never removed, they just show
  a ✓ / ×N badge, so nothing shifts while you tap down the list and you can **add the
  same song more than once**. **Add all** queues the lot.

- **Playing a playlist auto-fills Up next** with everything captured — the same result
  as tapping ＋ on every row — so you can reorder immediately. This costs nothing:
  the playlist context already plays that order, so no sync is needed.

- **No stutter on adding.** Rewriting the context is what makes playback hiccup, so
  adds don't sync at all — they're flushed at the next **track change**, where a replay
  from position 0 is inaudible. Only reorders and removals sync right away, since
  that's when you expect to hear the change.
- **Play all** for a whole playlist
- Live **Now Playing** with album art, progress (tap to seek), volume
- **Queue** tab showing what's up next
- Prev / play-pause / next

## Troubleshooting

- **"Premium required"** — playback control needs a Premium account.
- **Redirect/login error** — the Redirect URI in your Spotify app must be
  `http://127.0.0.1:8888/callback` *exactly* (use `127.0.0.1`, not `localhost`).
- **Controls do nothing** — check the device name shown beside the devices
  button: commands go to whatever Spotify says is active. If that device is
  asleep or offline, pick another one from the devices list.
- **I want the sound to come out of the Y70 panel** — tap the devices button and
  choose the entry tagged *this screen*. The app never takes playback on its own.
- **Nothing loads** — open the browser dev console (F12) for the error.

## Files

| File | Purpose |
|------|---------|
| `config.js`  | Your Client ID + settings |
| `server.js`  | Zero-dependency static server on `127.0.0.1:8888` |
| `index.html` | UI layout |
| `styles.css` | Touch/dark styling tuned for the tall Y70 display |
| `app.js`     | Auth, Web Playback SDK, API calls, rendering |
| `theme.js`   | Shared palette — presets, colour maths, CSS variables for every frame |
| `pcstats.ps1` | Long-lived telemetry sampler feeding `/api/pcstats` |
| `weather-bg.js` | Reactive sky canvas, shared by the weather app and widget |
| `syscontrol.ps1` | Resident helper: Core Audio + Windows media session |
| `discord.js` | Discord RPC over the local named pipe |
| `discord-app.json` | Your Discord client id + secret (never served) |
| `v2/main.js` | V2 native shell — the non-activating window |
| `v2/preload.js` | Bridge exposing keyboard mode to the pages |
| `launch-v2.bat` | Starts V2 |
| `notes.txt` | The notes widget's store (never served over HTTP) |
