"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const store = require("../services/store");
const { Suggest } = require("../services/suggest");

// A write that dies halfway (disk full, power cut): writes half the bytes, then throws.
function failingWrites(fn) {
  const real = fs.writeFileSync;
  fs.writeFileSync = (f, data, ...rest) => { real(f, String(data).slice(0, 12), ...rest); throw new Error("disk full"); };
  try { return fn(); } finally { fs.writeFileSync = real; }
}

test("a failed write leaves settings.json and suggest.json as they were", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tk-store-"));
  store.configure({ dataDir: dir });
  store.save({ baud: 460800, context_profiles: { chrome: 3 } });
  failingWrites(() => store.save({ baud: 115200 }));
  assert.equal(store.load().baud, 460800);
  assert.deepEqual(store.load().context_profiles, { chrome: 3 });

  const file = path.join(dir, "suggest.json");
  const data = { code: { 2: { w: 4, n: 4, t: 1 } } };
  assert.equal(new Suggest({ data }).save(file), true);
  assert.equal(failingWrites(() => new Suggest({ data: { other: {} } }).save(file)), false);
  assert.deepEqual(Suggest.load(file).data, data);
});
