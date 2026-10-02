/* Macropad Studio (Touch Keypad) — Electron main process.
 * Owns the serial link, device session, host bridge and feeds; the renderer
 * talks to it over IPC (preload.js).
 * Env: STUDIO_NO_SERIAL=1 never touches serial ports; STUDIO_SIM=1 talks to the
 * in-process simulated keypad (test/sim-device.js, dev only) instead of serial;
 * STUDIO_SMOKE=1 quits after the renderer reports ready (npm run smoke);
 * STUDIO_SCREENSHOT=<png> [STUDIO_VIEW=device|settings] captures the window;
 * STUDIO_DATA_DIR overrides the data dir. */
"use strict";

const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage, shell, globalShortcut } = require("electron");
const path = require("path");
const os = require("os");
const fs = require("fs");
const { spawn } = require("child_process");

const schema = require("./services/schema");
const store = require("./services/store");
const backup = require("./services/backup");
const activewin = require("./services/activewin");
const feeds = require("./services/feeds");
const flasher = require("./services/flasher");
const hostbridge = require("./services/hostbridge");
const { contextForProcess, CONTEXT_MATCH } = require("./services/contexts");
const { SerialLink } = require("./services/serial");
const { Device } = require("./services/device");

const SIM = process.env.STUDIO_SIM === "1";
const NO_SERIAL = process.env.STUDIO_NO_SERIAL === "1" && !SIM;
const SMOKE = process.env.STUDIO_SMOKE === "1";
const ICON = path.join(__dirname, "assets", "icon.ico");

let win = null, tray = null, link = null, device = null, bridge = null;
let manualDisconnect = false, connecting = false, pollTimer = null, currentContext = "global";

function send(type, data) { if (win && !win.isDestroyed()) win.webContents.send("evt", { type, data }); }
const log = (text) => send("log", text);

function openTarget(target) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) && !/^[a-z]:[\\/]/i.test(target)) return shell.openExternal(target);
  // apps on PATH, files, folders: let `start` resolve them
  spawn("cmd.exe", ["/c", "start", '""', target], { detached: true, windowsHide: true, stdio: "ignore" }).unref();
}
function runCommand(cmdline) { spawn(cmdline, { shell: true, detached: true, windowsHide: true, stdio: "ignore" }).unref(); }

function initServices() {
  const dataDir = process.env.STUDIO_DATA_DIR || (app.isPackaged ? app.getPath("userData") : __dirname);
  store.configure({ dataDir: path.join(dataDir, "data") });
  backup.configure({ dataDir });

  link = new SerialLink({ SerialPort: SIM ? simPort() : NO_SERIAL ? offlinePort() : undefined });
  bridge = new hostbridge.HostBridge({ globalShortcut, open: openTarget, run: runCommand, settings: () => store.load(), log });
  device = new Device({ link, backup, settings: store, bridge, tileDir: path.join(dataDir, "data", "tiles"), hostName: os.hostname() });

  for (const ev of ["log", "fs-info", "key", "page", "profile", "ble", "idle"]) link.on(ev, (d) => send(ev, d));
  link.on("tx", (t) => send("tx", t));
  link.on("seek", (sec) => feeds.seekNowPlaying(sec));     // tap-to-seek on the keypad's player
  link.on("rx", (t) => send("rx", t));
  link.on("disconnect", () => { send("state", device.state()); schedulePoll(); });
  device.on("state", (s) => send("state", s));
  device.on("save-state", (s) => send("save-state", s));
  device.on("log", log);
  device.on("bridge", (r) => send("bridge", r));

  const s = store.load();
  send("bridge", bridge.apply(s.host_slots));
  if (s.auto_switch_enabled) startContextSwitching();
  if (s.nowplaying_enabled) startNowPlaying();
}

// Stand-in port class when serial is disabled: lists nothing, opens nothing.
function offlinePort() {
  return class { static async list() { return []; } constructor(_o, cb) { setImmediate(() => cb(new Error("serial disabled (STUDIO_NO_SERIAL)"))); } on() {} };
}

// Demo/dev: a simulated keypad preloaded with the profiles the keypad ships with.
function simPort() {
  const { SimDevice, makeSimPort } = require("./test/sim-device");
  const sim = new SimDevice();
  const w = {};
  new Function("window", fs.readFileSync(path.join(__dirname, "..", "docs", "device", "profiles.js"), "utf8"))(w);
  w.DEFAULT_PROFILES.forEach((p, i) => sim.files.set(`/profile${i + 1}.json`, Buffer.from(JSON.stringify(p))));
  sim.theme = process.env.STUDIO_SIM_THEME || "daylight";
  return makeSimPort(sim);
}

// Auto-connect: look for the keypad every 3 s while not connected (unless the user disconnected).
async function tryAutoConnect() {
  if (NO_SERIAL || connecting || manualDisconnect || link.isOpen() || !store.load().auto_connect) return;
  connecting = true;
  try {
    const r = await device.connect();
    if (r.ok) { log(`Touch Keypad found on ${r.path} (fw ${r.status.ver || "?"}).\n`); send("connected", r); }
  } finally { connecting = false; }
}
function schedulePoll() {
  clearInterval(pollTimer);
  if (NO_SERIAL) return;
  pollTimer = setInterval(tryAutoConnect, 3000);
  tryAutoConnect();
}

function startContextSwitching() {
  activewin.start((proc) => {
    const ctx = contextForProcess(proc);
    if (ctx === currentContext) return;
    currentContext = ctx;
    const map = store.load().context_profiles || {};
    const slot = map[ctx] || map.global;
    send("context", { context: ctx, process: proc, slot: slot || null });
    if (slot) device.setActiveProfile(slot);
  });
}
function startNowPlaying() {
  feeds.startNowPlaying((np) => { send("nowplaying", np); device.nowPlaying(np); }, (e) => log(`Now Playing helper: ${e}\n`),
    (bmp, key) => { send("art", `data:image/bmp;base64,${bmp.toString("base64")}`); device.art(bmp, key); });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1360, height: 900, minWidth: 1100, minHeight: 720,
    backgroundColor: "#13212b", title: "Macropad Studio · Touch Keypad", icon: ICON, show: !SMOKE,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.removeMenu();
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); return { action: "deny" }; });
  win.webContents.on("console-message", (e) => {
    const { level, message, lineNumber, sourceId } = e;
    if (level === "error" || level === "warning" || level >= 2) console.error(`[renderer] ${message} (${sourceId}:${lineNumber})`);
    if (SMOKE && (level === "error" || level === 3)) { console.error("STUDIO_BOOT_FAIL"); smokeExit(1); }
  });
  win.webContents.on("render-process-gone", (_e, d) => { console.error("[renderer gone]", d.reason); if (SMOKE) smokeExit(1); });
  win.webContents.on("did-fail-load", (_e, code, desc) => { console.error("[load failed]", code, desc); if (SMOKE) smokeExit(1); });
  win.on("close", (e) => {
    if (app.isQuitting || SMOKE) return;
    e.preventDefault();          // keep running in the tray so host shortcuts stay live
    win.hide();
  });
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
}

function createTray() {
  if (SMOKE) return;
  const img = nativeImage.createFromPath(path.join(__dirname, "assets", "tray.png"));
  tray = new Tray(img.isEmpty() ? ICON : img);
  tray.setToolTip("Macropad Studio · Touch Keypad");
  const show = () => { if (!win || win.isDestroyed()) createWindow(); win.show(); win.focus(); };
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Show Studio", click: show },
    { type: "separator" },
    { label: "Quit", click: () => { app.isQuitting = true; app.quit(); } },
  ]));
  tray.on("click", show);
}

if (!SMOKE && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => { if (win) { win.show(); win.focus(); } });
  app.whenReady().then(() => {
    initServices();
    createWindow();
    createTray();
    schedulePoll();
    if (SMOKE) setTimeout(() => { console.error("STUDIO_BOOT_FAIL timeout"); smokeExit(1); }, 20000);
  });
}

// Child processes (media helper, window watcher) must go first or Electron won't exit.
function cleanup() {
  clearInterval(pollTimer);
  activewin.stop(); feeds.stopNowPlaying();
  if (bridge) bridge.dispose();
  globalShortcut.unregisterAll();
  if (tray) { tray.destroy(); tray = null; }
}
const smokeExit = (code) => { cleanup(); app.exit(code); };
app.on("before-quit", () => { app.isQuitting = true; cleanup(); });
app.on("window-all-closed", () => { if (app.isQuitting || SMOKE) { if (link) link.disconnect(); app.quit(); } });

// ---- IPC --------------------------------------------------------------------
ipcMain.on("app:ready", async (_e, info) => {
  if (process.env.STUDIO_SCREENSHOT) {
    await new Promise((r) => setTimeout(r, +process.env.STUDIO_SHOT_DELAY || 3000));
    fs.writeFileSync(process.env.STUDIO_SCREENSHOT, (await win.webContents.capturePage()).toPNG());
  }
  if (!SMOKE) return;
  console.log(`STUDIO_BOOT_OK ${JSON.stringify(info || {})}`);
  setTimeout(() => smokeExit(0), 200);
});

ipcMain.handle("ports:list", () => (NO_SERIAL ? [] : link.listPorts()));
ipcMain.handle("device:connect", async (_e, portPath) => {
  if (NO_SERIAL) return { ok: false, error: "serial disabled (STUDIO_NO_SERIAL)" };
  manualDisconnect = false;
  if (link.isOpen()) return { ok: true, ...device.state() };
  connecting = true;
  try { return await device.connect(portPath || undefined); } finally { connecting = false; }
});
ipcMain.handle("device:disconnect", () => { manualDisconnect = true; device.disconnect(); return true; });
ipcMain.handle("device:state", () => ({ ...device.state(), noSerial: NO_SERIAL, view: process.env.STUDIO_VIEW || null, appVersion: app.getVersion(), smoke: SMOKE }));
ipcMain.handle("device:status", () => device.refreshStatus());
ipcMain.handle("device:fsinfo", () => device.fsinfo());
ipcMain.handle("device:command", (_e, cmd) => link.command(String(cmd)));
ipcMain.handle("device:loadProfile", (_e, slot) => device.loadProfile(slot));
ipcMain.handle("device:setActive", (_e, slot) => device.setActiveProfile(slot));
ipcMain.handle("device:showPage", (_e, slot, page) => device.showPage(slot, page));
ipcMain.handle("device:save", (_e, slot, profile) => device.save(slot, profile));
ipcMain.on("device:edit", (_e, payload) => device.edit(payload));
ipcMain.handle("device:bleList", () => device.bleList());
ipcMain.handle("device:bleForget", (_e, n) => device.bleForget(n));
ipcMain.handle("device:bleUse", (_e, n) => device.bleUse(n));
ipcMain.handle("device:look", () => device.look());

ipcMain.handle("backup:list", () => { try { return backup.listBackups(); } catch (_) { return []; } });
ipcMain.handle("backup:read", (_e, id) => { try { return { ok: true, profile: schema.repairProfile(backup.readBackup(id)) }; } catch (e) { return { ok: false, error: e.message }; } });
ipcMain.handle("backup:all", async () => {
  if (!link.isOpen()) return { ok: false, error: "not connected" };
  const profiles = {};
  for (let n = 1; n <= schema.NUM_PROFILES; n++) {
    try { profiles[n] = JSON.parse(await link.readFile(`profile${n}.json`)); } catch (_) {}
  }
  return backup.manualBackupAll(profiles);
});

ipcMain.handle("settings:get", () => store.load());
ipcMain.handle("settings:set", (_e, patch) => {
  const before = store.load(), s = store.save(patch || {});
  if (before.auto_switch_enabled !== s.auto_switch_enabled) { if (s.auto_switch_enabled) startContextSwitching(); else { activewin.stop(); currentContext = "global"; } }
  if (before.nowplaying_enabled !== s.nowplaying_enabled) { if (s.nowplaying_enabled) startNowPlaying(); else feeds.stopNowPlaying(); }
  if (patch && "host_slots" in patch) send("bridge", bridge.apply(s.host_slots));
  if (patch && patch.auto_connect) { manualDisconnect = false; tryAutoConnect(); }
  return s;
});
ipcMain.handle("bridge:state", (_e, profile) => ({
  slots: store.load().host_slots,
  combos: Object.keys(store.load().host_slots).map((s) => hostbridge.comboForSlot(+s)),
  failed: bridge.failed,
  conflicts: profile ? hostbridge.findActionConflicts(profile) : [],
}));
ipcMain.handle("bridge:test", (_e, cmd) => bridge.execute(cmd));
ipcMain.handle("contexts:list", () => ["global", ...CONTEXT_MATCH.map(([id]) => id)]);

ipcMain.handle("dialog:import", async () => {
  const r = await dialog.showOpenDialog(win, { filters: [{ name: "JSON", extensions: ["json"] }], properties: ["openFile"] });
  if (r.canceled || !r.filePaths[0]) return null;
  try { return { ok: true, profile: schema.repairProfile(JSON.parse(fs.readFileSync(r.filePaths[0], "utf8"))) }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle("dialog:export", async (_e, profile) => {
  const r = await dialog.showSaveDialog(win, { defaultPath: "profile.json", filters: [{ name: "JSON", extensions: ["json"] }] });
  if (r.canceled || !r.filePath) return null;
  try { fs.writeFileSync(r.filePath, JSON.stringify(schema.repairProfile(profile), null, 2)); return { ok: true, path: r.filePath }; }
  catch (e) { return { ok: false, error: e.message }; }
});
const fwResources = () => (app.isPackaged ? process.resourcesPath : null);
ipcMain.handle("flash:info", () => flasher.info(fwResources()));
// Install firmware: release the port, run esptool, then reconnect to the same port.
ipcMain.handle("flash:run", async () => {
  if (NO_SERIAL) return { ok: false, error: "serial disabled (STUDIO_NO_SERIAL)" };
  const port = link.path || ((await link.listPorts()).find((p) => p.ch340) || {}).path;
  if (!port) return { ok: false, error: "no keypad found on USB" };
  manualDisconnect = true;
  device.disconnect();
  await new Promise((r) => setTimeout(r, 400));
  const r = await flasher.flash(port, fwResources(), (p) => send("flash", p));
  log(r.ok ? `Firmware installed on ${port}.\n` : `Firmware install failed: ${r.error}\n${r.log.slice(-1500)}\n`);
  manualDisconnect = false;
  setTimeout(async () => {
    if (link.isOpen() || connecting) return;
    connecting = true;
    try { await device.connect(port); } finally { connecting = false; }
  }, 3500);
  return { ok: r.ok, error: r.error };
});
