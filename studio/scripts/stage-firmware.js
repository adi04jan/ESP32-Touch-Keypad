/* Copies the release firmware and esptool into fw-bundle/, which electron-builder
 * ships as <resources>/firmware (services/flasher.js reads it there).
 * Run `python tools/kp.py build --release` first; `npm run dist` runs this. */
"use strict";
const fs = require("fs");
const path = require("path");
const flasher = require("../services/flasher");

const l = flasher.locate(null);
if (l.error) { console.error(`stage-firmware: ${l.error}`); process.exit(1); }
const out = path.join(__dirname, "..", "fw-bundle");
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out);
for (const [name, src] of Object.entries(l.files)) fs.copyFileSync(src, path.join(out, name));
fs.copyFileSync(l.esptool, path.join(out, "esptool.exe"));
fs.writeFileSync(path.join(out, "version.txt"), `${l.version}\n`);
console.log(`stage-firmware: ${l.version} -> ${out}`);
