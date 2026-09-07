// ============================================================================
//  Bridge between the dashboard pages and the native shell.
//
//  The pages are the same ones V1 served to a browser, so everything here is
//  additive: `window.y70native` simply does not exist when the dashboard is
//  opened in a normal browser, and the shell hides the native-only controls.
// ============================================================================
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("y70native", {
  version: 2,

  // The window is created non-focusable so taps never pull focus off a game.
  // That also means no keystrokes reach it — call this to borrow the keyboard
  // for a moment, and call it again with false to go back to passive.
  setKeyboardMode: (on) => ipcRenderer.invoke("y70:keyboard", !!on),
  getKeyboardMode: () => ipcRenderer.invoke("y70:keyboard-state"),
  onKeyboardMode: (fn) => {
    ipcRenderer.on("y70:keyboard-mode", (_e, on) => fn(!!on));
  },

  reload: () => ipcRenderer.invoke("y70:reload"),
  quit: () => ipcRenderer.invoke("y70:quit"),
  displays: () => ipcRenderer.invoke("y70:displays"),
});
