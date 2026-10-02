/* Settings persisted as JSON in the data dir (dev: studio/data, packaged: userData). */
"use strict";

const fs = require("fs");
const path = require("path");

let DATA_DIR = path.resolve(__dirname, "..", "data");
function configure(opts = {}) { if (opts.dataDir) DATA_DIR = opts.dataDir; }
const file = () => path.join(DATA_DIR, "settings.json");

const DEFAULTS = {
  auto_connect: true,
  baud: 921600,
  auto_switch_enabled: false,
  context_profiles: {},          // context id -> profile slot (1..8)
  host_slots: {},                // "0".."47" -> host cmd (PLAN.md §9)
  obs_enabled: false,
  obs_url: "ws://127.0.0.1:4455",
  obs_password: "",
  nowplaying_enabled: true,
  art_enabled: true,             // album art to the keypad's player page
  preview_theme: "daylight",     // the editor preview's theme while no keypad is connected
  settime_enabled: true,
};

function load() {
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(file(), "utf8")); } catch (_) {}
  const out = { ...DEFAULTS };
  for (const [k, v] of Object.entries(raw)) if (k in out && typeof v === typeof out[k]) out[k] = v;
  return out;
}

function save(patch) {
  const merged = { ...load(), ...patch };
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(file(), JSON.stringify(merged, null, 2));
  } catch (e) { console.error("settings write failed:", e.message); }
  return merged;
}

module.exports = { configure, load, save, DEFAULTS, dataDir: () => DATA_DIR };
