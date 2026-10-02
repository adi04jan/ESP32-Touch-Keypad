/* Macropad Studio (Touch Keypad) renderer. Vanilla JS adapted from the Studio
 * scene in docs/viewer/index.html: ACTION_META, ICONS, swatches, tile grid,
 * inspector and ActionBuilder (reorder by buttons or drag). Device work goes
 * through window.api (preload.js) to the main-process services. */
"use strict";

/* ============ schema metadata (mirrors services/schema.js) ============ */
const ACTION_META = {
  text:        { label: "Type Text",      cat: "Keyboard", icon: "type",                color: "#3f63c9", field: "value",  def: { value: "hello" } },
  multiline:   { label: "Multiline",      cat: "Keyboard", icon: "align-left",          color: "#3f63c9", field: "value",  def: { value: "line one\nline two" } },
  keycombo:    { label: "Key Combo",      cat: "Keyboard", icon: "command",             color: "#c2412b", field: "keys",   def: { keys: ["LEFT_CTRL", "C"] } },
  key:         { label: "Tap Key",        cat: "Keyboard", icon: "keyboard",            color: "#4a5fb0", field: "value",  def: { value: "ENTER" } },
  hold:        { label: "Hold Key",       cat: "Keyboard", icon: "arrow-down-to-line",  color: "#6a4fb0", field: "key",    def: { key: "LEFT_SHIFT" } },
  release:     { label: "Release Keys",   cat: "Keyboard", icon: "arrow-up-from-line",  color: "#6a4fb0", field: null,     def: {} },
  delay:       { label: "Delay",          cat: "Timing",   icon: "timer",               color: "#6b6258", field: "ms",     def: { ms: 300 } },
  repeat:      { label: "Repeat",         cat: "Timing",   icon: "repeat",              color: "#6b6258", field: "count",  def: { count: 3, actions: [{ type: "key", value: "DOWN_ARROW" }] } },
  comment:     { label: "Comment",        cat: "Timing",   icon: "message-square",      color: "#6b6258", field: "value",  def: { value: "note" } },
  mouse_click: { label: "Mouse Click",    cat: "Mouse",    icon: "mouse-pointer-click", color: "#2f6b4f", field: "button", def: { button: "LEFT" } },
  mouse_move:  { label: "Mouse Move",     cat: "Mouse",    icon: "move",                color: "#2f6b4f", field: "xyw",    def: { x: 0, y: 0, wheel: -5 } },
  media:       { label: "Media",          cat: "System",   icon: "volume-2",            color: "#1f5f7a", field: "value",  def: { value: "PLAY_PAUSE" } },
  telephony:   { label: "Telephony",      cat: "System",   icon: "phone",               color: "#1f5f7a", field: "value",  def: { value: "MIC_MUTE" } },
  profile:     { label: "Switch Profile", cat: "System",   icon: "layers",              color: "#a0700f", field: "value",  def: { value: 2 } },
  led:         { label: "Tile Tint",      cat: "Lighting", icon: "lightbulb",           color: "#b03a78", field: "color",  def: { color: [255, 110, 199] } },
  led_anim:    { label: "Tile Animation", cat: "Lighting", icon: "sparkles",            color: "#7f45b0", field: "value",  def: { value: "breathe" } },
  page:        { label: "Go to Page",     cat: "Screen",   icon: "panels-top-left",     color: "#7a1f2b", field: "value",  def: { value: 1 } },
  back:        { label: "Back",           cat: "Screen",   icon: "undo-2",              color: "#7a1f2b", field: null,     def: {} },
  host:        { label: "Host Action",    cat: "Screen",   icon: "monitor-up",          color: "#a0700f", field: "cmd",    def: { cmd: "open https://github.com" } },
};
const CATS = ["Keyboard", "Mouse", "Timing", "System", "Lighting", "Screen"];
const ENUMS = { media: ["PLAY_PAUSE", "STOP", "NEXT", "PREVIOUS", "MUTE", "VOLUME_UP", "VOLUME_DOWN"], mouse_click: ["LEFT", "RIGHT", "MIDDLE"], telephony: ["MIC_MUTE", "ANSWER", "DECLINE"], led_anim: ["flash", "breathe"] };
const ALIASES = { CTRL: "LEFT_CTRL", SHIFT: "LEFT_SHIFT", ALT: "LEFT_ALT", GUI: "LEFT_GUI", WIN: "LEFT_GUI", CMD: "LEFT_GUI", UP: "UP_ARROW", DOWN: "DOWN_ARROW", LEFT: "LEFT_ARROW", RIGHT: "RIGHT_ARROW", RETURN: "ENTER" };
const ICONS = ["mic", "mic-off", "play", "pause", "volume-1", "volume-2", "volume-x", "skip-back", "skip-forward", "headphones", "music", "radio",
  "lock", "copy", "clipboard-paste", "scissors", "file-text", "pen-line", "terminal", "github", "gitlab", "git-branch", "git-pull-request", "bug",
  "globe", "chrome", "mail", "calendar", "message-circle", "slack", "figma", "folder", "image", "camera", "video", "clapperboard",
  "monitor-play", "twitch", "youtube", "circle-dot", "gamepad-2", "coffee", "hammer", "rocket", "square", "check", "star", "heart",
  "bell", "flag", "search", "link", "clock", "sun", "moon", "zap", "house", "undo-2", "layers", "settings"];
const SWATCHES = [[194, 65, 43], [233, 150, 50], [233, 185, 73], [47, 107, 79], [47, 140, 120], [47, 107, 115], [52, 90, 160], [100, 80, 160], [148, 40, 58], [190, 80, 120], [110, 100, 92]];
const NUM_PROFILES = 8;

/* ============ helpers ============ */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const mix = (c, t, a) => c.map((v, i) => Math.round(v + (t[i] - v) * a));
const rgb = (c) => `rgb(${c.join(",")})`;
const tileVars = (c, seed = 0) => `--c1:${rgb(mix(c, [255, 255, 255], .08))};--c2:${rgb(mix(c, [0, 0, 0], .45))};--r:${((seed * 37) % 5 - 2) * .7}deg;--lr:${((seed * 53) % 5 - 2) * .6}deg`;
const ico = (name) => `<svg class="lc" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const norm = (k) => { const u = String(k).trim().toUpperCase(); return ALIASES[u] || (u.length === 1 ? String(k).trim() : u); };
const blankKeys = () => Array.from({ length: 15 }, () => null);
const blankProfile = (n) => ({ schema_version: 2, profile_name: `Profile ${n}`, default_delay: 20, brightness: 200, pages: [{ name: "Main", keys: blankKeys() }] });
const K = (id, name, icon, led_color, actions) => ({ id, name, icon, led_color, actions });
const cellPos = (i) => ({ c: i % 5 + 1, r: Math.floor(i / 5) + 1 });
const mmss = (s) => `${Math.floor((s || 0) / 60)}:${String((s || 0) % 60).padStart(2, "0")}`;

/* ============ state ============ */
const state = {
  slots: Object.fromEntries(Array.from({ length: NUM_PROFILES }, (_, i) => [i + 1, blankProfile(i + 1)])),
  slot: 1, page: 0, sel: 0, mode: "actions", view: "editor",
  conn: { connected: false }, settings: {}, np: { title: "Nothing playing", artist: "", pos: 0, len: 0, playing: false },
};
const prof = () => state.slots[state.slot];
const pg = () => prof().pages[state.page];
const selKey = () => pg().keys[state.sel];

/* ============ console ============ */
const stLog = $("st-log");
function cli(cls, msg) {
  const d = document.createElement("div");
  d.className = cls; d.textContent = msg;
  stLog.appendChild(d);
  while (stLog.childNodes.length > 400) stLog.firstChild.remove();
  stLog.scrollTop = stLog.scrollHeight;
}
$("cli-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const v = $("cli-in").value.trim();
  if (!v) return;
  $("cli-in").value = "";
  if (!state.conn.connected) { cli("sys", "! Not connected."); return; }
  const reply = await api.command(v);
  for (const line of String(reply).split("\n").slice(0, 200)) if (line.trim()) cli("sys", line);
});

/* ============ tiles ============ */
const tileNames = new Map();   // "icon|r,g,b" -> tile name (uploaded via main)
const tileImgs = new Map();    // "icon|r,g,b" -> data URL for the inspector preview
const tkey = (k) => `${k.icon || ""}|${k.led_color.join(",")}`;
async function previewImg(k) {
  const key = tkey(k);
  if (!tileImgs.has(key)) tileImgs.set(key, (await TileDraw.render(k.icon || "", k.led_color)).canvas.toDataURL());
  return tileImgs.get(key);
}
// Render the tile, hand the RGBA to main (RGB565 + CRC32 + upload), store the name on the key.
async function refreshTile(k) {
  const key = tkey(k);
  let name = tileNames.get(key);
  if (!name) {
    const { rgba, canvas } = await TileDraw.render(k.icon || "", k.led_color);
    tileImgs.set(key, canvas.toDataURL());
    name = await api.putTile(rgba);
    tileNames.set(key, name);
  }
  k.tile = name;
  return name;
}
async function ensureTiles(p) {
  let filled = false;
  for (const page of p.pages) for (const k of page.keys) if (k && !k.widget && !k.tile) { await refreshTile(k); filled = true; }
  return filled;
}

/* ============ device preview grid (viewer gridHTML, editor mode) ============ */
const stScreen = $("st-screen");
function covered(keys) {
  const set = new Set();
  keys.forEach((k, i) => { if (k?.span) { const { c, r } = cellPos(i); for (let dy = 0; dy < k.span[1]; dy++) for (let dx = 0; dx < k.span[0]; dx++) if (dx || dy) set.add((r - 1 + dy) * 5 + (c - 1 + dx)); } });
  return set;
}
function gridHTML(keys) {
  const cov = covered(keys);
  let n = 0;
  return `<div class="grid">${keys.map((k, i) => {
    if (cov.has(i)) return "";
    const { c, r } = cellPos(i);
    const sel = i === state.sel ? " sel" : "";
    if (k?.widget === "now_playing") {
      const np = state.np, pct = np.len ? Math.min(100, Math.round(np.pos / np.len * 100)) : 0;
      return `<button class="np${sel}" data-k="${i}" style="grid-column:${c} / span ${k.span[0]}; grid-row:${r} / span ${k.span[1]}" aria-label="Now playing widget">
        <span class="art">${ico("music")}</span>
        <span><span class="src">Now playing · via Studio</span><div class="tt">${esc(np.title || "Nothing playing")}</div><div class="ar">${esc(np.artist)}</div>
        <div class="prog"><i style="width:${pct}%"></i></div><div class="times"><span>${mmss(np.pos)}</span><span>${mmss(np.len)}</span></div></span></button>`;
    }
    if (!k) return `<button class="cell empty${sel}" data-k="${i}" style="grid-column:${c}; grid-row:${r}; --i:${n++}" aria-label="Empty key ${i + 1}"><span class="slot"></span></button>`;
    const badge = k.actions?.some((a) => a.type === "host") ? `<span class="badge">PC</span>` : k.hold_actions?.length ? `<span class="badge">hold</span>` : "";
    return `<button class="cell${sel}" data-k="${i}" draggable="true" style="grid-column:${c}; grid-row:${r}; --i:${n++}; ${tileVars(k.led_color, k.id + i)}" aria-label="${esc(k.name || `Key ${i + 1}`)}">
      ${badge}<span class="tile"><span class="face">${k.icon ? ico(k.icon) : ""}</span></span><span class="lbl">${esc(k.name || " ")}</span></button>`;
  }).join("")}</div>`;
}
const dotsHTML = (count, cur) => `<div class="dots">${Array.from({ length: count }, (_, i) => `<button tabindex="-1" aria-label="Page ${i + 1}" aria-current="${i === cur}"><i></i></button>`).join("")}</div>`;

function renderTop() {
  $("st-slots").innerHTML = Array.from({ length: NUM_PROFILES }, (_, i) => i + 1).map((n) =>
    `<button aria-pressed="${n === state.slot}" data-stslot="${n}" title="${n === state.conn.activeSlot ? "Active on the device" : ""}">${n} · ${esc(state.slots[n].profile_name)}${n === state.conn.activeSlot && state.conn.connected ? " ●" : ""}</button>`).join("");
  const c = state.conn, pill = $("conn-pill");
  pill.className = `pill ${c.connected ? "ok" : "off"}`;
  pill.lastElementChild.textContent = c.connected
    ? `Touch Keypad · ${c.path} · fw ${(c.status && c.status.ver) || "?"}`
    : c.noSerial ? "Serial disabled" : "Offline · looking for the keypad";
}

function renderStudio(keepSide = false) {
  const p = prof(), page = pg();
  renderTop();
  $("st-pages").innerHTML = p.pages.map((g, i) => `<button aria-pressed="${i === state.page}" data-stpg="${i}">${esc(g.name)}</button>`).join("") + `<button data-addpage>${ico("plus")} Page</button>`;
  const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  stScreen.innerHTML = `<div class="sb"><span class="clock">${time}</span><span class="ctx">${esc(p.profile_name)} · ${esc(page.name)}</span><span class="st">${ico("bluetooth")}</span></div>
    <div class="vp">${gridHTML(page.keys)}</div>${dotsHTML(p.pages.length, state.page)}`;
  $("st-json").textContent = JSON.stringify(p, null, 1);
  if (document.activeElement !== $("p-name")) $("p-name").value = p.profile_name;
  if (document.activeElement !== $("pg-name")) $("pg-name").value = page.name;
  $("pg-del").disabled = p.pages.length < 2;
  if (!keepSide) renderSide();
}

/* ============ inspector + ActionBuilder (viewer renderSide/renderActs) ============ */
const side = $("st-side");
function renderSide() {
  const k = selKey();
  if (!k) {
    side.innerHTML = `<div class="field"><span>Key ${state.sel + 1}</span><p class="hint">This key is empty.</p></div><button class="primary" id="mk-key">Create key</button>
      <button id="mk-np">Add Now Playing widget (3 × 2)</button><p class="hint">Widgets are drawn by the firmware and fed by Studio. The selected cell becomes the widget's top-left corner.</p>`;
    $("mk-key").onclick = async () => {
      const nk = K(state.sel + 1, "New key", "zap", [233, 150, 50], [{ type: "key", value: "F13" }]);
      pg().keys[state.sel] = nk;
      await refreshTile(nk);
      changed(["structure"]);
    };
    $("mk-np").onclick = () => {
      const keys = pg().keys, { c, r } = cellPos(state.sel);
      if (c > 3 || r > 2) { cli("sys", "! The widget doesn't fit here. Pick a cell in columns 1–3, rows 1–2."); return; }
      [0, 1, 2, 5, 6, 7].forEach((o) => { keys[state.sel + o] = null; });
      keys[state.sel] = { id: state.sel + 1, name: "Now Playing", widget: "now_playing", span: [3, 2], actions: [{ type: "media", value: "PLAY_PAUSE" }] };
      changed(["structure"]);
    };
    return;
  }
  if (k.widget) {
    side.innerHTML = `<div class="field"><span>Widget</span><b style="font:400 1rem var(--display); color:var(--oxblood)">Now Playing · 3 × 2</b></div>
      <p class="hint">Shows the track from the Windows media session. Studio sends it with <code>widget now_playing {…}</code>. A tap runs these actions:</p>
      <div class="acts" id="acts"></div>${addSelect()}<button id="rm-w">Remove widget</button>`;
    renderActs(k.actions);
    $("k-add").onchange = onAdd;
    $("rm-w").onclick = () => { pg().keys[state.sel] = null; changed(["structure"]); };
    return;
  }
  const list = state.mode === "hold" ? (k.hold_actions || []) : k.actions;
  side.innerHTML = `
    <div class="two"><label class="field"><span>Label</span><input id="k-name" value="${esc(k.name)}" maxlength="14"></label>
      <div class="field"><span>Tile · 72 × 72</span><span class="tprev" id="k-tile"></span></div></div>
    <div class="field"><span>Paper colour (led_color sets the tile)</span><div class="swatches">${SWATCHES.map((c) => `<button style="background-color:${rgb(c)}" aria-pressed="${c.join() === k.led_color.join()}" data-sw="${c.join(",")}" aria-label="Colour ${c.join(",")}"></button>`).join("")}</div></div>
    <div class="field"><span>Icon</span><div class="icons">${ICONS.map((n) => `<button aria-pressed="${n === k.icon}" data-ic="${n}" aria-label="${n}" title="${n}">${ico(n)}</button>`).join("")}</div></div>
    <div class="row" style="justify-content:space-between"><span class="mode" role="group" aria-label="Trigger"><button aria-pressed="${state.mode === "actions"}" data-mode2="actions">On tap</button><button aria-pressed="${state.mode === "hold"}" data-mode2="hold">On hold</button></span>
      <span class="hint">${k.tile ? `tile ${k.tile}` : "no tile yet"}</span></div>
    <div class="acts" id="acts"></div>
    ${addSelect()}
    <button class="ghost" id="k-clear">Clear key</button>`;
  previewImg(k).then((src) => {
    const slot = $("k-tile");
    if (!slot) return;
    const img = new Image();
    img.alt = "Rendered tile"; img.src = src;
    slot.replaceChildren(img);
  });
  renderActs(list);
  $("k-name").oninput = (e) => { k.name = e.target.value; changed(["title"], true); };
  $("k-add").onchange = onAdd;
  $("k-clear").onclick = () => { pg().keys[state.sel] = null; changed(["structure"]); };
}
const addSelect = () => `<label class="field"><span>Add action</span><select id="k-add"><option value="">Choose an action…</option>${CATS.map((c) => `<optgroup label="${c}">${Object.entries(ACTION_META).filter(([, m]) => m.cat === c).map(([t, m]) => `<option value="${t}">${m.label}</option>`).join("")}</optgroup>`).join("")}</select></label>`;
function onAdd(e) {
  const t = e.target.value; if (!t) return;
  const k = selKey(), a = { type: t, ...structuredClone(ACTION_META[t].def) };
  if (state.mode === "hold" && !k.widget) (k.hold_actions ||= []).push(a); else k.actions.push(a);
  changed([listKind()]);
}
const listKind = () => (state.mode === "hold" && !selKey().widget ? "hold" : "actions");
function fieldVal(a) {
  const f = ACTION_META[a.type].field;
  if (f === "keys") return (a.keys || []).join(" + ");
  if (f === "xyw") return `${a.x}, ${a.y}, ${a.wheel ?? 0}`;
  if (f === "color") return (a.color || []).join(", ");
  return f ? String(a[f] ?? "").replace(/\n/g, "\\n") : "";
}
function setField(a, v) {
  const f = ACTION_META[a.type].field;
  if (f === "keys") a.keys = v.split("+").map((s) => s.trim()).filter(Boolean).map(norm);
  else if (f === "xyw") { const [x, y, w] = v.split(",").map((n) => parseInt(n, 10) || 0); Object.assign(a, { x: Math.max(-127, Math.min(127, x)), y: Math.max(-127, Math.min(127, y)), wheel: Math.max(-127, Math.min(127, w || 0)) }); }
  else if (f === "color") a.color = v.split(",").map((n) => Math.max(0, Math.min(255, parseInt(n, 10) || 0))).slice(0, 3);
  else if (f === "count") a.count = Math.max(1, Math.min(50, parseInt(v, 10) || 1));
  else if (f === "ms") a.ms = Math.max(0, parseInt(v, 10) || 0);
  else if (f === "value" && (a.type === "page" || a.type === "profile")) a.value = Math.max(1, Math.min(a.type === "profile" ? NUM_PROFILES : 99, parseInt(v, 10) || 1));
  else if (f === "key" || (f === "value" && a.type === "key")) a[f] = norm(v);
  else if (f) a[f] = v.replace(/\\n/g, "\n");
}
function renderActs(list) {
  const el = $("acts");
  if (!list.length) { el.innerHTML = `<p class="hint">No actions yet. Add one below.</p>`; return; }
  el.innerHTML = list.map((a, i) => {
    const m = ACTION_META[a.type] || { label: a.type, icon: "square", color: "#6b6258", field: null };
    const input = ENUMS[a.type] ? `<select data-af="${i}" aria-label="${m.label}">${ENUMS[a.type].map((v) => `<option ${v === a[m.field] ? "selected" : ""}>${v}</option>`).join("")}</select>`
      : m.field ? `<input data-af="${i}" value="${esc(fieldVal(a))}" aria-label="${m.label} value">` : `<span class="hint">No settings</span>`;
    return `<div class="act" draggable="true" data-ai="${i}"><span class="ti" style="background-color:${m.color}">${ico(m.icon)}</span>
      <span class="bd"><b>${m.label}</b>${input}</span>
      <span class="ops"><button data-up="${i}" aria-label="Move up">${ico("arrow-up")}</button><button data-down="${i}" aria-label="Move down">${ico("arrow-down")}</button><button data-del="${i}" aria-label="Delete">${ico("x")}</button></span></div>`;
  }).join("");
}
const curList = () => { const k = selKey(); return state.mode === "hold" && !k.widget ? (k.hold_actions ||= []) : k.actions; };
side.addEventListener("input", (e) => { const i = e.target.dataset.af; if (i === undefined || e.target.tagName === "SELECT") return; setField(curList()[+i], e.target.value); changed([listKind()], true); });
side.addEventListener("change", (e) => { const i = e.target.dataset.af; if (i === undefined || e.target.tagName !== "SELECT") return; setField(curList()[+i], e.target.value); changed([listKind()], true); });
side.addEventListener("click", async (e) => {
  const t = e.target.closest("button"); if (!t) return;
  const L = curList;
  if (t.dataset.up) { const i = +t.dataset.up, l = L(); if (i > 0) [l[i - 1], l[i]] = [l[i], l[i - 1]]; changed([listKind()]); }
  if (t.dataset.down) { const i = +t.dataset.down, l = L(); if (i < l.length - 1) [l[i + 1], l[i]] = [l[i], l[i + 1]]; changed([listKind()]); }
  if (t.dataset.del) { const kind = listKind(); L().splice(+t.dataset.del, 1); const k = selKey(); if (k.hold_actions && !k.hold_actions.length) delete k.hold_actions; changed([kind]); }
  if (t.dataset.sw) { const k = selKey(); k.led_color = t.dataset.sw.split(",").map(Number); await refreshTile(k); changed(["face"]); }
  if (t.dataset.ic) { const k = selKey(); k.icon = t.dataset.ic; await refreshTile(k); changed(["face"]); }
  if (t.dataset.mode2) { state.mode = t.dataset.mode2; renderSide(); }
});
let actDrag = null;
side.addEventListener("dragstart", (e) => { const a = e.target.closest?.(".act"); if (a) { actDrag = +a.dataset.ai; a.classList.add("dragging"); e.dataTransfer.setData("text/plain", "action"); } });
side.addEventListener("dragover", (e) => { const a = e.target.closest(".act"); if (a && actDrag !== null) { e.preventDefault(); side.querySelectorAll(".act.over").forEach((n) => n.classList.remove("over")); a.classList.add("over"); } });
side.addEventListener("drop", (e) => { const a = e.target.closest(".act"); if (!a || actDrag === null) return; e.preventDefault(); const l = curList(), [m] = l.splice(actDrag, 1); l.splice(+a.dataset.ai, 0, m); actDrag = null; changed([listKind()]); });
side.addEventListener("dragend", () => { actDrag = null; side.querySelectorAll(".dragging,.over").forEach((n) => n.classList.remove("dragging", "over")); });

/* ============ grid interactions: select, drag to swap ============ */
stScreen.addEventListener("click", (e) => { const c = e.target.closest("[data-k]"); if (c) { state.sel = +c.dataset.k; state.mode = "actions"; renderStudio(); } });
let tileDrag = null;
stScreen.addEventListener("dragstart", (e) => { const c = e.target.closest?.("[data-k]"); if (c) { tileDrag = +c.dataset.k; e.dataTransfer.setData("text/plain", "tile"); } });
stScreen.addEventListener("dragover", (e) => { const c = e.target.closest("[data-k]"); if (c && tileDrag !== null && !c.classList.contains("np")) { e.preventDefault(); stScreen.querySelectorAll(".drop").forEach((n) => n.classList.remove("drop")); c.classList.add("drop"); } });
stScreen.addEventListener("drop", (e) => {
  const c = e.target.closest("[data-k]"); if (!c || tileDrag === null) return; e.preventDefault();
  const keys = pg().keys, i = +c.dataset.k, j = tileDrag; tileDrag = null;
  if (keys[j]?.widget || keys[i]?.widget || i === j) return;
  [keys[j], keys[i]] = [keys[i], keys[j]];
  if (keys[i]) keys[i].id = i + 1;
  if (keys[j]) keys[j].id = j + 1;
  state.sel = i; changed(["structure"]);
});

/* ============ slots, pages, names ============ */
document.addEventListener("click", async (e) => {
  const s = e.target.closest("[data-stslot]");
  if (s) {
    state.slot = +s.dataset.stslot; state.page = 0; state.sel = 0;
    renderStudio();
    if (state.conn.connected) await loadSlot(state.slot);
  }
  const g = e.target.closest("[data-stpg]");
  if (g) { state.page = +g.dataset.stpg; state.sel = 0; renderStudio(); api.showPage(state.slot, state.page + 1); }
  if (e.target.closest("[data-addpage]")) {
    const back = K(1, "Back", "undo-2", [110, 100, 92], [{ type: "back" }]);
    await refreshTile(back);
    prof().pages.push({ name: `Page ${prof().pages.length + 1}`, keys: [back, ...blankKeys().slice(1)] });
    state.page = prof().pages.length - 1; state.sel = 1;
    changed(["structure"]);
  }
  const v = e.target.closest(".rail2 [data-view]");
  if (v) showView(v.dataset.view);
});
$("p-name").addEventListener("input", (e) => { prof().profile_name = e.target.value; changed(["structure"], true); renderTop(); });
$("pg-name").addEventListener("input", (e) => { pg().name = e.target.value; changed(["structure"], true); });
$("pg-del").addEventListener("click", () => {
  const p = prof();
  if (p.pages.length < 2 || !confirm(`Delete page "${pg().name}"? A backup is taken before the device is written.`)) return;
  p.pages.splice(state.page, 1);
  state.page = Math.max(0, state.page - 1); state.sel = 0;
  changed(["structure"]);
});

/* ============ edits -> main (live push 300 ms, autosave 1500 ms, backup first) ============ */
function changed(kinds, fromInput = false) {
  const k = selKey();
  setSave("busy", "Saving…");
  renderStudio(fromInput);
  api.edit({ slot: state.slot, profile: prof(), page: state.page + 1, keyId: k ? k.id : null, kinds });
}
function setSave(cls, text) { const el = $("save-ind"); el.className = `save-ind ${cls}`; el.lastElementChild.textContent = text; }

async function loadSlot(n) {
  const p = await api.loadProfile(n);
  if (!p) { cli("sys", `! Could not read profile${n}.json; editing a local copy.`); return; }
  state.slots[n] = p;
  if (n === state.slot) { state.page = Math.min(state.page, p.pages.length - 1); renderStudio(); }
  if (await ensureTiles(p)) { if (n === state.slot) changed(["structure"]); else api.edit({ slot: n, profile: p, page: 1, keyId: null, kinds: ["structure"] }); }
  renderTop();
}

/* ============ views ============ */
const TITLES = { editor: "Editor", device: "Device", ai: "AI shortcuts", settings: "Settings" };
function showView(v) {
  state.view = v;
  document.querySelectorAll(".rail2 [data-view]").forEach((b) => b.setAttribute("aria-current", String(b.dataset.view === v)));
  document.querySelectorAll("section.view").forEach((s) => { s.hidden = s.dataset.view !== v; });
  $("view-title").textContent = TITLES[v];
  if (v === "device") renderDevice();
  if (v === "settings") renderSettings();
}

/* ---- Device page ---- */
async function renderDevice() {
  const el = $("device-pane"), c = state.conn, st = c.status || {};
  const [ports, backups, flash] = await Promise.all([api.listPorts(), api.backupList(), api.flashInfo()]);
  const fs = c.connected ? await api.fsinfo() : null;
  const ble = c.connected ? await api.bleList() : { slots: [] };
  el.innerHTML = `
    <div class="book"><h3>Connection</h3>
      <label class="field"><span>Port</span><select id="d-port">${ports.map((p) => `<option value="${esc(p.path)}" ${p.path === c.path ? "selected" : ""}>${esc(p.label)}${p.ch340 ? " (CH340)" : ""}</option>`).join("") || "<option value=''>No serial ports</option>"}</select></label>
      <div class="row"><button class="primary" id="d-detect">${ico("search")} Find keypad</button><button id="d-connect">${ico("plug")} Connect to port</button><button class="ghost" id="d-disc" ${c.connected ? "" : "disabled"}>${ico("unplug")} Disconnect</button></div>
      <label class="check"><input type="checkbox" id="d-auto" ${state.settings.auto_connect ? "checked" : ""}> Connect automatically when the keypad is plugged in</label>
      <p class="hint">Detection looks for a CH340 (VID 1A86, PID 7523) whose <code>status</code> reply contains <code>model:touch</code>.</p></div>
    <div class="book"><h3>Status</h3>
      <dl class="kv"><dt>Connected</dt><dd>${c.connected ? esc(c.path) : "no"}</dd><dt>Firmware</dt><dd>${esc(st.ver || "—")}</dd><dt>Model</dt><dd>${esc(st.model || "—")}</dd>
      <dt>Active profile</dt><dd>${esc(c.activeSlot || "—")}</dd><dt>Page</dt><dd>${esc(c.page || "—")}</dd><dt>BLE hosts up</dt><dd>${esc(st.ble ?? "—")}</dd>
      <dt>Storage</dt><dd>${fs ? `${Math.round(fs.used / 1024)} KB of ${Math.round(fs.total / 1024)} KB used` : "—"}</dd></dl>
      <div class="row"><button id="d-refresh" ${c.connected ? "" : "disabled"}>${ico("refresh-cw")} Refresh</button><button id="d-time" ${c.connected ? "" : "disabled"}>${ico("clock")} Send time</button></div></div>
    <div class="book"><h3>Bluetooth hosts</h3>
      ${ble.slots.length ? `<table><thead><tr><th>Slot</th><th>Host</th><th>State</th><th></th></tr></thead><tbody>${ble.slots.map((b) => `<tr><td>${b.slot}</td><td>${esc(b.name || "—")}</td><td>${esc(b.state)}</td><td>${b.name ? `<button data-forget="${b.slot}">${ico("trash-2")} Forget</button>` : ""}</td></tr>`).join("")}</tbody></table>`
        : `<p class="hint">${c.connected ? (ble.raw ? `<code>${esc(ble.raw)}</code>` : "No host slots reported.") : "Connect the keypad to see its host slots."}</p>`}
      <p class="hint">Pair a new host from the keypad's settings sheet. Forgetting a slot removes the bond on the device; remove it on the computer too.</p></div>
    <div class="book"><h3>Backups</h3>
      <div class="row"><button id="b-all" ${c.connected ? "" : "disabled"}>${ico("download")} Back up all profiles</button><button id="b-import">${ico("folder-open")} Import JSON</button><button id="b-export">${ico("save")} Export this profile</button></div>
      <p class="hint">An automatic backup is written before every device write (last 20 per profile).</p>
      <div class="backups">${backups.slice(0, 40).map((b) => `<div class="row" style="justify-content:space-between; border-bottom:1px solid var(--rule); padding:4px 0"><span class="hint">${b.kind} · profile ${b.slot} · ${esc(b.label)}</span><button data-restore="${esc(b.id)}">Open in slot ${state.slot}</button></div>`).join("") || `<p class="hint">No backups yet.</p>`}</div></div>
    <div class="book"><h3>Firmware</h3><p>${esc(flash.note)}</p><p class="hint">Planned: classic DTR/RTS auto-reset over the CH340 with the bundled esptool (PLAN.md §10).</p></div>`;
  $("d-detect").onclick = async () => { const r = await api.connect(); cli("sys", r.ok ? `Connected to ${r.path}` : `! ${r.error}`); };
  $("d-connect").onclick = async () => { const p = $("d-port").value; if (!p) return; const r = await api.connect(p); cli("sys", r.ok ? `Connected to ${r.path}` : `! ${r.error}`); };
  $("d-disc").onclick = () => api.disconnect();
  $("d-auto").onchange = async (e) => { state.settings = await api.setSettings({ auto_connect: e.target.checked }); };
  $("d-refresh").onclick = async () => { await api.status(); renderDevice(); };
  $("d-time").onclick = () => api.command(`settime ${Math.floor(Date.now() / 1000)} ${-new Date().getTimezoneOffset()}`);
  $("b-all").onclick = async () => { const r = await api.backupAll(); cli("sys", r.ok ? `Backed up ${r.count} profiles to ${r.path}` : `! ${r.error}`); renderDevice(); };
  $("b-import").onclick = async () => { const r = await api.importProfile(); if (r && r.ok) { state.slots[state.slot] = r.profile; await ensureTiles(r.profile); state.page = 0; state.sel = 0; changed(["structure"]); cli("sys", "Imported into the editor; autosave writes it to the device."); } else if (r) cli("sys", `! ${r.error}`); };
  $("b-export").onclick = async () => { const r = await api.exportProfile(prof()); if (r && r.ok) cli("sys", `Exported to ${r.path}`); };
  el.querySelectorAll("[data-forget]").forEach((b) => { b.onclick = async () => { if (!confirm(`Forget BLE host slot ${b.dataset.forget}?`)) return; await api.bleForget(+b.dataset.forget); renderDevice(); }; });
  el.querySelectorAll("[data-restore]").forEach((b) => { b.onclick = async () => {
    const r = await api.backupRead(b.dataset.restore);
    if (!r.ok) { cli("sys", `! ${r.error}`); return; }
    if (!confirm(`Replace profile ${state.slot} with this backup? The current version is backed up first.`)) return;
    state.slots[state.slot] = r.profile; state.page = 0; state.sel = 0; await ensureTiles(r.profile); changed(["structure"]); showView("editor");
  }; });
}

/* ---- Settings page ---- */
async function renderSettings() {
  const el = $("settings-pane"), s = state.settings = await api.getSettings();
  const [br, contexts] = await Promise.all([api.bridgeState(prof()), api.contexts()]);
  const failed = new Set(br.failed.map((f) => f.slot));
  const ctxRows = contexts.map((c) => `<tr><td>${esc(c)}</td><td><select data-ctx="${esc(c)}"><option value="">—</option>${Array.from({ length: NUM_PROFILES }, (_, i) => `<option value="${i + 1}" ${s.context_profiles[c] === i + 1 ? "selected" : ""}>${i + 1} · ${esc(state.slots[i + 1].profile_name)}</option>`).join("")}</select></td></tr>`).join("");
  el.innerHTML = `
    <div class="book wide"><h3>Host bridge</h3>
      <p class="hint">A <b>Host Action</b> key sends a reserved F13–F24 combo over Bluetooth; Studio catches it and runs the command. Commands: <code>open &lt;url, file or app&gt;</code>, <code>run &lt;command line&gt;</code>, <code>obs.scene &lt;scene&gt;</code>. Studio must be running (it stays in the tray).</p>
      ${Object.keys(br.slots).length ? `<table><thead><tr><th>Slot</th><th>Combo</th><th>Command</th><th>Status</th><th></th></tr></thead><tbody>${br.combos.map((c) => `<tr><td>${c.slot}</td><td><code>${esc(c.label)}</code></td><td><code>${esc(br.slots[c.slot])}</code></td><td>${failed.has(c.slot) ? `<span class="pill warn">taken by another app</span>` : `<span class="pill ok">listening</span>`}</td><td><button data-test="${esc(br.slots[c.slot])}">Test</button></td></tr>`).join("")}</tbody></table>`
        : `<p class="hint">No host actions saved yet.</p>`}
      ${br.conflicts.length ? `<p><b>Conflicts in this profile:</b></p><ul class="errors">${br.conflicts.map((x) => `<li>${esc(x.where)} sends ${esc(x.label)}, which is reserved for host actions</li>`).join("")}</ul>` : ""}
    </div>
    <div class="book"><h3>OBS</h3>
      <label class="check"><input type="checkbox" data-set="obs_enabled" ${s.obs_enabled ? "checked" : ""}> Switch OBS scenes (OBS WebSocket v5)</label>
      <label class="field"><span>WebSocket URL</span><input data-set="obs_url" value="${esc(s.obs_url)}"></label>
      <label class="field"><span>Password</span><input type="password" data-set="obs_password" value="${esc(s.obs_password)}"></label></div>
    <div class="book"><h3>Feeds</h3>
      <label class="check"><input type="checkbox" data-set="settime_enabled" ${s.settime_enabled ? "checked" : ""}> Set the keypad clock on connect (<code>settime</code>)</label>
      <label class="check"><input type="checkbox" data-set="nowplaying_enabled" ${s.nowplaying_enabled ? "checked" : ""}> Send Now Playing from the Windows media session</label>
      <label class="check"><input type="checkbox" data-set="auto_connect" ${s.auto_connect ? "checked" : ""}> Connect automatically</label>
      <label class="field"><span>Baud rate</span><select data-set="baud">${[921600, 460800, 115200].map((b) => `<option ${s.baud === b ? "selected" : ""}>${b}</option>`).join("")}</select></label></div>
    <div class="book"><h3>Switch profile by app</h3>
      <label class="check"><input type="checkbox" data-set="auto_switch_enabled" ${s.auto_switch_enabled ? "checked" : ""}> When the focused app changes, send <code>setprofile</code></label>
      <table><thead><tr><th>App context</th><th>Profile</th></tr></thead><tbody>${ctxRows}</tbody></table></div>`;
  el.querySelectorAll("[data-set]").forEach((inp) => {
    inp.addEventListener("change", async () => {
      const k = inp.dataset.set;
      const v = inp.type === "checkbox" ? inp.checked : k === "baud" ? +inp.value : inp.value;
      state.settings = await api.setSettings({ [k]: v });
    });
  });
  el.querySelectorAll("[data-ctx]").forEach((sel) => {
    sel.addEventListener("change", async () => {
      const map = { ...state.settings.context_profiles };
      if (sel.value) map[sel.dataset.ctx] = +sel.value; else delete map[sel.dataset.ctx];
      state.settings = await api.setSettings({ context_profiles: map });
    });
  });
  el.querySelectorAll("[data-test]").forEach((b) => { b.onclick = async () => { const r = await api.bridgeTest(b.dataset.test); cli("host", r.ok ? `host: ran ${b.dataset.test}` : `! host: ${r.error}`); }; });
}

/* ============ events from main ============ */
api.onEvent(({ type, data }) => {
  switch (type) {
    case "tx": cli("cli", `macropad:$ ${data}`); break;
    case "rx": cli(data.startsWith("EVT:") ? "ev" : "sys", data); break;
    case "log": cli(/^host:/.test(data) ? "host" : "sys", String(data).replace(/\n$/, "")); break;
    case "state": {
      const was = state.conn.connected;
      state.conn = { ...state.conn, ...data };
      renderTop();
      if (!was && data.connected) loadSlot(data.activeSlot || state.slot).then(() => { state.slot = data.activeSlot || state.slot; renderStudio(); });
      if (!data.connected) setSave("off", "Offline · edits are backed up on this PC");
      if (state.view === "device") renderDevice();
      break;
    }
    case "save-state": {
      if (data.slot !== state.slot) break;
      const m = { pending: ["busy", "Saving…"], saving: ["busy", "Writing to device…"], saved: ["", "Saved to device"], offline: ["off", "Backed up on PC · offline"], error: ["err", "Not saved"] }[data.state];
      if (m) setSave(...m);
      $("st-errors").innerHTML = data.state === "error" ? (data.errors || []).map((x) => `<li>${esc(x)}</li>`).join("") : "";
      break;
    }
    case "key": {
      if (state.conn.activeSlot !== state.slot || data.page !== state.page + 1) break;
      const cell = stScreen.querySelector(`[data-k="${data.id - 1}"]`);
      if (cell) { cell.classList.add("live"); if (data.state !== "1") setTimeout(() => cell.classList.remove("live"), data.state === "0" ? 0 : 400); }
      break;
    }
    case "profile": state.conn.activeSlot = data; renderTop(); break;
    case "page": state.conn.page = data; break;
    case "nowplaying": state.np = data; if (state.view === "editor" && pg().keys.some((k) => k?.widget)) renderStudio(true); break;
    case "context": if (data.slot) cli("sys", `Focused app → ${data.context}: profile ${data.slot}`); break;
    case "bridge": if (data.failed && data.failed.length) cli("host", `! ${data.failed.length} host combo(s) are taken by another app: ${data.failed.map((f) => f.label).join(", ")}`); break;
  }
});

/* ============ boot ============ */
(async () => {
  state.settings = await api.getSettings();
  state.conn = { ...state.conn, ...(await api.state()) };
  if (!state.conn.connected) setSave("off", state.conn.noSerial ? "Serial disabled" : "Offline · edits are backed up on this PC");
  renderStudio();
  if (state.conn.view) showView(state.conn.view);
  if (state.conn.connected) await loadSlot(state.conn.activeSlot || 1);
  // Self-check for the smoke test: the canvas renderer must produce 72x72 RGBA.
  const t = await TileDraw.render("mic", [47, 107, 79]);
  api.ready({ tileBytes: t.rgba.length, icons: ICONS.filter((n) => !document.getElementById(`i-${n}`)) });
})();
