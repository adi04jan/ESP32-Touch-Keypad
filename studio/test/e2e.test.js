/* E2E over the main-process services (no UI): Device + SerialLink + backup +
 * host bridge against the simulated keypad. Uses the real 300 ms / 1500 ms timings. */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { SerialLink } = require("../services/serial");
const { Device } = require("../services/device");
const backup = require("../services/backup");
const schema = require("../services/schema");
const hb = require("../services/hostbridge");
const { SimDevice, makeSimPort } = require("./sim-device");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 4000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error("timed out waiting"); await sleep(20); } };

function rig() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tk-studio-"));
  backup.configure({ dataDir: dir });
  const sim = new SimDevice();
  const link = new SerialLink({ SerialPort: makeSimPort(sim), uploadRate: Infinity });
  let settings = { baud: 921600, settime_enabled: true, host_slots: {} };
  const store = { load: () => ({ ...settings }), save: (p) => (settings = { ...settings, ...p }) };
  const reg = new Map();
  const bridge = new hb.HostBridge({ globalShortcut: { register: (a, f) => (reg.set(a, f), true), unregister: (a) => reg.delete(a) }, open: async () => {}, run: async () => {} });
  const dev = new Device({ link, backup, settings: store, bridge, tileDir: path.join(dir, "tiles") });
  return { dir, sim, link, dev, store, reg };
}
const solid = (rgb) => { const a = new Uint8Array(72 * 72 * 4); for (let i = 0; i < 72 * 72; i++) a.set([...rgb, 255], i * 4); return a; };

test("create a key, live push, autosave with backup, read back with cat", async () => {
  const { dir, sim, link, dev, store, reg } = rig();
  const r = await dev.connect();                    // auto-detect: CH340 + model:touch
  assert.equal(r.ok, true);
  assert.equal(r.path, "SIM1");
  assert.ok(sim.time && Math.abs(sim.time.epoch - Date.now() / 1000) < 5, "settime sent on connect");

  // Create a key in an empty cell with a rendered tile and a host action.
  const profile = schema.blankProfile("Daily");
  const tile = await dev.putTile(solid([47, 107, 79]));
  assert.ok(sim.files.has(`/t/${tile}.565`), "tile uploaded with ###BEGINB###");
  profile.pages[0].keys[2] = { id: 3, name: "Copy", icon: "copy", led_color: [47, 107, 79], tile,
    actions: [{ type: "keycombo", keys: ["CTRL", "C"] }], hold_actions: [{ type: "host", cmd: "open https://github.com" }] };

  const saved = new Promise((res) => dev.on("save-state", (s) => s.state === "saved" && res(s)));
  const t0 = Date.now();
  dev.edit({ slot: 1, profile, page: 1, keyId: 3, kinds: ["actions", "hold", "face", "title"] });

  await sleep(200);
  assert.equal(sim.received.some((l) => l.startsWith("setkey")), false, "push is debounced (300 ms)");
  await until(() => sim.received.some((l) => l.startsWith("title 3")));
  assert.ok(Date.now() - t0 >= 290);
  assert.ok(sim.received.includes('setkey 3 [{"type":"keycombo","keys":["LEFT_CTRL","C"]}]'));
  assert.ok(sim.received.includes(`setface 3 ${tile} 47 107 79`));
  assert.ok(sim.received.some((l) => /^sethold 3 \[\{"type":"host","cmd":"open https:\/\/github.com"/.test(l)));
  assert.deepEqual(sim.doc.pages[0].keys[2].actions, [{ type: "keycombo", keys: ["LEFT_CTRL", "C"] }]);
  assert.equal(sim.files.has("/profile1.json"), false, "autosave waits 1500 ms");

  await saved;
  assert.ok(Date.now() - t0 >= 1490);
  // Read back exactly as the device stored it.
  const back = JSON.parse(await link.readFile("profile1.json"));
  assert.equal(back.pages[0].keys[2].name, "Copy");
  assert.equal(back.pages[0].keys[2].tile, tile);
  assert.deepEqual(back.pages[0].keys[2].hold_actions, [{ type: "host", cmd: "open https://github.com", slot: 0 }]);
  assert.deepEqual(schema.validateProfile(back).errors, []);
  assert.ok(sim.files.has(`/t/${tile}.565`), "referenced tile survives the device's tile GC");
  // Host slot persisted and its combo registered.
  assert.deepEqual(store.load().host_slots, { 0: "open https://github.com" });
  assert.ok(reg.has("Control+Alt+Shift+F13"));
  // A PC backup was written before the device write.
  const bdir = path.join(dir, "device_backups", "auto", "profile1");
  const files = fs.readdirSync(bdir);
  assert.equal(files.length, 1);
  assert.match(files[0], /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.json$/);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(bdir, files[0]), "utf8")), back);
  link.disconnect();
});

test("rapid edits coalesce into one push per key and one upload", async () => {
  const { sim, link, dev } = rig();
  dev.pushMs = 60; dev.saveMs = 150;
  await dev.connect("SIM1");
  const profile = schema.blankProfile();
  profile.pages[0].keys[0] = { id: 1, name: "", led_color: [1, 2, 3], actions: [] };
  for (const name of ["G", "Gi", "Git", "Git s", "Git status"]) {
    profile.pages[0].keys[0].name = name;
    profile.pages[0].keys[0].actions = [{ type: "text", value: name }];
    dev.edit({ slot: 1, profile, page: 1, keyId: 1, kinds: name.length < 4 ? ["title"] : ["actions"] });
    await sleep(10);
  }
  await until(() => sim.files.has("/profile1.json"));
  await sleep(50);
  assert.equal(sim.received.filter((l) => l.startsWith("setkey")).length, 1);
  assert.equal(sim.received.filter((l) => l.startsWith("title")).length, 1, "title kind from early edits still flushed once");
  assert.ok(sim.received.includes("title 1 Git status"));
  assert.equal(sim.received.filter((l) => l.startsWith("###BEGIN### profile1.json")).length, 1);
  link.disconnect();
});

test("live push targets the right page and skips profiles not active on the device", async () => {
  const { sim, link, dev } = rig();
  await dev.connect("SIM1");
  const p = schema.blankProfile();
  p.pages.push({ name: "Two", keys: Array(15).fill(null) });
  p.pages[1].keys[4] = { id: 5, name: "Next", led_color: [1, 2, 3], actions: [{ type: "media", value: "NEXT" }] };
  await dev.save(1, p);
  await dev.push(1, 2, 5, new Set(["actions"]));
  const i = sim.received.indexOf("page 2");
  assert.ok(i >= 0 && sim.received[i + 1].startsWith("setkey 5"));
  assert.equal(sim.page, 2);
  sim.received.length = 0;
  assert.equal(await dev.push(3, 1, 1, new Set(["actions"])), false);   // slot 3 isn't active
  assert.deepEqual(sim.received, []);
  link.disconnect();
});

test("invalid profiles are not written; offline saves still back up", async () => {
  const { dir, sim, link, dev } = rig();
  const p = schema.blankProfile();
  p.pages[0].keys[0] = { id: 1, name: "x", led_color: [1, 2, 3], actions: [{ type: "text", value: "y".repeat(4096) }] };
  for (let i = 1; i < 15; i++) p.pages[0].keys[i] = { ...p.pages[0].keys[0], id: i + 1 };
  p.pages.push(structuredClone(p.pages[0]));
  const bad = await dev.save(2, p);
  assert.equal(bad.ok, false);
  assert.match(bad.errors.join(), /65536/);
  assert.equal(fs.existsSync(path.join(dir, "device_backups", "auto", "profile2")), false);

  const off = await dev.save(2, schema.blankProfile());
  assert.equal(off.ok, false);
  assert.equal(off.error, "not connected");
  assert.equal(fs.readdirSync(path.join(dir, "device_backups", "auto", "profile2")).length, 1);
  assert.equal(sim.received.length, 0);
  link.disconnect();
});

test("autosave re-uploads tiles the device lost, from the PC cache", async () => {
  const { sim, link, dev } = rig();
  await dev.connect("SIM1");
  const tile = await dev.putTile(solid([200, 10, 10]));
  sim.files.delete(`/t/${tile}.565`);               // e.g. GC'd or flashed fresh
  const p = schema.blankProfile();
  p.pages[0].keys[0] = { id: 1, name: "Red", icon: "zap", led_color: [200, 10, 10], tile, actions: [] };
  const r = await dev.save(1, p);
  assert.equal(r.ok, true, r.error);
  assert.ok(sim.files.has(`/t/${tile}.565`));
  const order = sim.received.filter((l) => l.startsWith("###"));
  assert.ok(order.findIndex((l) => l.includes(tile)) < order.findIndex((l) => l.includes("profile1.json")), "tiles before profile (§8.4)");
  link.disconnect();
});

test("device panel: status, BLE slots, forget, profile switch, events, now playing", async () => {
  const { sim, link, dev } = rig();
  await dev.connect("SIM1");
  assert.equal(dev.status.ver, "3.0.0");
  const ble = await dev.bleList();
  assert.deepEqual(ble.slots.map(({ slot, name, state }) => ({ slot, name, state })), [{ slot: 0, name: "ADITYA-PC", state: "connected" }, { slot: 1, name: "MacBook-Air", state: "bonded" }]);
  assert.deepEqual(await dev.look(), { led: "rainbow", ledColor: "255 255 255", ledBright: 153, brightness: 200, click: true, theme: "daylight" });
  assert.match(await link.command("theme aurora"), /theme aurora/);
  assert.equal((await dev.look()).theme, "aurora");
  const events = [];
  link.on("ble", (b) => events.push(b));
  await dev.bleForget(0);
  assert.equal(sim.ble[0].name, "MacBook-Air");
  assert.deepEqual(events, [{ slot: 0, up: false }]);

  sim.files.set("/profile2.json", Buffer.from(JSON.stringify(schema.blankProfile("Code"))));
  const before = sim.profileN;
  assert.equal((await dev.peekProfile(2)).profile_name, "Code");   // read in place:
  assert.equal(sim.profileN, before, "peeking does not switch the keypad");
  assert.equal(await dev.peekProfile(6), null, "an empty slot peeks as null");
  const p2 = await dev.loadProfile(2);
  assert.equal(p2.profile_name, "Code");
  assert.equal(dev.activeSlot, 2);
  await dev.setActiveProfile(1);
  assert.equal(sim.profileN, 1);

  const keys = [];
  link.on("key", (k) => keys.push(k));
  sim.press(1, 4, "1");
  await until(() => keys.length);
  assert.deepEqual(keys[0], { page: 1, id: 4, state: "1" });

  assert.equal(dev.nowPlaying({ title: "Midnight City", artist: "M83", app: "Spotify.exe", pos: 92, len: 243, playing: true }), true);
  assert.equal(dev.nowPlaying({ title: "Midnight City", artist: "M83", app: "Spotify.exe", pos: 93, len: 243, playing: true }), false, "position drift < 5 s is not resent");
  await until(() => sim.widgets.now_playing);
  assert.deepEqual(sim.widgets.now_playing, { title: "Midnight City", album: "", artist: "M83", app: "Spotify", pos: 92, len: 243, playing: true });
  const seeks = [];
  link.on("seek", (s) => seeks.push(s));
  sim.event("SEEK 42");
  await until(() => seeks.length);
  assert.deepEqual(seeks, [42]);
  link.disconnect();
});
