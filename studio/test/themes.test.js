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

// The colour roles of struct Theme (themes.h), in table order.
const C3 = "g0 g1 g2 ply ply2 well wellEdge ctl ctlTop ctlBot track hair txt txt2 txt3 lbl cyan mag green amber red slate onAccent tagBg card seg swOff segOff knob knobBot calBg dimRet shadow ink art accent bar".split(" ");
const hex6 = (h) => { h = h.toLowerCase(); return h.length === 4 ? "#" + [...h.slice(1)].map((c) => c + c).join("") : h; };

test("the preview draws every theme in the keypad's colours: ground, text, accent, bar, light flag and key style", () => {
  const fw = [...(R("firmware/TouchKeypad/themes.h") + R("firmware/TouchKeypad/themes_gen.h"))
    .matchAll(/\{ "(\w+)", "[^"]+", KS_(\w+), (true|false), (?:true|false), \d+,([\s\S]*?)(?:true|false) \}/g)].map((m) => {
    const hex = [...m[4].matchAll(/HEXC\(0x([0-9a-fA-F]{6})\)/g)].map((h) => "#" + h[1].toLowerCase());
    assert.equal(hex.length, C3.length, `${m[1]}: ${hex.length} colours in themes.h`);
    return { id: m[1], ks: m[2].toLowerCase(), light: m[3] === "true", ...Object.fromEntries(C3.map((k, i) => [k, hex[i]])) };
  });
  assert.equal(fw.length, 10);
  const css = R("studio/renderer/styles.css") + R("studio/renderer/themes_gen.css");
  const vars = (body) => Object.fromEntries([...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
  const root = vars(css.match(/:root \{([^}]*)\}/)[1]), base = vars(css.match(/\n\.dev \{ (--dg0[^}]*)\}/)[1]);
  for (const t of fw) {
    // Glass is the base .dev style on Studio's own :root text roles; the others override it.
    const own = t.id === "glass" ? {} : vars(css.match(new RegExp(`\\.dev\\[data-theme="${t.id}"\\] \\{([^}]*)\\}`))[1]);
    const v = { ...root, ...base, ...own };
    const get = (k) => { let x = v[k]; for (let m; x && (m = /^var\(--([\w-]+)\)$/.exec(x));) x = v[m[1]]; return x; };
    const preview = { g0: get("dg0"), g1: get("dg1"), g2: get("dg2"), txt: get("txt"), txt2: get("txt-2"), lbl: get("lbl"), accent: get("accent"), bar: get("bar") };
    for (const [role, c] of Object.entries(preview)) assert.equal(c && hex6(c), t[role], `${t.id} ${role}: preview ${c}, keypad ${t[role]}`);
    assert.equal(get("light"), t.light ? "1" : "0", `${t.id} light`);
    assert.equal(get("ks"), t.ks, `${t.id} key style`);
  }
});
