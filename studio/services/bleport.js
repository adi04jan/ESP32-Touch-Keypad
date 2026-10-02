/* Bluetooth port: the keypad's console over its Nordic UART service, through
 * native/KpLink (Windows' GATT API opens the paired, connected keypad; no scan).
 * Shaped like a `serialport` port so SerialLink runs over it unchanged; its path is "BLE". */
"use strict";

const { EventEmitter } = require("events");
const { spawn } = require("child_process");
const readline = require("readline");
const fs = require("fs");
const path = require("path");

const BLE_PATH = "BLE";

function kplinkExe() {
  const packaged = process.resourcesPath ? path.join(process.resourcesPath, "kplink", "KpLink.exe") : null;
  const dev = path.join(__dirname, "..", "native", "dist", "KpLink.exe");
  return [packaged, dev].find((p) => p && fs.existsSync(p)) || null;
}

class BlePort extends EventEmitter {
  constructor(_opts, cb, exe = kplinkExe()) {
    super();
    this.isOpen = false;
    if (!exe) { setImmediate(() => cb(new Error("Bluetooth helper KpLink.exe is missing"))); return; }
    const [file, ...args] = [].concat(exe);   // tests pass [node, "-e", fakeHelper]
    const child = this.child = spawn(file, args, { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let settled = false, why = "";
    const settle = (err) => { if (settled) return; settled = true; this.isOpen = !err; cb(err || null); };
    child.stdout.on("data", (b) => this.emit("data", b));
    child.stdin.on("error", () => {});   // EPIPE after the helper exits; 'exit' reports it
    readline.createInterface({ input: child.stderr }).on("line", (line) => {
      if (line.startsWith("OPEN ")) { this.info = line.slice(5); settle(); }
      else if (line.startsWith("ERR ")) why = line.slice(4);
    });
    child.on("error", (e) => settle(e));
    child.on("exit", (code) => {
      const was = this.isOpen;
      this.isOpen = false;
      settle(new Error(why || `Bluetooth helper exited (${code})`));
      if (was) this.emit("close");
    });
  }
  write(data, cb) {
    if (!this.isOpen) { if (cb) cb(new Error("Bluetooth link closed")); return; }
    this.child.stdin.write(data, cb);
  }
  close(cb) {
    this.isOpen = false;
    if (this.child) {
      this.child.stdin.end();                // the helper exits on end of input
      setTimeout(() => { try { this.child.kill(); } catch (_) {} }, 1500).unref();
    }
    if (cb) cb();
  }
}

// A `serialport`-shaped class over both transports: USB ports, then "BLE" when the helper ships.
function withBluetooth(SerialPort, exe = kplinkExe()) {
  function AnyPort(opts, cb) { return opts.path === BLE_PATH ? new BlePort(opts, cb, exe) : new SerialPort(opts, cb); }
  AnyPort.list = async () => [
    ...(await SerialPort.list().catch(() => [])),
    ...(exe ? [{ path: BLE_PATH, friendlyName: "Bluetooth" }] : []),
  ];
  return AnyPort;
}

module.exports = { BlePort, withBluetooth, kplinkExe, BLE_PATH };
