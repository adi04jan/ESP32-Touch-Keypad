/* Tile bytes: RGBA (from the renderer's 72x72 canvas) -> RGB565 -> CRC32 name
 * -> `###BEGINB###` base64 upload lines (PLAN.md §8.3). Drawing happens in the
 * renderer (renderer/tiledraw.js); everything here is pure and testable. */
"use strict";

const zlib = require("zlib");

const TILE_W = 72, TILE_H = 72;
const TILE_BYTES = TILE_W * TILE_H * 2;   // 10,368
const B64_LINE = 76;
// ponytail: byte order is a protocol constant; flip here if PROTOCOL.md says otherwise.
const BIG_ENDIAN = true;

// IEEE CRC-32 (zlib / esp_rom_crc32_le(0, …) compatible), as unsigned int.
const crc32 = (buf) => zlib.crc32(buf) >>> 0;
const hex8 = (n) => (n >>> 0).toString(16).padStart(8, "0");

function rgbaToRgb565(rgba, w = TILE_W, h = TILE_H, bigEndian = BIG_ENDIAN) {
  if (rgba.length !== w * h * 4) throw new Error(`expected ${w * h * 4} RGBA bytes, got ${rgba.length}`);
  const out = Buffer.alloc(w * h * 2);
  for (let i = 0, o = 0; i < rgba.length; i += 4, o += 2) {
    const v = ((rgba[i] & 0xF8) << 8) | ((rgba[i + 1] & 0xFC) << 3) | (rgba[i + 2] >> 3);
    if (bigEndian) out.writeUInt16BE(v, o); else out.writeUInt16LE(v, o);
  }
  return out;
}

const tileName = (rgb565) => hex8(crc32(rgb565));
const tilePath = (name) => `/t/${name}.565`;

function buildBinaryUploadLines(path, buf) {
  const b64 = Buffer.from(buf).toString("base64");
  const lines = [`###BEGINB### ${path} ${buf.length} crc=${hex8(crc32(buf))}`];
  for (let i = 0; i < b64.length; i += B64_LINE) lines.push(b64.slice(i, i + B64_LINE));
  lines.push("###END###");
  return lines;
}

// Tile names on the device from an `ls` reply (tolerates "name\tsize", "/t/name.565 size", …).
function parseTileList(text) {
  const out = new Set();
  for (const line of String(text).split("\n")) {
    const m = line.trim().match(/(?:^|\/)([0-9a-f]{8})\.565\b/i);
    if (m) out.add(m[1].toLowerCase());
  }
  return out;
}

module.exports = { TILE_W, TILE_H, TILE_BYTES, B64_LINE, BIG_ENDIAN, crc32, hex8, rgbaToRgb565, tileName, tilePath, buildBinaryUploadLines, parseTileList };
