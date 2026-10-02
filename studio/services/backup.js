/* Local PC backups of device profiles (copied from Macropad Studio 2.1).
 * Auto: a timestamped snapshot before every device write, pruned to the last N
 *       per profile. Manual: a full snapshot of all profiles on demand.
 * Everything lands under device_backups/ (gitignored — may hold secrets). */
"use strict";

const fs = require("fs");
const path = require("path");

// Writable base dir (dev: studio/; packaged: userData — set by main.js).
let BASE_DIR = path.resolve(__dirname, "..");
let BACKUP_ROOT = path.join(BASE_DIR, "device_backups");
function configure(opts = {}) {
  if (opts.dataDir) { BASE_DIR = opts.dataDir; BACKUP_ROOT = path.join(BASE_DIR, "device_backups"); }
}
const AUTO_KEEP = 20;   // snapshots retained per profile

function stamp() { return new Date().toISOString().replace(/[:.]/g, "-"); }
function ensure(dir) { fs.mkdirSync(dir, { recursive: true }); }

// One snapshot of a single profile, taken before a device write. Pruned to AUTO_KEEP.
function autoBackup(slot, profileObj) {
  try {
    const dir = path.join(BACKUP_ROOT, "auto", `profile${slot}`);
    ensure(dir);
    const file = path.join(dir, `${stamp()}.json`);
    fs.writeFileSync(file, JSON.stringify(profileObj, null, 2));
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
    while (files.length > AUTO_KEEP) {
      const old = files.shift();
      try { fs.unlinkSync(path.join(dir, old)); } catch (_) {}
    }
    return { ok: true, file };
  } catch (e) { return { ok: false, error: e.message }; }
}

// All provided profiles into one timestamped folder. profiles = { "1": obj, ... }.
function manualBackupAll(profiles) {
  try {
    const dir = path.join(BACKUP_ROOT, "manual", stamp());
    ensure(dir);
    let count = 0;
    for (const slot of Object.keys(profiles)) {
      if (!profiles[slot]) continue;
      fs.writeFileSync(path.join(dir, `profile${slot}.json`), JSON.stringify(profiles[slot], null, 2));
      count++;
    }
    return { ok: true, path: dir, count };
  } catch (e) { return { ok: false, error: e.message }; }
}

// Reconstruct a Date from a stamp like "2026-06-16T10-55-02-674Z".
function stampToDate(stem) {
  const iso = stem.replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, "T$1:$2:$3.$4Z");
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

// List every available backup (auto snapshots + manual sets), newest first.
// Each: { id (relative path under device_backups), kind, slot, time, label }.
function listBackups() {
  const out = [];
  const autoRoot = path.join(BACKUP_ROOT, "auto");
  if (fs.existsSync(autoRoot)) {
    for (const pd of fs.readdirSync(autoRoot)) {
      const m = pd.match(/^profile(\d+)$/); if (!m) continue;
      const dir = path.join(autoRoot, pd);
      for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json"))) {
        const d = stampToDate(f.replace(/\.json$/, ""));
        out.push({ id: ["auto", pd, f].join("/"), kind: "auto", slot: parseInt(m[1], 10),
          time: d ? d.getTime() : 0, label: d ? d.toLocaleString() : f });
      }
    }
  }
  const manualRoot = path.join(BACKUP_ROOT, "manual");
  if (fs.existsSync(manualRoot)) {
    for (const set of fs.readdirSync(manualRoot)) {
      const sd = path.join(manualRoot, set);
      let isDir = false; try { isDir = fs.statSync(sd).isDirectory(); } catch (_) {}
      if (!isDir) continue;
      const d = stampToDate(set);
      for (const f of fs.readdirSync(sd).filter((x) => /^profile\d+\.json$/.test(x))) {
        out.push({ id: ["manual", set, f].join("/"), kind: "manual", slot: parseInt(f.match(/profile(\d+)/)[1], 10),
          time: d ? d.getTime() : 0, label: d ? d.toLocaleString() : set });
      }
    }
  }
  out.sort((a, b) => b.time - a.time);
  return out;
}

// Read one backup by its (sanitized) id. Refuses anything outside device_backups.
function readBackup(id) {
  const root = path.resolve(BACKUP_ROOT);
  const full = path.resolve(root, String(id));
  if (full !== root && !full.startsWith(root + path.sep)) throw new Error("invalid backup id");
  return JSON.parse(fs.readFileSync(full, "utf8"));
}

module.exports = { root: () => BACKUP_ROOT, configure, autoBackup, manualBackupAll, listBackups, readBackup };
