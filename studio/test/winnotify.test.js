/* This PC's notifications to the keypad (services/winnotify.js): toast XML to a keypad note, the
 * app names and icons, text the keypad's fonts can draw, and the poller over a database shaped
 * like Windows' (only new toasts, never Studio's own). */
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { EventEmitter } = require("events");
const { WinNotify, toNote, toKeypadText, appOf } = require("../services/winnotify");
const { Device } = require("../services/device");

const toast = (...texts) => `<toast><visual><binding template="ToastGeneric">${texts.map((t) => `<text>${t}</text>`).join("")}</binding></visual></toast>`;

test("a toast becomes a keypad note: first text the title, the rest the body", () => {
  assert.deepStrictEqual(toNote("com.squirrel.slack.slack", toast("Priya Shah", "Review &amp; merge?", "#keypad")),
    { app: "Slack", title: "Priya Shah", body: "Review & merge? #keypad", icon: "message-square" });
  assert.strictEqual(toNote("x", "<toast><visual><binding/></visual></toast>"), null);   // nothing to show
});

test("apps get a short name and a keypad icon; unknown ids a readable piece", () => {
  assert.deepStrictEqual(appOf("MSTeams_8wekyb3d8bbwe!MSTeams"), { name: "Teams", icon: "users" });
  assert.deepStrictEqual(appOf("Windows.Defender.SecurityCenter"), { name: "Security", icon: "shield" });
  assert.deepStrictEqual(appOf("Contoso.Notes_8wekyb3d8bbwe!App"), { name: "Notes", icon: "bell" });
  assert.deepStrictEqual(appOf("com.acme.chat"), { name: "Chat", icon: "bell" });
});

test("text folds to what the keypad can draw: accents, quotes, no emoji, a length cap", () => {
  assert.strictEqual(toKeypadText("Café “launch” — 🚀 done", 40), 'Cafe "launch" – done');
  assert.strictEqual(toKeypadText("a".repeat(50), 10), `${"a".repeat(9)}…`);
  assert.strictEqual(toKeypadText("tab\tand\nnewline", 40), "tab and newline");
});

test("the poller forwards only toasts newer than its start, and never Studio's own", () => {
  const { DatabaseSync } = require("node:sqlite");
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wpn-")), "wpndatabase.db");
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE NotificationHandler (RecordId INTEGER PRIMARY KEY, PrimaryId TEXT);
    CREATE TABLE Notification (Id INTEGER PRIMARY KEY, HandlerId INTEGER, Type TEXT, Payload BLOB);
    INSERT INTO NotificationHandler VALUES (1, 'com.squirrel.slack.slack'), (2, 'com.adi04jan.touchkeypadstudio');`);
  const add = (id, h, type, xml) => db.prepare("INSERT INTO Notification VALUES (?, ?, ?, ?)").run(id, h, type, Buffer.from(xml));
  add(10, 1, "toast", toast("Old", "already seen"));
  const got = [];
  const w = new WinNotify({ dbPath: file, onNote: (n) => got.push(n), interval: 1e9 });
  w.start();
  add(11, 2, "toast", toast("Studio's own"));
  add(12, 1, "tile", toast("A live tile, not a toast"));
  add(13, 1, "toast", toast("Sam", "Lunch?"));
  w.poll();
  w.poll();   // nothing twice
  w.stop();
  db.close();
  assert.deepStrictEqual(got, [{ app: "Slack", title: "Sam", body: "Lunch?", icon: "message-square" }]);
});

test("Device.notify sends one notify line while the keypad is connected", () => {
  const link = Object.assign(new EventEmitter(), { open: false, sent: [], isOpen() { return this.open; }, command(c) { this.sent.push(c); } });
  const d = new Device({ link, settings: { load: () => ({}) } });
  assert.strictEqual(d.notify({ app: "Slack", title: "Sam", body: "Lunch?", icon: "message-square" }), false);
  link.open = true;
  assert.strictEqual(d.notify({ app: "Slack", title: "Sam", body: "Lunch?", icon: "message-square" }), true);
  assert.deepStrictEqual(link.sent, ['notify {"app":"Slack","title":"Sam","body":"Lunch?","icon":"message-square"}']);
});
