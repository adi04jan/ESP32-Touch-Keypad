/* This PC's notifications on the keypad: each new Windows toast (Slack, Teams, Outlook...) goes to
 * the keypad's bell, banner and pull-down shade (`notify`, docs/PROTOCOL.md). Windows keeps toasts
 * in a SQLite database in the user's profile; Studio reads it, read-only, every 2 s with Node's
 * built-in sqlite and forwards the new ones over the keypad link, nowhere else. */
"use strict";
const path = require("path");

const DB_PATH = () => path.join(process.env.LOCALAPPDATA || "", "Microsoft", "Windows", "Notifications", "wpndatabase.db");

// The app id Windows files a toast under -> a short name and a keypad icon (a key icon's name).
const APPS = [
  [/slack/i, "Slack", "message-square"], [/teams/i, "Teams", "users"], [/outlook|hxoutlook|windowscommunicationsapps|\bmail\b/i, "Mail", "mail"],
  [/discord/i, "Discord", "discord"], [/whatsapp/i, "WhatsApp", "whatsapp"], [/telegram/i, "Telegram", "telegram"],
  [/signal/i, "Signal", "signal"], [/chrome/i, "Chrome", "googlechrome"], [/firefox/i, "Firefox", "firefoxbrowser"],
  [/msedge|microsoftedge/i, "Edge", "globe"], [/spotify/i, "Spotify", "spotify"], [/zoom/i, "Zoom", "video"],
  [/defender|securitycenter/i, "Security", "shield"], [/wifi|wlan|networkmanager/i, "Wi-Fi", "wifi"],
  [/calendar/i, "Calendar", "calendar"], [/windowsupdate|updateorchestrator/i, "Windows Update", "download"],
  [/powershell/i, "PowerShell", "terminal"], [/github/i, "GitHub", "github"], [/visualstudiocode|vscode/i, "VS Code", "code-xml"],
  [/bluetooth/i, "Bluetooth", "bluetooth"], [/battery|power/i, "Power", "plug-zap"],
];

function appOf(id = "") {
  for (const [re, name, icon] of APPS) if (re.test(id)) return { name, icon };
  // Else a readable piece of the id: "Contoso.Notes_8wekyb3d8bbwe!App" -> "Notes", "com.acme.chat" -> "Chat".
  const parts = id.split("!")[0].split("_")[0].split(/[.\\/]/).filter((p) => p && !/^(exe|app|com|microsoft|windows|systemtoast)$/i.test(p));
  const name = parts.pop() || "PC";
  return { name: name.charAt(0).toUpperCase() + name.slice(1), icon: "bell" };
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) =>
  e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENTITIES[e.toLowerCase()] ?? m);

// The keypad's fonts carry ASCII and · … › – − ° ×: fold accents and quotes, drop the rest (emoji).
function toKeypadText(s, max) {
  const t = String(s).normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[‘’‚′]/g, "'").replace(/[“”„″]/g, '"').replace(/—/g, "–")
    .replace(/[^\x20-\x7e·…›–−°×]/g, " ").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

// A toast's XML -> { app, title, body, icon }, or null when it has no text.
function toNote(appId, xml) {
  const texts = [...String(xml).matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)].map((m) => decode(m[1].replace(/<[^>]+>/g, "")).trim()).filter(Boolean);
  if (!texts.length) return null;
  const { name, icon } = appOf(appId);
  return { app: toKeypadText(name, 18), title: toKeypadText(texts[0], 40), body: toKeypadText(texts.slice(1).join(" "), 80), icon };
}

class WinNotify {
  constructor({ onNote, log = () => {}, dbPath = DB_PATH(), interval = 2000, skip = /touchkeypadstudio|macropad studio/i } = {}) {
    Object.assign(this, { onNote, log, dbPath, interval, skip });
    this.lastId = null;
    this.db = null;
    this.timer = null;
  }
  start() {
    if (this.timer) return;
    this.lastId = this._maxId();   // only toasts from now on
    this.timer = setInterval(() => this.poll(), this.interval);
  }
  stop() {
    clearInterval(this.timer);
    this.timer = null;
    this._close();
  }
  poll() {
    try {
      if (this.lastId === null) { this.lastId = this._maxId(); return; }
      const rows = this._open().prepare(`SELECT n.Id AS id, n.Payload AS payload, h.PrimaryId AS app FROM Notification n
        JOIN NotificationHandler h ON h.RecordId = n.HandlerId WHERE n.Type = 'toast' AND n.Id > ? ORDER BY n.Id`).all(this.lastId);
      for (const r of rows) {
        this.lastId = Math.max(this.lastId, Number(r.id));
        if (this.skip.test(r.app || "")) continue;
        const note = toNote(r.app, Buffer.from(r.payload || "").toString("utf8"));
        if (note) this.onNote(note);
      }
    } catch (e) {
      this.log(`Windows notifications: ${e.message}\n`);
      this._close();   // reopen on the next poll
    }
  }
  _maxId() {
    try { return Number(this._open().prepare("SELECT max(Id) AS m FROM Notification").get().m || 0); }
    catch (e) { this.log(`Windows notifications: ${e.message}\n`); this._close(); return null; }
  }
  _open() {
    if (!this.db) { const { DatabaseSync } = require("node:sqlite"); this.db = new DatabaseSync(this.dbPath, { readOnly: true }); }
    return this.db;
  }
  _close() {
    try { if (this.db) this.db.close(); } catch (_) {}
    this.db = null;
  }
}

module.exports = { WinNotify, toNote, toKeypadText, appOf, DB_PATH };
