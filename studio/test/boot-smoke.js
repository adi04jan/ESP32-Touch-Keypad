/* Boot smoke: start Electron with serial disabled and a throwaway data dir, wait
 * for the renderer to report ready (it renders one tile as a self-check), exit.
 * Usage: npm run smoke. Never opens a serial port (STUDIO_NO_SERIAL=1). */
"use strict";
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const electron = require("electron");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "tk-smoke-"));
const env = { ...process.env, STUDIO_SMOKE: "1", STUDIO_NO_SERIAL: "1", STUDIO_DATA_DIR: dataDir, ELECTRON_ENABLE_LOGGING: "1" };
const child = spawn(electron, [path.join(__dirname, "..")], { env, stdio: ["ignore", "pipe", "pipe"] });
let out = "";
child.stdout.on("data", (d) => { out += d; process.stdout.write(d); });
child.stderr.on("data", (d) => { out += d; process.stderr.write(d); });
const kill = setTimeout(() => { console.error("smoke: timed out"); child.kill(); process.exit(1); }, 40000);
child.on("exit", (code) => {
  clearTimeout(kill);
  const ok = code === 0 && /STUDIO_BOOT_OK/.test(out) && !/\[renderer\]/.test(out);
  console.log(ok ? "smoke: OK" : `smoke: FAILED (exit ${code})`);
  process.exit(ok ? 0 : 1);
});
