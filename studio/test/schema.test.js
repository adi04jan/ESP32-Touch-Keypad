"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const schema = require("../services/schema");

const key = (id, extra = {}) => ({ id, name: `K${id}`, icon: "zap", led_color: [1, 2, 3], actions: [{ type: "key", value: "A" }], ...extra });
const profile = (keys) => ({ schema_version: 2, profile_name: "T", default_delay: 20, pages: [{ name: "Main", keys }] });
const blank = () => Array(15).fill(null);

test("19 action types, F13–F24 and 8 profiles", () => {
  assert.equal(schema.ACTION_TYPES.length, 19);
  for (const t of ["page", "back", "host"]) assert.ok(schema.ACTION_TYPES.includes(t));
  assert.ok(schema.KEY_NAMES.includes("F13") && schema.KEY_NAMES.includes("F24"));
  assert.deepEqual(schema.validateActions([{ type: "profile", value: 8 }]).errors, []);
  assert.equal(schema.validateActions([{ type: "profile", value: 9 }]).ok, false);
});

test("validateAction covers every type", () => {
  const good = [
    { type: "comment" }, { type: "delay", ms: 5 }, { type: "key", value: "F13" }, { type: "keycombo", keys: ["LEFT_CTRL", "C"] },
    { type: "text", value: "hi" }, { type: "multiline", value: "a\nb" }, { type: "hold", key: "LEFT_SHIFT" }, { type: "release" },
    { type: "repeat", count: 2, actions: [{ type: "key", value: "A" }] }, { type: "media", value: "NEXT" },
    { type: "mouse_move", x: 1, y: -1, wheel: 3 }, { type: "mouse_click", button: "LEFT" }, { type: "led", color: [1, 2, 3] },
    { type: "led_anim", value: "flash" }, { type: "profile", value: 2 }, { type: "telephony", value: "MIC_MUTE" },
    { type: "page", value: 2 }, { type: "back" }, { type: "host", cmd: "open https://x.y", slot: 47 },
  ];
  assert.equal(good.length, 19);
  assert.deepEqual(schema.validateActions(good).errors, []);
  const bad = [{ type: "nope" }, { type: "page", value: 0 }, { type: "host", cmd: "" }, { type: "host", cmd: "x", slot: 48 },
    { type: "mouse_move", x: 200, y: 0 }, { type: "repeat", count: 51, actions: [] }];
  for (const a of bad) assert.equal(schema.validateAction(a).length > 0, true, JSON.stringify(a));
});

test("repair normalizes aliases and drops the unfixable", () => {
  const r = schema.repairActions([
    { type: "combo", keys: ["ctrl", "shift", "esc"] }, { type: "goto", value: "3" }, { type: "pop" },
    { type: "host_action", value: " open x ", slot: 99 }, { type: "media", value: "bogus" }, null, { type: "wait", ms: "250" },
  ]);
  assert.deepEqual(r, [
    { type: "keycombo", keys: ["LEFT_CTRL", "LEFT_SHIFT", "ESC"] }, { type: "page", value: 3 }, { type: "back" },
    { type: "host", cmd: "open x" }, { type: "delay", ms: 250 },
  ]);
  assert.ok(schema.isValidActions(r));
});

test("repeat nesting deeper than 4 is rejected and repaired away", () => {
  let a = { type: "key", value: "A" };
  for (let i = 0; i < 5; i++) a = { type: "repeat", count: 1, actions: [a] };
  assert.equal(schema.validateAction(a).length > 0, true);
  assert.equal(schema.repairAction(a), null);
});

test("validateProfile: 15 cells, ids, labels, tiles, widgets, page targets", () => {
  const keys = blank();
  keys[0] = key(1, { tile: "3fa9c2d1", hold_actions: [{ type: "media", value: "NEXT" }] });
  keys[4] = key(5, { actions: [{ type: "page", value: 1 }] });
  assert.deepEqual(schema.validateProfile(profile(keys)).errors, []);

  const bad = blank();
  bad[0] = key(2);                                          // wrong id
  bad[1] = key(2, { name: "a label far too long" });
  bad[2] = key(3, { tile: "XYZ" });
  bad[3] = key(4, { actions: [{ type: "page", value: 3 }] }); // page past the end
  const errs = schema.validateProfile(profile(bad)).errors.join("\n");
  assert.match(errs, /keys\[0\]\.id must be 1/);
  assert.match(errs, /keys\[1\]\.name/);
  assert.match(errs, /keys\[2\]\.tile/);
  assert.match(errs, /page 3 does not exist/);
  assert.match(schema.validateProfile(profile(blank().slice(1))).errors[0], /15 entries/);
});

test("widget span covers cells; repair nulls covered cells and drops misfits", () => {
  const keys = blank();
  keys[0] = { id: 1, name: "Now Playing", widget: "now_playing", span: [3, 2], actions: [] };
  assert.deepEqual(schema.validateProfile(profile(keys)).errors, []);
  keys[6] = key(7);
  assert.match(schema.validateProfile(profile(keys)).errors.join(), /covered by a widget/);
  const fixed = schema.repairProfile(profile(keys));
  assert.equal(fixed.pages[0].keys[6], null);
  assert.deepEqual(schema.validateProfile(fixed).errors, []);

  const misfit = blank();
  misfit[3] = { id: 4, name: "NP", widget: "now_playing", span: [3, 2], actions: [] };   // column 4: doesn't fit
  assert.equal(schema.repairProfile(profile(misfit)).pages[0].keys[3], null);
});

test("migrateProfile turns a v1 profile into page 1, padded to 15", () => {
  const v1 = { profile_name: "Old", idle_animation: "rainbow", default_delay: 30,
    keys: [{ id: 1, name: "Copy", led_color: [9, 9, 9], actions: [{ type: "keycombo", keys: ["CTRL", "C"] }] }, { id: 12, actions: [] }] };
  const p = schema.repairProfile(v1);
  assert.equal(p.schema_version, 2);
  assert.equal(p.pages.length, 1);
  assert.equal(p.pages[0].keys.length, 15);
  assert.deepEqual(p.pages[0].keys[0].led_color, [9, 9, 9]);
  assert.deepEqual(p.pages[0].keys[0].actions[0].keys, ["LEFT_CTRL", "C"]);
  assert.equal(p.pages[0].keys[11].name, "Key 12");
  assert.equal(p.pages[0].keys[12], null);
  assert.equal("keys" in p, false);
  assert.deepEqual(schema.validateProfile(p).errors, []);
});

test("repairProfile fixes ids, clamps page targets, keeps valid tiles", () => {
  const keys = blank();
  keys[2] = { id: 9, name: "x", led_color: [300, -1, 5], tile: "ABCDEF01", actions: [{ type: "page", value: 7 }] };
  const p = schema.repairProfile({ profile_name: "R", pages: [{ name: "A", keys }, { name: "B", keys: [] }] });
  const k = p.pages[0].keys[2];
  assert.equal(k.id, 3);
  assert.deepEqual(k.led_color, [255, 0, 5]);
  assert.equal(k.tile, "abcdef01");
  assert.equal(k.actions[0].value, 2);
  assert.equal(p.pages[1].keys.length, 15);
  assert.deepEqual(schema.validateProfile(p).errors, []);
});

test("oversized profile is flagged against the 64 KB cap", () => {
  const keys = blank().map((_, i) => key(i + 1, { actions: [{ type: "text", value: "x".repeat(4096) }] }));
  const p = profile(keys);
  p.pages.push({ name: "Two", keys });
  assert.match(schema.validateProfile(p).errors.join(), /at most 65536/);
});
