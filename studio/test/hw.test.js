/* Hardware in the loop: Studio's real SerialLink + Device against the keypad on
 * USB (KP_TEST firmware). Skipped unless KP_HW=1:  npm run test:hw
 * Uses profile slot 7, switches the device back to slot 1 at the end. */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { SerialLink } = require("../services/serial");
const { Device } = require("../services/device");
const backup = require("../services/backup");

const HW = process.env.KP_HW === "1" || process.env.npm_lifecycle_event === "test:hw";
const SLOT = 7;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 5000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error("timed out waiting"); await sleep(20); } };
const cellXY = (id) => [((id - 1) % 5) * 96 + 48, 30 + Math.floor((id - 1) / 5) * 90 + 40];

let link, dev, settings;
const rx = [], keys = [], pages = [], profiles = [];

function profile(key2) {
  const p1 = Array(15).fill(null), p2 = Array(15).fill(null);
  p1[0] = { id: 1, name: "Studio", icon: "pencil", led_color: [47, 107, 115], tile: dev.testTile, actions: [{ type: "text", value: "ok" }] };
  p1[1] = { id: 2, name: "Key two", icon: "star", led_color: [194, 65, 43], actions: key2 };
  p1[2] = { id: 3, name: "Notepad", icon: "file-text", led_color: [226, 176, 74], actions: [{ type: "host", cmd: "open notepad" }] };
  p2[0] = { id: 1, name: "Back", icon: "undo-2", led_color: [130, 136, 150], actions: [{ type: "back" }] };
  return { schema_version: 2, profile_name: "Studio HW", default_delay: 5, pages: [{ name: "One", keys: p1 }, { name: "Two", keys: p2 }] };
}

test.before(async () => {
  if (!HW) return;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tk-hw-"));
  backup.configure({ dataDir: dir });
  settings = { baud: 921600, settime_enabled: true, host_slots: {} };
  const store = { load: () => ({ ...settings }), save: (p) => (settings = { ...settings, ...p }) };
  link = new SerialLink();
  dev = new Device({ link, backup, settings: store, bridge: null, tileDir: path.join(dir, "tiles") });
  link.on("rx", (l) => rx.push(l));
  link.on("key", (k) => keys.push(k));
  link.on("page", (n) => pages.push(n));
  link.on("profile", (n) => profiles.push(n));
});

test.after(async () => {
  if (!HW || !link.isOpen()) return;
  await dev.setActiveProfile(1);
  await link.command("setdim 120");
  link.disconnect();
});

test("detect finds the keypad by CH340 + model:touch", { skip: !HW }, async () => {
  const r = await dev.connect();
  assert.ok(r.ok, r.error);
  assert.equal(r.status.model, "touch");
  assert.match(r.status.ver, /^3\./);
  await link.command("hid dry on");
  await link.command("setdim 0");
});

test("a rendered tile uploads paced and lands in /t", { skip: !HW }, async () => {
  const rgba = Buffer.alloc(72 * 72 * 4);
  for (let i = 0; i < 72 * 72; i++) rgba.set([47, 107, 115, 255], i * 4);
  rgba.set([255, 255, 255, 255], (36 * 72 + 36) * 4);
  dev.testTile = await dev.putTile(rgba);
  assert.match(dev.testTile, /^[0-9a-f]{8}$/);
  assert.ok((await link.command("ls /t")).includes(`${dev.testTile}.565`));
});

test("save: host slot assigned, profile uploaded, cat matches", { skip: !HW }, async () => {
  const r = await dev.save(SLOT, profile([{ type: "key", value: "W" }]));
  assert.ok(r.ok, JSON.stringify(r.errors || r.error));
  const slot = Object.keys(settings.host_slots).find((s) => settings.host_slots[s] === "open notepad");
  assert.ok(slot !== undefined, "host cmd got a slot");
  const back = JSON.parse(await link.readFile(`profile${SLOT}.json`));
  assert.equal(back.profile_name, "Studio HW");
  assert.equal(back.pages[0].keys[2].actions[0].slot, +slot);
  assert.equal(back.pages[0].keys[0].tile, dev.testTile);
});

test("switching profile emits EVT:PROFILE", { skip: !HW }, async () => {
  await dev.setActiveProfile(SLOT);
  await until(() => profiles.includes(SLOT));
  assert.match(await link.command("status"), new RegExp(`Profile:${SLOT} `));
});

test("live push changes a key in RAM; a tap sends the new key", { skip: !HW }, async () => {
  const p = profile([{ type: "key", value: "Q" }]);
  dev.edit({ slot: SLOT, profile: p, page: 1, keyId: 2, kinds: ["actions"] });
  await sleep(dev.pushMs + 400);
  rx.length = 0; keys.length = 0;
  await link.command(`touch ${cellXY(2).join(" ")} 80`);
  await until(() => rx.some((l) => /^EVT:HID 1 0000140000000000$/.test(l))).catch((e) => { throw new Error(`${e.message}; rx=${JSON.stringify(rx)}`); });   // Q
  assert.deepEqual(keys.slice(0, 2).map((k) => [k.page, k.id, k.state]), [[1, 2, "1"], [1, 2, "0"]]);
});

test("autosave writes the edit to flash", { skip: !HW }, async () => {
  await until(() => !dev._save.has(SLOT), 6000);
  await sleep(300);
  const back = JSON.parse(await link.readFile(`profile${SLOT}.json`));
  assert.deepEqual(back.pages[0].keys[1].actions, [{ type: "key", value: "Q" }]);
});

test("host action key sends its reserved combo", { skip: !HW }, async () => {
  rx.length = 0;
  await link.command(`touch ${cellXY(3).join(" ")} 80`);
  const slot = +Object.keys(settings.host_slots).find((s) => settings.host_slots[s] === "open notepad");
  const mods = ["07", "05", "03", "0f"][Math.floor(slot / 12)], code = (0x68 + (slot % 12)).toString(16);
  await until(() => rx.some((l) => l === `EVT:HID 1 ${mods}00${code}0000000000`));
});

test("showPage follows the editor; EVT:PAGE comes back", { skip: !HW }, async () => {
  pages.length = 0;
  await dev.showPage(SLOT, 2);
  await until(() => pages.includes(2));
  await dev.showPage(SLOT, 1);
});

test("device panel: BLE list, fsinfo, now playing, clock", { skip: !HW }, async () => {
  const b = await dev.bleList();
  assert.match(b.raw, /hosts:\d+ connected:\d+/);
  const f = await dev.fsinfo();
  assert.ok(f.total > 1e6 && f.used > 0);
  assert.ok(dev.nowPlaying({ title: "Paper Moon", artist: "Band", app: "Spotify.exe", pos: 5, len: 180, playing: true }));
  await sleep(200);
  assert.match(await dev.syncTime(), /time set/);
  const look = await dev.look();
  assert.ok(look.brightness >= 8 && look.led && look.theme, JSON.stringify(look));
  const before = look.theme;
  assert.match(await link.command("theme paper"), /theme paper/);
  assert.equal((await dev.look()).theme, "paper");
  await link.command(`theme ${before}`);
  assert.match(b.raw, /^\d+ \S+ (connected|bonded) .+$|hosts:0/m, "ble list names each host");
});

test("an open Studio link never reads as a BOOT hold (no calibration screen)", { skip: !HW }, async () => {
  await sleep(2600);
  assert.match(await link.command("status"), /ui:home/);
});
