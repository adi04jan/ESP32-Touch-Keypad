"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("events");
const { MicMute } = require("../services/micmute");

// A stand-in for the PowerShell helper: answers each command line the way the real one does.
function fakeSpawn(state = { muted: false, spawns: 0, lines: [] }) {
  return (cmd, args, opts) => {
    state.spawns++;
    const child = new EventEmitter();
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    child.stdin = { write: (s) => {
      for (const l of s.split("\n").filter(Boolean)) {
        state.lines.push(l);
        if (l === "toggle") state.muted = !state.muted;
        if (l === "mute") state.muted = true;
        if (l === "unmute") state.muted = false;
        const now = state.muted;   // the real helper answers each line with the state right after it
        setImmediate(() => child.stdout.emit("data", Buffer.from(`muted ${now ? 1 : 0}\r\n`)));
      }
    } };
    child.kill = () => child.emit("exit", 0);
    state.child = child;
    state.opts = opts;
    return child;
  };
}

test("toggle, mute and unmute answer with the mic's state; one hidden helper serves them all", async () => {
  const st = { muted: false, spawns: 0, lines: [] };
  const m = new MicMute({ spawn: fakeSpawn(st) });
  assert.equal(await m.run("toggle"), true);
  assert.equal(await m.run("toggle"), false);
  assert.equal(await m.run("mute"), true);
  assert.equal(await m.run("unmute"), false);
  assert.deepEqual(st.lines, ["toggle", "toggle", "mute", "unmute"]);
  assert.equal(st.spawns, 1);
  assert.equal(st.opts.windowsHide, true);
  m.stop();
});

test("requests sent back to back get their own answers, in order", async () => {
  const m = new MicMute({ spawn: fakeSpawn() });
  assert.deepEqual(await Promise.all([m.run("toggle"), m.run("toggle"), m.run("toggle")]), [true, false, true]);
  m.stop();
});

test("a helper that dies is restarted on the next press; the press in flight fails", async () => {
  const st = { muted: false, spawns: 0, lines: [] };
  const spawn = fakeSpawn(st);
  const m = new MicMute({ spawn: (...a) => { const c = spawn(...a); if (st.spawns === 1) c.stdin.write = () => setImmediate(() => c.emit("exit", 1)); return c; } });
  await assert.rejects(m.run("toggle"));
  assert.equal(await m.run("toggle"), true);
  assert.equal(st.spawns, 2);
  m.stop();
});

test("an unknown argument is refused without touching the mic", async () => {
  const st = { muted: false, spawns: 0, lines: [] };
  const m = new MicMute({ spawn: fakeSpawn(st) });
  await assert.rejects(m.run("loud"));
  assert.equal(st.spawns, 0);
});
