/* Signature animations for every key icon: each icon acts out what its key does.
 *   node build_anims.js [icon ...]     (in tools/icons; run after build_icons.js)
 * Writes firmware/TouchKeypad/anims_gen.h: for each key icon (the ICONS order of icons_gen.h),
 * its frames as changes against the icon's own mask, so a frame costs only the pixels that move,
 * deflated per icon.
 *
 * Copy pulls a second sheet out of the first, save drops the arrow into the disk, a bell rings,
 * wifi lights its arcs one by one, a check draws itself. Every animation starts and ends on the
 * resting icon, so the key is still between plays. Parts are the icon's own SVG elements, moved,
 * turned, scaled, faded or drawn, then rasterized exactly as build_icons.js rasterizes the masks.
 * The designs live in anim_designs.js. */
"use strict";
const fs = require("fs");
const path = require("path");
const { Resvg } = require("@resvg/resvg-js");

const ROOT = path.resolve(__dirname, "../..");
const ICONS_H = path.join(ROOT, "firmware/TouchKeypad/icons_gen.h");
const KEYICONS = path.join(ROOT, "studio/renderer/keyicons.js");
const OUT = path.join(ROOT, "firmware/TouchKeypad/anims_gen.h");
const PX = 36, STROKE = 2.2, FRAME_MS = 60;

// ---------------------------------------------------------------- geometry
// An SVG path as polylines (one per subpath), in the icon's 24-unit space.
function pathPoints(d) {
  let i = 0;
  const ws = () => { while (i < d.length && /[\s,]/.test(d[i])) i++; };
  const num = () => {
    ws();
    const m = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/.exec(d.slice(i));
    if (!m) throw new Error(`path number at ${i}: ${d}`);
    i += m[0].length;
    return parseFloat(m[0]);
  };
  const flag = () => { ws(); return d[i++] === "1"; };   // arc flags may run together: "0 01.5 2"
  const more = () => { ws(); return i < d.length && /[-+.\d]/.test(d[i]); };
  const subs = [];
  let pts = [], x = 0, y = 0, sx = 0, sy = 0, cmd = "", lc = null, lq = null;
  const to = (nx, ny) => { x = nx; y = ny; pts.push([x, y]); };
  const bez = (p, n = 16) => {
    for (let k = 1; k <= n; k++) {
      const t = k / n, u = 1 - t;
      if (p.length === 4) to(u * u * u * p[0][0] + 3 * u * u * t * p[1][0] + 3 * u * t * t * p[2][0] + t * t * t * p[3][0],
        u * u * u * p[0][1] + 3 * u * u * t * p[1][1] + 3 * u * t * t * p[2][1] + t * t * t * p[3][1]);
      else to(u * u * p[0][0] + 2 * u * t * p[1][0] + t * t * p[2][0], u * u * p[0][1] + 2 * u * t * p[1][1] + t * t * p[2][1]);
    }
  };
  const arc = (rx, ry, phi, large, sweep, x2, y2) => {   // endpoint to centre form (SVG 1.1 F.6.5)
    const x1 = x, y1 = y, cp = Math.cos(phi * Math.PI / 180), sp = Math.sin(phi * Math.PI / 180);
    rx = Math.abs(rx); ry = Math.abs(ry);
    if (!rx || !ry) { to(x2, y2); return; }
    const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2, x1p = cp * dx + sp * dy, y1p = -sp * dx + cp * dy;
    const lam = x1p * x1p / (rx * rx) + y1p * y1p / (ry * ry);
    if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
    const num2 = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
    const co = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num2 / (rx * rx * y1p * y1p + ry * ry * x1p * x1p)));
    const cxp = co * rx * y1p / ry, cyp = -co * ry * x1p / rx;
    const cx = cp * cxp - sp * cyp + (x1 + x2) / 2, cy = sp * cxp + cp * cyp + (y1 + y2) / 2;
    const ang = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
    let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
    if (!sweep && dt > 0) dt -= 2 * Math.PI; else if (sweep && dt < 0) dt += 2 * Math.PI;
    const n = Math.max(4, Math.ceil(Math.abs(dt) * 8));
    for (let k = 1; k <= n; k++) {
      const t = t1 + dt * k / n;
      to(cx + rx * Math.cos(t) * cp - ry * Math.sin(t) * sp, cy + rx * Math.cos(t) * sp + ry * Math.sin(t) * cp);
    }
  };
  const seg = (C, rel) => {
    const ox = rel ? x : 0, oy = rel ? y : 0;
    if (C === "L") to(ox + num(), oy + num());
    else if (C === "H") to(ox + num(), y);
    else if (C === "V") to(x, oy + num());
    else if (C === "C") { const a = [ox + num(), oy + num()], b = [ox + num(), oy + num()], e = [ox + num(), oy + num()]; bez([[x, y], a, b, e]); lc = b; }
    else if (C === "S") { const a = lc ? [2 * x - lc[0], 2 * y - lc[1]] : [x, y], b = [ox + num(), oy + num()], e = [ox + num(), oy + num()]; bez([[x, y], a, b, e]); lc = b; }
    else if (C === "Q") { const a = [ox + num(), oy + num()], e = [ox + num(), oy + num()]; bez([[x, y], a, e], 12); lq = a; }
    else if (C === "T") { const a = lq ? [2 * x - lq[0], 2 * y - lq[1]] : [x, y], e = [ox + num(), oy + num()]; bez([[x, y], a, e], 12); lq = a; }
    else if (C === "A") { const rx = num(), ry = num(), ph = num(), la = flag(), sw = flag(); arc(rx, ry, ph, la, sw, ox + num(), oy + num()); }
    else throw new Error(`path command ${C}: ${d}`);
    if (C !== "C" && C !== "S") lc = null;
    if (C !== "Q" && C !== "T") lq = null;
  };
  while (true) {
    ws();
    if (i >= d.length) break;
    if (/[a-zA-Z]/.test(d[i])) cmd = d[i++];
    const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase();
    if (C === "Z") { to(sx, sy); subs.push(pts); pts = [[x, y]]; continue; }
    if (C === "M") {
      if (pts.length > 1) subs.push(pts);
      x = (rel ? x : 0) + num(); y = (rel ? y : 0) + num(); sx = x; sy = y; pts = [[x, y]];
      while (more()) seg("L", rel);   // extra pairs after a move are lines
      continue;
    }
    do seg(C, rel); while (more());
  }
  if (pts.length > 1) subs.push(pts);
  return subs;
}

const attr = (el, k) => { const m = new RegExp(`\\s${k}="([^"]*)"`).exec(el); return m ? parseFloat(m[1]) : 0; };
// Length and bounds [x0, y0, x1, y1] of one element.
function measure(el) {
  const tag = /<(\w+)/.exec(el)[1];
  if (tag === "circle") {
    const cx = attr(el, "cx"), cy = attr(el, "cy"), r = attr(el, "r");
    return { len: 2 * Math.PI * r, box: [cx - r, cy - r, cx + r, cy + r] };
  }
  if (tag === "ellipse") {
    const cx = attr(el, "cx"), cy = attr(el, "cy"), a = attr(el, "rx"), b = attr(el, "ry");
    return { len: Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b))), box: [cx - a, cy - b, cx + a, cy + b] };
  }
  if (tag === "rect") {
    const x = attr(el, "x"), y = attr(el, "y"), w = attr(el, "width"), h = attr(el, "height"), r = Math.min(attr(el, "rx") || attr(el, "ry"), w / 2, h / 2);
    return { len: 2 * (w + h) - 8 * r + 2 * Math.PI * r, box: [x, y, x + w, y + h] };
  }
  if (tag === "line") {
    const x1 = attr(el, "x1"), y1 = attr(el, "y1"), x2 = attr(el, "x2"), y2 = attr(el, "y2");
    return { len: Math.hypot(x2 - x1, y2 - y1), box: [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)] };
  }
  if (tag === "path") {
    let len = 0, box = [Infinity, Infinity, -Infinity, -Infinity];
    for (const s of pathPoints(/\sd="([^"]*)"/.exec(el)[1])) s.forEach((p, k) => {
      if (k) len += Math.hypot(p[0] - s[k - 1][0], p[1] - s[k - 1][1]);
      box = [Math.min(box[0], p[0]), Math.min(box[1], p[1]), Math.max(box[2], p[0]), Math.max(box[3], p[1])];
    });
    return { len, box };
  }
  return { len: 60, box: [2.4, 2.4, 21.6, 21.6] };   // a brand mark's group: its whole box
}
const union = (boxes) => boxes.reduce((u, b) => [Math.min(u[0], b[0]), Math.min(u[1], b[1]), Math.max(u[2], b[2]), Math.max(u[3], b[3])], [Infinity, Infinity, -Infinity, -Infinity]);

// ---------------------------------------------------------------- motion
const clamp01 = (t) => Math.max(0, Math.min(1, t));
const EASE = {
  lin: (t) => t,
  out: (t) => t >= 1 ? 1 : 1 - Math.pow(2, -10 * t),   // expo out: fast, then a soft natural stop
  in: (t) => t * t * t,
  io: (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
  back: (t) => { const c = 1.6; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); },   // a small overshoot, for things with mass
  step: (t) => t < 1 ? 0 : 1,
};
// x, y move (24-unit space); r turns (degrees); s, sx, sy scale; o fades; d draws the stroke (0..1).
const REST = { x: 0, y: 0, r: 0, s: 1, sx: 1, sy: 1, o: 1, d: 1 };

// A track's keys are [t, props, ease] with t in 0..1 of the animation; a prop holds between its keys
// and eases into each key from the one before (the first from rest).
function sample(keys, t) {
  const out = { ...REST };
  for (const k of Object.keys(REST)) {
    let prevT = 0, v = REST[k];
    for (const [kt, props, ease] of keys) {
      if (!(k in props)) continue;
      if (t <= kt) { v += (props[k] - v) * EASE[ease || "out"](kt > prevT ? clamp01((t - prevT) / (kt - prevT)) : 1); break; }
      prevT = kt; v = props[k];
    }
    out[k] = v;
  }
  return out;
}

function pivotOf(p, box) {
  if (Array.isArray(p)) return p;
  const [x0, y0, x1, y1] = box, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  return { c: [cx, cy], t: [cx, y0], b: [cx, y1], l: [x0, cy], r: [x1, cy], tl: [x0, y0], tr: [x1, y0], bl: [x0, y1], br: [x1, y1], i: [12, 12] }[p || "c"];
}

// ---------------------------------------------------------------- rendering
function frameSvg(icon, els, geo, tracks, t) {
  const paint = icon.f ? 'fill="#fff"' : `fill="none" stroke="#fff" stroke-width="${STROKE}" stroke-linecap="round" stroke-linejoin="round"`;
  let body = "";
  els.forEach((el, i) => {
    let xf = "", o = 1, d = 1, rev = false;
    for (const tr of tracks) {   // tracks compose: the earlier one is the outer transform
      if (!tr.els.includes(i)) continue;
      const v = sample(tr.keys, t), [px, py] = pivotOf(tr.p, tr.box || geo[i].box);
      if (v.x || v.y) xf += ` translate(${v.x.toFixed(3)} ${v.y.toFixed(3)})`;
      if (v.r || v.s !== 1 || v.sx !== 1 || v.sy !== 1)
        xf += ` translate(${px} ${py}) rotate(${v.r.toFixed(3)}) scale(${(v.s * v.sx).toFixed(4)} ${(v.s * v.sy).toFixed(4)}) translate(${-px} ${-py})`;
      o *= v.o;
      if (v.d < d) { d = v.d; rev = !!tr.rev; }
    }
    if (o < 0.02 || d < 0.02) return;
    let shape = el;
    if (d < 0.999) {   // draw on: one dash as long as the drawn part, from the start (or the end)
      const L = geo[i].len, on = L * d;
      shape = el.replace(/\s*\/>$/, ` stroke-dasharray="${on.toFixed(3)} ${(L + 1).toFixed(3)}"${rev ? ` stroke-dashoffset="${(on - L).toFixed(3)}"` : ""}/>`);
    }
    body += xf || o < 0.999 ? `<g${xf ? ` transform="${xf.trim()}"` : ""}${o < 0.999 ? ` opacity="${o.toFixed(3)}"` : ""}>${shape}</g>` : shape;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${PX}" height="${PX}" viewBox="0 0 24 24" ${paint}>${body}</svg>`;
}

function mask(svg, px = PX) {
  const img = new Resvg(svg, { fitTo: { mode: "width", value: px }, font: { loadSystemFonts: false } }).render();   // no text: skip the font scan
  const rgba = img.pixels, out = new Uint8Array(px * px);   // each read of .pixels is a fresh copy
  for (let i = 0; i < px * px; i++) out[i] = Math.round(rgba[i * 4 + 3] * 15 / 255);
  return out;
}

// A frame as runs of changed pixels against the resting mask: [skip, count, count nibbles] ...,
// ended by [0, 0]. A skip of 255 with count 0 only moves on.
function delta(frame, base) {
  const out = [], n = PX * PX;
  let pos = 0;
  while (true) {
    let s = pos;
    while (s < n && frame[s] === base[s]) s++;
    if (s >= n) break;
    let e = s;   // run over the changes, bridging gaps of up to 3 unchanged pixels
    while (e < n) {
      if (frame[e] !== base[e]) { e++; continue; }
      let g = e;
      while (g < n && g - e < 4 && frame[g] === base[g]) g++;
      if (g < n && g - e < 4) e = g; else break;
    }
    let skip = s - pos;
    while (skip > 255) { out.push(255, 0); skip -= 255; }
    for (let a = s; a < e; a += 255) {
      const cnt = Math.min(255, e - a);
      out.push(a === s ? skip : 0, cnt);
      for (let k = 0; k < cnt; k += 2) out.push((frame[a + k] << 4) | (k + 1 < cnt ? frame[a + k + 1] : 0));
    }
    pos = e;
  }
  out.push(0, 0);
  return out;
}

// ---------------------------------------------------------------- inputs
function loadIcons() {
  const w = {};
  new Function("window", fs.readFileSync(KEYICONS, "utf8"))(w);
  return w.KEY_ICONS;
}
function loadMasks() {
  const text = fs.readFileSync(ICONS_H, "utf8");
  const block = text.slice(text.indexOf("ICON_DATA[] PROGMEM = {"));
  const data = Buffer.from(block.slice(0, block.indexOf("};")).match(/0x[0-9a-fA-F]{2}/g).map((h) => parseInt(h, 16)));
  const table = text.slice(text.indexOf("static const IconDef ICONS[] = {"));
  const out = [];
  for (const [, name, off] of table.slice(0, table.indexOf("};")).matchAll(/\{"([a-z0-9-]+)",\s*(\d+)\}/g)) {
    const m = new Uint8Array(PX * PX);
    for (let i = 0; i < PX * PX; i++) { const b = data[+off + (i >> 1)]; m[i] = i & 1 ? b & 15 : b >> 4; }
    out.push({ name, base: m });
  }
  return out;
}

// One icon's animation: { n frames, svgAt(t) }.
function prepare(name, icon, design) {
  const els = [...(icon.d.match(/<(?:path|circle|rect|line|ellipse|polyline|polygon)\b[^>]*\/>|<g\b[\s\S]*?<\/g>/g) || []), ...(design.extra || [])];
  const geo = els.map(measure);
  const tracks = design.tracks.map((tr) => {
    const list = tr.el === "*" ? els.map((_, i) => i) : [].concat(tr.el);
    list.forEach((i) => { if (!geo[i]) throw new Error(`${name}: no element ${i}`); });
    return { ...tr, els: list, box: list.length > 1 ? union(list.map((i) => geo[i].box)) : null };
  });
  const n = Math.max(2, Math.round(design.ms / FRAME_MS) + 1);
  return { n, svgAt: (t) => frameSvg(icon, els, geo, tracks, t) };
}

module.exports = { prepare, mask, loadIcons, loadMasks, PX, FRAME_MS };

if (require.main === module) {
  const zlib = require("zlib");
  const { design } = require("./anim_designs.js");
  const icons = loadIcons(), masks = loadMasks(), only = process.argv.slice(2);
  const rows = [], data = [];
  let rawAll = 0, rawMax = 0;
  for (const { name, base } of masks) {
    if (only.length && !only.includes(name)) { rows.push({ off: data.length, z: 0, raw: 0, n: 0 }); continue; }
    const a = prepare(name, icons[name], design(name, icons[name]));
    const frames = [];
    for (let k = 0; k < a.n; k++) frames.push(mask(a.svgAt(k / (a.n - 1))));
    // Drop still frames at both ends: the key shows its resting icon there anyway.
    const still = (f) => f.every((v, i) => v === base[i]);
    let s = 0, e = frames.length;
    while (s < e && still(frames[s])) s++;
    while (e > s && still(frames[e - 1])) e--;
    if (e - s > 255) throw new Error(`${name}: ${e - s} frames`);
    const raw = [];
    for (let k = s; k < e; k++) raw.push(...delta(frames[k], base));
    // Deflated per icon (the ESP32 ROM inflates it: tinfl), so one icon unpacks on its own.
    const z = e > s ? zlib.deflateRawSync(Buffer.from(raw), { level: 9 }) : Buffer.alloc(0);
    if (raw.length > 65535) throw new Error(`${name}: ${raw.length} bytes`);
    rows.push({ off: data.length, z: z.length, raw: e > s ? raw.length : 0, n: e - s });
    for (const b of z) data.push(b);
    rawAll += raw.length;
    rawMax = Math.max(rawMax, raw.length);
  }
  const frames = rows.reduce((t, r) => t + r.n, 0), hex = [];
  for (let i = 0; i < data.length; i += 24) hex.push("  " + data.slice(i, i + 24).map((v) => "0x" + v.toString(16).padStart(2, "0")).join(","));
  fs.writeFileSync(OUT, `// Generated by tools/icons/build_anims.js from tools/icons/anim_designs.js. Do not edit.
// Each key icon's signature animation, in ICONS order (icons_gen.h): its frames, ${FRAME_MS} ms apart,
// as runs of changed pixels against the icon's resting mask: [skip, count, count 4-bit pixels] ...
// ended by [0, 0]; a skip of 255 with count 0 only moves on. Each icon's runs are deflated (raw,
// no header): z bytes at off, inflating to raw. ${frames} frames, ${data.length} bytes (${rawAll} inflated).
#pragma once
#include <Arduino.h>
#define ANIM_FRAME_MS ${FRAME_MS}
#define ANIM_COUNT ${rows.length}
#define ANIM_RAW_MAX ${rawMax}
struct AnimDef { uint32_t off; uint16_t z, raw; uint8_t frames; };
static const uint8_t ANIM_DATA[] PROGMEM = {
${hex.join(",\n") || "  0"}
};
static const AnimDef ANIMS[] = {
${rows.map((r, i) => `  {${r.off}, ${r.z}, ${r.raw}, ${r.n}},   // ${masks[i].name}`).join("\n")}
};
`);
  console.log(`${masks.length} icons, ${frames} frames, ${(data.length / 1024).toFixed(1)} KB (${(rawAll / 1024).toFixed(1)} KB inflated, largest ${rawMax} B) -> ${path.relative(ROOT, OUT)}`);
}
