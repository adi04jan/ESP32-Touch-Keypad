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
