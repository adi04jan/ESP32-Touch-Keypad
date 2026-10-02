/* Studio end to end, through the INSTALLED app and the real keypad.
 *
 *   node tools/e2e/studio_e2e.js
 *
 * Launches the installed Macropad Studio Touch with a DevTools port and drives
 * its real UI (clicks, keys, inputs) while the keypad is on USB and paired to
 * this PC over Bluetooth. Every action goes UI -> Studio -> USB -> keypad, and
 * is checked on the keypad through Studio's own serial link (window.api),
 * on this PC (typed text in KpHelper's window, a silent media session, a file
 * a host action writes), and on screen (DevTools screenshots).
 *
 * Edits only scratch slot 8 and restores the keypad's theme, LED, brightness,
 * click and active profile. Studio runs with a throwaway data folder, so the
 * installed app's own settings stay untouched. Keystrokes go only to
 * KpHelper's focused window; the one media key goes only to KpHelper's silent
 * session (checked first). Leaves the Bluetooth pairing alone.
 */
"use strict";
const { spawn, execSync, execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const EXE = process.env.STUDIO_EXE || path.join(process.env.LOCALAPPDATA, "Programs", "touch-keypad-studio", "Macropad Studio Touch.exe");
const HELPER = path.join(__dirname, "bin", "KpHelper.exe");
const OUT = path.join(__dirname, "..", "..", "build", "studio-e2e");
const PORT = 9223, SLOT = 8;
const TYPED = path.join(OUT, "typed.txt"), HOST_FILE = path.join(OUT, "host-ok.txt");
const STATE_PY = path.join(__dirname, "keypad_state.py"), STATE_FILE = path.join(OUT, "keypad-before.json");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(what, fn, ms = 10000, every = 150) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < ms) { try { last = await fn(); if (last) return last; } catch (e) { last = e.message; } await sleep(every); }
  throw new Error(`timed out: ${what}${last !== undefined && last !== false ? ` (last: ${String(last).slice(0, 160)})` : ""}`);
}
const log = (s) => console.log(`[studio-e2e ${new Date().toTimeString().slice(0, 8)}] ${s}`);

// ---------------------------------------------------------------- DevTools
class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.wait = new Map(); ws.onmessage = (m) => { const d = JSON.parse(m.data); const w = this.wait.get(d.id); if (w) { this.wait.delete(d.id); d.error ? w.no(new Error(d.error.message)) : w.ok(d.result); } }; }
  send(method, params = {}) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params })); return new Promise((ok, no) => this.wait.set(id, { ok, no })); }
  async ev(expression) {
    const r = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
    return r.result.value;
  }
}
async function connectCdp() {
  const target = await until("Studio's DevTools page", async () => {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    return list.find((t) => t.type === "page" && /index\.html/.test(t.url));
  }, 30000, 500);
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no; });
  return new Cdp(ws);
}

let cdp, studio, typing = null, media = null;
const mediaLines = [];
const run = (fn, ...args) => cdp.ev(`(${fn})(...${JSON.stringify(args)})`);   // a function, run in Studio's renderer
const cmd = (c) => run(async (c) => api.command(c), c);
const click = (sel) => run((sel) => { const el = document.querySelector(sel); if (!el) throw new Error(`no ${sel}`); if (el.disabled) throw new Error(`${sel} is disabled`); el.click(); return true; }, sel);
const setInput = (sel, v, type = "input") => run((sel, v, type) => { const el = document.querySelector(sel); if (!el) throw new Error(`no ${sel}`); el.value = v; el.dispatchEvent(new Event(type, { bubbles: true })); return true; }, sel, v, type);
const key = (k, mods = {}) => run((k, m) => { document.body.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, ...m })); return true; }, k, mods);
const text = (sel) => run((sel) => { const el = document.querySelector(sel); return el ? el.textContent : ""; }, sel);
const view = (v) => click(`.rail2 [data-view="${v}"]`).then(() => sleep(v === "device" ? 1500 : 400));
async function shot(name) { const r = await cdp.send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(r.data, "base64")); }
const readCat = (n) => cmd(`cat /profile${n}.json`).then((r) => { const t = r.trim().split("\n").filter((l) => !l.startsWith("cat ")).join("\n"); try { return JSON.parse(t); } catch (_) { return null; } });
const statusOf = async () => Object.fromEntries((await cmd("status")).trim().split(/\s+/).map((kv) => kv.split(":")));
const keyOf = async (page, i) => { const p = await readCat(SLOT); return p && p.pages[page] ? p.pages[page].keys[i] : undefined; };

function helperProc(args, onLine) {
  const p = spawn(HELPER, args, { stdio: ["pipe", "pipe", "pipe"] });
  let buf = "";
  p.stdout.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (l) onLine(l); } });
  return p;
}
const typed = () => (fs.existsSync(TYPED) ? fs.readFileSync(TYPED, "utf8") : "");

// ---------------------------------------------------------------- tests
let before, saved;   // the keypad's state before the run (saved over USB), put back after
const T = [];
const test = (name, fn) => T.push([name, fn]);

test("installed Studio boots and finds the keypad on USB", async () => {
  const pill = await until("connection pill", async () => { const t = await text("#conn-pill"); return /Touch Keypad/.test(t) && /fw 3\.2/.test(t) && t; }, 30000);
  if (!/COM\d+/.test(pill)) throw new Error(`no port in "${pill}"`);
  log(`keypad: profile ${before.Profile}, theme ${before.theme}, ble ${before.ble}, cal ${before.cal}`);
});

test("slot strip names every profile and marks empty slots", async () => {
  const strip = await until("profile names", async () => { const t = await text("#st-slots"); return /Empty/.test(t) && t; }, 15000);
  for (const name of ["Daily", "Code", "Stream"]) if (!strip.includes(name)) throw new Error(`"${name}" missing in "${strip}"`);
  if (!strip.includes(`${SLOT} · Empty`)) throw new Error(`slot ${SLOT} not empty: "${strip}"`);
});

test("the preview shows the keypad's own theme", async () => {
  const th = await until("preview theme", async () => run(() => document.querySelector("#st-screen .dev").dataset.theme));
  if (th !== before.theme) throw new Error(`preview ${th}, keypad ${before.theme}`);
  await shot("01-editor");
});

test("Device view: the theme picker sets the keypad's theme", async () => {
  await view("device");
  await click('[data-theme-set="aurora"]');
  await until("keypad theme aurora", async () => (await cmd("theme")).includes("theme aurora"));
  await sleep(600);
  await click(`[data-theme-set="${before.theme}"]`);
  await until(`keypad theme ${before.theme}`, async () => (await cmd("theme")).includes(`theme ${before.theme}`));
  await shot("02-device");
});

test("Device view: LED pattern, colour and brightness reach the keypad", async () => {
  await click('[data-led="breathe"]');
  await until("led breathe", async () => (await cmd("led")).startsWith("led breathe"));
  await sleep(500);
  await click('[data-ledc="255 95 87"]');
  await until("breathe in red", async () => (await cmd("led")).includes("color 255 95 87"));
  await sleep(500);
  await setInput("#d-ledb", "90", "change");
  await until("led brightness 90", async () => (await cmd("ledbright")).includes("ledbright 90"));
  await sleep(500);
  await cmd(`led ${saved.led} ${saved.led_color}`);
  await cmd(`ledbright ${saved.led_bright}`);
});

test("Device view: screen brightness and key click reach the keypad", async () => {
  await view("device");
  await setInput("#d-bright", "120", "change");
  await until("brightness 120", async () => (await cmd("setbrightness")).includes("brightness 120"));
  await sleep(500);
  await run(() => { const c = document.querySelector("#d-click"); c.checked = !c.checked; c.dispatchEvent(new Event("change", { bubbles: true })); return true; });
  await until("click toggled", async () => (await cmd("click")).includes(before.click ? "off" : "on"));
  await cmd(`setbrightness ${saved.bright}`);
  await cmd(`click ${before.click ? "on" : "off"}`);
});

test(`Editor: create a key in empty slot ${SLOT}; autosave writes it to the keypad`, async () => {
  await view("editor");
  await click(`[data-stslot="${SLOT}"]`);
  await until(`keypad on profile ${SLOT}`, async () => (await statusOf()).Profile === String(SLOT), 8000);
  await until("empty key inspector", async () => run(() => !!document.querySelector("#mk-key")));
  await click("#mk-key");
  await until("key inspector", async () => run(() => !!document.querySelector("#k-name")));
  await setInput("#k-name", "E2E key");
  await setInput("#k-add", "text", "change");
  await sleep(200);
  await click('[data-del="0"]');                      // drop the default F13 action, keep the text action
  await setInput('[data-af="0"]', "e2e-studio-ok ");
  await click('[data-ic="rocket"]');
  const k = await until("key written to the keypad", async () => { const k = await keyOf(0, 0); return k && k.name === "E2E key" && k.icon === "rocket" && k; }, 12000, 500);
  if (k.actions.length !== 1 || k.actions[0].value !== "e2e-studio-ok ") throw new Error(JSON.stringify(k));
  await until("slot strip no longer says Empty", async () => !(await text("#st-slots")).includes(`${SLOT} · Empty`), 5000);
  await shot("03-key");
});

test("a tap on the keypad flashes in Studio and types over Bluetooth", async () => {
  if (before.ble !== "1") throw new Error("no Bluetooth host connected: pair this PC first");
  fs.rmSync(TYPED, { force: true });
  typing = helperProc(["window", TYPED, "300"], () => {});
  await sleep(2500);                                   // the window takes focus
  for (let i = 0; i < 4 && !typed().includes("e2e-studio-ok"); i++) { await cmd("touch 48 70 80"); await sleep(2500); }
  if (!typed().includes("e2e-studio-ok")) throw new Error(`typed: ${JSON.stringify(typed())}`);
  if (!/EVT:KEY 1 1 1/.test(await text("#st-log"))) throw new Error("Studio's console never saw EVT:KEY 1 1 1");
});

test("Editor keyboard: Ctrl+Z undoes, Ctrl+Y redoes, both saved to the keypad", async () => {
  await click('#st-screen [data-k="0"]');
  await setInput("#k-name", "Renamed");
  await until("rename saved", async () => ((await keyOf(0, 0)) || {}).name === "Renamed", 12000, 500);
  await run(() => { document.activeElement.blur(); return true; });
  await key("z", { ctrlKey: true });
  await until("undo saved", async () => ((await keyOf(0, 0)) || {}).name === "E2E key", 12000, 500);
  await key("y", { ctrlKey: true });
  await until("redo saved", async () => ((await keyOf(0, 0)) || {}).name === "Renamed", 12000, 500);
});

test("Editor keyboard: copy a key, arrow right, paste, Delete", async () => {
  await click('#st-screen [data-k="0"]');
  await key("c", { ctrlKey: true });
  await key("ArrowRight");
  await key("v", { ctrlKey: true });
  const k = await until("pasted key saved", async () => { const k = await keyOf(0, 1); return k && k.name === "Renamed" && k; }, 12000, 500);
  if (k.id !== 2) throw new Error(`pasted id ${k.id}`);
  await key("Delete");
  await until("cleared key saved", async () => (await keyOf(0, 1)) === null, 12000, 500);
});

test("Editor: a host action key runs on this PC through the installed Studio", async () => {
  fs.rmSync(HOST_FILE, { force: true });
  await click('#st-screen [data-k="2"]');
  await click("#mk-key");
  await until("key inspector", async () => run(() => !!document.querySelector("#k-name")));
  await setInput("#k-name", "Host");
  await setInput("#k-add", "host", "change");
  await sleep(200);
  await click('[data-del="0"]');
  await setInput('[data-af="0"]', `run cmd /c echo host-ok> "${HOST_FILE}"`);
  await until("host key saved with a slot", async () => { const k = await keyOf(0, 2); return k && k.actions[0].type === "host" && Number.isInteger(k.actions[0].slot); }, 12000, 500);
  await sleep(1500);                                   // the bridge registers the reserved combo
  const quiet = typed();
  await cmd("touch 240 70 80");
  try {
    await until("the host command ran", async () => fs.existsSync(HOST_FILE) && fs.readFileSync(HOST_FILE, "utf8").includes("host-ok"), 10000, 300);
  } catch (e) {
    const br = await run(async () => JSON.stringify(await api.bridgeState(prof())));
    const tail = (await text("#st-log")).slice(-900);
    throw new Error(`${e.message}; bridge ${br}; console tail ${JSON.stringify(tail)}`);
  }
  await sleep(500);
  if (typed() !== quiet) throw new Error(`the combo leaked into the window: ${JSON.stringify(typed().slice(quiet.length))}`);
});

test("Editor: a new page turned into the media player", async () => {
  await click("[data-addpage]");
  await until("page 2 selected", async () => run(() => state.page === 1));
  await click('#st-screen [data-k="1"]');
  await run(() => { window.confirm = () => true; return true; });
  await click("#mk-np");
  await until("player page saved", async () => ((await keyOf(1, 0)) || {}).widget === "media", 12000, 500);
  await shot("04-player-page");
});

test("Music: the PC's media session reaches Studio and the keypad", async () => {
  await cmd("page 2");
  media = helperProc(["media", "150", "Studio E2E Track"], (l) => mediaLines.push(l));
  await until("helper session", async () => mediaLines.some((l) => l.startsWith("CURRENT")), 15000);
  const np = await until("Studio's now playing", async () => run(() => state.np && state.np.title === "Studio E2E Track" && state.np), 20000, 300);
  if (np.album !== "E2E Album" || np.artist !== "Keypad Test") throw new Error(JSON.stringify(np));
  await until("album art in Studio", async () => run(() => !!state.art), 20000, 300);
  await shot("05-studio-player");
});

test("Music: tap-to-seek on the keypad moves the PC's track", async () => {
  await sleep(1500);
  await cmd("touch 388 153 80");                       // 75% along the seek bar
  await until("session near 75%", async () => mediaLines.some((l) => { const m = l.match(/^POS (\d+)/); return m && +m[1] >= 170 && +m[1] <= 190; }), 10000, 200);
});

test("Music: Play/Pause on the keypad pauses and resumes the PC's player over Bluetooth", async () => {
  const cur = mediaLines.find((l) => l.startsWith("CURRENT")) || "";
  if (!cur.includes("KpHelper")) throw new Error(`media keys would go to ${cur}, not the test session`);
  const n0 = mediaLines.length;
  await cmd("touch 274 248 80");
  await until("paused", async () => mediaLines.slice(n0).includes("STATE Paused"), 6000);
  const n1 = mediaLines.length;
  await cmd("touch 274 248 80");
  await until("playing", async () => mediaLines.slice(n1).includes("STATE Playing"), 6000);
});

test("Device view: Studio installs its bundled firmware and everything survives", async () => {
  await view("device");
  if (!/Installs firmware 3\.\d+\.\d+/.test(await text("#device-pane"))) throw new Error("no bundled firmware offered");
  await run(() => { window.confirm = () => true; return true; });
  await click("#d-flash");
  await until("installed", async () => /Installed/.test(await text("#flash-msg")), 120000, 1000);
  await until("reconnected", async () => (await run(() => state.conn.connected)) && /fw 3\.2/.test(await text("#conn-pill")), 40000, 1000);
  const s = await statusOf();
  if (s.cal !== before.cal) throw new Error(`calibration changed: ${s.cal}`);
  if (((await keyOf(0, 0)) || {}).name !== "Renamed") throw new Error(`slot ${SLOT} lost`);
  await shot("06-after-install");
});

test("Device view: back up all profiles writes them to this PC", async () => {
  await view("device");
  await click("#b-all");
  const m = await until("backup line", async () => (await text("#st-log")).match(/Backed up (\d+) profiles to (.+?\.json|[^\s]+)/), 15000, 300);
  if (+m[1] < 4) throw new Error(`only ${m[1]} profiles`);
});

// ---------------------------------------------------------------- run
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  if (!fs.existsSync(EXE)) { console.error(`Studio is not installed at ${EXE}`); process.exit(2); }
  // the keypad's state, saved over USB before Studio owns the port and put back after it quits
  saved = JSON.parse(execFileSync("python", [STATE_PY, "save", STATE_FILE, "--free-slot", String(SLOT)], { encoding: "utf8" }).trim().split("\n").pop());
  before = Object.fromEntries(saved.status.trim().split(/\s+/).map((kv) => kv.split(":")));
  before.click = saved.click;
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "studio-e2e-"));
  studio = spawn(EXE, [`--remote-debugging-port=${PORT}`], { env: { ...process.env, STUDIO_DATA_DIR: data }, stdio: "ignore" });
  const results = [];
  try {
    cdp = await connectCdp();
    const only = process.env.E2E_ONLY && new RegExp(process.env.E2E_ONLY, "i");   // rerun a few: E2E_ONLY="slot 8|host"
    for (const [name, fn] of T.filter(([n], i) => !only || i === 0 || only.test(n))) {
      const t0 = Date.now();
      try { await fn(); results.push([true, name]); log(`PASS ${name} (${Date.now() - t0} ms)`); }
      catch (e) { results.push([false, name, e.message]); log(`FAIL ${name}: ${e.message}`); try { await shot(`fail-${results.length}`); } catch (_) {} }
    }
  } catch (e) { log(`ABORT: ${e.message}`); results.push([false, "harness", e.message]); }
  for (const p of [typing, media]) if (p) try { p.kill(); } catch (_) {}
  try { execSync(`taskkill /PID ${studio.pid} /T /F`, { stdio: "ignore" }); } catch (_) {}
  await sleep(1500);   // Windows releases the COM port
  try { log(`restored: ${execFileSync("python", [STATE_PY, "restore", STATE_FILE], { encoding: "utf8" }).trim()}`); }
  catch (e) { log(`RESTORE FAILED: ${e.message}`); }
  const failed = results.filter((r) => !r[0]);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  for (const f of failed) console.log(`  FAIL ${f[1]}: ${f[2]}`);
  fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 1));
  process.exit(failed.length ? 1 : 0);
})();
