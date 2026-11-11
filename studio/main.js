/* Macropad Studio (Touch Keypad) — Electron main process.
 * Owns the serial link, device session, host bridge and feeds; the renderer
 * talks to it over IPC (preload.js).
 * Env: STUDIO_NO_SERIAL=1 never touches serial ports; STUDIO_SIM=1 talks to the
 * in-process simulated keypad (test/sim-device.js, dev only) instead of serial;
 * STUDIO_SMOKE=1 quits after the renderer reports ready (npm run smoke);
 * STUDIO_SCREENSHOT=<png> [STUDIO_VIEW=device|settings] captures the window;
 * STUDIO_DATA_DIR overrides the data dir; STUDIO_BLE_ONLY=1 connects over Bluetooth only. */
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
const { CONTEXT_MATCH } = require("./services/contexts");
const { SerialLink } = require("./services/serial");
const { withBluetooth } = require("./services/bleport");
const { Device } = require("./services/device");
const { Autogen, appKey } = require("./services/autogen");
const chat = require("./services/chat");
const { WinNotify } = require("./services/winnotify");
const { Suggest } = require("./services/suggest");
const { MicMute } = require("./services/micmute");
const { isAppFrame, openKind } = require("./services/guard");

const SIM = process.env.STUDIO_SIM === "1";
const NO_SERIAL = process.env.STUDIO_NO_SERIAL === "1" && !SIM;
const SMOKE = process.env.STUDIO_SMOKE === "1";
const BLE_ONLY = process.env.STUDIO_BLE_ONLY === "1";   // hides USB ports: tests the Bluetooth link with the cable in
const ICON = path.join(__dirname, "assets", "icon.ico");
const INDEX_HTML = path.join(__dirname, "renderer", "index.html");

let win = null, tray = null, link = null, device = null, bridge = null, autogen = null, winNotify = null;
let micmute = null;   // the `mic toggle` host key: every mic on the PC (services/micmute.js)
let suggest = null, suggestFile = "", suggestSaveTimer = null;   // the quick bar's suggested profile (services/suggest.js)
let manualDisconnect = false, connecting = null, pollTimer = null, currentContext = "global";   // connecting: the connect in flight

function send(type, data) { if (win && !win.isDestroyed()) win.webContents.send("evt", { type, data }); }
const log = (text) => send("log", text);

// URLs to their app; files, folders and app names to the shell's association (ShellExecute, no cmd:
// an & or ^ in a path stays part of the path).
async function openTarget(target) {
  if (openKind(target) === "url") return shell.openExternal(target);
  const err = await shell.openPath(target);
  if (err) throw new Error(err);
}
// Not detached: a detached shell has no console, so console programs it starts (cmd /c, git,
// python ...) open their own and their output never reaches a redirect. Hidden is enough.
function runCommand(cmdline) {
  const c = spawn(cmdline, { shell: true, windowsHide: true, stdio: "ignore" });
  c.on("error", (e) => log(`host: run failed: ${e.message}\n`));
  c.unref();
}

function initServices() {
  const dataDir = process.env.STUDIO_DATA_DIR || (app.isPackaged ? app.getPath("userData") : __dirname);
  store.configure({ dataDir: path.join(dataDir, "data") });
  backup.configure({ dataDir });

  link = new SerialLink({ SerialPort: SIM ? simPort() : NO_SERIAL ? offlinePort() : withBluetooth(BLE_ONLY ? { list: async () => [] } : require("serialport").SerialPort) });
  micmute = new MicMute({ log });
  bridge = new hostbridge.HostBridge({ globalShortcut, open: openTarget, run: runCommand, settings: () => store.load(), log,
    mic: (arg) => micmute.run(arg).then((muted) => log(`mic: ${muted ? "muted" : "on"}\n`)) });
  if (process.platform === "win32" && !SMOKE) micmute.run("get").catch(() => {});   // warm the helper: the first press is instant too
  device = new Device({ link, backup, settings: store, bridge, tileDir: path.join(dataDir, "data", "tiles"), hostName: os.hostname(),
    jpeg: (bgra) => {   // the cover as a few KB of JPEG (the keypad takes up to 16 KB)
      const img = nativeImage.createFromBitmap(bgra, { width: 128, height: 128 });
      const j = img.toJPEG(85);
      return j.length <= 16000 ? j : img.toJPEG(60);
    } });

  for (const ev of ["log", "fs-info", "key", "page", "profile", "ble", "idle", "switch", "panel"]) link.on(ev, (d) => send(ev, d));
  link.on("tx", (t) => send("tx", t));
  link.on("seek", (sec) => feeds.seekNowPlaying(sec));     // tap-to-seek on the keypad's player
  link.on("rx", (t) => send("rx", t));
  link.on("disconnect", () => { suggest.reset(); send("state", device.state()); schedulePoll(); });
  device.on("state", (s) => { send("state", s); pushSuggest(); });   // a connect, a profile change
  device.on("save-state", (s) => send("save-state", s));
  device.on("log", log);
  device.on("bridge", (r) => send("bridge", r));
  // The keypad's Generate button: the app in front gets a profile (cached, else from Claude).
  autogen = new Autogen({ device, link, settings: store, cacheDir: path.join(dataDir, "data", "autogen"), log,
    onSaved: (slot, profile) => send("profile-saved", { slot, profile }) });
  link.on("event", (body) => { if (body === "AUTOGEN") autogen.run(); });

  const s = store.load();
  // Learning: EVT:PROFILE stops counting (auto-switch's picks never count), EVT:SWITCH (the owner,
  // on the keypad) starts it, and each press after it weighs that profile for the app in front.
  suggestFile = path.join(dataDir, "data", "suggest.json");
  suggest = Suggest.load(suggestFile, { halfLifeDays: s.suggest_half_life_days, minWeight: s.suggest_min_weight });
  link.on("profile", (n) => { suggest.profile(n); pushSuggest(); });
  link.on("switch", (e) => suggest.manual(e.slot));
  link.on("key", (e) => {
    if (e.state !== "1") return;
    suggest.key();
    clearTimeout(suggestSaveTimer);
    suggestSaveTimer = setTimeout(() => suggest.save(suggestFile), 2000);
    pushSuggest();
  });
  send("bridge", bridge.apply(s.host_slots));
  startFocusWatch();
  if (s.nowplaying_enabled) startNowPlaying();
  if (s.notifications_enabled) startWinNotify();
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
  if (process.env.STUDIO_SIM_CAL === "0") sim.cal = 0;   // an uncalibrated keypad, for the notice
  return makeSimPort(sim);
}

// One connect at a time: the 3 s search, Find keypad and the reconnect after a flash share it.
function connectOnce(portPath) {
  if (!connecting) connecting = device.connect(portPath).finally(() => { connecting = null; });
  return connecting;
}
// Auto-connect: look for the keypad every 3 s while not connected (unless the user disconnected).
async function tryAutoConnect() {
  if (NO_SERIAL || connecting || manualDisconnect || link.isOpen() || !store.load().auto_connect) return;
  const r = await connectOnce();
  if (r.ok) { log(`Touch Keypad found on ${r.path} (fw ${r.status.ver || "?"}).\n`); send("connected", r); }
}
function schedulePoll() {
  clearInterval(pollTimer);
  if (NO_SERIAL) return;
  pollTimer = setInterval(tryAutoConnect, 3000);
  tryAutoConnect();
}

// The app in front, always: Autogenerate needs it; auto-switch (when on) acts on it.
// The keypad's suggestion slot, for the app in front: sent only when it changes.
function pushSuggest() {
  if (!suggest || !link || !link.isOpen()) return;
  const n = suggest.update(device.activeSlot);
  if (n !== null) device.suggest(n).catch(() => {});
}

function startFocusWatch() {
  activewin.start((proc, title) => {
    autogen.usage.focus(proc, title);
    suggest.focus(appKey(proc));   // learns with auto-switch on or off
    pushSuggest();
    if (!store.load().auto_switch_enabled) return;
    const ctx = appKey(proc);   // a known context (chrome, vscode...) or the process name (generated profiles)
    if (ctx === currentContext) return;
    currentContext = ctx;
    const map = store.load().context_profiles || {};
    const slot = map[ctx] || map.global;
    send("context", { context: ctx, process: proc, slot: slot || null });
    if (slot) device.setActiveProfile(slot);
  });
}
// This PC's notifications to the keypad's bell, banner and shade (Settings › Notifications).
function startWinNotify() {
  if (winNotify || process.platform !== "win32") return;
  winNotify = new WinNotify({ onNote: (n) => device.notify(n), log });
  winNotify.start();
}
function stopWinNotify() {
  if (winNotify) winNotify.stop();
  winNotify = null;
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
  win.webContents.on("will-navigate", (e) => e.preventDefault());   // a dropped file or a link never replaces Studio's page
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
  win.loadFile(INDEX_HTML);
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
    schedulePoll();   // before the tray: nothing cosmetic may stop the keypad search
    try { createTray(); } catch (e) { console.error(`[tray] ${e.message}`); }
    if (SMOKE) setTimeout(() => { console.error("STUDIO_BOOT_FAIL timeout"); smokeExit(1); }, 20000);
  });
}

// Child processes (media helper, window watcher) must go first or Electron won't exit.
function cleanup() {
  clearInterval(pollTimer);
  if (micmute) micmute.stop();
  if (suggest) {
    clearTimeout(suggestSaveTimer);
    suggest.save(suggestFile);
    // ponytail: best effort, the quit may beat it; the keypad forgets suggestions on a reboot anyway
    if (link && link.isOpen()) device.suggest(0).catch(() => {});
  }
  activewin.stop(); feeds.stopNowPlaying();
  if (bridge) bridge.dispose();
  globalShortcut.unregisterAll();
  if (tray) { tray.destroy(); tray = null; }
}
const smokeExit = (code) => { cleanup(); app.exit(code); };
app.on("before-quit", () => { app.isQuitting = true; cleanup(); });
app.on("window-all-closed", () => { if (app.isQuitting || SMOKE) { if (link) link.disconnect(); app.quit(); } });

// ---- IPC --------------------------------------------------------------------
// Every channel answers Studio's own page only (services/guard.js); anything else is refused and logged.
function fromApp(e, ch) {
  const url = e.senderFrame && e.senderFrame.url;
  if (isAppFrame(url, INDEX_HTML)) return true;
  console.error(`[ipc] refused ${ch} from ${url}`);
  return false;
}
function handle(ch, fn) { ipcMain.handle(ch, (e, ...a) => { if (!fromApp(e, ch)) throw new Error(`${ch}: not from Studio`); return fn(e, ...a); }); }
function on(ch, fn) { ipcMain.on(ch, (e, ...a) => { if (fromApp(e, ch)) fn(e, ...a); }); }

on("app:ready", async (_e, info) => {
  if (process.env.STUDIO_SCREENSHOT) {
    await new Promise((r) => setTimeout(r, +process.env.STUDIO_SHOT_DELAY || 3000));
    fs.writeFileSync(process.env.STUDIO_SCREENSHOT, (await win.webContents.capturePage()).toPNG());
  }
  if (!SMOKE) return;
  console.log(`STUDIO_BOOT_OK ${JSON.stringify(info || {})}`);
  setTimeout(() => smokeExit(0), 200);
});

handle("ports:list", () => (NO_SERIAL ? [] : link.listPorts()));
handle("device:connect", async (_e, portPath) => {
  if (NO_SERIAL) return { ok: false, error: "serial disabled (STUDIO_NO_SERIAL)" };
  manualDisconnect = false;
  if (link.isOpen()) return { ok: true, ...device.state() };
  return connectOnce(portPath || undefined);
});
handle("device:disconnect", () => { manualDisconnect = true; device.disconnect(); return true; });
handle("device:state", () => ({ ...device.state(), noSerial: NO_SERIAL, view: process.env.STUDIO_VIEW || null, appVersion: app.getVersion(), smoke: SMOKE }));
handle("device:status", () => device.refreshStatus());
handle("device:fsinfo", () => device.fsinfo());
handle("device:command", (_e, cmd) => link.command(String(cmd)));
handle("device:loadProfile", (_e, slot) => device.loadProfile(slot));
handle("device:peekProfile", (_e, slot) => device.peekProfile(slot));
handle("device:setActive", (_e, slot) => device.setActiveProfile(slot));
handle("device:showPage", (_e, slot, page) => device.showPage(slot, page));
handle("device:save", (_e, slot, profile) => device.save(slot, profile));
on("device:edit", (_e, payload) => device.edit(payload));
handle("device:bleList", () => device.bleList());
handle("device:bleForget", (_e, n) => device.bleForget(n));
handle("device:bleUse", (_e, n) => device.bleUse(n));
handle("device:look", () => device.look());

handle("backup:list", () => { try { return backup.listBackups(); } catch (_) { return []; } });
handle("backup:read", (_e, id) => { try { return { ok: true, profile: schema.repairProfile(backup.readBackup(id)) }; } catch (e) { return { ok: false, error: e.message }; } });
handle("backup:all", async () => {
  if (!link.isOpen()) return { ok: false, error: "not connected" };
  const profiles = {};
  for (let n = 1; n <= schema.NUM_PROFILES; n++) {
    try { profiles[n] = JSON.parse(await link.readFile(`profile${n}.json`)); } catch (_) {}
  }
  return backup.manualBackupAll(profiles);
});

handle("settings:get", () => store.load());
handle("suggest:rows", () => suggest.rows());
handle("suggest:clear", (_e, appId, slot) => { suggest.clear(appId, slot); suggest.save(suggestFile); pushSuggest(); return suggest.rows(); });
handle("settings:set", (_e, patch) => {
  const before = store.load(), s = store.save(patch || {});
  if (before.auto_switch_enabled !== s.auto_switch_enabled) currentContext = "global";   // the next focus change applies
  if (before.nowplaying_enabled !== s.nowplaying_enabled) { if (s.nowplaying_enabled) startNowPlaying(); else feeds.stopNowPlaying(); }
  if (before.notifications_enabled !== s.notifications_enabled) { if (s.notifications_enabled) startWinNotify(); else stopWinNotify(); }
  if (patch && "host_slots" in patch) send("bridge", bridge.apply(s.host_slots));
  if (patch && patch.auto_connect) { manualDisconnect = false; tryAutoConnect(); }
  return s;
});
handle("bridge:state", (_e, profile) => ({
  slots: store.load().host_slots,
  combos: Object.keys(store.load().host_slots).map((s) => hostbridge.comboForSlot(+s)),
  failed: bridge.failed,
  conflicts: profile ? hostbridge.findActionConflicts(profile) : [],
  shared: device.hostConflicts,   // one host slot, two commands, in the keypad's profiles
}));
handle("bridge:test", (_e, slot) => bridge.fire(parseInt(slot, 10)));   // a saved slot only: the page never sends a command line
handle("notify:test", () => device.notify({ app: "Studio", title: "Test notification", body: "Swipe down on the keypad to read it", icon: "bell" }));
handle("contexts:list", () => {
  const known = ["global", ...CONTEXT_MATCH.map(([id]) => id)];
  return [...known, ...Object.keys(store.load().context_profiles || {}).filter((k) => !known.includes(k))];   // + generated apps
});
handle("autogen:run", (_e, force) => autogen.run(!!force));
handle("chat:send", (_e, req) => chat.chatTurn(req));
handle("tiles:put", (_e, list) => device.putTiles(list));
handle("tile:get", (_e, name) => device._tileBytes(String(name)) || null);   // RGB565 for the preview
handle("autogen:state", () => ({ last: autogen.usage.last, minutes: autogen.usage.minutes(), busy: autogen.busy }));

handle("dialog:import", async () => {
  const r = await dialog.showOpenDialog(win, { filters: [{ name: "JSON", extensions: ["json"] }], properties: ["openFile"] });
  if (r.canceled || !r.filePaths[0]) return null;
  try { return { ok: true, profile: schema.repairProfile(JSON.parse(fs.readFileSync(r.filePaths[0], "utf8"))) }; }
  catch (e) { return { ok: false, error: e.message }; }
});
handle("dialog:export", async (_e, profile) => {
  const r = await dialog.showSaveDialog(win, { defaultPath: "profile.json", filters: [{ name: "JSON", extensions: ["json"] }] });
  if (r.canceled || !r.filePath) return null;
  try { fs.writeFileSync(r.filePath, JSON.stringify(schema.repairProfile(profile), null, 2)); return { ok: true, path: r.filePath }; }
  catch (e) { return { ok: false, error: e.message }; }
});
const fwResources = () => (app.isPackaged ? process.resourcesPath : null);
handle("flash:info", () => flasher.info(fwResources()));
// Install firmware: release the port, run esptool, then reconnect to the same port.
handle("flash:run", async () => {
  if (NO_SERIAL) return { ok: false, error: "serial disabled (STUDIO_NO_SERIAL)" };
  const target = await flasher.targetPort(link);   // the live USB link, checked to be the keypad
  if (target.error) return { ok: false, error: target.error };
  const port = target.port;
  await device.flush();   // a pending autosave goes to the keypad first
  manualDisconnect = true;
  device.disconnect();
  await new Promise((r) => setTimeout(r, 400));
  const r = await flasher.flash(port, fwResources(), (p) => send("flash", p));
  log(r.ok ? `Firmware installed on ${port}.\n` : `Firmware install failed: ${r.error}\n${r.log.slice(-1500)}\n`);
  manualDisconnect = false;
  setTimeout(() => { if (!link.isOpen()) connectOnce(port); }, 3500);
  return { ok: r.ok, error: r.error };
});
