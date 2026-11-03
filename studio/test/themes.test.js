"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const R = (p) => fs.readFileSync(path.join(__dirname, "..", "..", p), "utf8");

test("firmware, Studio and the token file list the same themes, in the same order", () => {
  const fw = [...(R("firmware/TouchKeypad/themes.h") + R("firmware/TouchKeypad/themes_gen.h")).matchAll(/\{ "(\w+)", "([^"]+)", KS_/g)].map((m) => [m[1], m[2]]);
  assert.equal(fw.length, 10);
  assert.deepEqual(JSON.parse(R("studio/renderer/app.js").match(/const THEMES = (\[.*\]);/)[1]), fw);
  const css = R("studio/renderer/styles.css") + R("studio/renderer/themes_gen.css");
  for (const [id] of fw.slice(1)) assert.ok(css.includes(`.dev[data-theme="${id}"]`), `preview CSS for ${id}`);   // glass is the base style
  const tokens = JSON.parse(R("tools/themes/theme_tokens.json")).themes.map((t) => t.id);
  for (const [id] of fw) assert.ok(tokens.includes(id), `${id} in theme_tokens.json`);
});
