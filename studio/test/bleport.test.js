"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { SerialLink } = require("../services/serial");
const { withBluetooth, BLE_PATH } = require("../services/bleport");

// A stand-in for KpLink: announces the link, then answers `status` like the keypad's console.
const FAKE = `
process.stderr.write("OPEN Touch Keypad 8C94DF4E58FA 247\\n");
let buf = "";
process.stdin.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\\n")) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (line === "status") process.stdout.write("Profile:2 loaded:1 ver:3.2.1 model:touch page:1 ble:1 pwr:bat bat:64\\n");
    process.stdout.write("macropad:$ ");
  }
});`;
const NONE = `process.stderr.write("ERR no paired Touch Keypad is connected to this PC\\n"); process.exit(3);`;
const noUsb = { list: async () => [] };

test("with no USB keypad, detect finds the keypad over Bluetooth", async () => {
  const link = new SerialLink({ SerialPort: withBluetooth(noUsb, [process.execPath, "-e", FAKE]) });
  assert.deepEqual((await link.listPorts()).map((p) => [p.path, p.ble]), [[BLE_PATH, true]]);
  const found = await link.detect();
  assert.equal(found.path, BLE_PATH);
  assert.equal(found.status.pwr, "bat");
  assert.equal(found.status.bat, "64");
  let down = false;
  link.on("disconnect", () => { down = true; });
  link.disconnect();
  assert.ok(down && !link.isOpen());
});

test("Bluetooth unavailable: one log line, however often the search retries", async () => {
  const link = new SerialLink({ SerialPort: withBluetooth(noUsb, [process.execPath, "-e", NONE]) });
  const logs = [];
  link.on("log", (t) => logs.push(t));
  assert.equal(await link.detect(), null);
  assert.equal(await link.detect(), null);
  assert.deepEqual(logs, ["Connection error: no paired Touch Keypad is connected to this PC\n"]);
});

test("without the helper, only USB ports are listed", async () => {
  const usb = { list: async () => [{ path: "COM26", vendorId: "1a86", productId: "7523" }] };
  const link = new SerialLink({ SerialPort: withBluetooth(usb, null) });
  assert.deepEqual((await link.listPorts()).map((p) => [p.path, p.ch340, p.ble]), [["COM26", true, false]]);
});
