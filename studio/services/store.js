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
  context_profiles: {},          // context id or process name -> profile slot (1..16)
  host_slots: {},                // "0".."47" -> host cmd (PLAN.md §9)
  obs_enabled: false,
  obs_url: "ws://127.0.0.1:4455",
  obs_password: "",
  nowplaying_enabled: true,
  notifications_enabled: true,   // this PC's Windows notifications to the keypad's bell, banner and shade
  art_enabled: true,             // album art to the keypad's player page
  preview_theme: "daylight",
  console_open: false,           // the device console starts folded away     // the editor preview's theme while no keypad is connected
  settime_enabled: true,
  suggest_half_life_days: 7,     // the quick bar's suggestion: a press counts half after this many days
  suggest_min_weight: 3,         // ... and a profile needs this much weight to be suggested
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
    fs.writeFileSync(`${file()}.tmp`, JSON.stringify(merged, null, 2));   // whole or not at all: a write that dies
    fs.renameSync(`${file()}.tmp`, file());                               // halfway never resets every setting
  } catch (e) { console.error("settings write failed:", e.message); }
  return merged;
}

module.exports = { configure, load, save, DEFAULTS, dataDir: () => DATA_DIR };
