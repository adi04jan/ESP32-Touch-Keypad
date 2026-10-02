/* Device session: everything between the editor and the serial link.
 * Live push (setkey/sethold/setface/title, debounced 300 ms), autosave (1500 ms
 * after the last edit, PC backup first), tile sync (§8.4), feeds and BLE slots.
 * Runs in the main process; the e2e test drives it against test/sim-device.js. */
"use strict";

const fs = require("fs");
const path = require("path");
const { EventEmitter } = require("events");
const schema = require("./schema");
const tiles = require("./tiles");
const feeds = require("./feeds");
const hostbridge = require("./hostbridge");
const { parseStatus } = require("./serial");

const FS_RESERVE = 64 * 1024;   // keep this much LittleFS free after tile uploads

class Device extends EventEmitter {
  /* deps: { link: SerialLink, backup, settings: {load(), save(patch)}, tileDir?, bridge?: HostBridge,
   *         pushMs = 300, saveMs = 1500 } */
  constructor(deps) {
    super();
    this.link = deps.link;
    this.backup = deps.backup;
    this.settings = deps.settings;
    this.bridge = deps.bridge || null;
    this.tileDir = deps.tileDir || null;
    this.hostName = deps.hostName || null;   // names this PC on the keypad's status bar and host list
    this.pushMs = deps.pushMs ?? 300;
    this.saveMs = deps.saveMs ?? 1500;
    this.profiles = {};            // slot -> latest editor profile
    this.status = null;
    this.activeSlot = null;        // device's active profile
    this.devicePage = null;        // device's current page (1-based)
    this.deviceTiles = new Set();
    this.tileCache = new Map();    // name -> rgb565 Buffer
    this._push = new Map();        // debounce timers
    this._save = new Map();
    this._clock = null;
    this._np = null;
    this._art = null;

    const l = this.link;
    l.on("open", () => this.emit("state", this.state()));
    l.on("disconnect", () => { clearInterval(this._clock); this.status = null; this.emit("state", this.state()); });
    l.on("profile", (n) => { this.activeSlot = n; this.devicePage = 1; this.emit("state", this.state()); });
    l.on("page", (n) => { this.devicePage = n; this.emit("state", this.state()); });
    l.on("ble", (b) => { if (b.up && this.hostName) this.link.command(`hostname ${this.hostName}`); });
  }

  state() {
    return { connected: this.link.isOpen(), path: this.link.path, status: this.status, activeSlot: this.activeSlot, page: this.devicePage };
  }

  // ---- connection ----
  async connect(portPath) {
    const baud = this.settings.load().baud;
    let found;
    if (portPath) {
      if (!(await this.link.connect(portPath, baud))) return { ok: false, error: `cannot open ${portPath}` };
      await this.link.waitReady();
      found = { path: portPath, status: parseStatus(await this.link.command("status")) };
      if (found.status.model !== "touch") this.emit("log", `Warning: ${portPath} did not report model:touch.\n`);
    } else {
      found = await this.link.detect(baud);
      if (!found) return { ok: false, error: "no Touch Keypad found (CH340 + model:touch)" };
    }
    await this.onConnected(found.status);
    return { ok: true, path: found.path, status: this.status };
  }

  async onConnected(status) {
    this.status = status;
    this._np = null;
    this.activeSlot = parseInt(status.profile, 10) || 1;
    this.devicePage = parseInt(status.page, 10) || 1;
    if (this.settings.load().settime_enabled) {
      await this.syncTime();
      clearInterval(this._clock);
      this._clock = setInterval(() => this.syncTime(), 60 * 60 * 1000);
      if (this._clock.unref) this._clock.unref();
    }
    this.deviceTiles = tiles.parseTileList(await this.link.command("ls /t"));
    if (this.hostName && +status.ble > 0) await this.link.command(`hostname ${this.hostName}`);
    this.emit("state", this.state());
  }

  disconnect() { this.link.disconnect(); }
  syncTime() { return this.link.command(feeds.timeCommand()); }

  async refreshStatus() {
    if (!this.link.isOpen()) return null;
    this.status = parseStatus(await this.link.command("status"));
    this.activeSlot = parseInt(this.status.profile, 10) || this.activeSlot;
    this.devicePage = parseInt(this.status.page, 10) || this.devicePage;
    this.emit("state", this.state());
    return this.status;
  }

  // ---- profiles ----
  async loadProfile(slot) {
    if (!this.link.isOpen()) return null;
    if (this._save.has(slot)) await this.flush();     // never read back a file with edits still pending
    await this.link.command(`setprofile ${slot}`);
    this.activeSlot = slot;
    this.devicePage = 1;
    const raw = await this.link.readFile(`profile${slot}.json`);
    let p = null;
    try { p = schema.repairProfile(JSON.parse(raw)); } catch (_) {}
    if (p) this.profiles[slot] = p;
    this.emit("state", this.state());
    return p;
  }

  async showPage(slot, page) {
    if (!this.link.isOpen() || slot !== this.activeSlot || page === this.devicePage) return;
    await this.link.command(`page ${page}`);
    this.devicePage = page;
  }

  /* One editor change. kinds ⊂ actions | hold | face | title | structure.
   * Schedules the live preview (debounced per key) and the autosave. */
  edit({ slot, profile, page, keyId, kinds = [] }) {
    this.profiles[slot] = profile;
    if (keyId && kinds.some((k) => k !== "structure")) {
      const id = `${slot}:${page}:${keyId}`;
      const prev = this._push.get(id);
      clearTimeout(prev && prev.t);
      const pending = new Set([...(prev ? prev.kinds : []), ...kinds]);
      this._push.set(id, { kinds: pending, t: setTimeout(() => { this._push.delete(id); this.push(slot, page, keyId, pending); }, this.pushMs) });
    }
    clearTimeout(this._save.get(slot));
    this.emit("save-state", { slot, state: "pending" });
    this._save.set(slot, setTimeout(() => { this._save.delete(slot); this.save(slot); }, this.saveMs));
  }

  // Live RAM preview of one key on the device (only when that profile is active there).
  async push(slot, page, keyId, kinds) {
    if (!this.link.isOpen() || slot !== this.activeSlot) return false;
    const p = this.profiles[slot];
    const k = p && p.pages[page - 1] && p.pages[page - 1].keys[keyId - 1];
    if (!k || k.widget) return false;
    await this.showPage(slot, page);
    const clean = schema.repairProfile(p).pages[page - 1].keys[keyId - 1];
    if (kinds.has("actions")) await this.link.command(`setkey ${keyId} ${JSON.stringify(clean.actions)}`);
    if (kinds.has("hold")) await this.link.command(`sethold ${keyId} ${JSON.stringify(clean.hold_actions || [])}`);
    if (kinds.has("face") && clean.tile) {
      await this.ensureTile(clean.tile);
      await this.link.command(`setface ${keyId} ${clean.tile} ${clean.led_color.join(" ")}`);
    }
    if (kinds.has("title")) await this.link.command(`title ${keyId} ${clean.name}`);
    return true;
  }

  // Flush pending debounces now (used on quit and by tests).
  async flush() {
    const pushes = [...this._push.entries()];
    this._push.clear();
    for (const [id, v] of pushes) {
      clearTimeout(v.t);
      const [slot, page, keyId] = id.split(":").map(Number);
      await this.push(slot, page, keyId, v.kinds);
    }
    const saves = [...this._save.keys()];
    for (const slot of saves) { clearTimeout(this._save.get(slot)); this._save.delete(slot); await this.save(slot); }
  }

  /* Write a profile: repair, assign host slots, validate, PC backup, sync tiles,
   * upload, reload. Returns { ok, errors?, error?, backup?, profile? }. */
  async save(slot, profile = this.profiles[slot]) {
    if (!profile) return { ok: false, error: "nothing to save" };
    this.profiles[slot] = profile;
    const clean = schema.repairProfile(profile);
    const s = this.settings.load();
    const { slots, errors: slotErr } = hostbridge.assignSlots([clean], s.host_slots);
    if (JSON.stringify(slots) !== JSON.stringify(s.host_slots)) this.settings.save({ host_slots: slots });
    if (this.bridge) this.emit("bridge", this.bridge.apply(slots));
    const v = schema.validateProfile(clean);
    const errors = [...slotErr, ...v.errors];
    if (errors.length) { this.emit("save-state", { slot, state: "error", errors }); return { ok: false, errors }; }

    const bk = this.backup.autoBackup(slot, clean);   // backup BEFORE every device write
    if (!this.link.isOpen()) { this.emit("save-state", { slot, state: "offline" }); return { ok: false, error: "not connected", backup: bk, profile: clean }; }

    this.emit("save-state", { slot, state: "saving" });
    const t = await this.syncTiles(clean);
    if (!t.ok) { this.emit("save-state", { slot, state: "error", errors: [t.error] }); return { ok: false, error: t.error, backup: bk }; }
    const r = await this.link.uploadJson(`profile${slot}.json`, clean);
    if (!r.ok) { this.emit("save-state", { slot, state: "error", errors: [r.reply] }); return { ok: false, error: r.reply, backup: bk }; }
    if (slot === this.activeSlot) {
      const page = this.devicePage || 1;
      await this.link.command(`setprofile ${slot}`);
      this.devicePage = 1;
      if (page > 1 && page <= clean.pages.length) await this.showPage(slot, page);
    }
    this.emit("save-state", { slot, state: "saved" });
    return { ok: true, backup: bk, profile: clean };
  }

  // ---- tiles ----
  // RGBA from the renderer -> cached RGB565, named by CRC32. Uploads right away when connected.
  async putTile(rgba) {
    const buf = tiles.rgbaToRgb565(Buffer.from(rgba));
    const name = tiles.tileName(buf);
    this.tileCache.set(name, buf);
    if (this.tileDir) {
      try { fs.mkdirSync(this.tileDir, { recursive: true }); fs.writeFileSync(path.join(this.tileDir, `${name}.565`), buf); } catch (_) {}
    }
    if (this.link.isOpen()) await this.ensureTile(name);
    return name;
  }

  _tileBytes(name) {
    if (this.tileCache.has(name)) return this.tileCache.get(name);
    if (!this.tileDir) return null;
    try { const b = fs.readFileSync(path.join(this.tileDir, `${name}.565`)); this.tileCache.set(name, b); return b; } catch (_) { return null; }
  }

  async ensureTile(name) {
    if (this.deviceTiles.has(name)) return { ok: true };
    const buf = this._tileBytes(name);
    if (!buf) return { ok: false, error: `tile ${name} is not cached on this PC` };
    const r = await this.link.uploadBinary(tiles.tilePath(name), buf);
    if (r.ok) this.deviceTiles.add(name);
    else this.emit("log", `Tile ${name} upload failed: ${r.reply}\n`);
    return r.ok ? { ok: true } : { ok: false, error: r.reply };
  }

  // §8.4 steps 2–3: upload referenced tiles the device lacks, after a space check.
  async syncTiles(profile) {
    this.deviceTiles = tiles.parseTileList(await this.link.command("ls /t"));
    const need = new Set();
    for (const pg of profile.pages) for (const k of pg.keys) if (k && k.tile && !this.deviceTiles.has(k.tile)) need.add(k.tile);
    const missing = [...need].filter((n) => this._tileBytes(n));
    if (need.size > missing.length) this.emit("log", `${need.size - missing.length} tile(s) are neither on the device nor cached here; they will show blank.\n`);
    if (!missing.length) return { ok: true, uploaded: 0 };
    const fsInfo = (await this.link.command("fsinfo", undefined, true)).match(/FS_INFO:(\d+),(\d+)/);
    if (fsInfo) {
      const free = +fsInfo[1] - +fsInfo[2], want = missing.length * tiles.TILE_BYTES;
      if (free - want < FS_RESERVE) return { ok: false, error: `device storage low: ${free} B free, tiles need ${want} B` };
    }
    for (const n of missing) { const r = await this.ensureTile(n); if (!r.ok) return r; }
    return { ok: true, uploaded: missing.length };
  }

  // ---- device panel ----
  // `ble list`: "<n> <address> connected|bonded <name>" per bond, then a hosts: summary.
  async bleList() {
    const raw = await this.link.command("ble list", undefined, true);
    const slots = [];
    for (const line of raw.split("\n")) {
      const m = line.trim().match(/^(\d+)\s+(\S+)\s+(connected|bonded)(?:\s+(.+))?$/i);
      if (m) slots.push({ slot: +m[1], addr: m[2], state: m[3].toLowerCase(), name: m[4] || `Host ${+m[1] + 1}` });
    }
    return { slots, raw };
  }
  bleForget(n) { return this.link.command(`ble forget ${parseInt(n, 10)}`); }
  bleUse(n) { return this.link.command(`ble use ${parseInt(n, 10)}`); }

  // Screen brightness, LED pattern/colour/brightness and key click, read without changing anything.
  async look() {
    if (!this.link.isOpen()) return null;
    const led = (await this.link.command("led", undefined, true)).match(/led (\w+) color (\d+) (\d+) (\d+) brightness (\d+)/);
    const br = (await this.link.command("setbrightness", undefined, true)).match(/brightness (\d+)/);
    const ck = (await this.link.command("click", undefined, true)).match(/click (on|off)/);
    const th = (await this.link.command("theme", undefined, true)).match(/^theme (\w+)$/m);
    return { led: led ? led[1] : "", ledColor: led ? `${led[2]} ${led[3]} ${led[4]}` : "", ledBright: led ? +led[5] : 0, brightness: br ? +br[1] : 0, click: !!ck && ck[1] === "on", theme: th ? th[1] : "" };
  }

  async fsinfo() {
    const m = (await this.link.command("fsinfo", undefined, true)).match(/FS_INFO:(\d+),(\d+)/);
    return m ? { total: +m[1], used: +m[2] } : null;
  }

  async setActiveProfile(n) {
    if (!this.link.isOpen() || n === this.activeSlot) return;
    await this.link.command(`setprofile ${n}`);
    this.activeSlot = n;
    this.devicePage = 1;
    this.emit("state", this.state());
  }

  // Album art: the helper's 128x128 BMP -> RGB565 straight into the player's RAM buffer.
  // key = "title|artist|album" of the track it belongs to.
  art(bmp, key = "") {
    try { this._art = { buf: feeds.bmpToRgb565(bmp), key }; } catch (e) { this.emit("log", `Album art skipped: ${e.message}\n`); return Promise.resolve(false); }
    return this._sendArt();
  }
  async _sendArt() {
    if (!this._art || !this.link.isOpen() || this.settings.load().art_enabled === false) return false;
    return (await this.link.uploadBinary("ram:art", this._art.buf)).ok;
  }

  // Now Playing: push to the widget when something the device can't extrapolate changed.
  // A new title clears the keypad's cover, so a cover we already hold for it goes again.
  nowPlaying(np) {
    const now = Date.now();
    if (!this.link.isOpen() || !feeds.shouldSend(this._np && this._np.data, np, this._np ? this._np.at : 0, now)) return false;
    const newTrack = !this._np || this._np.data.title !== np.title;
    this._np = { data: np, at: now };
    this.link.command(feeds.nowPlayingCommand(np));
    if (newTrack && this._art && this._art.key === `${np.title ?? ""}|${np.artist ?? ""}|${np.album ?? ""}`) this._sendArt();
    return true;
  }
}

module.exports = { Device };
