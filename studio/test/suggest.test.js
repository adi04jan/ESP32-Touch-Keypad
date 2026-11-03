"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { Suggest } = require("../services/suggest");

const DAY = 86400000;
const mk = (o = {}) => { let t = 1e12; const s = new Suggest({ now: () => t, ...o }); s.tick = (ms) => { t += ms; }; return s; };
const learn = (s, app, slot, n) => { s.focus(app); s.profile(slot); s.manual(slot); for (let i = 0; i < n; i++) s.key(); };

test("manual switch then presses build the weight; auto-switch presses don't", () => {
  const s = mk(); s.focus("terminal");
  s.profile(1); s.key(); s.key();                              // auto-switch to 1: not counted
  s.profile(13); s.manual(13); s.key(); s.key(); s.key();
  assert.equal(s.weight("terminal", 1), 0);
  assert.equal(s.weight("terminal", 13), 3);
  assert.equal(s.best(1), 13);
  assert.equal(s.best(13), 0);                                  // already there
});

test("a focus change stops counting", () => {
  const s = mk(); learn(s, "terminal", 13, 1);
  s.focus("vscode"); s.key(); s.focus("terminal"); s.key();
  assert.equal(s.weight("terminal", 13), 1);
  assert.equal(s.weight("vscode", 13), 0);
});

test("old presses fade with the half-life; the minimum gates a suggestion", () => {
  const s = mk({ halfLifeDays: 7, minWeight: 3 }); learn(s, "terminal", 13, 4);
  s.tick(7 * DAY);
  assert.ok(Math.abs(s.weight("terminal", 13) - 2) < 1e-9);
  assert.equal(s.best(1), 0);
});

test("go-back counts like any manual switch", () => {
  const s = mk(); learn(s, "terminal", 1, 3);
  assert.equal(s.best(13), 1);
});

test("update sends only when the best changes", () => {           // Review Focus 4
  const s = mk(); learn(s, "terminal", 13, 3); s.profile(1);
  assert.equal(s.update(1), 13);
  s.focus("terminal"); assert.equal(s.update(1), null);         // same app again: nothing to send
  s.focus("vscode"); assert.equal(s.update(1), 0);              // nothing learned for vscode: clear it
  s.focus("vscode"); assert.equal(s.update(1), null);
  s.reset(); assert.equal(s.update(1), 0);                      // after a reconnect it is sent again
});

test("load: missing or corrupt file starts empty", () => {         // Review Focus 5
  const f = path.join(os.tmpdir(), `sug-${process.pid}.json`);
  fs.writeFileSync(f, "{not json");
  assert.deepEqual(Suggest.load(f).rows(), []);
  assert.deepEqual(Suggest.load(f + ".none").rows(), []);
  fs.unlinkSync(f);
});

test("save and load keep the weights; rows and clear", () => {
  const f = path.join(os.tmpdir(), `sug2-${process.pid}.json`);
  const s = mk(); learn(s, "terminal", 13, 2); s.save(f);
  const r = Suggest.load(f).rows();
  assert.deepEqual(r.map((x) => [x.app, x.slot, x.presses]), [["terminal", 13, 2]]);
  s.clear("terminal", 13); assert.deepEqual(s.rows(), []);
  fs.unlinkSync(f);
});
