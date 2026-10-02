"use strict";
// The installer only ships the folders build.files lists: a missing one works in
// dev and breaks the installed app (3.2.0 shipped without assets/, so the tray
// icon threw before the keypad search started).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const pkg = require("../package.json");

test("the installer packages every folder Studio loads at run time", () => {
  for (const dir of ["renderer", "services", "assets"]) assert.ok(pkg.build.files.some((f) => f.startsWith(`${dir}/`)), `${dir}/ not in build.files`);
  const main = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
  for (const m of main.matchAll(/path\.join\(__dirname, "([^"]+)"/g)) {
    if (m[1] === "..") continue;   // dev-only (the simulated keypad reads docs/)
    assert.ok(pkg.build.files.some((f) => f === m[1] || f.startsWith(`${m[1]}/`)), `main.js loads ${m[1]} but the installer leaves it out`);
  }
});

test("the installer ships the Bluetooth helper where bleport.js looks for it", () => {
  assert.ok(pkg.build.extraResources.some((r) => r.from === "native/dist" && r.to === "kplink"));
  assert.match(pkg.scripts.dist, /npm run kplink/);
  assert.match(fs.readFileSync(path.join(__dirname, "..", "services", "bleport.js"), "utf8"), /"kplink", "KpLink\.exe"/);
});
