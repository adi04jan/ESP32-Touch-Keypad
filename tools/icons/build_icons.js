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
chevron-up chevron-down chevrons-up chevrons-down corner-down-left zoom-in zoom-out columns-2 rows-2
panel-left panel-bottom fullscreen grid-3x3 fold-vertical unfold-vertical replace strikethrough
list-ordered case-sensitive text-cursor-input square-dashed crop funnel hash delete square-pen paperclip
reply forward smile thumbs-up hand captions history archive save-all square-x square-plus file-search
folder-tree redo-dot arrow-down-to-dot arrow-up-from-dot bug-play circle-stop triangle-alert
circle-question-mark diff circuit-board microchip usb binary activity gauge chart-line plug
calculator box ruler route group log-out log-in bot brain book-open
unlink bluetooth-searching rotate-cw flip-horizontal
`.trim().split(/\s+/);

const BRANDS = `github gitlab spotify discord obsstudio twitch youtube figma googlechrome steam zoom notion apple
x reddit whatsapp telegram signal netflix applemusic soundcloud docker npm python nodedotjs arduino espressif
raspberrypi linux ubuntu android firefoxbrowser openai anthropic claude git googlemeet bruno
autodesk bambulab nordicsemiconductor`.trim().split(/\s+/);

const UI_ICONS = `bluetooth bluetooth-off bluetooth-searching settings plug-zap battery-full battery-medium battery-low
x check chevron-left chevron-right sun moon lightbulb volume-1 volume-2 volume-x sliders-horizontal palette cpu
info layers keyboard crosshair refresh-cw trash-2 link unlink power rotate-ccw monitor sparkles hand mic-off
play pause skip-back skip-forward circle-dot bell bell-ring chevron-down`.trim().split(/\s+/);

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

// A key mask run-length coded for flash (gfx.cpp unpackMask; build_anims.js and build_icon_gifs.py read
// it back): t < 0x80 is t+1 clear pixels, t < 0xC0 is t-0x7F solid ones (15), else t-0xBF pixels follow
// as 4-bit pairs. Runs of 0 or 15 shorter than 3 ride in a literal. 291 masks: 188 KB -> 96 KB.
const nibAt = (m, i) => (i & 1 ? m[i >> 1] & 15 : m[i >> 1] >> 4);
function packMask(m, px) {
  const n = px * px, out = [];
  for (let i = 0; i < n;) {
    const v = nibAt(m, i);
    let j = i;
    if (v === 0 || v === 15) {
      const max = v === 0 ? 128 : 64;
      while (j < n && j - i < max && nibAt(m, j) === v) j++;
      if (j - i >= 3 || j >= n || j - i === max) { out.push(v === 0 ? j - i - 1 : 0x7f + j - i); i = j; continue; }
      j = i;
    }
    while (j < n && j - i < 64) {   // a literal: up to the next run of 3 or more
      const w = nibAt(m, j);
      if (w === 0 || w === 15) {
        let k = j;
        while (k < n && nibAt(m, k) === w) k++;
        if (k - j >= 3 && j > i) break;
        j = Math.min(k, i + 64);
      } else j++;
    }
    out.push(0xbf + j - i);
    for (let k = i; k < j; k += 2) out.push((nibAt(m, k) << 4) | (k + 1 < j ? nibAt(m, k + 1) : 0));
    i = j;
  }
  return Buffer.from(out);
}
function unpackMask(buf, off, px) {
  const n = px * px, m = Buffer.alloc(n / 2);
  const put = (i, v) => { m[i >> 1] |= i & 1 ? v : v << 4; };
  for (let i = 0, p = off; i < n;) {
    const t = buf[p++];
    if (t < 0x80) i += t + 1;
    else if (t < 0xc0) for (let c = t - 0x7f; c-- && i < n; i++) put(i, 15);
    else { const c = t - 0xbf; for (let k = 0; k < c && i < n; k++, i++) put(i, nibAt(buf.subarray(p), k)); p += (c + 1) >> 1; }
  }
  return m;
}

function emitTable(set, px, dataName, tableName, packed = false) {
  const blobs = [], table = [];
  let off = 0;
  for (const [n, icon] of set) {
    const raw = mask4(icon, px), blob = packed ? packMask(raw, px) : raw;
    if (packed && !unpackMask(blob, 0, px).equals(raw)) throw new Error(`${n}: the packed mask does not unpack to itself`);
    table.push(`  {"${n}", ${off}}`);
    blobs.push(blob);
    off += blob.length;
  }
  return cArray(dataName, Buffer.concat(blobs)) + `static const IconDef ${tableName}[] = {\n${table.join(",\n")}\n};\n`;
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

// ICON_DATA is run-length coded (packMask); UI_ICON_DATA is plain 4-bit pairs.
${emitTable(keySet, KEY_PX, "ICON_DATA", "ICONS", true)}
${emitTable(uiSet, UI_PX, "UI_ICON_DATA", "UI_ICONS")}`;
fs.writeFileSync(path.join(ROOT, "firmware/TouchKeypad/icons_gen.h"), header);

const js = {};
for (const [n, icon] of keySet) js[n] = { f: icon.filled ? 1 : 0, d: icon.inner };
for (const [n, icon] of uiSet) if (!js[n]) js[n] = { f: 0, d: icon.inner, ui: 1 };
fs.writeFileSync(path.join(ROOT, "studio/renderer/keyicons.js"),
  `/* Generated by tools/icons/build_icons.js (Lucide ISC, Simple Icons CC0). Do not edit. */\n` +
  `window.KEY_ICONS = ${JSON.stringify(js)};\nwindow.KEY_ICON_NAMES = ${JSON.stringify(keySet.map(([n]) => n))};\n`);

console.log(`key icons ${keySet.length} (${(header.match(/ICON_DATA\[\] PROGMEM = \{([^}]*)\}/)[1].match(/0x/g) || []).length} B packed), ui icons ${uiSet.length}`);if (key.missing.length + brands.missing.length + ui.missing.length)
  console.log(`missing: ${[...key.missing, ...brands.missing.map((b) => `brand:${b}`), ...ui.missing].join(" ")}`);
