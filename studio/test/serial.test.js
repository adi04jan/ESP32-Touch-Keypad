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
  assert.match(logs.join(""), /not a Touch Keypad/);
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
