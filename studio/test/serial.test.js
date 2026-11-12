"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { SerialLink, parseStatus, parseFsInfo, buildUploadLines, stripCatEcho } = require("../services/serial");
const { SimDevice, makeSimPort } = require("./sim-device");
const tiles = require("../services/tiles");

async function rig(opts = {}) {
  const sim = new SimDevice(opts);
  const link = new SerialLink({ SerialPort: makeSimPort(sim, opts.ports), uploadRate: opts.uploadRate ?? Infinity });
  return { sim, link };
}

test("parsers", () => {
  assert.deepEqual(parseStatus("Profile:1 loaded:1 idle:0 mode:ble ver:3.0.0 model:touch page:2 ble:1"),
    { profile: "1", loaded: "1", idle: "0", mode: "ble", ver: "3.0.0", model: "touch", page: "2", ble: "1" });
  assert.deepEqual(parseFsInfo("FS_INFO:2097152,4096"), { total: 2097152, used: 4096 });
  assert.equal(parseFsInfo("nope"), null);
  assert.deepEqual(buildUploadLines("/profile1.json", { a: 1 }), ["###BEGIN### profile1.json", "{", ' "a": 1', "}", "###END###"]);
  assert.equal(stripCatEcho("cat /x\n{}\n"), "{}");
});

test("line assembly: prompt split across chunks, prompt followed by EVT in one chunk", async () => {
  const link = new SerialLink();
  link.port = { isOpen: true, write: () => {} };
  const keys = [];
  link.on("key", (k) => keys.push(k));
  const p = link.command("status");
  await new Promise((r) => setImmediate(r));
  for (const c of ["Profile:1 mo", "del:touch\nmacro", "pad", ":$", " EVT:KEY 1 2 1\nEVT:PA", "GE 3\n"]) link._feed(c);
  assert.equal(await p, "Profile:1 model:touch");
  assert.deepEqual(keys, [{ page: 1, id: 2, state: "1" }]);
  assert.equal(link._partial, "");
});

test("detect picks the CH340 that reports model:touch", async () => {
  const ports = [{ path: "COM_OTHER", vendorId: "10c4", productId: "ea60" }, { path: "SIM1", vendorId: "1a86", productId: "7523" }];
  const { link } = await rig({ ports });
  const found = await link.detect();
  assert.equal(found.path, "SIM1");
  assert.equal(found.status.model, "touch");
  link.disconnect();
});

test("detect skips a CH340 that is not a Touch Keypad", async () => {
  const { link } = await rig({ model: "s2" });
  const logs = [];
  link.on("log", (t) => logs.push(t));
  assert.equal(await link.detect(), null);
  assert.equal(link.isOpen(), false);
  assert.match(logs.join(""), /did not answer as a Touch Keypad/);
});

test("command queue serializes concurrent commands and attributes replies", async () => {
  const { sim, link } = await rig();
  assert.ok(await link.connect("SIM1"));
  assert.ok(await link.waitReady());
  const [a, b, c] = await Promise.all([link.command("setprofile 2"), link.command("status"), link.command("page 1")]);
  assert.equal(a, "profile 2");
  assert.match(b, /^Profile:2 .*model:touch/);
  assert.equal(c, "page 1");
  assert.deepEqual(sim.received.slice(-3), ["setprofile 2", "status", "page 1"]);
  link.disconnect();
});

test("EVT lines are diverted to events, never into a command's output", async () => {
  const { sim, link } = await rig();
  await link.connect("SIM1");
  sim.files.set("/profile1.json", Buffer.from('{\n "x": 1\n}\n'));
  const keys = [], pages = [], ble = [];
  link.on("key", (k) => keys.push(k));
  link.on("page", (p) => pages.push(p));
  link.on("ble", (b) => ble.push(b));
  const p = link.readFile("profile1.json");
  sim.press(2, 7, "H");          // arrives while cat is in flight
  assert.deepEqual(JSON.parse(await p), { x: 1 });
  sim.event("BLE 1 up");
  sim.event("BLE 1 params 15.00 ms latency 30");   // not a link change
  sim.event("BLE pair open");
  assert.equal(await link.command("page 1"), "page 1");   // the page command also emits EVT:PAGE 1
  assert.deepEqual(keys, [{ page: 2, id: 7, state: "H" }]);
  assert.deepEqual(pages, [1]);
  assert.deepEqual(ble, [{ slot: 1, up: true }]);
  link.disconnect();
});

test("JSON upload: SAVED reply resolves ok; invalid JSON is rejected", async () => {
  const { sim, link } = await rig();
  await link.connect("SIM1");
  const r = await link.uploadJson("profile3.json", { schema_version: 2, text: "a\nb" });
  assert.equal(r.ok, true);
  assert.match(r.reply, /^SAVED profile3\.json \d+/);
  assert.deepEqual(JSON.parse(sim.files.get("/profile3.json")), { schema_version: 2, text: "a\nb" });
  // a broken upload (raw lines) is rejected by the device and reported as not ok
  const bad = await link._upload("x.json", ["###BEGIN### x.json", "{ broken", "###END###"]);
  assert.equal(bad.ok, false);
  assert.match(bad.reply, /rejected/);
  link.disconnect();
});

test("binary upload with paced lines round-trips and is CRC-checked", async () => {
  const { sim, link } = await rig({ uploadRate: 200000 });
  await link.connect("SIM1");
  const buf = Buffer.alloc(tiles.TILE_BYTES);
  for (let i = 0; i < buf.length; i++) buf[i] = (i * 31) & 255;
  const name = tiles.tileName(buf);
  const r = await link.uploadBinary(tiles.tilePath(name), buf);
  assert.equal(r.ok, true, r.reply);
  assert.deepEqual(sim.files.get(`/t/${name}.565`), buf);
  // corrupt one line -> CRC mismatch is reported
  const lines = tiles.buildBinaryUploadLines("/t/deadbeef.565", buf);
  lines[3] = lines[3].replace(/^./, (c) => (c === "A" ? "B" : "A"));
  const bad = await link._upload("bad", lines);
  assert.equal(bad.ok, false);
  assert.match(bad.reply, /crc mismatch/);
  link.disconnect();
});

test("commands time out cleanly and offline commands resolve empty", async () => {
  const { sim, link } = await rig();
  assert.equal(await link.command("status"), "");   // not connected
  await link.connect("SIM1");
  sim.line = () => {};                                // device goes silent
  const t0 = Date.now();
  assert.equal(await link.command("status", 150), "");
  assert.ok(Date.now() - t0 >= 140);
  link.disconnect();
});

test("a reply that arrives after its command timed out never answers the next command", async () => {
  const { EventEmitter } = require("events");
  class SlowPort extends EventEmitter {   // profile 4 answers after 300 ms (a slow Bluetooth read), the rest after 60 ms
    constructor(_o, cb) { super(); this.isOpen = true; setImmediate(() => cb(null)); }
    static async list() { return []; }
    set() {} close() {}
    write(d, cb) {
      if (cb) cb();
      const cmd = String(d).trim(), m = cmd.match(/^cat \/profile(\d+)\.json$/);
      setTimeout(() => this.emit("data", Buffer.from(`${m ? `{"profile_name":"P${m[1]}"}` : `ok ${cmd}`}\nmacropad:$ `)), m && m[1] === "4" ? 300 : 60);
    }
  }
  const link = new SerialLink({ SerialPort: SlowPort });
  await link.connect("X");
  assert.equal(await link.command("cat /profile4.json", 200), "");   // timed out
  assert.equal(await link.command("cat /profile5.json", 200), '{"profile_name":"P5"}');
  assert.equal(await link.command("cat /profile6.json", 200), '{"profile_name":"P6"}');
});

test("a UTF-8 character split across two chunks arrives whole", async () => {
  const { EventEmitter } = require("events");
  let port;
  class P extends EventEmitter {
    constructor(_o, cb) { super(); port = this; this.isOpen = true; setImmediate(() => cb(null)); }
    static async list() { return []; }
    write(_d, cb) { if (cb) cb(); } set() {} close() {}
  }
  const link = new SerialLink({ SerialPort: P });
  await link.connect("X");
  const reply = link.command("cat /note.txt");
  await new Promise((r) => setImmediate(r));
  const bytes = Buffer.from("Café ☕\nmacropad:$ ", "utf8");
  for (const [a, b] of [[0, 4], [4, 7], [7, bytes.length]]) port.emit("data", bytes.subarray(a, b));   // splits é and ☕
  assert.equal(await reply, "Café ☕");
});

test("two connects at once share one open: no orphaned port holds the COM port", async () => {
  const { EventEmitter } = require("events");
  let held = null;
  class OnePort extends EventEmitter {   // like Windows: a second open of a held port is denied
    constructor(_o, cb) { super(); this.isOpen = false; setTimeout(() => { if (held) return cb(new Error("Access denied")); held = this; this.isOpen = true; cb(null); }, 30); }
    static async list() { return []; }
    write(_d, cb) { if (cb) cb(); } set() {}
    close() { this.isOpen = false; if (held === this) held = null; }
  }
  const link = new SerialLink({ SerialPort: OnePort });
  const [a, b] = await Promise.all([link.connect("COM5"), link.connect("COM5")]);
  assert.deepEqual([a, b, link.isOpen()], [true, true, true]);
  assert.equal(link.port, held, "the link holds the one open port");
  link.disconnect();
  assert.equal(held, null);
  assert.equal(await link.connect("COM5"), true);
});

test("firmware installs only on a live USB link that answers model:touch", async () => {
  const { targetPort } = require("../services/flasher");
  const { BLE_PATH } = require("../services/bleport");
  const { link } = await rig();
  assert.match((await targetPort(link)).error, /USB cable/);           // never connected
  await link.connect("SIM1");
  assert.deepEqual(await targetPort(link), { port: "SIM1" });
  link.disconnect();
  assert.match((await targetPort(link)).error, /USB cable/, "a stale path is never used");
  const other = await rig({ model: "s2" });
  await other.link.connect("SIM1");
  assert.match((await targetPort(other.link)).error, /did not answer as a Touch Keypad/);
  const ble = await rig({ ports: [{ path: BLE_PATH }, { path: "SIM1", vendorId: "1a86", productId: "7523" }] });
  await ble.link.connect(BLE_PATH);
  assert.match((await targetPort(ble.link)).error, /Bluetooth/, "never a guessed CH340 port");
});

test("a dropped port releases the in-flight command", async () => {
  const { sim, link } = await rig();
  await link.connect("SIM1");
  sim.line = () => {};
  const p = link.command("status", 5000);
  let disc = false;
  link.on("disconnect", () => { disc = true; });
  await new Promise((r) => setImmediate(r));          // let the queued command start
  link.port.close();
  assert.equal(await p, "");
  assert.equal(disc, true);
});

test("SWITCH, PANEL and PKEY events", async () => {
  const { sim, link } = await rig(); await link.connect("SIM1");
  const got = [];
  for (const ev of ["switch", "panel", "pkey"]) link.on(ev, (e) => got.push([ev, e]));
  sim.event("SWITCH 13 suggest"); sim.event("PANEL 3 8 2"); sim.event("PKEY 8 2 15 1"); sim.event("PANEL 0");
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(got, [["switch", { slot: 13, how: "suggest" }], ["panel", { btn: 3, profile: 8, page: 2 }],
    ["pkey", { profile: 8, page: 2, id: 15, state: "1" }], ["panel", { btn: 0, profile: 0, page: 0 }]]);
});

test("Device quickbar round trip and suggest against the sim", async () => {
  const fs = require("fs"), os = require("os"), path = require("path");
  const { Device } = require("../services/device");
  const backup = require("../services/backup");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qb-"));
  backup.configure({ dataDir: dir });
  const { sim, link } = await rig(); await link.connect("SIM1");
  const store = { load: () => ({ baud: 921600, settime_enabled: false, host_slots: {}, context_profiles: {} }), save: () => {} };
  const device = new Device({ link, backup, settings: store, tileDir: path.join(dir, "tiles") });
  assert.deepEqual(await device.getQuickbar(), [null, null, null, null]);
  const qb = [{ profile: 8, page: 2, icon: "git-branch", label: "Git" }, null, null, null];
  assert.deepEqual(await device.setQuickbar(qb), { ok: true });
  assert.deepEqual(await device.getQuickbar(), qb);
  assert.equal((await device.setQuickbar([1, 2])).ok, false);
  await device.suggest(13);
  assert.equal(sim.suggested, 13);
  // Autosave writes it like a profile: the bar it replaces goes to a PC backup first, then the keypad.
  const bar = [null, { profile: 2, page: 1, icon: "", label: "Code" }, null, null];
  assert.deepEqual(await device.saveQuickbar(bar), { ok: true });
  assert.deepEqual(sim.quickbar, bar);
  const saved = fs.readdirSync(path.join(dir, "device_backups", "auto", "quickbar"));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, "device_backups", "auto", "quickbar", saved[0]), "utf8")), qb);
  // Final review: a bar Studio could not read is never written over (the editor's draft of it is empty).
  const read = device.getQuickbar; device.getQuickbar = async () => null;
  assert.equal((await device.saveQuickbar([null, null, null, null])).ok, false);
  device.getQuickbar = read;
  assert.deepEqual(sim.quickbar, bar);
  assert.ok(backup.listBackups().every((b) => Number.isInteger(b.slot)), "never offered as a profile backup");
});


test("uploads send ###SYNC### every 4 KB and wait for the ACK", async () => {
  const { sim, link } = await rig(); await link.connect("SIM1");
  const big = { pages: Array.from({ length: 12 }, (_, i) => ({ name: `p${i}`, text: "x".repeat(1500) })) };
  const r = await link.uploadJson("big.json", big);
  assert.equal(r.ok, true, r.reply);
  assert.ok(sim.syncs >= 3, `syncs ${sim.syncs}`);
  assert.ok(sim.maxUnsynced <= 4096 + 1600, `unsynced ${sim.maxUnsynced}`);
  assert.equal(sim.linesWhileWaiting || 0, 0);
  assert.deepEqual(JSON.parse(sim.files.get("/big.json").toString()), big);
});

test("the cover goes as a JPEG to ram:artj when Studio has an encoder", async () => {
  const fs = require("fs"), os = require("os"), path = require("path");
  const { Device } = require("../services/device");
  const backup = require("../services/backup");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "art-"));
  backup.configure({ dataDir: dir });
  const { sim, link } = await rig(); await link.connect("SIM1");
  const store = { load: () => ({ baud: 921600, settime_enabled: false, host_slots: {}, context_profiles: {}, art_enabled: true }), save: () => {} };
  let got = null;
  const device = new Device({ link, backup, settings: store, tileDir: path.join(dir, "tiles"), jpeg: (bgra) => { got = bgra; return Buffer.from("JPEG!"); } });
  const bmp = Buffer.alloc(54 + 128 * 384);
  bmp.write("BM", 0, "latin1"); bmp.writeUInt32LE(54, 10); bmp.writeInt32LE(128, 18); bmp.writeInt32LE(128, 22); bmp.writeUInt16LE(24, 28);
  bmp[54] = 10; bmp[55] = 20; bmp[56] = 30;                      // bottom-left pixel: B G R
  assert.equal(await device.art(bmp, "t|a|b"), true);
  assert.equal((sim.files.get("ram:artj") || sim.files.get("/ram:artj")).toString(), "JPEG!");   // the sim keeps binary paths as sent
  assert.equal(got.length, 128 * 128 * 4);
  assert.deepEqual([...got.subarray(127 * 512, 127 * 512 + 4)], [10, 20, 30, 255]);   // top-down: the last row
});
