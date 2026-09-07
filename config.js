// ============================================================================
//  HYTE Y70 Spotify Controller — configuration
// ============================================================================
//  1. Go to https://developer.spotify.com/dashboard  ->  "Create app"
//  2. App name/description: anything (e.g. "Y70 Spotify")
//  3. Redirect URI: add EXACTLY   http://127.0.0.1:8888/callback
//  4. Which API/SDKs:   check "Web API"  AND  "Web Playback SDK"
//  5. Save, open the app, copy the "Client ID" and paste it below.
//
//  (No Client Secret is needed — this uses OAuth PKCE for public clients.)
// ============================================================================

window.SPOTIFY_CONFIG = {
  // Paste your Spotify app Client ID between the quotes:
  CLIENT_ID: "bd5e41c0f409463b8a896bb7e090eb6d",

  // Must match the port the server runs on and the Redirect URI you registered.
  REDIRECT_URI: "http://127.0.0.1:8888/callback",

  // The name this player shows up as in Spotify Connect / your device list.
  DEVICE_NAME: "HYTE Y70",

  // Weather widget location. Leave LAT/LON as null to use browser geolocation
  // (falls back to New York). Example: LAT: 43.65, LON: -79.38, LABEL: "Toronto"
  WEATHER: {
    LAT: null,
    LON: null,
    LABEL: "",

    // Optional. The map defaults to Esri's dark basemap, which needs no key.
    // CARTO's dark basemap looks nicer but now stamps "API KEY REQUIRED" across
    // every tile unless you register a free key at carto.com — paste one here
    // and "Carto Dark" is added to the basemap picker.
    CARTO_KEY: "",
  },
};
