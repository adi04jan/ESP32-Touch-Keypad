"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { SerialLink } = require("../services/serial");
const { Device } = require("../services/device");
const backup = require("../services/backup");
const schema = require("../services/schema");
const { Autogen, Usage, answerSchema, toProfile, appKey, iconNames } = require("../services/autogen");
const { SimDevice, makeSimPort } = require("./sim-device");

// Stands in for Claude Code: checks how it was called, then answers like `claude -p --output-format json`.
// FAKE_MODE=bad answers once with a near-empty profile (one key), then a good one.
const FAKE = `
const args = process.argv.slice(2), fs = require("fs");
if (!args.includes("-p") || !args.includes("--json-schema") || args[args.indexOf("--tools") + 1] !== "") process.exit(9);
if (process.env.ANTHROPIC_API_KEY) process.exit(8);   // must run on the claude.ai login
let input = ""; process.stdin.on("data", (d) => input += d).on("end", () => {
  const count = process.env.FAKE_COUNT; let n = 0;
  try { n = +fs.readFileSync(count, "utf8"); } catch (_) {}
  fs.writeFileSync(count, String(n + 1));
  const bad = process.env.FAKE_MODE === "bad" && n === 0;
  const keys = [
    { name: "Send", icon: "send", actions: [{ type: "keycombo", keys: ["LEFT_CTRL", "ENTER"] }] },
    { name: "New request", icon: "plus", actions: [{ type: "keycombo", keys: ["LEFT_CTRL", "N"] }] },
    { name: "Save", icon: "no-such-icon", actions: [{ type: "keycombo", keys: ["LEFT_CTRL", "S"] }] }];
  const out = { profile_name: "Bruno", pages: [{ name: "Main", keys: bad ? keys.slice(0, 1) : keys }] };
  console.log(JSON.stringify({ type: "result", is_error: false, result: "", structured_output: out, prompt_seen: input.includes("bruno") }));
});`;

function rig(mode = "") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tk-autogen-"));
  const fake = path.join(dir, "fake-claude.js");
  fs.writeFileSync(fake, FAKE);
  process.env.FAKE_COUNT = path.join(dir, "count");
  process.env.FAKE_MODE = mode;
  backup.configure({ dataDir: dir });
  const sim = new SimDevice();
  for (const n of [1, 2, 3]) sim.files.set(`/profile${n}.json`, Buffer.from(JSON.stringify(schema.blankProfile(n))));   // the shipped three
  sim.files.set("/backups/profile4.json-000001.bak", Buffer.from("{}"));   // a backup is not a profile
  const link = new SerialLink({ SerialPort: makeSimPort(sim), uploadRate: Infinity });
  let settings = { baud: 921600, settime_enabled: false, host_slots: {}, context_profiles: {} };
  const store = { load: () => ({ ...settings }), save: (p) => (settings = { ...settings, ...p }) };
  const dev = new Device({ link, backup, settings: store, tileDir: path.join(dir, "tiles") });
  const saved = [];
  const ag = new Autogen({ device: dev, link, settings: store, cacheDir: path.join(dir, "autogen"), claude: [process.execPath, fake], onSaved: (slot) => saved.push(slot) });
  const calls = () => { try { return +fs.readFileSync(process.env.FAKE_COUNT, "utf8"); } catch (_) { return 0; } };
  return { dir, sim, link, dev, store, ag, saved, calls };
}

test("usage: minutes per app and the last real app in front (Studio itself never counts)", () => {
  let t = 0;
  const u = new Usage(() => t);
  u.focus("Code", "autogen.js - ESP32-Touch-Keypad"); t += 120000;
  u.focus("chrome", "Docs"); t += 60000;
  u.focus("Macropad Studio Touch", "Macropad Studio"); t += 30000;
  assert.deepEqual(u.last, { proc: "chrome", title: "Docs" });
  assert.deepEqual(u.minutes(), [["code", 2], ["chrome", 1]]);
  assert.equal(appKey("Code"), "vscode");          // a known context
  assert.equal(appKey("bruno"), "bruno");
  assert.equal(appKey("obs64"), "obs64");          // any other app: its process name
});

test("a folder in Claude's answer opens its page and its page has Back", () => {
  const icons = iconNames();
  const p = toProfile({ profile_name: "Git app", pages: [
    { name: "Main", keys: [{ name: "Git", icon: "git-branch", actions: [{ type: "page", page: 2 }] }, { name: "Save", icon: "save", actions: [{ type: "keycombo", keys: ["LEFT_CTRL", "S"] }] }] },
    { name: "Git", keys: [{ name: "Pull", icon: "download", actions: [{ type: "text", value: "git pull" }] }, { name: "Back", icon: "arrow-left", actions: [{ type: "back" }] }] }] }, "Git app", icons);
  assert.deepEqual(p.pages[0].keys[0].actions, [{ type: "page", value: 2 }]);
  assert.deepEqual(p.pages[1].keys[1].actions, [{ type: "back" }]);
  assert.ok(schema.validateProfile(p).ok);
  const far = toProfile({ profile_name: "X", pages: [{ name: "Main", keys: [{ name: "F", icon: "folder", actions: [{ type: "page", page: 9 }] }] }] }, "X", icons);
  assert.equal(far.pages[0].keys[0].actions[0].value, 1);   // a folder never points past the last page
});

test("Claude's answer becomes a valid v2 profile: 15 cells, ids, known icons only", () => {
  const icons = iconNames();
  assert.ok(icons.length > 200 && icons.includes("keyboard"));
  const sch = answerSchema(icons);
  assert.equal(sch.properties.pages.maxItems, 3);
  const p = toProfile({ profile_name: "X", pages: [{ name: "Main", keys: [{ name: "A very long key name", icon: "nope", actions: [{ type: "key", value: "F5" }] }] }] }, "X", icons);
  assert.equal(p.pages[0].keys.length, 15);
  assert.equal(p.pages[0].keys[0].icon, "keyboard");
  assert.equal(p.pages[0].keys[0].name.length, schema.MAX_LABEL);
  assert.ok(schema.validateProfile(p).ok);
});

test("Generate on a new app: Claude once, saved to a free slot, mapped, loaded, cached", async () => {
  const r = rig();
  await r.dev.connect("SIM1");
  r.ag.usage.focus("bruno", "Bruno");
  const res = await r.ag.run();
  assert.equal(res.ok, true, res.error);
  assert.equal(r.calls(), 1);
  assert.equal(res.slot, 4);                                            // 1-3 hold the shipped profiles
  assert.equal(r.store.load().context_profiles.bruno, 4);
  assert.equal(r.sim.profileN, 4);                                      // the keypad switched to it
  const onKeypad = JSON.parse(r.sim.files.get("/profile4.json").toString());
  assert.equal(onKeypad.pages[0].keys[1].name, "New request");
  assert.equal(onKeypad.pages[0].keys[2].icon, "keyboard");             // unknown icon replaced
  assert.ok(fs.existsSync(path.join(r.dir, "autogen", "bruno.json")));
  assert.deepEqual(r.saved, [4]);
  assert.match(r.sim.toasts[0], /^busy Asking Claude for Bruno/);
  assert.match(r.sim.toasts.at(-1), /^done Bruno ready: profile 4/);

  // Tap again: the app already has its profile, so no Claude call, just the switch.
  await r.dev.setActiveProfile(1);
  const again = await r.ag.run();
  assert.deepEqual([again.ok, again.cached, again.slot, r.calls()], [true, true, 4, 1]);
  assert.equal(r.sim.profileN, 4);

  // The slot was cleared on the keypad: the copy kept here goes back, still no Claude call.
  r.sim.files.delete("/profile4.json");
  const restored = await r.ag.run();
  assert.deepEqual([restored.ok, restored.cached, restored.slot, r.calls()], [true, true, 4, 1]);
  assert.ok(r.sim.files.has("/profile4.json"));

  // Regenerate asks Claude again.
  const fresh = await r.ag.run(true);
  assert.deepEqual([fresh.ok, !!fresh.cached, r.calls()], [true, false, 2]);
  r.link.disconnect();
});

test("an empty or foreign `ls /` reply is an error: no slot looks free, profile 1 is not overwritten", async () => {
  const r = rig();
  await r.dev.connect("SIM1");
  r.ag.usage.focus("bruno", "Bruno");
  const before = r.sim.files.get("/profile1.json").toString();
  const cmd = r.sim._command.bind(r.sim);
  for (const reply of ["", "Profile:1 loaded:1 model:touch"]) {   // a timeout; another command's late reply
    r.sim._command = (s) => (s === "ls /" ? (reply ? r.sim.println(reply) : undefined) : cmd(s));
    const res = await r.ag.run(true);
    assert.equal(res.ok, false);
    assert.match(res.error, /list the keypad/);
  }
  assert.equal(r.sim.files.get("/profile1.json").toString(), before);
  r.link.disconnect();
});

test("a rejected answer is retried once with the errors; no app yet and a missing CLI fail politely", async () => {
  const r = rig("bad");
  await r.dev.connect("SIM1");
  assert.equal((await r.ag.run()).error, "no app yet");
  assert.match(r.sim.toasts.at(-1), /^fail Use an app first/);
  r.ag.usage.focus("bruno", "Bruno");
  const res = await r.ag.run();
  assert.equal(res.ok, true, res.error);
  assert.equal(r.calls(), 2);
  assert.ok(r.sim.toasts.some((t) => /^busy Fixing the Bruno profile/.test(t)));

  r.ag.claude = path.join(r.dir, "no-such-claude.exe");
  const missing = await r.ag.run(true);
  assert.equal(missing.ok, false);
  assert.match(missing.error, /not installed|ENOENT/);
  assert.match(r.sim.toasts.at(-1), /^fail /);
  r.link.disconnect();
});
