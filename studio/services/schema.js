/* Schema v2 for the Touch Keypad (PLAN.md §7). Adapted from Macropad Studio 2.1
 * services/schema.js: same 16 v1 action types and aliases, plus `page`, `back`,
 * `host`; F13–F24; 8 profiles; pages of 15 cells; hold_actions; widgets.
 * Everything sent to the device goes through repairProfile + validateProfile. */

"use strict";

const SCHEMA_VERSION = 2;
const MAX_TEXT_LEN = 4096;
const MAX_REPEAT_COUNT = 50;
const MAX_REPEAT_DEPTH = 4;
const NUM_PROFILES = 8;
const COLS = 5, ROWS = 3, CELLS = COLS * ROWS;
const MAX_LABEL = 14;
const HOST_SLOTS = 48;
const MAX_UPLOAD_BYTES = 64 * 1024;
const AXIS_MIN = -127, AXIS_MAX = 127;
const WIDGETS = { media: [5, 3], now_playing: [3, 2] };   // media: the full-page player
const ANIMS = ["eq", "pulse", "rec"];                         // eq while playing, pulse while off, rec while on

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const DIGITS = "0123456789".split("");
const FN = Array.from({ length: 24 }, (_, i) => `F${i + 1}`);   // v2 adds F13–F24
const NAMED = [
  "ENTER", "ESC", "BACKSPACE", "TAB", "SPACE", "MINUS", "EQUAL",
  "LEFT_BRACE", "RIGHT_BRACE", "BACKSLASH", "SEMICOLON", "QUOTE", "TILDE",
  "COMMA", "DOT", "SLASH", "CAPS_LOCK", "INSERT", "HOME", "PAGEUP",
  "DELETE", "END", "PAGEDOWN", "RIGHT_ARROW", "LEFT_ARROW", "DOWN_ARROW", "UP_ARROW",
];
const KEY_NAMES = [...LETTERS, ...DIGITS, ...FN, ...NAMED];
const MODIFIER_NAMES = [
  "LEFT_CTRL", "LEFT_SHIFT", "LEFT_ALT", "LEFT_GUI",
  "RIGHT_CTRL", "RIGHT_SHIFT", "RIGHT_ALT", "RIGHT_GUI",
];
const KEY_AND_MODIFIER = [...MODIFIER_NAMES, ...KEY_NAMES];
const MEDIA_NAMES = ["PLAY_PAUSE", "STOP", "NEXT", "PREVIOUS", "MUTE", "VOLUME_UP", "VOLUME_DOWN"];
const TELEPHONY_NAMES = ["MIC_MUTE", "ANSWER", "DECLINE"];
const MOUSE_BUTTONS = ["LEFT", "RIGHT", "MIDDLE"];
const LED_ANIM_VALUES = ["flash", "breathe"];
const ACTION_TYPES = [
  "comment", "delay", "key", "keycombo", "text", "multiline", "hold", "release",
  "repeat", "media", "mouse_move", "mouse_click", "led", "led_anim", "profile", "telephony",
  "page", "back", "host",
];

const KEY_SET = new Set(KEY_NAMES);
const KEY_AND_MOD_SET = new Set(KEY_AND_MODIFIER);
const MEDIA_SET = new Set(MEDIA_NAMES);
const TEL_SET = new Set(TELEPHONY_NAMES);
const BTN_SET = new Set(MOUSE_BUTTONS);
const LED_ANIM_SET = new Set(LED_ANIM_VALUES);
const TYPE_SET = new Set(ACTION_TYPES);

const ALIASES = {
  CTRL: "LEFT_CTRL", CONTROL: "LEFT_CTRL",
  SHIFT: "LEFT_SHIFT", ALT: "LEFT_ALT", OPTION: "LEFT_ALT",
  GUI: "LEFT_GUI", WIN: "LEFT_GUI", WINDOWS: "LEFT_GUI",
  LEFT_WIN: "LEFT_GUI", RIGHT_WIN: "RIGHT_GUI",
  LEFT_WINDOWS: "LEFT_GUI", RIGHT_WINDOWS: "RIGHT_GUI",
  CMD: "LEFT_GUI", COMMAND: "LEFT_GUI", LEFT_COMMAND: "LEFT_GUI",
  SUPER: "LEFT_GUI", META: "LEFT_GUI",
  RETURN: "ENTER", ESCAPE: "ESC", DEL: "DELETE",
  PGUP: "PAGEUP", PGDN: "PAGEDOWN", PAGE_UP: "PAGEUP", PAGE_DOWN: "PAGEDOWN",
  SPACEBAR: "SPACE", BKSP: "BACKSPACE", PERIOD: "DOT", FULLSTOP: "DOT",
  UP: "UP_ARROW", DOWN: "DOWN_ARROW", LEFT: "LEFT_ARROW", RIGHT: "RIGHT_ARROW",
  ARROWUP: "UP_ARROW", ARROWDOWN: "DOWN_ARROW", ARROWLEFT: "LEFT_ARROW", ARROWRIGHT: "RIGHT_ARROW",
};
const TYPE_ALIASES = {
  keypress: "key", press: "key", string: "text", combo: "keycombo",
  key_combo: "keycombo", shortcut: "keycombo", wait: "delay", sleep: "delay",
  pause: "delay", mousemove: "mouse_move", mouseclick: "mouse_click",
  click: "mouse_click", ledanim: "led_anim", animation: "led_anim",
  goto: "page", go_to_page: "page", folder: "page", pop: "back", host_action: "host",
};

// ---------------------------------------------------------------------------
const clampInt = (v, lo, hi, dflt = 0) => {
  let n = typeof v === "number" ? v : parseInt(v, 10);
  if (!Number.isFinite(n)) n = dflt;
  return Math.max(lo, Math.min(hi, Math.round(n)));
};
const toInt = (v, dflt = 0) => {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? Math.round(n) : dflt;
};
const isRgb = (c) => Array.isArray(c) && c.length === 3 && c.every((x) => Number.isInteger(x) && x >= 0 && x <= 255);
const fixRgb = (c) => (Array.isArray(c) && c.length === 3 ? c.map((x) => clampInt(x, 0, 255)) : null);

function normKey(token) {
  if (typeof token !== "string") return null;
  const s = token.trim();
  if (!s) return null;
  let up = s.toUpperCase();
  if (ALIASES[up]) up = ALIASES[up];
  if (KEY_AND_MOD_SET.has(up)) return up;
  if (s.length === 1) return s; // arbitrary printable char, preserve case
  return null;
}

// ---- validation: returns array of error strings (empty = valid) -----------
function validateAction(a, path = "", depth = 0) {
  const e = [];
  const p = path ? path + ": " : "";
  if (a === null || typeof a !== "object" || Array.isArray(a)) return [`${p}not an object`];
  const t = a.type;
  if (!TYPE_SET.has(t)) return [`${p}unknown type '${t}'`];

  const reqStr = (k, set) => {
    const v = a[k];
    if (typeof v !== "string") { e.push(`${p}${k} must be a string`); return; }
    if (set && !set.has(v)) e.push(`${p}${k} '${v}' not allowed`);
  };
  const keyish = (v, set, k) => {
    if (typeof v !== "string" || (!set.has(v) && v.length !== 1))
      e.push(`${p}${k} '${v}' is not a valid key`);
  };

  switch (t) {
    case "comment": case "release": case "back": break;
    case "delay":
      if (!Number.isInteger(a.ms) || a.ms < 0) e.push(`${p}ms must be a non-negative integer`);
      break;
    case "key": keyish(a.value, KEY_SET, "value"); break;
    case "keycombo":
      if (!Array.isArray(a.keys) || a.keys.length === 0) e.push(`${p}keys must be a non-empty array`);
      else a.keys.forEach((k) => keyish(k, KEY_AND_MOD_SET, "keys[]"));
      break;
    case "text": case "multiline":
      if (typeof a.value !== "string") e.push(`${p}value must be a string`);
      else if (a.value.length > MAX_TEXT_LEN) e.push(`${p}value too long`);
      break;
    case "hold": keyish(a.key, KEY_AND_MOD_SET, "key"); break;
    case "repeat":
      if (depth >= MAX_REPEAT_DEPTH) e.push(`${p}repeat nested deeper than ${MAX_REPEAT_DEPTH}`);
      if (!Number.isInteger(a.count) || a.count < 1 || a.count > MAX_REPEAT_COUNT)
        e.push(`${p}count must be 1..${MAX_REPEAT_COUNT}`);
      if (!Array.isArray(a.actions)) e.push(`${p}actions must be an array`);
      else a.actions.forEach((x, i) => e.push(...validateAction(x, `${path}actions[${i}]`, depth + 1)));
      break;
    case "media": reqStr("value", MEDIA_SET); break;
    case "mouse_move":
      for (const k of ["x", "y"]) if (!Number.isInteger(a[k]) || a[k] < AXIS_MIN || a[k] > AXIS_MAX) e.push(`${p}${k} out of range`);
      if (a.wheel !== undefined && (!Number.isInteger(a.wheel) || a.wheel < AXIS_MIN || a.wheel > AXIS_MAX)) e.push(`${p}wheel out of range`);
      break;
    case "mouse_click": reqStr("button", BTN_SET); break;
    case "led": if (!isRgb(a.color)) e.push(`${p}color must be [r,g,b] 0..255`); break;
    case "led_anim":
      reqStr("value", LED_ANIM_SET);
      if (a.color !== undefined && !isRgb(a.color)) e.push(`${p}color must be [r,g,b]`);
      break;
    case "profile":
      if (!Number.isInteger(a.value) || a.value < 1 || a.value > NUM_PROFILES) e.push(`${p}value must be 1..${NUM_PROFILES}`);
      break;
    case "telephony": reqStr("value", TEL_SET); break;
    case "page":
      if (!Number.isInteger(a.value) || a.value < 1) e.push(`${p}value must be a page number >= 1`);
      break;
    case "host":
      if (typeof a.cmd !== "string" || !a.cmd.trim()) e.push(`${p}cmd must be a non-empty string`);
      if (a.slot !== undefined && (!Number.isInteger(a.slot) || a.slot < 0 || a.slot >= HOST_SLOTS)) e.push(`${p}slot must be 0..${HOST_SLOTS - 1}`);
      break;
  }
  return e;
}

function validateActions(actions) {
  if (!Array.isArray(actions)) return { ok: false, errors: ["actions is not an array"] };
  const errors = [];
  actions.forEach((a, i) => errors.push(...validateAction(a, `[${i}]`)));
  return { ok: errors.length === 0, errors };
}
const isValidActions = (actions) => validateActions(actions).ok;

// ---- repair: best-effort normalization, drops the unfixable ---------------
function repairAction(a, depth = 0) {
  if (a === null || typeof a !== "object" || Array.isArray(a)) return null;
  let t = String(a.type || "").trim().toLowerCase();
  t = TYPE_ALIASES[t] || t;
  if (!TYPE_SET.has(t)) return null;

  switch (t) {
    case "comment": {
      const o = { type: t };
      if ("value" in a) o.value = String(a.value ?? "");
      return o;
    }
    case "delay": return { type: t, ms: Math.max(0, toInt(a.ms, 0)) };
    case "key": {
      const k = normKey(a.value);
      return k && (KEY_SET.has(k) || k.length === 1) ? { type: t, value: k } : null;
    }
    case "keycombo": {
      if (!Array.isArray(a.keys)) return null;
      const keys = a.keys.map(normKey).filter(Boolean);
      return keys.length ? { type: t, keys } : null;
    }
    case "text": case "multiline":
      return { type: t, value: String(a.value ?? "").slice(0, MAX_TEXT_LEN) };
    case "hold": {
      const k = normKey(a.key ?? a.value);
      return k ? { type: t, key: k } : null;
    }
    case "release": case "back": return { type: t };
    case "repeat": {
      if (depth >= MAX_REPEAT_DEPTH) return null;
      const inner = repairActions(a.actions || [], depth + 1);
      if (!inner.length) return null;
      return { type: t, count: clampInt(a.count, 1, MAX_REPEAT_COUNT, 1), actions: inner };
    }
    case "media": {
      const v = String(a.value ?? "").trim().toUpperCase();
      return MEDIA_SET.has(v) ? { type: t, value: v } : null;
    }
    case "mouse_move": {
      const o = { type: t, x: clampInt(a.x, AXIS_MIN, AXIS_MAX), y: clampInt(a.y, AXIS_MIN, AXIS_MAX) };
      if ("wheel" in a) o.wheel = clampInt(a.wheel, AXIS_MIN, AXIS_MAX);
      return o;
    }
    case "mouse_click": {
      const b = String(a.button ?? "").trim().toUpperCase();
      return BTN_SET.has(b) ? { type: t, button: b } : null;
    }
    case "led": {
      const c = fixRgb(a.color);
      return c ? { type: t, color: c } : null;
    }
    case "led_anim": {
      const v = String(a.value ?? "").trim().toLowerCase();
      if (!LED_ANIM_SET.has(v)) return null;
      const o = { type: t, value: v };
      const c = fixRgb(a.color);
      if (c) o.color = c;
      return o;
    }
    case "profile": return { type: t, value: clampInt(a.value, 1, NUM_PROFILES, 1) };
    case "telephony": {
      const v = String(a.value ?? "").trim().toUpperCase();
      return TEL_SET.has(v) ? { type: t, value: v } : null;
    }
    case "page": return { type: t, value: Math.max(1, toInt(a.value, 1)) };
    case "host": {
      const cmd = String(a.cmd ?? a.value ?? "").trim();
      if (!cmd) return null;
      const o = { type: t, cmd };
      const s = toInt(a.slot, -1);
      if (s >= 0 && s < HOST_SLOTS) o.slot = s;
      return o;
    }
    default: return null;
  }
}

function repairActions(actions, depth = 0) {
  if (!Array.isArray(actions)) return [];
  return actions.map((a) => repairAction(a, depth)).filter((x) => x !== null);
}

// ---- profiles ---------------------------------------------------------------
const cellPos = (i) => ({ c: i % COLS, r: Math.floor(i / COLS) });
// Cell indexes (0-based) a widget at index i with span [w,h] covers, excluding i.
function coveredBy(i, span) {
  const { c, r } = cellPos(i), out = [];
  for (let dy = 0; dy < span[1]; dy++) for (let dx = 0; dx < span[0]; dx++)
    if (dx || dy) out.push((r + dy) * COLS + (c + dx));
  return out;
}
function widgetFits(i, span) {
  const { c, r } = cellPos(i);
  return c + span[0] <= COLS && r + span[1] <= ROWS;
}

function validateProfile(p) {
  const e = [];
  if (!p || typeof p !== "object") return { ok: false, errors: ["profile is not an object"] };
  if (p.schema_version !== SCHEMA_VERSION) e.push(`schema_version must be ${SCHEMA_VERSION}`);
  if (typeof p.profile_name !== "string") e.push("profile_name must be a string");
  if (!Number.isInteger(p.default_delay) || p.default_delay < 0) e.push("default_delay must be a non-negative integer");
  if (p.brightness !== undefined && (!Number.isInteger(p.brightness) || p.brightness < 0 || p.brightness > 255)) e.push("brightness must be 0..255");
  if (p.color !== undefined && !isRgb(p.color)) e.push("color must be [r,g,b]");
  if (!Array.isArray(p.pages) || !p.pages.length) return { ok: false, errors: [...e, "pages must be a non-empty array"] };
  const nPages = p.pages.length;
  p.pages.forEach((pg, pi) => {
    const pp = `pages[${pi}]`;
    if (!pg || typeof pg !== "object") { e.push(`${pp} is not an object`); return; }
    if (typeof pg.name !== "string") e.push(`${pp}.name must be a string`);
    if (!Array.isArray(pg.keys) || pg.keys.length !== CELLS) { e.push(`${pp}.keys must have ${CELLS} entries`); return; }
    const covered = new Set();
    pg.keys.forEach((k, i) => {
      if (k && k.widget) coveredBy(i, k.span || [1, 1]).forEach((j) => covered.add(j));
    });
    pg.keys.forEach((k, i) => {
      const kp = `${pp}.keys[${i}]`;
      if (k === null) return;
      if (typeof k !== "object") { e.push(`${kp} must be an object or null`); return; }
      if (covered.has(i)) e.push(`${kp} is covered by a widget and must be null`);
      if (k.id !== i + 1) e.push(`${kp}.id must be ${i + 1}`);
      if (typeof k.name !== "string" || k.name.length > MAX_LABEL) e.push(`${kp}.name must be a string of at most ${MAX_LABEL} chars`);
      if (k.anim !== undefined && !ANIMS.includes(k.anim)) e.push(`${kp}.anim must be one of ${ANIMS.join(", ")}`);
      if (k.toggle !== undefined && typeof k.toggle !== "boolean") e.push(`${kp}.toggle must be true or false`);
      if (k.widget !== undefined) {
        const span = WIDGETS[k.widget];
        if (!span) e.push(`${kp}.widget '${k.widget}' unknown`);
        else if (!Array.isArray(k.span) || k.span[0] !== span[0] || k.span[1] !== span[1]) e.push(`${kp}.span must be [${span}]`);
        else if (!widgetFits(i, span)) e.push(`${kp} widget does not fit at this cell`);
      } else {
        if (!isRgb(k.led_color)) e.push(`${kp}.led_color must be [r,g,b]`);
        if (k.tile !== undefined && !/^[0-9a-f]{8}$/.test(k.tile)) e.push(`${kp}.tile must be 8 lowercase hex chars`);
      }
      for (const field of ["actions", "hold_actions", "off_actions"]) {
        if (field !== "actions" && k[field] === undefined) continue;
        if (!Array.isArray(k[field])) { e.push(`${kp}.${field} must be an array`); continue; }
        k[field].forEach((a, ai) => {
          e.push(...validateAction(a, `${kp}.${field}[${ai}]`));
          if (a && a.type === "page" && Number.isInteger(a.value) && a.value > nPages) e.push(`${kp}.${field}[${ai}]: page ${a.value} does not exist`);
        });
      }
    });
  });
  const bytes = Buffer.byteLength(JSON.stringify(p));
  if (bytes > MAX_UPLOAD_BYTES) e.push(`profile is ${bytes} bytes; the device accepts at most ${MAX_UPLOAD_BYTES}`);
  return { ok: e.length === 0, errors: e };
}

function repairKey(k, i) {
  if (!k || typeof k !== "object") return null;
  const out = { id: i + 1, name: String(k.name ?? "").slice(0, MAX_LABEL) };
  if (k.widget && WIDGETS[k.widget]) {
    out.widget = k.widget;
    out.span = [...WIDGETS[k.widget]];
  } else {
    if (typeof k.icon === "string" && k.icon) out.icon = k.icon;
    out.led_color = fixRgb(k.led_color ?? k.glow) || [110, 100, 92];
    if (typeof k.tile === "string" && /^[0-9a-fA-F]{8}$/.test(k.tile)) out.tile = k.tile.toLowerCase();
    if (ANIMS.includes(k.anim)) out.anim = k.anim;
    if (k.toggle === true) out.toggle = true;
  }
  out.actions = repairActions(k.actions || []);
  for (const f of ["hold_actions", "off_actions"]) {
    if (!Array.isArray(k[f])) continue;
    const list = repairActions(k[f]);
    if (list.length) out[f] = list;
  }
  return out;
}

function repairPage(pg, pi) {
  const src = pg && Array.isArray(pg.keys) ? pg.keys : [];
  const keys = Array.from({ length: CELLS }, (_, i) => repairKey(src[i], i));
  // Widgets: drop ones that don't fit, then null the cells they cover.
  keys.forEach((k, i) => {
    if (!k || !k.widget) return;
    if (!widgetFits(i, k.span)) { keys[i] = null; return; }
    coveredBy(i, k.span).forEach((j) => { keys[j] = null; });
  });
  return { name: String((pg && pg.name) || `Page ${pi + 1}`), keys };
}

// v1 (keys[12], no schema_version) -> v2: the 12 keys become page 1, padded to 15.
function migrateProfile(p) {
  if (!p || typeof p !== "object") return p;
  if (Array.isArray(p.pages)) return p;
  const keys = Array.from({ length: CELLS }, () => null);
  for (const k of p.keys || []) {
    const id = toInt(k && k.id, 0);
    if (id >= 1 && id <= 12) keys[id - 1] = { ...k, name: k.name || `Key ${id}` };
  }
  const out = { ...p, schema_version: SCHEMA_VERSION, pages: [{ name: "Main", keys }] };
  delete out.keys;
  delete out.idle_animation;
  return out;
}

function repairProfile(p) {
  p = migrateProfile(p) || {};
  const out = {
    schema_version: SCHEMA_VERSION,
    profile_name: String(p.profile_name || "Profile"),
    default_delay: Number.isInteger(p.default_delay) && p.default_delay >= 0 ? p.default_delay : 20,
  };
  if (p.brightness !== undefined) out.brightness = clampInt(p.brightness, 0, 255, 200);
  const color = fixRgb(p.color);
  if (color) out.color = color;
  const pages = Array.isArray(p.pages) && p.pages.length ? p.pages : [{ name: "Main", keys: [] }];
  out.pages = pages.map(repairPage);
  // page actions pointing past the last page are clamped.
  const n = out.pages.length;
  const clampPages = (list) => list.forEach((a) => {
    if (a.type === "page" && a.value > n) a.value = n;
    if (a.type === "repeat") clampPages(a.actions);
  });
  for (const pg of out.pages) for (const k of pg.keys) if (k) { clampPages(k.actions); if (k.hold_actions) clampPages(k.hold_actions); }
  return out;
}

function blankProfile(name = "Profile") {
  return { schema_version: SCHEMA_VERSION, profile_name: name, default_delay: 20, brightness: 200,
    pages: [{ name: "Main", keys: Array.from({ length: CELLS }, () => null) }] };
}

// All host actions in a profile (including nested repeats), for slot assignment.
function hostActions(p) {
  const out = [];
  const walk = (list) => (list || []).forEach((a) => {
    if (a && a.type === "host") out.push(a);
    if (a && a.type === "repeat") walk(a.actions);
  });
  for (const pg of (p && p.pages) || []) for (const k of pg.keys || []) if (k) { walk(k.actions); walk(k.hold_actions); }
  return out;
}

module.exports = {
  SCHEMA_VERSION, MAX_TEXT_LEN, MAX_REPEAT_COUNT, NUM_PROFILES, COLS, ROWS, CELLS, MAX_LABEL,
  HOST_SLOTS, MAX_UPLOAD_BYTES, WIDGETS, ANIMS,
  KEY_NAMES, MODIFIER_NAMES, KEY_AND_MODIFIER, MEDIA_NAMES, TELEPHONY_NAMES,
  MOUSE_BUTTONS, LED_ANIM_VALUES, ACTION_TYPES, ALIASES,
  normKey, validateAction, validateActions, isValidActions, repairAction, repairActions,
  validateProfile, repairProfile, migrateProfile, blankProfile, hostActions, coveredBy, widgetFits,
};
