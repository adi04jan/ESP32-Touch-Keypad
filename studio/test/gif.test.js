"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const schema = require("../services/schema");
const backup = require("../services/backup");
const { SerialLink } = require("../services/serial");
const { Device } = require("../services/device");
const { SimDevice, makeSimPort } = require("./sim-device");

const solid = (r, g, b) => { const a = new Uint8Array(72 * 72 * 4); for (let i = 0; i < 72 * 72; i++) a.set([r, g, b, 255], i * 4); return a; };
const page = (keys) => ({ name: "One", keys: Array.from({ length: 15 }, (_, i) => keys[i] || null) });
const prof = (k0) => ({ schema_version: 2, profile_name: "GIF", color: [79, 140, 255], default_delay: 20, pages: [page([k0])] });
const key = (extra) => ({ id: 1, name: "GIF", led_color: [79, 140, 255], actions: [{ type: "key", value: "F13" }], ...extra });

test("schema: frames are 2-16 tile names with a frame time; repair keeps what is usable", () => {
  assert.ok(schema.validateProfile(prof(key({ frames: ["0000000a", "0000000b"], frame_ms: 120 }))).ok);
  assert.equal(schema.validateProfile(prof(key({ frames: ["0000000a"] }))).ok, false);                  // one frame is a still image: use tile
  assert.equal(schema.validateProfile(prof(key({ frames: ["0000000a", "0000000b"], frame_ms: 5 }))).ok, false);
  const r = schema.repairProfile(prof(key({ frames: ["0000000A", "bad", "0000000B"], frame_ms: 9999 }))).pages[0].keys[0];
  assert.deepEqual([r.frames, r.frame_ms], [["0000000a", "0000000b"], 2000]);
  assert.equal(schema.repairProfile(prof(key({ frames: ["0000000a"] }))).pages[0].keys[0].frames, undefined);
});

test("a GIF's frames upload as tiles (repeats once), and saving a GIF key syncs any the keypad lacks", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tk-gif-"));
  backup.configure({ dataDir: dir });
  const sim = new SimDevice();
  const link = new SerialLink({ SerialPort: makeSimPort(sim), uploadRate: Infinity });
  let settings = { baud: 921600, settime_enabled: false, host_slots: {} };
  const store = { load: () => ({ ...settings }), save: (p) => (settings = { ...settings, ...p }) };
  const dev = new Device({ link, backup, settings: store, tileDir: path.join(dir, "tiles") });
  await dev.connect("SIM1");

  const r = await dev.putTiles([solid(255, 0, 0), solid(0, 0, 255), solid(255, 0, 0)]);
  assert.equal(r.ok, true);
  assert.equal(r.names.length, 3);
  assert.equal(r.names[0], r.names[2]);                                   // the same frame twice is one tile
  for (const n of new Set(r.names)) assert.ok(sim.files.has(`/t/${n}.565`), n);

  sim.files.delete(`/t/${r.names[1]}.565`);                               // the keypad lost one: saving puts it back
  const s = await dev.save(4, prof(key({ frames: r.names, frame_ms: 150 })));
  assert.equal(s.ok, true, JSON.stringify(s));
  assert.ok(sim.files.has(`/t/${r.names[1]}.565`));
  assert.deepEqual(JSON.parse(sim.files.get("/profile4.json")).pages[0].keys[0].frames, r.names);

  sim.fsTotal = sim._used() + 2000;                                        // nearly full: refused before anything is sent
  const full = await dev.putTiles([solid(0, 255, 0), solid(10, 20, 30)]);
  assert.equal(full.ok, false);
  assert.match(full.error, /KB free/);
  link.disconnect();
});
