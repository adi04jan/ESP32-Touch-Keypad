"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const feeds = require("../services/feeds");
const { contextForProcess } = require("../services/contexts");

test("the PowerShell helpers print UTF-8, not the OEM code page (titles like Beyoncé, Café)", () => {
  const utf8 = /\[Console\]::OutputEncoding\s*=\s*\[Text\.Encoding\]::UTF8/;
  assert.match(feeds.NP_PS, utf8);
  assert.match(require("../services/activewin").PS, utf8);
});

// Runs the helper's own ArtStep over scripted polls ([key, album, cover]); "-" = nothing sent.
test("a new track's cover is not the previous track's that the session still holds", { skip: process.platform !== "win32" }, () => {
  const fn = feeds.NP_PS.match(/^function ArtStep[\s\S]*?^}$/m);
  assert.ok(fn, "ArtStep in NP_PS");
  const polls = [
    ["A", "", "a"],                                            // first track: take what is there
    ["B", "", "a"], ["B", "", "a"], ["B", "", "b"], ["B", "", "b"],   // Chrome: title first, cover ~1 s later
    ["C", "X", "c"], ["D", "X", "c"],                          // same album: the same cover is right
    ...Array(6).fill(["E", "Y", "c"]), ["E", "Y", "c"], ["E", "Y", "e"],   // shared cover after 3 s, a late new one still wins
    ["F", "", ""], ["F", "", "f"],                             // no cover yet
  ];
  const ps = `${fn[0]}\n` + polls.map(([k, al, c]) => `$r = ArtStep '${k}' '${al}' { '${c}' }; if ($r) { $r } else { '-' }`).join("\n");
  const out = require("child_process").execFileSync("powershell.exe", ["-NoProfile", "-EncodedCommand", Buffer.from(ps, "utf16le").toString("base64")], { encoding: "utf8" });
  assert.deepEqual(out.trim().split(/\r?\n/), ["a", "-", "-", "b", "-", "c", "c", "-", "-", "-", "-", "-", "c", "-", "e", "-", "f"]);
});

test("settime carries epoch seconds and minutes east of UTC", () => {
  const d = new Date(Date.UTC(2026, 9, 1, 12, 0, 0));
  const [cmd, epoch, tz] = feeds.timeCommand(d).split(" ");
  assert.equal(cmd, "settime");
  assert.equal(+epoch, d.getTime() / 1000);
  assert.equal(+tz, -d.getTimezoneOffset());
});

test("now_playing widget command is compact JSON with trimmed fields", () => {
  const c = feeds.nowPlayingCommand({ title: "x".repeat(100), artist: "A", app: "SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify", pos: 3, len: 10, playing: true });
  assert.match(c, /^widget now_playing \{/);
  const o = JSON.parse(c.slice("widget now_playing ".length));
  assert.equal(o.title.length, 64);
  assert.equal(o.app, "Spotify");
  assert.deepEqual(Object.keys(o), ["title", "album", "artist", "app", "pos", "len", "playing"]);
  assert.equal(c.includes("\n"), false);
});

test("album art: 128x128 bottom-up 24-bit BMP -> big-endian RGB565, top row first", () => {
  const stride = 128 * 3, off = 54, bmp = Buffer.alloc(off + stride * 128);
  bmp.write("BM", 0, "latin1");
  bmp.writeUInt32LE(off, 10); bmp.writeInt32LE(128, 18); bmp.writeInt32LE(128, 22); bmp.writeUInt16LE(24, 28);
  const top = off + 127 * stride;                     // last stored row = top of the image
  bmp[top] = 0; bmp[top + 1] = 0; bmp[top + 2] = 255;  // BGR: red at (0,0)
  bmp[off] = 255; bmp[off + 1] = 0; bmp[off + 2] = 0;  // blue at (0,127)
  const px = feeds.bmpToRgb565(bmp);
  assert.equal(px.length, 128 * 128 * 2);
  assert.equal(px.readUInt16BE(0), 0xF800);
  assert.equal(px.readUInt16BE(127 * 128 * 2), 0x001F);
  assert.throws(() => feeds.bmpToRgb565(Buffer.alloc(60)), /not a BMP/);
});

test("now playing throttle: send on change or >= 5 s drift", () => {
  const a = { title: "T", artist: "A", pos: 10, len: 200, playing: true };
  assert.equal(feeds.shouldSend(null, a, 0, 0), true);
  assert.equal(feeds.shouldSend(a, { ...a, pos: 13 }, 0, 3000), false);       // on schedule
  assert.equal(feeds.shouldSend(a, { ...a, pos: 60 }, 0, 3000), true);        // seek
  assert.equal(feeds.shouldSend(a, { ...a, playing: false }, 0, 1000), true); // pause
  assert.equal(feeds.shouldSend(a, { ...a, title: "U" }, 0, 1000), true);     // new track
  const paused = { ...a, playing: false };
  assert.equal(feeds.shouldSend(paused, paused, 0, 60000), false);
});

test("context mapping from focused process", () => {
  assert.equal(contextForProcess("Code.exe"), "vscode");
  assert.equal(contextForProcess("chrome"), "chrome");
  assert.equal(contextForProcess("obs64"), "global");
});
