/* The quick bar's suggested profile: which profile the owner switches to by hand, per app in
 * front, learned from key presses that follow the switch. Auto-switch's own picks never count:
 * EVT:PROFILE stops counting, and only EVT:SWITCH (a switch made on the keypad) starts it again.
 * Recent presses count more: each weight halves every halfLifeDays.
 * Data: { "<app>": { "<slot>": { w: weight at t, n: presses, t: epoch ms of the last press } } } */
"use strict";

const fs = require("fs");
const path = require("path");

const DAY = 86400000;

class Suggest {
  constructor({ now = Date.now, halfLifeDays = 7, minWeight = 3, data = {} } = {}) {
    this.now = now;
    this.halfMs = halfLifeDays * DAY;
    this.minWeight = minWeight;
    this.data = data && typeof data === "object" && !Array.isArray(data) ? data : {};
    this.app = null;        // the app in front
    this.counting = 0;      // the slot presses count for (0: none)
    this.sent = undefined;  // the last value update() returned
  }

  static load(file, opts = {}) {
    let data = {};
    try { data = JSON.parse(fs.readFileSync(file, "utf8")); } catch (_) {}   // missing or corrupt: start empty
    return new Suggest({ ...opts, data });
  }

  save(file) {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(`${file}.tmp`, JSON.stringify(this.data));   // whole or not at all
      fs.renameSync(`${file}.tmp`, file);
      return true;
    } catch (_) { return false; }
  }

  focus(app) {
    if (app === this.app) return;
    this.app = app;
    this.counting = 0;
  }

  profile() { this.counting = 0; }

  manual(slot) { this.counting = this.app ? slot : 0; }

  key() {
    if (!this.counting || !this.app) return;
    const byApp = (this.data[this.app] ||= {}), e = byApp[this.counting];
    byApp[this.counting] = { w: this.weight(this.app, this.counting) + 1, n: ((e && e.n) || 0) + 1, t: this.now() };
  }

  weight(app, slot) {
    const e = this.data[app] && this.data[app][slot];
    if (!e || !(e.w > 0)) return 0;
    return e.w * Math.pow(0.5, Math.max(0, this.now() - e.t) / this.halfMs);
  }

  best(activeSlot) {
    let best = 0, bw = -1;
    for (const k of Object.keys(this.data[this.app] || {})) {
      const slot = +k, w = this.weight(this.app, slot);
      if (slot !== activeSlot && w >= this.minWeight && w > bw) { best = slot; bw = w; }
    }
    return best;
  }

  update(activeSlot) {
    const b = this.best(activeSlot);
    if (b === this.sent) return null;
    this.sent = b;
    return b;
  }

  reset() { this.sent = undefined; }

  rows() {
    const out = [];
    for (const [app, slots] of Object.entries(this.data))
      for (const [k, e] of Object.entries(slots || {}))
        out.push({ app, slot: +k, weight: this.weight(app, k), presses: (e && e.n) || 0, last: (e && e.t) || 0 });
    return out.sort((a, b) => b.weight - a.weight);
  }

  clear(app, slot) {
    if (!this.data[app]) return;
    delete this.data[app][slot];
    if (!Object.keys(this.data[app]).length) delete this.data[app];
    this.sent = undefined;   // the best may have changed: the next update() tells the keypad
  }
}

module.exports = { Suggest };
