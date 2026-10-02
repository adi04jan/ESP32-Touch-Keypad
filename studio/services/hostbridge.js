/* Host bridge (PLAN.md §9): a `host` action makes the keypad send a reserved
 * F13–F24 combo; Studio registers those combos with Electron's globalShortcut
 * and runs the mapped command: `open <url|file|app>`, `run <command line>`,
 * `obs.scene <name>` (OBS WebSocket v5, optional). */
"use strict";

const crypto = require("crypto");
const schema = require("./schema");

// slot = set * 12 + (F - 13). Keep in lockstep with the firmware's host table.
const MOD_SETS = [
  { label: "Ctrl+Alt+Shift", accel: "Control+Alt+Shift", keys: ["LEFT_CTRL", "LEFT_ALT", "LEFT_SHIFT"] },
  { label: "Ctrl+Alt", accel: "Control+Alt", keys: ["LEFT_CTRL", "LEFT_ALT"] },
  { label: "Ctrl+Shift", accel: "Control+Shift", keys: ["LEFT_CTRL", "LEFT_SHIFT"] },
  { label: "Ctrl+Alt+Shift+Win", accel: "Control+Alt+Shift+Super", keys: ["LEFT_CTRL", "LEFT_ALT", "LEFT_SHIFT", "LEFT_GUI"] },
];

function comboForSlot(slot) {
  if (!Number.isInteger(slot) || slot < 0 || slot >= schema.HOST_SLOTS) throw new Error(`bad host slot ${slot}`);
  const set = MOD_SETS[Math.floor(slot / 12)], f = `F${13 + (slot % 12)}`;
  return { slot, label: `${set.label}+${f}`, accelerator: `${set.accel}+${f}`, keys: [...set.keys, f] };
}

// Give every distinct host cmd in `profiles` a slot, reusing `slots` ({ "n": cmd }).
// Mutates the actions' `slot`; returns { slots, errors }.
function assignSlots(profiles, slots = {}) {
  const out = { ...slots }, errors = [];
  const byCmd = new Map(Object.entries(out).map(([s, c]) => [c, +s]));
  for (const p of profiles) for (const a of schema.hostActions(p)) {
    let s = byCmd.get(a.cmd);
    if (s === undefined) {
      s = [...Array(schema.HOST_SLOTS).keys()].find((n) => !(String(n) in out));
      if (s === undefined) { errors.push(`all ${schema.HOST_SLOTS} host slots are in use; '${a.cmd}' has none`); delete a.slot; continue; }
      out[String(s)] = a.cmd;
      byCmd.set(a.cmd, s);
    }
    a.slot = s;
  }
  return { slots: out, errors };
}

// keycombo/key actions that would send a reserved host combo by accident.
function findActionConflicts(profile) {
  const reserved = new Map();
  for (let s = 0; s < schema.HOST_SLOTS; s++) { const c = comboForSlot(s); reserved.set([...c.keys].sort().join("+"), c); }
  const out = [];
  const walk = (list, where) => (list || []).forEach((a, i) => {
    if (a && a.type === "repeat") return walk(a.actions, `${where} > repeat`);
    if (!a || a.type !== "keycombo") return;
    const keys = a.keys.map((k) => schema.normKey(k) || k);
    const hit = reserved.get([...new Set(keys)].sort().join("+"));
    if (hit) out.push({ where: `${where} action ${i + 1}`, label: hit.label, slot: hit.slot });
  });
  ((profile && profile.pages) || []).forEach((pg, pi) => (pg.keys || []).forEach((k) => {
    if (!k) return;
    walk(k.actions, `page ${pi + 1} key ${k.id}`);
    walk(k.hold_actions, `page ${pi + 1} key ${k.id} (hold)`);
  }));
  return out;
}

function parseCommand(cmd) {
  const s = String(cmd || "").trim();
  const m = s.match(/^(open|run|obs\.scene)\s+(.+)$/i);
  if (!m) return { kind: "invalid", arg: s };
  return { kind: m[1].toLowerCase(), arg: m[2].trim() };
}

// ---- OBS WebSocket v5 (one request per connection; fine for scene switches) ----
function obsAuth(password, salt, challenge) {
  const secret = crypto.createHash("sha256").update(password + salt).digest("base64");
  return crypto.createHash("sha256").update(secret + challenge).digest("base64");
}

function obsRequest({ url = "ws://127.0.0.1:4455", password = "" }, requestType, requestData = {}, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const done = (err, v) => { clearTimeout(t); try { ws.close(); } catch (_) {} err ? reject(err) : resolve(v); };
    const t = setTimeout(() => done(new Error("OBS did not answer")), timeoutMs);
    ws.onerror = () => done(new Error(`cannot reach OBS at ${url}`));
    ws.onmessage = (ev) => {
      let msg; try { msg = JSON.parse(ev.data); } catch (_) { return; }
      if (msg.op === 0) {
        const d = { rpcVersion: 1 };
        if (msg.d.authentication) d.authentication = obsAuth(password, msg.d.authentication.salt, msg.d.authentication.challenge);
        ws.send(JSON.stringify({ op: 1, d }));
      } else if (msg.op === 2) {
        ws.send(JSON.stringify({ op: 6, d: { requestType, requestId: "studio", requestData } }));
      } else if (msg.op === 7) {
        const st = msg.d.requestStatus || {};
        st.result ? done(null, msg.d.responseData) : done(new Error(st.comment || `OBS error ${st.code}`));
      }
    };
  });
}

class HostBridge {
  /* deps: { globalShortcut, open(target), run(cmdline), settings() -> {obs_*}, log(text) } */
  constructor(deps) {
    this.d = deps;
    this.registered = new Map();     // accelerator -> slot
    this.slots = {};
    this.failed = [];
  }

  // (Re)register every slot in use. Returns { registered: [...labels], failed: [{slot,label,cmd}] }.
  apply(slots) {
    const gs = this.d.globalShortcut;
    for (const accel of this.registered.keys()) { try { gs.unregister(accel); } catch (_) {} }
    this.registered.clear();
    this.slots = { ...slots };
    this.failed = [];
    for (const [s, cmd] of Object.entries(this.slots)) {
      const c = comboForSlot(+s);
      let ok = false;
      try { ok = gs.register(c.accelerator, () => this.fire(+s)); } catch (_) {}
      if (ok) this.registered.set(c.accelerator, +s);
      else this.failed.push({ slot: +s, label: c.label, cmd });
    }
    return { registered: [...this.registered.values()].map((s) => comboForSlot(s).label), failed: this.failed };
  }

  fire(slot) {
    const cmd = this.slots[String(slot)];
    if (!cmd) return Promise.resolve({ ok: false, error: `no command on slot ${slot}` });
    return this.execute(cmd);
  }

  async execute(cmd) {
    const { kind, arg } = parseCommand(cmd);
    const log = this.d.log || (() => {});
    try {
      if (kind === "open") await this.d.open(arg);
      else if (kind === "run") await this.d.run(arg);
      else if (kind === "obs.scene") {
        const s = this.d.settings ? this.d.settings() : {};
        if (!s.obs_enabled) throw new Error("OBS is off (Settings > Host bridge)");
        await (this.d.obsRequest || obsRequest)({ url: s.obs_url, password: s.obs_password }, "SetCurrentProgramScene", { sceneName: arg });
      } else throw new Error(`unknown host command '${cmd}' (use open, run or obs.scene)`);
      log(`host: ${cmd}\n`);
      return { ok: true };
    } catch (e) {
      log(`host: ${cmd} failed: ${e.message}\n`);
      return { ok: false, error: e.message };
    }
  }

  dispose() { this.apply({}); }
}

module.exports = { MOD_SETS, comboForSlot, assignSlots, findActionConflicts, parseCommand, obsAuth, obsRequest, HostBridge };
