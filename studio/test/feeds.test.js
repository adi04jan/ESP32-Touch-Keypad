"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const feeds = require("../services/feeds");
const { contextForProcess } = require("../services/contexts");

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
  assert.deepEqual(Object.keys(o), ["title", "artist", "app", "pos", "len", "playing"]);
  assert.equal(c.includes("\n"), false);
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
