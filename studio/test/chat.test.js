"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const schema = require("../services/schema");
const { chatTurn, turnText } = require("../services/chat");

// Stands in for Claude Code. FAKE_CHAT picks the answer: "edit" moves key 1 into a Git folder,
// "bad" sends a broken profile once (then a good one), "talk" answers without a profile.
const FAKE = `
const fs = require("fs");
let input = ""; process.stdin.on("data", (d) => input += d).on("end", () => {
  const n = +(fs.existsSync(process.env.FAKE_COUNT) ? fs.readFileSync(process.env.FAKE_COUNT, "utf8") : 0);
  fs.writeFileSync(process.env.FAKE_COUNT, String(n + 1));
  const prof = JSON.parse(input.split("\\n").find((l) => l.startsWith('{"schema_version"')));
  let out;
  if (process.env.FAKE_CHAT === "talk") out = { reply: "Page 1 has 2 keys.", profile: null };
  else if (process.env.FAKE_CHAT === "bad" && n === 0) out = { reply: "Here.", profile: { pages: "nope" } };
  else {
    const git = prof.pages[0].keys[0];
    prof.pages[0].keys[0] = { id: 1, name: "Git", icon: "git-branch", led_color: [79, 140, 255], actions: [{ type: "page", value: 2 }] };
    prof.pages[1] = { name: "Git", keys: Array.from({ length: 15 }, (_, i) => i === 0 ? git : i === 14 ? { id: 15, name: "Back", icon: "arrow-left", led_color: [138, 152, 171], actions: [{ type: "back" }] } : null) };
    out = { reply: "Moved " + git.name + " into a Git folder.", profile: prof };
  }
  console.log(JSON.stringify({ type: "result", is_error: false, result: "", structured_output: out }));
});`;

function rig(mode) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tk-chat-"));
  fs.writeFileSync(path.join(dir, "fake.js"), FAKE);
  process.env.FAKE_COUNT = path.join(dir, "count");
  process.env.FAKE_CHAT = mode;
  const calls = () => +(fs.existsSync(process.env.FAKE_COUNT) ? fs.readFileSync(process.env.FAKE_COUNT, "utf8") : 0);
  return { claude: [process.execPath, path.join(dir, "fake.js")], calls };
}
const PROFILE = { schema_version: 2, profile_name: "Code", color: [79, 140, 255], default_delay: 20, pages: [
  { name: "Main", keys: Array.from({ length: 15 }, (_, i) => i === 0 ? { id: 1, name: "Pull", icon: "download", led_color: [82, 214, 143], actions: [{ type: "text", value: "git pull" }, { type: "key", value: "ENTER" }] }
    : i === 1 ? { id: 2, name: "Save", icon: "save", led_color: [63, 198, 224], actions: [{ type: "keycombo", keys: ["LEFT_CTRL", "S"] }] } : null) },
  { name: "Two", keys: Array(15).fill(null) }] };
const req = (message, history = []) => ({ history, message, profile: PROFILE, slot: 2, slots: [[1, "Daily"], [2, "Code"]] });

test("the turn carries the schema, the open profile, the other profiles and the conversation", () => {
  const t = turnText(req("Group the Git keys", [{ role: "user", text: "hi" }, { role: "ai", text: "Hello" }]));
  for (const s of ["schema v2", "Folders:", "Icons:", "git-branch", "profile 2", '"profile_name":"Code"', "1 Daily, 2 Code", "Owner: hi", "You: Hello", "Owner: Group the Git keys"]) assert.ok(t.includes(s), s);
});

test("an edit comes back repaired and valid: a folder on page 1, the key inside with Back", async () => {
  const r = rig("edit");
  const out = await chatTurn(req("Put Pull in a Git folder"), r.claude);
  assert.equal(out.error, undefined);
  assert.match(out.reply, /Moved Pull into a Git folder/);
  assert.deepEqual(out.profile.pages[0].keys[0].actions, [{ type: "page", value: 2 }]);
  assert.equal(out.profile.pages[1].keys[0].name, "Pull");
  assert.deepEqual(out.profile.pages[1].keys[14].actions, [{ type: "back" }]);
  assert.equal(out.profile.pages[0].keys[1].name, "Save");            // untouched keys stay
  assert.ok(schema.validateProfile(out.profile).ok);
});

test("a question gets an answer and no change; a broken profile is retried once", async () => {
  const talk = rig("talk");
  assert.deepEqual(await chatTurn(req("How many keys on page 1?"), talk.claude), { reply: "Page 1 has 2 keys.", profile: null });
  const bad = rig("bad");
  const out = await chatTurn(req("Fix it"), bad.claude);
  assert.equal(bad.calls(), 2);
  assert.ok(out.profile && schema.validateProfile(out.profile).ok);
});

test("a missing Claude Code is an error message, not a crash", async () => {
  const out = await chatTurn(req("hi"), path.join(os.tmpdir(), "no-such-claude.exe"));
  assert.equal(out.profile, null);
  assert.match(out.error, /not installed|ENOENT/);
});

// Typed text and host commands can hold passwords: they leave the PC as «secret:N» placeholders.
// This fake records what it was sent, moves key 1 to cell 6, adds a key with a new literal, and
// (FAKE_CHAT=drop) deletes key 1's placeholder or (FAKE_CHAT=swap) puts a typed placeholder in a host cmd.
const SECRET_FAKE = `
const fs = require("fs");
let input = ""; process.stdin.on("data", (d) => input += d).on("end", () => {
  fs.writeFileSync(process.env.FAKE_SEEN, input);
  const prof = JSON.parse(input.split("\\n").find((l) => l.startsWith('{"schema_version"')));
  const keys = prof.pages[0].keys;
  keys[5] = { ...keys[0], id: 6 }; keys[0] = null;
  keys[6] = { id: 7, name: "New", icon: "zap", led_color: [1, 2, 3], actions: [{ type: "text", value: "a new literal" }] };
  if (process.env.FAKE_CHAT === "drop") keys[5].actions = [{ type: "key", value: "ENTER" }];
  if (process.env.FAKE_CHAT === "swap") keys[1].actions[0].cmd = keys[5].actions[0].value;
  console.log(JSON.stringify({ type: "result", is_error: false, result: "", structured_output: { reply: "Moved it.", profile: prof } }));
});`;
const SECRETS = ["hunter2-pa55word", "run C:\\deploy.cmd --token tk_9f8e7d", "user@example.com\nsecond-line-secret", "nested-r3peat-secret", "open https://x.y/?key=abc123"];
const SECRET_PROFILE = { schema_version: 2, profile_name: "Work", default_delay: 20, pages: [{ name: "Main", keys: Array.from({ length: 15 }, (_, i) =>
  i === 0 ? { id: 1, name: "Login", icon: "lock", led_color: [1, 2, 3], actions: [{ type: "text", value: SECRETS[0] }, { type: "key", value: "ENTER" }] }
  : i === 1 ? { id: 2, name: "Deploy", icon: "rocket", led_color: [1, 2, 3], actions: [{ type: "host", cmd: SECRETS[1], slot: 3 }],
    hold_actions: [{ type: "multiline", value: SECRETS[2] }, { type: "repeat", count: 2, actions: [{ type: "text", value: SECRETS[3] }] }] }
  : i === 2 ? { id: 3, name: "Mail", icon: "mail", led_color: [1, 2, 3], toggle: true, actions: [{ type: "key", value: "A" }], off_actions: [{ type: "host", cmd: SECRETS[4] }] }
  : null) }] };
function secretRig(mode) {
  const r = rig(mode), dir = path.dirname(r.claude[1]);
  fs.writeFileSync(r.claude[1], SECRET_FAKE);
  process.env.FAKE_SEEN = path.join(dir, "seen.txt");
  return { ...r, seen: () => fs.readFileSync(process.env.FAKE_SEEN, "utf8") };
}
const secretReq = () => ({ history: [], message: "Move Login", profile: structuredClone(SECRET_PROFILE), slot: 4, slots: [[4, "Work"]] });

test("Ask Claude never sends typed text or host commands: they go as placeholders", async () => {
  const r = secretRig("edit");
  const out = await chatTurn(secretReq(), r.claude);
  assert.equal(out.error, undefined);
  const seen = r.seen();
  for (const s of SECRETS) for (const part of s.split("\n")) assert.ok(!seen.includes(part) && !seen.includes(JSON.stringify(part).slice(1, -1)), `sent: ${part}`);
  assert.match(seen, /«secret:1»/);
  assert.match(seen, /opaque/);   // the model is told to keep them verbatim
});

test("a placeholder comes back as its value wherever the answer moved it; new literals stay", async () => {
  const r = secretRig("edit");
  const out = await chatTurn(secretReq(), r.claude);
  const k = out.profile.pages[0].keys;
  assert.equal(k[0], null);
  assert.deepEqual(k[5].actions[0], { type: "text", value: SECRETS[0] });
  assert.equal(k[1].actions[0].cmd, SECRETS[1]);
  assert.equal(k[1].hold_actions[0].value, SECRETS[2]);
  assert.equal(k[1].hold_actions[1].actions[0].value, SECRETS[3]);
  assert.equal(k[2].off_actions[0].cmd, SECRETS[4]);
  assert.equal(k[6].actions[0].value, "a new literal");
  assert.ok(schema.validateProfile(out.profile).ok);
});

test("a placeholder the answer deleted stays deleted; a typed one never becomes a command", async () => {
  const drop = await chatTurn(secretReq(), secretRig("drop").claude);
  assert.ok(!JSON.stringify(drop.profile).includes(SECRETS[0].slice(0, 6)));
  const swap = await chatTurn(secretReq(), secretRig("swap").claude);
  assert.ok(!JSON.stringify(swap.profile.pages[0].keys[1].actions).includes(SECRETS[0]), "a typed password became a host command");
});
