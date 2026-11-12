/* Studio's chat: the owner asks, Claude organizes, creates or edits the profile open in the
 * editor. Each turn sends the conversation so far, that profile (schema v2 JSON, its typed text and
 * host commands as placeholders) and the names
 * of the keypad's other profiles to Claude Code (autogen.js runClaude: the claude.ai login, no
 * tools). Claude answers {reply, profile}: profile is the complete updated profile when it
 * changed something, else null. A returned profile is repaired and validated here; the editor
 * applies it as one undoable change and autosave writes it to the keypad. */
"use strict";

const schema = require("./schema");
const { runClaude, iconNames } = require("./autogen");

const ANSWER = { type: "object", additionalProperties: false, required: ["reply"], properties: {
  reply: { type: "string" }, profile: { type: ["object", "null"] } } };

function guide(icons) {
  const named = schema.KEY_NAMES.filter((k) => k.length > 2 && !/^F\d+$/.test(k));
  return [
    "You help the owner of a Touch Keypad organize, create and edit its profiles, inside Macropad Studio.",
    "The keypad: a 480x320 touch screen, 5x3 keys per page (15 cells), up to 16 pages per profile, 16 profiles. Keys type into the focused Windows app over Bluetooth.",
    "Profile JSON (schema v2): {schema_version:2, profile_name (max 24), color:[r,g,b], default_delay (ms), pages:[{name (max 14), keys:[exactly 15 entries, null for an empty cell]}]}.",
    "A key: {id: its cell 1-15, name (max 14 chars), icon (from the list below), led_color:[r,g,b], actions:[...], optional hold_actions:[...], toggle:true with off_actions:[...], anim: eq|pulse|rec, hold_to_fire:true (a tap does nothing, holding 500 ms fires actions; never with hold_actions)}.",
    "Actions: {type:'key', value:KEY} | {type:'keycombo', keys:[MODIFIER..., KEY]} | {type:'text', value} typed literally | {type:'multiline', value} | {type:'delay', ms} |",
    "  {type:'media', value: PLAY_PAUSE|STOP|NEXT|PREVIOUS|MUTE|VOLUME_UP|VOLUME_DOWN} | {type:'telephony', value: MIC_MUTE|ANSWER|DECLINE} | {type:'page', value:n} (1-based) | {type:'back'} |",
    "  {type:'profile', value: 1-16} | {type:'host', cmd: 'open <url, file or app>' or 'run <command line>'} (Studio runs it on the PC).",
    `KEY: A-Z, 0-9, F1-F24, ${named.join(" ")}. MODIFIER: LEFT_CTRL LEFT_SHIFT LEFT_ALT LEFT_GUI (and RIGHT_*).`,
    "Folders: a key whose only action is page n opens page n; that page holds a family of commands and ends with a Back key (only action back) in cell 15. The keypad draws folder keys as a stack of cards.",
    "A page whose first key has widget:'media' and span:[5,3] is the full-page media player: keep it unless asked.",
    `Icons: ${icons.join(" ")}`,
    "Rules: keep every key the owner did not ask about exactly as it is (id, actions, colours). Use real default Windows shortcuts; never invent one. No destructive key on page 1.",
    "Private values: every text and multiline value and every host cmd shows as a placeholder like «secret:3». They are opaque: keep each one verbatim on its action (moving the action is fine), never edit, split, copy or explain one. Write a literal value only for an action you add.",
    "Answer JSON {reply, profile}. reply: a short plain answer for the owner (what you changed, or your answer to the question). profile: the COMPLETE updated profile when you changed it, else null.",
  ].join("\n");
}

function turnText({ history = [], message, profile, slot, slots = [] }, fix = "") {
  return [
    guide(iconNames()),
    "",
    slots.length ? `The keypad's profiles: ${slots.map(([n, name]) => `${n} ${name}`).join(", ")}.` : "",
    `Open in the editor, profile ${slot}:`,
    JSON.stringify(profile),
    history.length ? `Conversation so far:\n${history.slice(-10).map((m) => `${m.role === "user" ? "Owner" : "You"}: ${m.text}`).join("\n")}` : "",
    `Owner: ${message}`,
    fix ? `Your previous profile was rejected: ${fix}. Send it again, fixed.` : "",
  ].filter(Boolean).join("\n");
}

/* Typed text and host commands can hold passwords and tokens, so they never leave this PC: each
 * such action's value goes as «secret:N» and comes back wherever the answer kept that placeholder.
 * A placeholder returns only into the kind of field it came from: typed text never becomes a command. */
const PRIVATE = { text: ["value", "typed"], multiline: ["value", "typed"], host: ["cmd", "host"] };
function eachPrivate(profile, fn) {
  const list = (v) => (Array.isArray(v) ? v : []);
  const walk = (acts) => list(acts).forEach((a) => {
    if (!a || typeof a !== "object") return;
    const p = PRIVATE[a.type];
    if (p && typeof a[p[0]] === "string") fn(a, ...p);
    if (a.type === "repeat") walk(a.actions);
  });
  for (const pg of list(profile && profile.pages)) for (const k of list(pg && pg.keys))
    if (k && typeof k === "object") for (const f of ["actions", "hold_actions", "off_actions", "mic_actions"]) walk(k[f]);
}
function redact(profile) {
  const copy = structuredClone(profile), secrets = new Map();
  eachPrivate(copy, (a, field, kind) => {
    const ph = `«secret:${secrets.size + 1}»`;
    secrets.set(ph, { value: a[field], kind });
    a[field] = ph;
  });
  return { profile: copy, secrets };
}
function unredact(profile, secrets) {
  eachPrivate(profile, (a, field, kind) => {
    a[field] = a[field].replace(/«secret:\d+»/g, (ph) => (secrets.has(ph) && secrets.get(ph).kind === kind ? secrets.get(ph).value : ph));
  });
  return profile;
}

/* One turn. req: {history:[{role,text}], message, profile, slot, slots:[[n,name]]}.
 * Resolves {reply, profile|null, error?}; never rejects (the chat shows the error). */
async function chatTurn(req, claude = "claude") {
  try {
    const { profile, secrets } = redact(req.profile);
    const sent = { ...req, profile };
    let out = await runClaude(claude, turnText(sent), ANSWER);
    if (!out.profile) return { reply: String(out.reply || ""), profile: null };
    // Check Claude's profile as sent: repairing a broken one would turn it into an empty
    // profile, and applying that would wipe the owner's keys. Repair only tidies a valid one.
    let v = schema.validateProfile(out.profile);
    if (!v.ok) {
      out = await runClaude(claude, turnText(sent, v.errors.slice(0, 6).join("; ")), ANSWER);
      v = out.profile ? schema.validateProfile(out.profile) : { ok: false, errors: ["no profile"] };
      if (!v.ok) return { reply: String(out.reply || ""), profile: null, error: `the change did not validate: ${v.errors.slice(0, 2).join("; ")}` };
    }
    return { reply: String(out.reply || ""), profile: schema.repairProfile(unredact(out.profile, secrets)) };
  } catch (e) {
    return { reply: "", profile: null, error: e.message };
  }
}

module.exports = { chatTurn, turnText, ANSWER };
