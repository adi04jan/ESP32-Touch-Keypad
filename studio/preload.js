/* Bridge between the renderer and the main process. Self-contained on purpose:
 * a sandboxed preload cannot require local modules (that once blanked 2.1's window). */
"use strict";

const { contextBridge, ipcRenderer } = require("electron");
const call = (ch) => (...a) => ipcRenderer.invoke(ch, ...a);

contextBridge.exposeInMainWorld("api", {
  listPorts: call("ports:list"),
  connect: call("device:connect"),          // (path?) — no path = auto-detect CH340 + model:touch
  disconnect: call("device:disconnect"),
  state: call("device:state"),
  status: call("device:status"),
  fsinfo: call("device:fsinfo"),
  command: call("device:command"),
  loadProfile: call("device:loadProfile"),
  setActive: call("device:setActive"),
  showPage: call("device:showPage"),
  save: call("device:save"),
  putTile: call("device:putTile"),          // (Uint8ClampedArray rgba 72x72) -> tile name
  edit: (payload) => ipcRenderer.send("device:edit", payload),
  bleList: call("device:bleList"),
  bleForget: call("device:bleForget"),
  backupList: call("backup:list"),
  backupRead: call("backup:read"),
  backupAll: call("backup:all"),
  getSettings: call("settings:get"),
  setSettings: call("settings:set"),
  bridgeState: call("bridge:state"),
  bridgeTest: call("bridge:test"),
  contexts: call("contexts:list"),
  importProfile: call("dialog:import"),
  exportProfile: call("dialog:export"),
  flashInfo: call("flash:info"),
  ready: (info) => ipcRenderer.send("app:ready", info),
  onEvent: (cb) => {
    const h = (_e, payload) => cb(payload);
    ipcRenderer.on("evt", h);
    return () => ipcRenderer.removeListener("evt", h);
  },
});
