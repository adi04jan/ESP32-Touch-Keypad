"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const hb = require("../services/hostbridge");

const prof = (actionsPerKey) => ({ schema_version: 2, profile_name: "P", default_delay: 20,
  pages: [{ name: "Main", keys: Array.from({ length: 15 }, (_, i) => (actionsPerKey[i] ? { id: i + 1, name: "k", led_color: [1, 1, 1], actions: actionsPerKey[i] } : null)) }] });

test("slot -> combo covers F13–F24 x 4 modifier sets = 48 unique combos", () => {
  assert.deepEqual(hb.comboForSlot(0), { slot: 0, label: "Ctrl+Alt+Shift+F13", accelerator: "Control+Alt+Shift+F13", keys: ["LEFT_CTRL", "LEFT_ALT", "LEFT_SHIFT", "F13"] });
  assert.equal(hb.comboForSlot(11).label, "Ctrl+Alt+Shift+F24");
  assert.equal(hb.comboForSlot(12).accelerator, "Control+Alt+F13");
  assert.equal(hb.comboForSlot(30).label, "Ctrl+Shift+F19");
  assert.equal(hb.comboForSlot(47).accelerator, "Control+Alt+Shift+Super+F24");
  const all = new Set(Array.from({ length: 48 }, (_, s) => hb.comboForSlot(s).accelerator));
  assert.equal(all.size, 48);
  assert.throws(() => hb.comboForSlot(48));
});

test("assignSlots: one slot per distinct cmd, stable across saves, shared across profiles", () => {
  const a = prof({ 0: [{ type: "host", cmd: "open https://github.com" }], 1: [{ type: "host", cmd: "obs.scene BRB" }], 2: [{ type: "host", cmd: "open https://github.com" }] });
  const { slots, errors } = hb.assignSlots([a], { 0: "run old.cmd" });
  assert.deepEqual(errors, []);
  assert.deepEqual(slots, { 0: "run old.cmd", 1: "open https://github.com", 2: "obs.scene BRB" });
  const keys = a.pages[0].keys;
  assert.equal(keys[0].actions[0].slot, 1);
  assert.equal(keys[1].actions[0].slot, 2);
  assert.equal(keys[2].actions[0].slot, 1);
  const b = prof({ 5: [{ type: "repeat", count: 2, actions: [{ type: "host", cmd: "obs.scene BRB" }] }] });
  hb.assignSlots([b], slots);
  assert.equal(b.pages[0].keys[5].actions[0].actions[0].slot, 2);
});

test("assignSlots reports when all 48 slots are taken", () => {
  const full = Object.fromEntries(Array.from({ length: 48 }, (_, i) => [String(i), `run ${i}`]));
  const p = prof({ 0: [{ type: "host", cmd: "open new" }] });
  const { errors } = hb.assignSlots([p], full);
  assert.match(errors[0], /all 48 host slots/);
  assert.equal("slot" in p.pages[0].keys[0].actions[0], false);
});

test("HostBridge registers combos, reports conflicts, maps combos to commands", async () => {
  const held = new Set(["Control+Alt+F13"]);   // another app holds slot 12
  const reg = new Map();
  const globalShortcut = {
    register: (acc, fn) => { if (held.has(acc)) return false; reg.set(acc, fn); return true; },
    unregister: (acc) => reg.delete(acc),
  };
  const calls = [];
  const bridge = new hb.HostBridge({
    globalShortcut,
    open: async (t) => calls.push(["open", t]),
    run: async (c) => calls.push(["run", c]),
    obsRequest: async (conn, type, data) => calls.push(["obs", conn.url, type, data.sceneName]),
    settings: () => ({ obs_enabled: true, obs_url: "ws://h:4455", obs_password: "pw" }),
  });
  const r = bridge.apply({ 0: "open https://github.com", 1: "obs.scene Gameplay", 12: "run notepad.exe", 13: "bogus thing" });
  assert.deepEqual(r.failed, [{ slot: 12, label: "Ctrl+Alt+F13", cmd: "run notepad.exe" }]);
  assert.equal(r.registered.length, 3);
  await reg.get("Control+Alt+Shift+F13")();
  await reg.get("Control+Alt+Shift+F14")();
  assert.deepEqual(calls, [["open", "https://github.com"], ["obs", "ws://h:4455", "SetCurrentProgramScene", "Gameplay"]]);
  assert.equal((await bridge.fire(13)).ok, false);
  assert.equal((await bridge.fire(40)).ok, false);
  // re-apply unregisters what is no longer used
  bridge.apply({ 2: "run x" });
  assert.deepEqual([...reg.keys()], ["Control+Alt+Shift+F15"]);
});

test("OBS commands are refused while OBS is off", async () => {
  const bridge = new hb.HostBridge({ globalShortcut: { register: () => true, unregister: () => {} }, settings: () => ({ obs_enabled: false }), obsRequest: async () => assert.fail("should not connect") });
  const r = await bridge.execute("obs.scene X");
  assert.equal(r.ok, false);
  assert.match(r.error, /OBS is off/);
});

test("parseCommand", () => {
  assert.deepEqual(hb.parseCommand("open https://x.y/?a=1&b=2"), { kind: "open", arg: "https://x.y/?a=1&b=2" });
  assert.deepEqual(hb.parseCommand("  OBS.SCENE  Just Chatting "), { kind: "obs.scene", arg: "Just Chatting" });
  assert.deepEqual(hb.parseCommand("run C:\\tools\\do it.cmd"), { kind: "run", arg: "C:\\tools\\do it.cmd" });
  assert.equal(hb.parseCommand("launch x").kind, "invalid");
});

test("keycombo actions that collide with a reserved combo are flagged", () => {
  const p = prof({ 3: [{ type: "keycombo", keys: ["CTRL", "SHIFT", "ALT", "F13"] }], 4: [{ type: "keycombo", keys: ["LEFT_CTRL", "C"] }] });
  p.pages[0].keys[4].hold_actions = [{ type: "repeat", count: 1, actions: [{ type: "keycombo", keys: ["LEFT_CTRL", "LEFT_SHIFT", "F20"] }] }];
  const c = hb.findActionConflicts(p);
  assert.deepEqual(c.map((x) => x.label), ["Ctrl+Alt+Shift+F13", "Ctrl+Shift+F20"]);
  assert.match(c[1].where, /key 5 \(hold\)/);
});

test("OBS v5 auth string matches the obs-websocket protocol docs example", () => {
  assert.equal(hb.obsAuth("supersecretpassword", "lM1GncleQOaCu9lT1yeUZhFYnqhsLLP1G5lAGo3ixaI=", "+IxH4CnCiqpX1rM9scsNynZzbOe4KhDeYcTNS3PDaeY="),
    "1Ct943GAT+6YQUUX47Ia/ncufilbe6+oD6lY+5kaCu4=");
});
