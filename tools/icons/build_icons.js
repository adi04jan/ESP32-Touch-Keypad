/* Key and UI icons for the keypad, from Lucide (ISC) and Simple Icons (CC0).
 *   npm run build      (in tools/icons)
 * Writes:
 *   firmware/TouchKeypad/icons_gen.h   4-bit alpha masks: 40 px key glyphs, 20 px UI glyphs
 *   studio/renderer/keyicons.js        the same set as SVG markup, for Studio and docs/device
 *   (key masks are drawn at 36 px, the key glyph size in firmware/DESIGN.md)
 * The firmware tints a mask with the key colour and lights it with a glow it
 * blurs at draw time, so one mask serves every colour. */
"use strict";
const fs = require("fs");
const path = require("path");
const { Resvg } = require("@resvg/resvg-js");

const ROOT = path.resolve(__dirname, "../..");
const LUCIDE = path.join(__dirname, "node_modules/lucide-static/icons");
const BRAND = path.join(__dirname, "node_modules/simple-icons/icons");
const KEY_PX = 36, UI_PX = 20, STROKE = 2.2;
const pkgVersion = (p) => JSON.parse(fs.readFileSync(path.join(__dirname, "node_modules", p, "package.json"), "utf8")).version;

const KEY_ICONS = `
play pause skip-back skip-forward rewind fast-forward shuffle repeat repeat-1 volume volume-1 volume-2 volume-x
mic mic-off mic-vocal headphones music music-2 radio podcast disc-3 list-music audio-lines audio-waveform speaker
phone phone-off video video-off message-circle message-square mail send bell bell-off users user at-sign
lock lock-open power moon sun monitor laptop keyboard mouse mouse-pointer-click gamepad-2 camera image scan
screen-share cast app-window layout-grid maximize minimize square-terminal terminal code code-xml braces bug
git-branch git-pull-request git-commit-horizontal git-merge database server cloud cloud-upload download upload
wifi bluetooth battery-full plug-zap cpu hard-drive folder folder-open file file-text file-code files clipboard
clipboard-paste copy scissors undo-2 redo-2 save trash-2 search settings sliders-horizontal refresh-cw rotate-ccw
house globe link external-link bookmark star heart flag pin map-pin calendar clock timer alarm-clock hourglass
coffee zap flame rocket hammer wrench paintbrush palette pen-line highlighter type bold italic list list-checks
check x plus minus circle-dot square circle triangle arrow-up arrow-down arrow-left arrow-right chevron-left
chevron-right chevrons-left chevrons-right layers sparkles wand-sparkles lightbulb eye eye-off shield key-round
fingerprint printer shopping-cart gift trophy film clapperboard tv monitor-play radio-tower airplay smartphone
watch car plane dumbbell pizza beer cake leaf umbrella snowflake thermometer droplet wind crosshair info
`.trim().split(/\s+/);

const BRANDS = `github gitlab spotify discord obsstudio twitch youtube figma googlechrome steam zoom notion apple
x reddit whatsapp telegram signal netflix applemusic soundcloud docker npm python nodedotjs arduino espressif
raspberrypi linux ubuntu android firefoxbrowser openai anthropic`.trim().split(/\s+/);

const UI_ICONS = `bluetooth bluetooth-off bluetooth-searching settings plug-zap battery-full battery-medium battery-low
x check chevron-left chevron-right sun moon lightbulb volume-1 volume-2 volume-x sliders-horizontal palette cpu
info layers keyboard crosshair refresh-cw trash-2 link unlink power rotate-ccw monitor sparkles hand mic-off
play pause skip-back skip-forward circle-dot`.trim().split(/\s+/);

function readLucide(name) {
  const f = path.join(LUCIDE, `${name}.svg`);
  if (!fs.existsSync(f)) return null;
  const s = fs.readFileSync(f, "utf8");
  return { inner: s.slice(s.indexOf(">", s.indexOf("<svg")) + 1, s.lastIndexOf("</svg>")).replace(/<!--[\s\S]*?-->/g, "").trim(), filled: false };
}

function readBrand(slug) {
  const f = path.join(BRAND, `${slug}.svg`);
  if (!fs.existsSync(f)) return null;
  const d = fs.readFileSync(f, "utf8").match(/<path d="([^"]+)"/);
  // Brand marks fill their whole 24-unit box; scale them to sit like a stroked glyph.
  return d ? { inner: `<g transform="translate(2.4 2.4) scale(.8)"><path d="${d[1]}"/></g>`, filled: true } : null;
}

function svgMarkup(icon, px) {
  const paint = icon.filled ? 'fill="#fff"'
    : `fill="none" stroke="#fff" stroke-width="${STROKE}" stroke-linecap="round" stroke-linejoin="round"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 24 24" ${paint}>${icon.inner}</svg>`;
}

// 4-bit alpha, two pixels per byte, high nibble first.
function mask4(icon, px) {
  const img = new Resvg(svgMarkup(icon, px), { fitTo: { mode: "width", value: px } }).render();
  if (img.width !== px || img.height !== px) throw new Error(`raster ${img.width}x${img.height}`);
  const out = Buffer.alloc(px * px / 2);
  for (let i = 0; i < px * px; i += 2) {
    const a = Math.round(img.pixels[i * 4 + 3] * 15 / 255), b = Math.round(img.pixels[(i + 1) * 4 + 3] * 15 / 255);
    out[i / 2] = (a << 4) | b;
  }
  return out;
}

function collect(names, readers) {
  const got = [], missing = [];
  for (const n of names) {
    let icon = null;
    for (const r of readers) if ((icon = r(n))) break;
    if (icon) got.push([n, icon]); else missing.push(n);
  }
  return { got, missing };
}

const key = collect(KEY_ICONS, [readLucide]);
const brands = collect(BRANDS, [readBrand]);
const ui = collect(UI_ICONS, [readLucide]);
const lucideNames = new Set(key.got.map(([n]) => n));
const brandEntries = brands.got.map(([n, i]) => [lucideNames.has(n) ? `brand-${n}` : n, i]);
const keySet = [...key.got, ...brandEntries].sort((a, b) => (a[0] < b[0] ? -1 : 1));
const uiSet = ui.got.sort((a, b) => (a[0] < b[0] ? -1 : 1));

function cArray(name, buf) {
  const lines = [];
  for (let i = 0; i < buf.length; i += 24) lines.push("  " + [...buf.subarray(i, i + 24)].map((b) => `0x${b.toString(16).padStart(2, "0")}`).join(","));
  return `static const uint8_t ${name}[] PROGMEM = {\n${lines.join(",\n")}\n};\n`;
}

function emitTable(set, px, dataName, tableName) {
  const blobs = set.map(([, icon]) => mask4(icon, px));
  const size = px * px / 2;
  const table = set.map(([n], i) => `  {"${n}", ${i * size}}`).join(",\n");
  return cArray(dataName, Buffer.concat(blobs)) + `static const IconDef ${tableName}[] = {\n${table}\n};\n`;
}

const header = `// Generated by tools/icons/build_icons.js from Lucide ${pkgVersion("lucide-static")} (ISC)
// and Simple Icons ${pkgVersion("simple-icons")} (CC0). Do not edit.
#pragma once
#include <Arduino.h>

struct IconDef { const char *name; uint32_t off; };
#define ICON_PX ${KEY_PX}
#define UI_ICON_PX ${UI_PX}
#define ICON_COUNT ${keySet.length}
#define UI_ICON_COUNT ${uiSet.length}

${emitTable(keySet, KEY_PX, "ICON_DATA", "ICONS")}
${emitTable(uiSet, UI_PX, "UI_ICON_DATA", "UI_ICONS")}`;
fs.writeFileSync(path.join(ROOT, "firmware/TouchKeypad/icons_gen.h"), header);

const js = {};
for (const [n, icon] of keySet) js[n] = { f: icon.filled ? 1 : 0, d: icon.inner };
for (const [n, icon] of uiSet) if (!js[n]) js[n] = { f: 0, d: icon.inner, ui: 1 };
fs.writeFileSync(path.join(ROOT, "studio/renderer/keyicons.js"),
  `/* Generated by tools/icons/build_icons.js (Lucide ISC, Simple Icons CC0). Do not edit. */\n` +
  `window.KEY_ICONS = ${JSON.stringify(js)};\nwindow.KEY_ICON_NAMES = ${JSON.stringify(keySet.map(([n]) => n))};\n`);

console.log(`key icons ${keySet.length} (${keySet.length * KEY_PX * KEY_PX / 2} B), ui icons ${uiSet.length}`);
if (key.missing.length + brands.missing.length + ui.missing.length)
  console.log(`missing: ${[...key.missing, ...brands.missing.map((b) => `brand:${b}`), ...ui.missing].join(" ")}`);
