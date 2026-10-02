/* Serial link to the Touch Keypad. Adapted from Macropad Studio 2.1
 * services/serial.js: one serialized command queue, prompt detection, EVT:
 * diversion and paced uploads, plus binary (###BEGINB###) tile uploads, v2
 * events and CH340 + `model:touch` detection (PLAN.md §8, PROTOCOL.md).
 *
 * Emits: 'log'(text), 'tx'(text), 'rx'(line), 'fs-info'({total,used}),
 *        'key'({page,id,state}), 'profile'(n), 'page'(n), 'ble'({slot,up}),
 *        'idle'(name), 'open', 'disconnect'. */
"use strict";

const { EventEmitter } = require("events");
const { buildBinaryUploadLines } = require("./tiles");

const PROMPT = "macropad:$";
const CAPTURE_TIMEOUT_MS = 4000;
const CH340 = { vendorId: "1A86", productId: "7523" };
const DEFAULT_BAUD = 921600;

function parseFsInfo(line) {
  const m = String(line).trim().match(/^FS_INFO:(\d+),(\d+)/);
  return m ? { total: +m[1], used: +m[2] } : null;
}

// "Profile:1 loaded:1 idle:0 mode:ble ver:3.0.0 model:touch page:1 ble:1" -> {profile:"1", …}
function parseStatus(text) {
  const out = {};
  for (const m of String(text).matchAll(/([A-Za-z_]+):(\S+)/g)) out[m[1].toLowerCase()] = m[2];
  return out;
}

function buildUploadLines(filename, obj) {
  const name = String(filename).replace(/^\/+/, "");
  return [`###BEGIN### ${name}`, ...JSON.stringify(obj, null, 1).split("\n"), "###END###"];
}

function stripCatEcho(text) {
  const lines = String(text).trim().split("\n");
  if (lines.length && lines[0].trimStart().startsWith("cat ")) lines.shift();
  return lines.join("\n").trim();
}

const uploadOk = (reply) => /^\s*SAVED\b/m.test(reply) || /->\s*OK/.test(reply);

class SerialLink extends EventEmitter {
  /* opts.SerialPort: class with the `serialport` API (tests pass the simulator).
   * opts.uploadRate: bytes/s while streaming uploads (Infinity = no pacing). */
  constructor(opts = {}) {
    super();
    this.SerialPort = opts.SerialPort || null;
    this.uploadRate = opts.uploadRate ?? 30000;
    this.port = null;
    this.path = null;
    this._partial = "";
    this._reading = false;
    this._readLines = [];
    this._readResolve = null;
    this._readTimer = null;
    this._chain = null;
  }

  _impl() {
    if (!this.SerialPort) this.SerialPort = require("serialport").SerialPort;
    return this.SerialPort;
  }

  async listPorts() {
    try {
      const ports = await this._impl().list();
      return ports.map((p) => ({
        path: p.path,
        label: `${p.path}${p.friendlyName ? " · " + p.friendlyName : ""}`,
        vendorId: (p.vendorId || "").toUpperCase(), productId: (p.productId || "").toUpperCase(),
        ch340: (p.vendorId || "").toUpperCase() === CH340.vendorId && (p.productId || "").toUpperCase() === CH340.productId,
      }));
    } catch (e) {
      this.emit("log", `Port list error: ${e.message}\n`);
      return [];
    }
  }

  isOpen() { return !!(this.port && this.port.isOpen); }

  connect(path, baud = DEFAULT_BAUD) {
    return new Promise((resolve) => {
      if (this.isOpen()) return resolve(true);
      const Impl = this._impl();
      const port = new Impl({ path, baudRate: baud }, (err) => {
        if (err) {
          this.emit("log", `Connection error: ${err.message}\n`);
          this.port = null;
          return resolve(false);
        }
        this._partial = "";
        this.path = path;
        this.emit("log", `Connected to ${path} at ${baud} baud.\n`);
        this.emit("open");
        resolve(true);
      });
      this.port = port;
      port.on("data", (buf) => this._feed(buf.toString("utf8")));
      port.on("error", (e) => { this.emit("log", `Serial error: ${e.message}\n`); this._down(port); });
      port.on("close", () => this._down(port));
    });
  }

  _down(port) {
    if (port && this.port && this.port !== port) return;
    const was = !!this.port;
    this.port = null;
    if (this._reading) { this.emit("log", "Connection lost during a device operation.\n"); this._finishRead(); }
    if (was) this.emit("disconnect");
  }

  disconnect() {
    const p = this.port;
    if (p) { try { p.close(); } catch (_) {} }
    this._down(p);
  }

  send(cmd) {
    if (!this.isOpen()) return;
    this.port.write(cmd + "\n", (e) => { if (e) this.emit("log", `Write error: ${e.message}\n`); });
  }

  // ---- serialized device I/O ----------------------------------------
  _runExclusive(fn) {
    const run = () => fn();
    this._chain = (this._chain || Promise.resolve()).then(run, run);
    return this._chain;
  }

  _capture(timeoutMs, onTimeout) {
    this._reading = true;
    this._readLines = [];
    clearTimeout(this._readTimer);
    this._readTimer = setTimeout(() => { if (onTimeout) onTimeout(); this._finishRead(true); }, timeoutMs);
  }

  // Send a command; resolve with its output once the prompt returns ("" on timeout / offline).
  command(cmd, timeoutMs = CAPTURE_TIMEOUT_MS) {
    return this._runExclusive(() => new Promise((resolve) => {
      if (!this.isOpen()) return resolve("");
      this._readResolve = resolve;
      this._capture(timeoutMs, () => this.emit("log", `Device did not answer '${cmd.split(" ")[0]}' in time.\n`));
      this.emit("tx", cmd);
      this.send(cmd);
    }));
  }

  _finishRead() {
    clearTimeout(this._readTimer);
    const lines = this._readLines, resolve = this._readResolve;
    this._reading = false; this._readLines = []; this._readResolve = null;
    if (resolve) resolve(lines.join("\n"));
  }

  // After open the board may still be booting (CH340 DTR/RTS can reset it):
  // poke with empty lines until a prompt comes back.
  async waitReady(totalMs = 3000) {
    const t0 = Date.now();
    while (this.isOpen() && Date.now() - t0 < totalMs) {
      let got = false;
      await this._runExclusive(() => new Promise((resolve) => {
        this._readResolve = () => { got = true; resolve(); };
        this._capture(500, () => { this._readResolve = null; resolve(); });
        this.send("");
      }));
      if (got) return true;
    }
    return false;
  }

  // Stream lines paced to uploadRate bytes/s; resolve { ok, reply } on the closing prompt.
  _upload(label, lines) {
    return this._runExclusive(() => new Promise((resolve) => {
      if (!this.isOpen()) return resolve({ ok: false, reply: "not connected" });
      const bytes = lines.reduce((n, l) => n + l.length + 1, 0);
      const rate = this.uploadRate;
      this._readResolve = (reply) => resolve({ ok: uploadOk(reply), reply });
      this._capture(8000 + (Number.isFinite(rate) ? (bytes / rate) * 1000 : 0),
        () => this.emit("log", `Upload of ${label} timed out; device did not acknowledge.\n`));
      this.emit("tx", `${lines[0]}  (${lines.length - 2} lines, ${bytes} B)`);
      const t0 = Date.now();
      let i = 0, sent = 0;
      const pump = () => {
        if (!this.isOpen()) { this._finishRead(); return; }
        const budget = Number.isFinite(rate) ? 256 + ((Date.now() - t0) * rate) / 1000 : Infinity;
        while (i < lines.length && sent < budget) { const l = lines[i++]; this.send(l); sent += l.length + 1; }
        if (i < lines.length) setTimeout(pump, 4);
      };
      pump();
    }));
  }

  uploadJson(filename, obj) {
    let lines;
    try { lines = buildUploadLines(filename, obj); }
    catch (e) { return Promise.resolve({ ok: false, reply: `serialization error: ${e.message}` }); }
    return this._upload(filename, lines);
  }

  uploadBinary(path, buf) { return this._upload(path, buildBinaryUploadLines(path, buf)); }

  readFile(filename) {
    if (!filename.startsWith("/")) filename = "/" + filename;
    return this.command(`cat ${filename}`).then(stripCatEcho);
  }

  // Find the keypad: CH340 port whose `status` reply carries model:touch.
  async detect(baud = DEFAULT_BAUD) {
    if (this.isOpen()) {
      const st = parseStatus(await this.command("status"));
      return st.model === "touch" ? { path: this.path, status: st } : null;
    }
    for (const p of (await this.listPorts()).filter((x) => x.ch340)) {
      if (!(await this.connect(p.path, baud))) continue;
      await this.waitReady();
      const st = parseStatus(await this.command("status"));
      if (st.model === "touch") return { path: p.path, status: st };
      this.emit("log", `${p.path} is a CH340 but not a Touch Keypad; skipping.\n`);
      this.disconnect();
    }
    return null;
  }

  // Device -> app live events (PLAN.md §8.2).
  _handleEvent(body) {
    const t = body.split(/\s+/);
    switch (t[0]) {
      case "KEY": this.emit("key", { page: +t[1], id: +t[2], state: t[3] }); break;
      case "PROFILE": this.emit("profile", +t[1]); break;
      case "PAGE": this.emit("page", +t[1]); break;
      case "BLE": this.emit("ble", { slot: +t[1], up: t[2] === "up" }); break;
      case "IDLE": this.emit("idle", t[1] || "none"); break;
      default: this.emit("event", body);
    }
  }

  // -- line assembly --------------------------------------------------
  // The prompt has no newline after it and may arrive split across chunks, so
  // look for it in the accumulated tail, not in the latest chunk.
  _feed(text) {
    if (!text) return;
    let s = this._partial + text;
    if (this._afterPrompt) { if (s[0] === " ") s = s.slice(1); this._afterPrompt = false; }   // the prompt's trailing space
    const parts = s.split("\n");
    this._partial = parts.pop();
    for (const line of parts) this._handleLine(line);
    let at;
    while ((at = this._partial.indexOf(PROMPT)) >= 0) {
      const head = this._partial.slice(0, at + PROMPT.length);
      this._partial = this._partial.slice(at + PROMPT.length);
      if (this._partial[0] === " ") this._partial = this._partial.slice(1);
      else if (!this._partial) this._afterPrompt = true;
      this._handleLine(head);
    }
  }

  _handleLine(line) {
    const clean = line.replace(/\r/g, "");
    const at = clean.indexOf(PROMPT);
    if (at >= 0) {
      if (clean.slice(0, at).trim()) this._handleLine(clean.slice(0, at));
      if (this._reading) this._finishRead();
      const rest = clean.slice(at + PROMPT.length).replace(/^ /, "");
      if (rest) this._handleLine(rest);
      return;
    }
    if (clean.startsWith("EVT:")) { this.emit("rx", clean); this._handleEvent(clean.slice(4).trim()); return; }
    const fs = parseFsInfo(clean);
    if (fs) this.emit("fs-info", fs);
    if (clean.trim() !== "") this.emit("rx", clean);
    if (this._reading) this._readLines.push(clean);
  }
}

module.exports = { SerialLink, PROMPT, CH340, DEFAULT_BAUD, parseFsInfo, parseStatus, buildUploadLines, stripCatEcho, uploadOk };
