/* Tile renderer: draws the 72x72 papercraft tile (the viewer's .tile/.face look:
 * a darker paper base, a lighter face cut a little crooked, grain, a white lucide
 * icon with an ink drop shadow) and returns its RGBA bytes. Main turns those into
 * RGB565, names them by CRC32 and uploads them (services/tiles.js). Deterministic:
 * the crookedness and grain are seeded from icon + colour, so the same tile always
 * has the same bytes and is stored once on the device. */
"use strict";

const TileDraw = (() => {
  const SIZE = 72;
  // ponytail: colour behind the rounded corners; should match the firmware's grid background.
  const BG = [36, 52, 92];
  const mix = (c, t, a) => c.map((v, i) => Math.round(v + (t[i] - v) * a));
  const css = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  const hash = (s) => { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
  const rng = (seed) => () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const images = new Map();

  function iconImage(name, stroke) {
    const key = name + stroke;
    if (images.has(key)) return images.get(key);
    const sym = document.getElementById(`i-${name}`);
    const inner = sym ? sym.innerHTML : "";
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
    const img = new Image();
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    const p = img.decode().then(() => img);
    images.set(key, p);
    return p;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // -> { rgba: Uint8ClampedArray(72*72*4), canvas }
  async function render(icon, color) {
    const seed = hash(`${icon}|${color.join(",")}`);
    const rand = rng(seed);
    const r = (((seed % 5) - 2) * 0.7 * Math.PI) / 180;   // viewer: --r = ((seed*37)%5-2)*.7deg
    const c1 = mix(color, [255, 255, 255], 0.08), c2 = mix(color, [0, 0, 0], 0.45);
    const cv = document.createElement("canvas");
    cv.width = cv.height = SIZE;
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    ctx.fillStyle = css(BG);
    ctx.fillRect(0, 0, SIZE, SIZE);
    const S = 60, rad = S * 0.16, cx = SIZE / 2 + 1.5, cy = SIZE / 2 + 1.5;

    // base sheet: darker paper, shadowed, rotated the other way
    ctx.save();
    ctx.translate(cx, cy); ctx.rotate(-r * 0.6);
    ctx.shadowColor = "rgba(0,0,0,.55)"; ctx.shadowBlur = 4; ctx.shadowOffsetY = 2.5;
    ctx.fillStyle = css(c2);
    roundRect(ctx, -S / 2, -S / 2, S, S, rad); ctx.fill();
    ctx.restore();

    // face: lighter paper, lifted up-left
    ctx.save();
    ctx.translate(cx - 3, cy - 3.5); ctx.rotate(r);
    ctx.shadowColor = "rgba(0,0,0,.45)"; ctx.shadowBlur = 3; ctx.shadowOffsetY = 1.5;
    ctx.fillStyle = css(c1);
    roundRect(ctx, -S / 2, -S / 2, S, S, rad); ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.strokeStyle = "rgba(255,255,255,.28)"; ctx.lineWidth = 1.4;      // top edge catching the light
    ctx.beginPath(); ctx.moveTo(-S / 2 + rad, -S / 2 + 1); ctx.lineTo(S / 2 - rad, -S / 2 + 1); ctx.stroke();
    const I = S * 0.52;
    const [shadow, glyph] = await Promise.all([iconImage(icon, "rgba(0,0,0,.30)"), iconImage(icon, "#ffffff")]);
    ctx.drawImage(shadow, -I / 2 + 1.2, -I / 2 + 1.6, I, I);
    ctx.drawImage(glyph, -I / 2, -I / 2, I, I);
    ctx.restore();

    // paper grain: seeded luminance noise on everything but the backdrop
    const img = ctx.getImageData(0, 0, SIZE, SIZE), d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] === BG[0] && d[i + 1] === BG[1] && d[i + 2] === BG[2]) continue;
      const n = (rand() - 0.5) * 18;
      d[i] = Math.max(0, Math.min(255, d[i] + n)); d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n)); d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
    }
    ctx.putImageData(img, 0, 0);
    return { rgba: img.data, canvas: cv };
  }

  return { render, SIZE, BG };
})();
