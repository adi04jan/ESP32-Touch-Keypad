/* Autogenerate a keypad profile for the app in front. The keypad's Generate button sends
 * EVT:AUTOGEN (Studio's Settings has the same button). What Claude gets: the focused app,
 * its window title and this session's minutes per app, never keystrokes. Claude answers
 * through Claude Code (`claude -p` on the user's claude.ai login, its default model) in a
 * fixed JSON shape; Studio turns that into a schema v2 profile, saves it to that app's slot
 * (or the first free one), keeps a copy here, maps the app for auto-switching and loads it.
 * An app that already has a profile just switches to it: Claude runs once per app.
 * Progress goes to the keypad as `autogen busy|done|fail <text>`. */
"use strict";

const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const schema = require("./schema");
const { contextForProcess } = require("./contexts");

// Windows that are never "the app in front" for this purpose.
const IGNORE = /^(macropad studio touch|electron|kphelper|lockapp|searchhost|shellexperiencehost|startmenuexperiencehost|applicationframehost|textinputhost)$/i;
const LABELS = { code: "VS Code", chrome: "Chrome", msedge: "Edge", windowsterminal: "Terminal", explorer: "File Explorer",
  "notepad++": "Notepad++", winword: "Word", excel: "Excel", powerpnt: "PowerPoint", outlook: "Outlook", "ms-teams": "Teams" };
const PALETTE = [[79, 140, 255], [82, 214, 143], [63, 198, 224], [242, 183, 70], [155, 123, 255], [255, 111, 174], [226, 72, 64], [138, 152, 171]];
const TIMEOUT_MS = 180000;

const procKey = (p) => String(p || "").toLowerCase().replace(/\.exe$/, "");
const appLabel = (p) => LABELS[procKey(p)] || procKey(p).replace(/(^|[-_ ])(\w)/g, (_, s, c) => (s ? " " : "") + c.toUpperCase());
// Auto-switch key: the known context id (chrome, vscode...), else the process name itself.
const appKey = (p) => { const c = contextForProcess(p); return c !== "global" ? c : procKey(p); };

// Minutes per app and the last real app in front, from the focus watcher.
class Usage {
  constructor(now = Date.now) { this.now = now; this.ms = new Map(); this.cur = null; this.since = 0; this.last = null; }
  focus(proc, title = "") {
    const t = this.now(), key = procKey(proc);
    if (key !== this.cur) {
      if (this.cur) this.ms.set(this.cur, (this.ms.get(this.cur) || 0) + (t - this.since));
      this.cur = key;
      this.since = t;
    }
    if (key && !IGNORE.test(key)) this.last = { proc: key, title: String(title || "").slice(0, 160) };
  }
  minutes(n = 8) {
    const m = new Map(this.ms);
    if (this.cur) m.set(this.cur, (m.get(this.cur) || 0) + (this.now() - this.since));
    return [...m].filter(([k]) => !IGNORE.test(k)).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, ms]) => [k, Math.round(ms / 6000) / 10]);
  }
}

function iconNames() {
  try {
    const js = fs.readFileSync(path.join(__dirname, "..", "renderer", "keyicons.js"), "utf8");
    return [...js.matchAll(/"([a-z0-9-]+)":\{"f":/g)].map((m) => m[1]);
  } catch (_) { return ["keyboard"]; }
}

// The shape Claude must answer in (Claude Code checks it with --json-schema).
function answerSchema(icons) {
  const str = (max) => ({ type: "string", maxLength: max });
  const action = { type: "object", additionalProperties: false, required: ["type"], properties: {
    type: { enum: ["keycombo", "key", "text", "delay", "media", "page", "back"] },
    keys: { type: "array", items: { enum: schema.KEY_AND_MODIFIER } },
    value: { type: "string" }, ms: { type: "integer" }, page: { type: "integer" } } };
  const key = { type: "object", additionalProperties: false, required: ["name", "icon", "actions"], properties: {
    name: str(schema.MAX_LABEL), icon: { enum: icons }, actions: { type: "array", minItems: 1, maxItems: 8, items: action } } };
  const page = { type: "object", additionalProperties: false, required: ["name", "keys"], properties: {
    name: str(14), keys: { type: "array", minItems: 1, maxItems: schema.CELLS, items: key } } };
  return { type: "object", additionalProperties: false, required: ["profile_name", "pages"], properties: {
    profile_name: str(24), pages: { type: "array", minItems: 1, maxItems: 3, items: page } } };
}

function prompt(app, minutes, fix = "") {
  return [
    `Design a keypad profile for the Windows app "${appLabel(app.proc)}" (process ${app.proc}.exe).`,
    app.title ? `Its window title right now: "${app.title}".` : "",
    minutes.length ? `Minutes in each app this session: ${minutes.map(([k, m]) => `${k} ${m}`).join(", ")}.` : "",
    "",
    "The keypad is a 5x3 touch macropad: each key types keyboard input into the focused window over Bluetooth.",
    "Rules:",
    "- 1 to 3 pages, up to 15 keys each. Page 1 holds this app's most used shortcuts; group the rest by task.",
    "- Only real default Windows shortcuts of this app (the ones in its own docs). Never invent one.",
    "- Key names: short, at most 14 characters. Pick the closest icon from the allowed list.",
    "- Actions: keycombo {keys:[modifiers..., one key]} for chords; key {value}; text {value} types literally;",
    "  delay {ms}; media {value: PLAY_PAUSE|NEXT|PREVIOUS|MUTE|VOLUME_UP|VOLUME_DOWN}.",
    "- Key names in keys/value use the allowed names (LEFT_CTRL, LEFT_SHIFT, LEFT_ALT, LEFT_GUI, A-Z, 0-9, F1-F24, ENTER, ESC, TAB, ...).",
    "- Folders: group a family of commands (all Git commands, all debug commands...) behind one key on page 1",
    "  whose only action is page {page: N} (a later page, 1-based). That page holds the family and ends with a",
    "  Back key whose only action is back. The keypad draws folder keys as a stack of cards.",
    "- No destructive key (delete, discard, close without saving) on page 1.",
    "- profile_name: the app's name.",
    fix ? `\nYour previous answer was rejected: ${fix}. Fix exactly that.` : "",
    "Answer with the JSON object only.",
  ].filter((l) => l !== "").join("\n");
}

// Claude's answer -> a schema v2 profile (15 cells per page, ids, LED colours).
function toProfile(out, label, icons) {
  const known = new Set(icons);
  const tone = PALETTE[[...label].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % PALETTE.length];
  const pages = Math.min(3, (out.pages || []).length) || 1;
  const action = (a) => a.type === "keycombo" ? { type: "keycombo", keys: a.keys || [] }
    : a.type === "delay" ? { type: "delay", ms: Math.max(0, Math.min(5000, a.ms | 0)) }
    : a.type === "page" ? { type: "page", value: Math.max(1, Math.min(pages, a.page | 0 || parseInt(a.value, 10) || 1)) }
    : a.type === "back" ? { type: "back" }
    : { type: a.type, value: String(a.value ?? "") };
  return schema.repairProfile({
    schema_version: 2, profile_name: String(out.profile_name || label).slice(0, 24), color: tone, default_delay: 20,
    pages: (out.pages || []).slice(0, 3).map((pg) => ({
      name: String(pg.name || "Page").slice(0, 14),
      keys: Array.from({ length: schema.CELLS }, (_, i) => {
        const k = (pg.keys || [])[i];
        if (!k) return null;
        return { id: i + 1, name: String(k.name).slice(0, schema.MAX_LABEL), icon: known.has(k.icon) ? k.icon : "keyboard",
          led_color: PALETTE[i % PALETTE.length], actions: (k.actions || []).map(action) };
      }),
    })),
  });
}

// One Claude Code run: prompt on stdin, JSON on stdout. Your claude.ai login, not an API key
// from the environment; no tools; a scratch working folder so no project context loads.
function runClaude(cmd, text, sch) {
  return new Promise((resolve, reject) => {
    const [file, ...pre] = [].concat(cmd);
    const args = [...pre, "-p", "--output-format", "json", "--json-schema", JSON.stringify(sch),
      "--tools", "", "--strict-mcp-config", "--no-session-persistence"];
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== "ANTHROPIC_API_KEY" && !/^CLAUDE(CODE|_CODE_|_PID|_EFFORT)/.test(k)));
    let child;
    try { child = spawn(file, args, { cwd: os.tmpdir(), env, windowsHide: true }); }
    catch (e) { return reject(e); }
    let out = "", err = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error("Claude took too long")); }, TIMEOUT_MS);
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    child.on("error", (e) => { clearTimeout(timer); reject(e.code === "ENOENT" ? new Error("Claude Code is not installed") : e); });
    child.on("close", (code) => {
      clearTimeout(timer);
      const at = out.indexOf("{");
      let d;
      try { d = JSON.parse(out.slice(at)); } catch (_) { return reject(new Error(`Claude Code failed (${code}): ${(err || out).trim().slice(-120)}`)); }
      if (d.is_error) return reject(new Error(String(d.result || "Claude reported an error").slice(0, 120)));
      if (d.structured_output) return resolve(d.structured_output);
      try { resolve(JSON.parse(String(d.result).replace(/^```(json)?|```$/gm, "").trim())); }
      catch (_) { reject(new Error("Claude's answer was not JSON")); }
    });
    child.stdin.on("error", () => {});
    child.stdin.end(text);
  });
}

const keyCount = (p) => p.pages.reduce((n, pg) => n + pg.keys.filter(Boolean).length, 0);
// Valid, and worth a keypad: repairProfile already drops bad key names, so an answer that
// lost most of its keys (or never had them) is the failure to catch.
function check(p) {
  const v = schema.validateProfile(p), n = keyCount(p);
  return v.ok && n < 3 ? { ok: false, errors: [`only ${n} usable keys; give the app's most used shortcuts, at least 6 keys`] } : v;
}

class Autogen {
  /* deps: device (Device), link (SerialLink), settings (store), cacheDir, log(text), onSaved(slot, profile);
   * claude: the command (array allowed: tests pass [node, fake.js]). */
  constructor(deps) {
    Object.assign(this, { claude: "claude", cacheDir: null, log: () => {}, onSaved: () => {} }, deps);
    this.usage = new Usage(deps.now);
    this.icons = iconNames();
    this.busy = false;
  }
  say(state, text) { return this.link.isOpen() ? this.link.command(`autogen ${state} ${text}`, undefined, true) : Promise.resolve(""); }

  async usedSlots() {
    const lines = (await this.link.command("ls /", undefined, true)).split("\n").filter((l) => l.trim());
    // A timeout or another command's late reply would make every slot look free, and slot 1 would be overwritten.
    if (!lines.length || !lines.every((l) => /^[^\t]+\t\d+\s*$/.test(l))) throw new Error("Could not list the keypad's files");
    return new Set(lines.map((l) => l.match(/^profile(\d+)\.json\t/)).filter(Boolean).map((m) => +m[1]));   // not backups/profileN.json-*.bak
  }
  // A slot for this app: the one it is mapped to, else the first slot with no profile.
  async pickSlot(key) {
    const mapped = (this.settings.load().context_profiles || {})[key];
    if (mapped) return mapped;
    const used = await this.usedSlots();
    for (let n = 1; n <= schema.NUM_PROFILES; n++) if (!used.has(n)) return n;
    throw new Error("No free profile slot");
  }
  cacheFile(key) { return this.cacheDir && path.join(this.cacheDir, `${key.replace(/[^a-z0-9+_-]/gi, "_")}.json`); }
  readCache(key) { try { return schema.repairProfile(JSON.parse(fs.readFileSync(this.cacheFile(key), "utf8"))); } catch (_) { return null; } }

  async install(key, profile, how) {
    const slot = await this.pickSlot(key);
    const r = await this.device.save(slot, profile);
    if (!r.ok) throw new Error(r.error || (r.errors || []).join("; ") || "save failed");
    await this.device.setActiveProfile(slot);
    this.settings.save({ context_profiles: { ...(this.settings.load().context_profiles || {}), [key]: slot } });
    this.onSaved(slot, r.profile);
    await this.say("done", `${r.profile.profile_name} ${how}: profile ${slot}`);
    return { slot, profile: r.profile };
  }

  /* The app in front gets its profile. Cached first: an app that already has one (mapped
   * to a slot that still holds a profile, or kept here from an earlier generation) just
   * switches to it. Claude only runs for a new app, or with force (Studio's Regenerate). */
  async run(force = false) {
    if (this.busy) { await this.say("busy", "Still generating..."); return { ok: false, error: "busy" }; }
    const app = this.usage.last;
    if (!app) { await this.say("fail", "Use an app first, then tap Generate"); return { ok: false, error: "no app yet" }; }
    const label = appLabel(app.proc), key = appKey(app.proc);
    this.busy = true;
    try {
      if (!force) {
        const mapped = (this.settings.load().context_profiles || {})[key];
        if (mapped && (await this.usedSlots()).has(mapped)) {
          await this.device.setActiveProfile(mapped);
          await this.say("done", `${label}: profile ${mapped}`);
          return { ok: true, slot: mapped, key, cached: true };
        }
        const cached = this.readCache(key);
        if (cached) return { ok: true, key, cached: true, ...(await this.install(key, cached, "restored")) };
      }
      await this.say("busy", `Asking Claude for ${label}...`);
      this.log(`Autogenerate: ${label} ("${app.title}") -> Claude Code\n`);
      const sch = answerSchema(this.icons);
      const t0 = Date.now();
      let profile = toProfile(await runClaude(this.claude, prompt(app, this.usage.minutes()), sch), label, this.icons);
      let v = check(profile);
      if (!v.ok) {   // one more try, told exactly what was wrong
        await this.say("busy", `Fixing the ${label} profile...`);
        profile = toProfile(await runClaude(this.claude, prompt(app, this.usage.minutes(), v.errors.slice(0, 6).join("; ")), sch), label, this.icons);
        v = check(profile);
        if (!v.ok) throw new Error("Claude's profile did not validate");
      }
      if (this.cacheDir) { fs.mkdirSync(this.cacheDir, { recursive: true }); fs.writeFileSync(this.cacheFile(key), JSON.stringify(profile, null, 1)); }
      const r = await this.install(key, profile, "ready");
      const keys = keyCount(r.profile);
      this.log(`Autogenerate: ${r.profile.profile_name} saved to profile ${r.slot} (${keys} keys, ${((Date.now() - t0) / 1000).toFixed(1)} s)\n`);
      return { ok: true, key, ...r };
    } catch (e) {
      this.log(`Autogenerate failed: ${e.message}\n`);
      await this.say("fail", e.message.slice(0, 40));
      return { ok: false, error: e.message };
    } finally { this.busy = false; }
  }
}

module.exports = { Autogen, Usage, answerSchema, prompt, toProfile, runClaude, appLabel, appKey, iconNames };
