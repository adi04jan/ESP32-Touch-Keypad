"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const tiles = require("../services/tiles");

const solid = (r, g, b, n = 72 * 72) => { const a = new Uint8Array(n * 4); for (let i = 0; i < n; i++) a.set([r, g, b, 255], i * 4); return a; };

test("crc32 is the IEEE/zlib CRC (check value)", () => {
  assert.equal(tiles.hex8(tiles.crc32(Buffer.from("123456789"))), "cbf43926");
});

test("RGB565 packing, big-endian by default", () => {
  const px = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255, 0x12, 0x34, 0x56, 0]);
  const be = tiles.rgbaToRgb565(px, 5, 1);
  assert.deepEqual([...be], [0xF8, 0x00, 0x07, 0xE0, 0x00, 0x1F, 0xFF, 0xFF, 0x11, 0xAA]);
  const le = tiles.rgbaToRgb565(px, 5, 1, false);
  assert.deepEqual([...le.subarray(0, 2)], [0x00, 0xF8]);
  assert.equal(tiles.BIG_ENDIAN, true);
});

test("a 72x72 tile is 10,368 bytes and named by CRC32 of its RGB565 bytes", () => {
  const buf = tiles.rgbaToRgb565(solid(47, 107, 79));
  assert.equal(buf.length, tiles.TILE_BYTES);
  assert.equal(buf.length, 10368);
  const name = tiles.tileName(buf);
  assert.match(name, /^[0-9a-f]{8}$/);
  assert.equal(name, tiles.hex8(tiles.crc32(buf)));
  assert.equal(tiles.tilePath(name), `/t/${name}.565`);
  assert.notEqual(tiles.tileName(tiles.rgbaToRgb565(solid(47, 107, 80))), name);   // blue LSBs differ after >>3? 79>>3 = 9, 80>>3 = 10
  assert.throws(() => tiles.rgbaToRgb565(new Uint8Array(10)), /expected/);
});

test("###BEGINB### framing: header, 76-char base64 lines, ###END###", () => {
  const buf = tiles.rgbaToRgb565(solid(10, 20, 30));
  const lines = tiles.buildBinaryUploadLines("/t/abc.565", buf);
  assert.equal(lines[0], `###BEGINB### /t/abc.565 10368 crc=${tiles.hex8(tiles.crc32(buf))}`);
  assert.equal(lines.at(-1), "###END###");
  const body = lines.slice(1, -1);
  assert.equal(body.length, Math.ceil(Math.ceil(10368 / 3) * 4 / 76));   // 182
  assert.ok(body.slice(0, -1).every((l) => l.length === 76));
  assert.ok(body.at(-1).length <= 76 && body.at(-1).length > 0);
  assert.deepEqual(Buffer.from(body.join(""), "base64"), buf);
});

test("parseTileList reads ls output in several shapes", () => {
  const s = tiles.parseTileList("3fa9c2d1.565\t10368\n/t/B2041E7C.565 10368\nprofile1.json\t600\nnot-a-tile.565\n");
  assert.deepEqual([...s].sort(), ["3fa9c2d1", "b2041e7c"]);
});
