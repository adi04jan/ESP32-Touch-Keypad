/* Firmware install from Studio. esptool writes the same four images the
 * Arduino uploader writes (bootloader 0x1000, partitions 0x8000, boot_app0
 * 0xe000, app 0x10000), so NVS (pairings, calibration, settings) and LittleFS
 * (profiles) stay as they are.
 * Packaged: <resources>/firmware/ holds esptool.exe, the four .bin files and
 * version.txt (staged by scripts/stage-firmware.js). Dev: build/fw-release from
 * `tools/kp.py build --release` plus esptool and boot_app0 from the Arduino
 * esp32 core. Test builds (build/fw, HID dry-run on) are never installed. */
"use strict";

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const CORE = path.join(process.env.LOCALAPPDATA || "", "Arduino15", "packages", "esp32");
const IMAGES = [["0x1000", "bootloader.bin"], ["0x8000", "partitions.bin"], ["0xe000", "boot_app0.bin"], ["0x10000", "app.bin"]];

const newest = (dir) => { try { return fs.readdirSync(dir).sort().reverse().map((d) => path.join(dir, d)); } catch (_) { return []; } };

// -> { esptool, files: {name: path}, version } or { error }
function locate(resourcesPath) {
  const packed = resourcesPath && path.join(resourcesPath, "firmware");
  if (packed && fs.existsSync(path.join(packed, "app.bin"))) {
    const files = Object.fromEntries(IMAGES.map(([, n]) => [n, path.join(packed, n)]));
    let version = "";
    try { version = fs.readFileSync(path.join(packed, "version.txt"), "utf8").trim(); } catch (_) {}
    return { esptool: path.join(packed, "esptool.exe"), files, version };
  }
  const fw = path.join(ROOT, "build", "fw-release");
  const files = {
    "bootloader.bin": path.join(fw, "TouchKeypad.ino.bootloader.bin"),
    "partitions.bin": path.join(fw, "TouchKeypad.ino.partitions.bin"),
    "app.bin": path.join(fw, "TouchKeypad.ino.bin"),
    "boot_app0.bin": newest(path.join(CORE, "hardware", "esp32")).map((d) => path.join(d, "tools", "partitions", "boot_app0.bin")).find(fs.existsSync),
  };
  const esptool = newest(path.join(CORE, "tools", "esptool_py")).map((d) => path.join(d, "esptool.exe")).find(fs.existsSync);
  const missing = Object.entries(files).filter(([, p]) => !p || !fs.existsSync(p)).map(([n]) => n);
  if (!esptool) missing.push("esptool.exe");
  if (missing.length) return { error: `firmware files not found: ${missing.join(", ")} (run tools/kp.py build --release)` };
  let version = "";
  try { version = fs.readFileSync(path.join(ROOT, "firmware", "TouchKeypad", "board.h"), "utf8").match(/FW_VERSION\s+"([^"]+)"/)[1]; } catch (_) {}
  return { esptool, files, version };
}

function info(resourcesPath) {
  const l = locate(resourcesPath);
  if (l.error) return { available: false, note: `Studio can't install firmware here: ${l.error}.` };
  return { available: true, version: l.version, note: `Installs firmware ${l.version || ""} over USB. Profiles, Bluetooth pairings and touch calibration are kept.` };
}

/* Runs esptool on `port`. onProgress({pct, msg}). Resolves { ok, error?, log }.
 * The caller must close its own handle on the port first. */
function flash(port, resourcesPath, onProgress = () => {}) {
  const l = locate(resourcesPath);
  if (l.error) return Promise.resolve({ ok: false, error: l.error, log: "" });
  const sizes = IMAGES.map(([, n]) => fs.statSync(l.files[n]).size), total = sizes.reduce((a, b) => a + b, 0);
  const args = ["--chip", "esp32", "--port", port, "--baud", "921600", "--before", "default-reset", "--after", "hard-reset", "write-flash", "-z",
    "--flash-mode", "keep", "--flash-freq", "keep", "--flash-size", "keep", ...IMAGES.flatMap(([addr, n]) => [addr, l.files[n]])];
  return new Promise((resolve) => {
    let log = "", img = 0, done = 0;
    const child = spawn(l.esptool, args, { windowsHide: true });
    const feed = (d) => {
      const s = d.toString();
      log += s;
      for (const line of s.split(/[\r\n]+/)) {
        if (/Connecting/.test(line)) onProgress({ pct: 0, msg: "Connecting to the keypad…" });
        const m = line.match(/Writing at 0x[0-9a-f]+.*?(\d+(?:\.\d+)?) ?%/i);
        if (m) onProgress({ pct: Math.min(100, Math.round(((done + (sizes[img] || 0) * +m[1] / 100) / total) * 100)), msg: `Writing ${IMAGES[img] ? IMAGES[img][1] : ""}…` });
        if (/^Wrote \d+ bytes/i.test(line.trim())) { done += sizes[img] || 0; img++; }
        if (/Hard resetting/i.test(line)) onProgress({ pct: 100, msg: "Restarting the keypad…" });
      }
    };
    child.stdout.on("data", feed);
    child.stderr.on("data", feed);
    child.on("error", (e) => resolve({ ok: false, error: e.message, log }));
    child.on("exit", (code) => resolve(code === 0 ? { ok: true, log } : { ok: false, error: (log.match(/(?:A fatal error occurred|error):?\s*(.+)/i) || [, `esptool exited with ${code}`])[1].trim(), log }));
  });
}

module.exports = { locate, info, flash, IMAGES };
