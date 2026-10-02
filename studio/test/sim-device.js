/* In-process fake Touch Keypad speaking the PLAN.md §8 line CLI.
 * SimDevice holds the state (files, active profile, RAM previews, BLE slots);
 * makeSimPort(device) returns a class with the `serialport` SerialPort API
 * (constructor(opts, cb), write, close, static list) that SerialLink accepts. */
"use strict";

const { EventEmitter } = require("events");
const zlib = require("zlib");

const PROMPT = "macropad:$ ";
const hex8 = (n) => (n >>> 0).toString(16).padStart(8, "0");

class SimDevice extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.files = new Map();          // "/profile1.json" -> Buffer, "/t/xxxxxxxx.565" -> Buffer
    this.fsTotal = opts.fsTotal ?? 2 * 1024 * 1024;
    this.profileN = 1;
    this.page = 1;
    this.doc = null;                 // parsed active profile with RAM previews applied
    this.ble = [{ name: "ADITYA-PC", state: "connected" }, { name: "MacBook-Air", state: "bonded" }, null];
    this.time = null;
    this.widgets = {};
    this.shows = [];
    this.received = [];              // every command line (uploads summarized)
    this.version = opts.version ?? "3.0.0";
    this.model = opts.model ?? "touch";
    this.chunked = opts.chunked ?? true;
    this._rng = 7;
    this._up = null;                 // in-progress upload
    this.out = () => {};             // set by the port
  }

  // ---- output helpers ----
  _write(text) {
    if (!this.chunked) return this.out(text);
    // Split into pseudo-random chunks so the host's line assembly gets exercised.
    let i = 0;
    while (i < text.length) {
      this._rng = (this._rng * 1103515245 + 12345) & 0x7fffffff;
      const n = 1 + (this._rng % 40);
      this.out(text.slice(i, i + n));
      i += n;
    }
  }
  println(s) { this._write(s + "\n"); }
  prompt() { this._write(PROMPT); }
  event(body) { this.println(`EVT:${body}`); }
  press(page, id, state = "1") { this.event(`KEY ${page} ${id} ${state}`); }

  // ---- profiles ----
  _load(n) {
    const f = this.files.get(`/profile${n}.json`);
    try { this.doc = f ? JSON.parse(f.toString("utf8")) : null; } catch (_) { this.doc = null; }
    if (!this.doc || !Array.isArray(this.doc.pages)) this.doc = { schema_version: 2, profile_name: `Profile ${n}`, default_delay: 20, pages: [{ name: "Main", keys: Array(15).fill(null) }] };
    this.profileN = n;
    this.page = 1;
  }
  _key(id, create) {
    if (!this.doc) this._load(this.profileN);
    const keys = this.doc.pages[this.page - 1].keys;
    if (!keys[id - 1] && create) keys[id - 1] = { id, name: "", led_color: [110, 100, 92], actions: [] };
    return keys[id - 1];
  }
  _gcTiles() {
    const used = new Set();
    for (const [name, buf] of this.files) {
      if (!/^\/profile\d\.json$/.test(name)) continue;
      for (const m of buf.toString("utf8").matchAll(/"tile"\s*:\s*"([0-9a-f]{8})"/g)) used.add(m[1]);
    }
    for (const name of [...this.files.keys()]) {
      const m = name.match(/^\/t\/([0-9a-f]{8})\.565$/);
      if (m && !used.has(m[1])) this.files.delete(name);
    }
  }
  _used() { let n = 0; for (const b of this.files.values()) n += b.length; return n; }

  // ---- input ----
  line(raw) {
    const line = raw.replace(/\r$/, "");
    if (this._up) return this._uploadLine(line.trim());
    const s = line.trim();
    if (s.startsWith("###BEGINB###")) {
      const m = s.match(/^###BEGINB###\s+(\S+)\s+(\d+)\s+crc=([0-9a-fA-F]{8})$/);
      this.received.push(s);
      if (!m) { this.println("ERR usage: ###BEGINB### <path> <size> crc=<crc32>"); return this.prompt(); }
      this._up = { kind: "bin", path: m[1], size: +m[2], crc: m[3].toLowerCase(), b64: [] };
      return;
    }
    if (s.startsWith("###BEGIN###")) {
      const target = s.slice(11).trim();
      this.received.push(s);
      if (!target) { this.println("Usage: ###BEGIN### filename.json"); return; }
      this._up = { kind: "json", path: "/" + target.replace(/^\/+/, ""), lines: [] };
      return;
    }
    if (!s) return this.prompt();
    this.received.push(s);
    this._command(s);
    this.prompt();
  }

  _uploadLine(s) {
    const up = this._up;
    if (s !== "###END###") {
      if (up.kind === "json") up.lines.push(s); else up.b64.push(s);
      return;
    }
    this._up = null;
    if (up.kind === "json") {
      const text = up.lines.join("\n") + "\n";
      try { JSON.parse(text); } catch (e) { this.println(`Upload rejected: invalid JSON (${e.message})`); return this.prompt(); }
      if (text.length > 64 * 1024) { this.println("Upload too large; discarded."); return this.prompt(); }
      this.files.set(up.path, Buffer.from(text, "utf8"));
      this.println(`SAVED ${up.path.slice(1)} ${Buffer.byteLength(text)}`);
      this._gcTiles();
      if (up.path === `/profile${this.profileN}.json`) { const pg = this.page; this._load(this.profileN); this.page = Math.min(pg, this.doc.pages.length); }
    } else {
      const buf = Buffer.from(up.b64.join(""), "base64");
      if (buf.length !== up.size) this.println(`ERR size mismatch ${buf.length} != ${up.size}`);
      else if (hex8(zlib.crc32(buf)) !== up.crc) this.println(`ERR crc mismatch ${hex8(zlib.crc32(buf))} != ${up.crc}`);
      else { this.files.set(up.path, buf); this.println(`SAVED ${up.path}`); }
    }
    this.prompt();
  }

  _command(s) {
    const sp = s.indexOf(" ");
    const cmd = (sp < 0 ? s : s.slice(0, sp)).toLowerCase();
    const arg = sp < 0 ? "" : s.slice(sp + 1).trim();
    const json = (txt) => { try { return JSON.parse(txt); } catch (_) { return undefined; } };
    const idAndRest = () => { const i = arg.indexOf(" "); return [parseInt(i < 0 ? arg : arg.slice(0, i), 10), i < 0 ? "" : arg.slice(i + 1)]; };
    switch (cmd) {
      case "help": return this.println("help ls cat fsinfo reboot status setprofile setkey sethold setface page setled setidle setbrightness widget settime title show ble");
      case "status": {
        if (!this.doc) this._load(this.profileN);
        const up = this.ble.filter((b) => b && b.state === "connected").length;
        return this.println(`Profile:${this.profileN} loaded:1 idle:0 mode:ble ver:${this.version} model:${this.model} page:${this.page} ble:${up}`);
      }
      case "fsinfo": return this.println(`FS_INFO:${this.fsTotal},${this._used()}`);
      case "ls": {
        const dir = arg.replace(/\/+$/, "");
        for (const [name, buf] of this.files) {
          if (dir === "/t" ? name.startsWith("/t/") : !name.startsWith("/t/")) this.println(`${name.split("/").pop()}\t${buf.length}`);
        }
        return;
      }
      case "cat": {
        const f = this.files.get(arg.startsWith("/") ? arg : "/" + arg);
        return this.println(f ? f.toString("utf8").replace(/\n$/, "") : "");
      }
      case "setprofile": {
        const n = parseInt(arg, 10);
        if (!(n >= 1 && n <= 8)) return this.println("invalid");
        this._load(n);
        this.event(`PROFILE ${n}`);
        return this.println(`profile ${n}`);
      }
      case "page": {
        const n = parseInt(arg, 10);
        if (!this.doc) this._load(this.profileN);
        if (!(n >= 1 && n <= this.doc.pages.length)) return this.println("invalid page");
        this.page = n;
        this.event(`PAGE ${n}`);
        return this.println(`page ${n}`);
      }
      case "setkey": case "sethold": {
        const [id, rest] = idAndRest();
        const v = json(rest);
        if (!(id >= 1 && id <= 15) || !Array.isArray(v)) return this.println(`${cmd} <id> <json-array>`);
        this._key(id, true)[cmd === "setkey" ? "actions" : "hold_actions"] = v;
        return this.println(`Key ${id} updated in RAM`);
      }
      case "setface": {
        const t = arg.split(/\s+/);
        const id = parseInt(t[0], 10);
        if (!(id >= 1 && id <= 15) || !/^[0-9a-f]{8}$/.test(t[1] || "") || t.length !== 5) return this.println("setface <id> <tile> <r> <g> <b>");
        const k = this._key(id, true);
        k.tile = t[1]; k.led_color = t.slice(2).map(Number);
        return this.println(`face ${id} ${this.files.has(`/t/${t[1]}.565`) ? "ok" : "missing tile"}`);
      }
      case "title": {
        const [id, text] = idAndRest();
        if (!(id >= 1 && id <= 15)) return this.println("title <id> <text>");
        this._key(id, true).name = text;
        return this.println(`title ${id}`);
      }
      case "show": {
        const [id, what] = idAndRest();
        this.shows.push({ id, what });
        return this.println(`show ${id} ${what}`);
      }
      case "widget": {
        const i = arg.indexOf(" ");
        const name = i < 0 ? arg : arg.slice(0, i), v = json(arg.slice(i + 1));
        if (!name || v === undefined) return this.println("widget <name> <json>");
        this.widgets[name] = v;
        return this.println(`widget ${name}`);
      }
      case "settime": {
        const [epoch, tz] = arg.split(/\s+/);
        if (!/^\d+$/.test(epoch || "")) return this.println("settime <epoch> <tz>");
        this.time = { epoch: +epoch, tz };
        return this.println("time set");
      }
      case "setled": case "setidle": return this.println(`${cmd} ok`);
      case "setbrightness": if (arg) this.bright = +arg; return this.println(`brightness ${this.bright ?? 200}`);
      case "ledbright": if (arg) this.ledBright = +arg; return this.println(`ledbright ${this.ledBright ?? 153}`);
      case "click": if (arg) this.click = arg === "on"; return this.println(`click ${this.click === false ? "off" : "on"}`);
      case "theme": {
        const ids = ["glass", "paper", "daylight", "aurora", "synth", "retro"];
        if (arg && !ids.includes(arg)) return this.println(`theme ${ids.join(" ")}`);
        if (arg) { this.theme = arg; this.event(`THEME ${arg}`); }
        return this.println(`theme ${this.theme || "daylight"}`);
      }
      case "led": {
        const [name, ...c] = arg.split(/\s+/).filter(Boolean);
        if (name) this.led = name;
        if (c.length === 3) this.ledColor = c.join(" ");
        return this.println(`led ${this.led || "rainbow"} color ${this.ledColor || "255 255 255"} brightness ${this.ledBright ?? 153} showing 0 0 0`);
      }
      case "ble": {
        const [sub, n] = arg.split(/\s+/);
        if (sub === "list") {
          const bonds = this.ble.filter(Boolean);
          bonds.forEach((b, i) => this.println(`${i} aa:bb:cc:dd:ee:0${i} ${b.state} ${b.name}`));
          return this.println(`hosts:${bonds.length} connected:${bonds.filter((b) => b.state === "connected").length} advertising:0 pairing:0`);
        }
        if (sub === "forget" && /^[0-2]$/.test(n || "") && this.ble.filter(Boolean)[+n]) {
          const was = this.ble.filter(Boolean)[+n];
          this.ble = [...this.ble.filter((b) => b && b !== was), null];
          if (was && was.state === "connected") this.event(`BLE ${n} down`);
          return this.println(`forgot ${n}`);
        }
        return this.println("ble list | ble forget <n>");
      }
      case "reboot": return this.println("rebooting");
      default: return this.println("unknown");
    }
  }
}

// SerialPort-compatible class bound to one SimDevice. `ports` is what list() returns.
function makeSimPort(device, ports = [{ path: "SIM1", vendorId: "1a86", productId: "7523", friendlyName: "USB-SERIAL CH340 (SIM)" }]) {
  return class SimPort extends EventEmitter {
    static async list() { return ports; }
    constructor(opts, cb) {
      super();
      this.path = opts.path;
      this.isOpen = false;
      this._buf = "";
      setImmediate(() => {
        if (!ports.some((p) => p.path === opts.path)) return cb && cb(new Error(`File not found: ${opts.path}`));
        this.isOpen = true;
        device.out = (text) => setImmediate(() => this.isOpen && this.emit("data", Buffer.from(text, "utf8")));
        cb && cb(null);
      });
    }
    write(data, cb) {
      this._buf += data.toString();
      let i;
      while ((i = this._buf.indexOf("\n")) >= 0) {
        const line = this._buf.slice(0, i);
        this._buf = this._buf.slice(i + 1);
        device.line(line);
      }
      if (cb) setImmediate(() => cb(null));
      return true;
    }
    close(cb) {
      if (!this.isOpen) return cb && cb(null);
      this.isOpen = false;
      setImmediate(() => { this.emit("close"); cb && cb(null); });
    }
  };
}

module.exports = { SimDevice, makeSimPort, PROMPT };
