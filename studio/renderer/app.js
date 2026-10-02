/* Macropad Studio (Touch Keypad) renderer. The editor's preview is the keypad
 * screen at device pixels (docs/device/index.html, firmware/DESIGN.md); the
 * device draws the same glass keys from the same icon names, so Studio sends
 * names, colours and actions, never rendered tiles. Device work goes through
 * window.api (preload.js) to the main-process services. */
"use strict";

/* ============ schema metadata (mirrors services/schema.js) ============ */
const ACTION_META = {
  text:        { label: "Type Text",      cat: "Keyboard", icon: "type",                color: "#4f8cff", field: "value",  def: { value: "hello" } },
  multiline:   { label: "Multiline",      cat: "Keyboard", icon: "list",                color: "#4f8cff", field: "value",  def: { value: "line one\nline two" } },
  keycombo:    { label: "Key Combo",      cat: "Keyboard", icon: "keyboard",            color: "#ff5f57", field: "keys",   def: { keys: ["LEFT_CTRL", "C"] } },
  key:         { label: "Tap Key",        cat: "Keyboard", icon: "keyboard",            color: "#9b7bff", field: "value",  def: { value: "ENTER" } },
  hold:        { label: "Hold Key",       cat: "Keyboard", icon: "arrow-down",          color: "#9b7bff", field: "key",    def: { key: "LEFT_SHIFT" } },
  release:     { label: "Release Keys",   cat: "Keyboard", icon: "arrow-up",            color: "#9b7bff", field: null,     def: {} },
  delay:       { label: "Delay",          cat: "Timing",   icon: "timer",               color: "#8a98ab", field: "ms",     def: { ms: 300 } },
  repeat:      { label: "Repeat",         cat: "Timing",   icon: "repeat",              color: "#8a98ab", field: "count",  def: { count: 3, actions: [{ type: "key", value: "DOWN_ARROW" }] } },
  comment:     { label: "Comment",        cat: "Timing",   icon: "message-square",      color: "#8a98ab", field: "value",  def: { value: "note" } },
  mouse_click: { label: "Mouse Click",    cat: "Mouse",    icon: "mouse-pointer-click", color: "#2fbf9a", field: "button", def: { button: "LEFT" } },
  mouse_move:  { label: "Mouse Move",     cat: "Mouse",    icon: "mouse",               color: "#2fbf9a", field: "xyw",    def: { x: 0, y: 0, wheel: -5 } },
  media:       { label: "Media",          cat: "System",   icon: "volume-2",            color: "#3fc6e0", field: "value",  def: { value: "PLAY_PAUSE" } },
  telephony:   { label: "Telephony",      cat: "System",   icon: "phone",               color: "#3fc6e0", field: "value",  def: { value: "MIC_MUTE" } },
  profile:     { label: "Switch Profile", cat: "System",   icon: "layers",              color: "#f2b746", field: "value",  def: { value: 2 } },
  led:         { label: "LED Tint",       cat: "Lighting", icon: "lightbulb",           color: "#ff6fae", field: "color",  def: { color: [255, 110, 199] } },
  led_anim:    { label: "LED Animation",  cat: "Lighting", icon: "sparkles",            color: "#d86ce8", field: "value",  def: { value: "breathe" } },
  page:        { label: "Go to Page",     cat: "Screen",   icon: "layout-grid",         color: "#e56fd6", field: "value",  def: { value: 1 } },
  back:        { label: "Back",           cat: "Screen",   icon: "arrow-left",          color: "#e56fd6", field: null,     def: {} },
  host:        { label: "Host Action",    cat: "Screen",   icon: "monitor",             color: "#f2b746", field: "cmd",    def: { cmd: "open https://github.com" } },
};
const CATS = ["Keyboard", "Mouse", "Timing", "System", "Lighting", "Screen"];
const ENUMS = { media: ["PLAY_PAUSE", "STOP", "NEXT", "PREVIOUS", "MUTE", "VOLUME_UP", "VOLUME_DOWN"], mouse_click: ["LEFT", "RIGHT", "MIDDLE"], telephony: ["MIC_MUTE", "ANSWER", "DECLINE"], led_anim: ["flash", "breathe"] };
const ALIASES = { CTRL: "LEFT_CTRL", SHIFT: "LEFT_SHIFT", ALT: "LEFT_ALT", GUI: "LEFT_GUI", WIN: "LEFT_GUI", CMD: "LEFT_GUI", UP: "UP_ARROW", DOWN: "DOWN_ARROW", LEFT: "LEFT_ARROW", RIGHT: "RIGHT_ARROW", RETURN: "ENTER" };
const ICON_NAMES = window.KEY_ICON_NAMES || [];
// The twelve glass tints of firmware/DESIGN.md.
const TINTS = [[79, 140, 255], [63, 198, 224], [47, 191, 154], [82, 214, 143], [168, 214, 74], [242, 183, 70], [255, 138, 61], [255, 95, 87], [255, 111, 174], [216, 108, 232], [155, 123, 255], [138, 152, 171]];
const ANIMS = [["", "None"], ["eq", "Equalizer while playing"], ["pulse", "Pulse while off"], ["rec", "Blink red while on"]];
const LED_PATTERNS = ["rainbow", "breathe", "solid", "status", "off"];
// The keypad's themes (firmware/TouchKeypad/themes.h); the preview draws the chosen one.
const THEMES = [["glass", "Glass"], ["paper", "Paper"], ["daylight", "Daylight"], ["aurora", "Aurora"], ["synth", "Synth"], ["retro", "Retro"]];
const NUM_PROFILES = 8;

/* ============ helpers ============ */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const rgb = (c) => `rgb(${c.join(",")})`;
function kicon(name, px = 24) {   // a glyph from the shared icon map (the device draws the same mask)
  const g = (window.KEY_ICONS || {})[name];
  if (!g) return "";
  const paint = g.f ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"';
  return `<svg viewBox="0 0 24 24" width="${px}" height="${px}" ${paint} aria-hidden="true">${g.d}</svg>`;
}
const ico = (name) => (document.getElementById(`i-${name}`) ? `<svg class="lc" aria-hidden="true"><use href="#i-${name}"/></svg>` : kicon(name, 16));
const norm = (k) => { const u = String(k).trim().toUpperCase(); return ALIASES[u] || (u.length === 1 ? String(k).trim() : u); };
const blankKeys = () => Array.from({ length: 15 }, () => null);
const blankProfile = (n) => ({ schema_version: 2, profile_name: `Profile ${n}`, color: [138, 152, 171], default_delay: 20, pages: [{ name: "Main", keys: blankKeys() }] });
const K = (id, name, icon, led_color, actions) => ({ id, name, icon, led_color, actions });
const luma = ([r, g, b]) => (r * 77 + g * 150 + b * 29) >> 8;
const mixc = (a, b, t) => a.map((v, i) => Math.round(v + ((b[i] - v) * t) / 255));
// Glyph ink where the theme does not use one ink for every key (the firmware's keyInk).
function keyInk(tint) {
  if (state.theme === "paper") return luma(mixc(tint, [239, 228, 204], 46)) > 165 ? "#1f1a14" : "#fffaf0";
  if (state.theme === "daylight") { let c = tint; for (let i = 0; i < 6 && luma(c) > 118; i++) c = mixc(c, [0, 0, 0], 45); return rgb(c); }
  return "";
}
// The profile line as the keypad draws it: four greens in Retro, darkened to read on light grounds.
function lineFor(c) {
  if (state.theme === "retro") return [48, 98, 48];
  const light = ["paper", "daylight", "synth"].includes(state.theme);
  for (let i = 0; light && i < 4 && luma(c) > 140; i++) c = mixc(c, [0, 0, 0], 50);
  return c;
}
const mmss = (s) => `${Math.floor((s || 0) / 60)}:${String((s || 0) % 60).padStart(2, "0")}`;
const isPlayerPage = (page) => !!(page.keys[0] && page.keys[0].widget);
// Profiles live on the keypad: without it Studio only previews (an offline edit would be
// replaced by the keypad's profile on connect, or overwrite it with a blank one).
// While a slot loads from the keypad its editor waits: an edit made then was replaced by the arriving copy.
const editable = () => !!(state.conn.connected || state.conn.smoke) && !state.loading;
const newer = (a, b) => { const x = String(a).split(".").map(Number), y = String(b).split(".").map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };

/* ============ state ============ */
const state = {
  slots: Object.fromEntries(Array.from({ length: NUM_PROFILES }, (_, i) => [i + 1, blankProfile(i + 1)])),
  slot: 1, page: 0, sel: 0, mode: "actions", view: "editor", iconFilter: "", theme: "daylight", empty: {}, loading: null,
  conn: { connected: false }, settings: {}, np: { title: "", album: "", artist: "", app: "", pos: 0, len: 0, playing: false }, art: null,
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
  $("console-last").textContent = msg;
}
$("console-box").addEventListener("toggle", async () => {
  const open = $("console-box").open;
  if (open) { stLog.scrollTop = stLog.scrollHeight; $("cli-in").focus(); }
  if (state.settings.console_open !== open) state.settings = await api.setSettings({ console_open: open });
});
$("cli-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const v = $("cli-in").value.trim();
  if (!v) return;
  $("cli-in").value = "";
  if (!state.conn.connected) { cli("sys", "! Not connected."); return; }
  const reply = await api.command(v);
  for (const line of String(reply).split("\n").slice(0, 200)) if (line.trim()) cli("sys", line);
});

/* ============ the keypad screen (device pixels) ============ */
function keyHTML(k, i) {
  const sel = i === state.sel ? " sel" : "";
  if (!k) return `<div class="cell${sel}" data-k="${i}" role="button" tabindex="0" aria-label="Empty key ${i + 1}"><div class="well"></div></div>`;
  const host = (k.actions || []).some((a) => a.type === "host");
  const tag = host ? `<span class="tag pc">PC</span>` : k.hold_actions?.length ? `<span class="tag hold">HOLD</span>` : k.toggle ? `<span class="tag on">ON</span>` : "";
  const anim = k.anim ? `<span class="tag anim">${k.anim.toUpperCase()}</span>` : "";
  const face = k.icon && window.KEY_ICONS?.[k.icon] ? kicon(k.icon, 36) : `<span class="ini">${esc((k.name || "?").split(/\s+/).map((w) => w[0]).join("").slice(0, 2))}</span>`;
  return `<div class="cell${sel}" data-k="${i}" draggable="true" role="button" tabindex="0" aria-label="${esc(k.name || `Key ${i + 1}`)}">
    <span class="key" style="--t:${rgb(k.led_color || [138, 152, 171])}${keyInk(k.led_color || [138, 152, 171]) ? `;--ink:${keyInk(k.led_color || [138, 152, 171])}` : ""}">${face}</span>${tag}${anim}<span class="lbl">${esc(k.name || " ")}</span></div>`;
}
function playerHTML(sel) {
  const np = state.np, pct = np.len ? Math.min(100, (np.pos / np.len) * 100) : 0;
  const art = state.art ? `<img src="${state.art}" alt="Album art">` : kicon("music", 36);
  return `<div class="mp${sel ? " sel" : ""}" data-k="0" role="button" tabindex="0" aria-label="Media player page">
    <div class="art">${art}</div>
    <div class="meta"><div class="t">${esc(np.title || "Nothing playing")}</div>${np.album ? `<div class="al">${esc(np.album)}</div>` : ""}
      <div class="a">${esc(np.artist || "Studio sends the track here")}${np.app ? ` <b>${esc(String(np.app).split("!").pop().replace(/\.exe$/i, "").split(".").pop())}</b>` : ""}</div></div>
    <div class="seek"><i style="width:${pct}%"></i><b style="left:${pct}%"></b></div>
    <div class="times"><span>${mmss(np.pos)}</span><span>−${mmss(Math.max(0, np.len - np.pos))}</span></div>
    <div class="ctl"><span class="mute">${kicon("volume-x", 24)}</span><span>${kicon("volume-1", 28)}</span><span>${kicon("skip-back", 28)}</span>
      <span class="play">${kicon(np.playing ? "pause" : "play", 36)}</span><span>${kicon("skip-forward", 28)}</span><span>${kicon("volume-2", 28)}</span></div></div>`;
}
function devHTML() {
  const p = prof(), page = pg(), line = rgb(lineFor(p.color || [138, 152, 171]));
  const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  const up = state.conn.connected && state.conn.status && +state.conn.status.ble > 0;
  const body = isPlayerPage(page) ? playerHTML(state.sel === 0) : `<div class="grid">${page.keys.map(keyHTML).join("")}</div>`;
  return `<div class="dev" data-theme="${state.theme}" style="--line:${line}">
    <div class="sb"><span class="clock">${time}</span><span class="prof"><i></i>${esc(p.profile_name)} <span>${state.page + 1}/${p.pages.length}</span></span>
      <span class="host${up ? "" : " caution"}">${kicon(up ? "bluetooth" : "bluetooth-off", 18)}${up ? "Host" : "No host"}</span><span class="gear">${kicon("settings", 18)}</span></div>
    ${body}
    ${p.pages.length > 1 ? `<div class="line" style="--n:${p.pages.length}">${p.pages.map((_, i) => `<i class="${i === state.page ? "cur" : ""}"></i>`).join("")}</div>` : ""}</div>`;
}

function renderTop() {
  $("st-slots").innerHTML = Array.from({ length: NUM_PROFILES }, (_, i) => i + 1).map((n) => {
    const empty = state.conn.connected && state.empty[n];
    return `<button aria-pressed="${n === state.slot}" data-stslot="${n}" class="${empty ? "empty" : ""}" title="${n === state.conn.activeSlot ? "Active on the keypad" : empty ? "Empty slot: edit it to create a profile" : ""}">${n} · ${empty ? "Empty" : esc(state.slots[n].profile_name)}${n === state.conn.activeSlot && state.conn.connected ? " ●" : ""}</button>`;
  }).join("");
  const c = state.conn, pill = $("conn-pill");
  pill.className = `pill ${c.connected ? "ok" : "off"}`;
  pill.lastElementChild.textContent = c.connected
    ? `Touch Keypad · ${c.path === "BLE" ? "Bluetooth" : c.path} · fw ${(c.status && c.status.ver) || "?"}`
    : c.noSerial ? "Serial disabled" : "Offline · looking for the keypad";
}

function renderStudio(keepSide = false) {
  const p = prof(), page = pg();
  renderTop();
  const ed = editable();
  $("st-pages").innerHTML = p.pages.map((g, i) => `<button aria-pressed="${i === state.page}" data-stpg="${i}">${esc(g.name)}</button>`).join("") + (ed ? `<button data-addpage>${ico("plus")} Page</button>` : "");
  $("p-name").disabled = $("pg-name").disabled = !ed;
  renderNotices();
  $("st-screen").innerHTML = devHTML();
  $("st-json").textContent = JSON.stringify(p, null, 1);
  if (document.activeElement !== $("p-name")) $("p-name").value = p.profile_name;
  if (document.activeElement !== $("pg-name")) $("pg-name").value = page.name;
  $("pg-del").disabled = !ed || p.pages.length < 2;
  $("p-color").innerHTML = TINTS.map((c) => `<button style="background:${rgb(c)}" aria-pressed="${(p.color || []).join() === c.join()}" data-pcolor="${c.join(",")}" aria-label="Line colour ${c.join(",")}" ${ed ? "" : "disabled"}></button>`).join("");
  if (!keepSide) renderSide();
}

/* ============ notices: first run, calibration, firmware ============ */
function renderNotices() {
  const c = state.conn, st = c.status || {}, out = [];
  if (!c.connected && !c.smoke) {
    out.push(`<div class="notice first"><div><h2>Connect your Touch Keypad</h2>
      <ol><li>Plug it into this PC with a USB-C data cable.</li><li>Studio finds it by itself and opens its profiles here.</li>
      <li>Edits go to the keypad as you make them, with a backup on this PC first.</li></ol>
      <p class="hint">${c.noSerial ? "Serial is disabled in this session." : "Looking for the keypad… Its keys already work as a Bluetooth keyboard without Studio."}</p></div>
      <button class="primary" data-find>${ico("search")} Find keypad</button></div>`);
  } else if (c.connected) {
    if (st.cal === "0" || st.ui === "cal")
      out.push(`<div class="notice caution">${ico("crosshair")}<p><b>Touch is not calibrated yet.</b> The keypad shows its calibration screen: press and hold each lit target, then the centre check.</p></div>`);
    if (state.fwBundled && st.ver && newer(state.fwBundled, st.ver))
      out.push(`<div class="notice">${ico("download")}<p><b>Firmware ${esc(state.fwBundled)} is ready to install.</b> The keypad has ${esc(st.ver)}. Profiles, pairings and calibration are kept.</p><button data-goview="device">Open Device</button></div>`);
  }
  $("st-notice").innerHTML = out.join("");
}
$("st-notice").addEventListener("click", async (e) => {
  if (e.target.closest("[data-find]")) { const r = await api.connect(); cli("sys", r.ok ? `Connected to ${r.path}` : `! ${r.error}`); }
  if (e.target.closest("[data-goview]")) showView("device");
});

/* ============ inspector + ActionBuilder ============ */
const side = $("st-side");
function iconGrid(k) {
  const f = state.iconFilter.trim().toLowerCase();
  const names = ICON_NAMES.filter((n) => !f || n.includes(f));
  return names.map((n) => `<button aria-pressed="${n === k.icon}" data-ic="${n}" aria-label="${n}" title="${n}">${kicon(n, 20)}</button>`).join("") || `<p class="hint" style="grid-column:1/-1; padding:8px">No icon matches.</p>`;
}
function renderSide() {
  const page = pg();
  if (state.loading) {
    side.innerHTML = `<div class="field"><span>Keys</span><h2>Loading profile ${state.loading}…</h2></div><p class="hint">Reading it from the keypad.</p>`;
    return;
  }
  if (!editable()) {
    side.innerHTML = `<div class="field"><span>Keys</span><h2>Keypad not connected</h2></div>
      <p class="hint">Profiles live on the keypad, so they open here once it is plugged in. Until then this is a preview: the themes and the screen look exactly like the keypad's.</p>`;
    return;
  }
  if (isPlayerPage(page)) {
    side.innerHTML = `<div class="field"><span>Page</span><h2>Media player</h2></div>
      <p class="hint">This page is the keypad's player: album art, track, running times, tap-to-seek and transport keys. Studio feeds it from the Windows media session; its keys send media commands over Bluetooth.</p>
      <button class="danger" id="rm-w">${ico("trash-2")} Turn back into a key page</button>`;
    $("rm-w").onclick = () => { page.keys[0] = null; changed(["structure"]); };
    return;
  }
  const k = selKey();
  if (!k) {
    side.innerHTML = `<div class="field"><span>Key ${state.sel + 1}</span><p class="hint">This key is empty.</p></div>
      <button class="primary" id="mk-key">${ico("plus")} Create key</button>
      <button id="mk-np">${ico("music")} Make this page the media player</button><p class="hint">The player fills the whole page; the keys on this page are cleared.</p>`;
    $("mk-key").onclick = () => { pg().keys[state.sel] = K(state.sel + 1, "New key", "zap", [242, 183, 70], [{ type: "key", value: "F13" }]); changed(["structure"]); };
    $("mk-np").onclick = () => {
      if (pg().keys.some((x) => x) && !confirm("Clear this page's keys and make it the media player?")) return;
      pg().keys = blankKeys();
      pg().keys[0] = { id: 1, name: "Now Playing", widget: "media", span: [5, 3], actions: [{ type: "media", value: "PLAY_PAUSE" }] };
      state.sel = 0;
      changed(["structure"]);
    };
    return;
  }
  const modes = [["actions", "On tap"], ["hold", "On hold"], ...(k.toggle ? [["off", "Turning off"]] : [])];
  if (!modes.some(([m]) => m === state.mode)) state.mode = "actions";
  side.innerHTML = `
    <div class="two"><label class="field"><span>Label</span><input id="k-name" value="${esc(k.name)}" maxlength="14"></label>
      <div class="dev keyprev" data-theme="${state.theme}"><span class="key" style="--t:${rgb(k.led_color)}${keyInk(k.led_color) ? `;--ink:${keyInk(k.led_color)}` : ""}">${k.icon ? kicon(k.icon, 36) : ""}</span></div></div>
    <div class="field"><span>Colour</span><div class="swatches">${TINTS.map((c) => `<button style="background:${rgb(c)}" aria-pressed="${c.join() === k.led_color.join()}" data-sw="${c.join(",")}" aria-label="Colour ${c.join(",")}"></button>`).join("")}</div></div>
    <div class="field iconbox"><span>Icon · ${ICON_NAMES.length} built in</span><input id="ic-filter" placeholder="Search icons: play, mic, git, spotify…" value="${esc(state.iconFilter)}" aria-label="Search icons"><div class="icons" id="icons">${iconGrid(k)}</div></div>
    <div class="two"><label class="field"><span>Animation</span><select id="k-anim">${ANIMS.map(([v, l]) => `<option value="${v}" ${(k.anim || "") === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <label class="check" style="padding-bottom:8px"><input type="checkbox" id="k-toggle" ${k.toggle ? "checked" : ""}> Toggle</label></div>
    <p class="hint">${k.toggle ? "A toggle remembers on and off and shows ON. Without “Turning off” actions it runs the same actions both ways." : "Animations play on the keypad: the equalizer while media plays, pulse or blink on toggles."}</p>
    <span class="mode" role="group" aria-label="Trigger">${modes.map(([m, l]) => `<button aria-pressed="${state.mode === m}" data-mode2="${m}">${l}</button>`).join("")}</span>
    <div class="acts" id="acts"></div>
    ${addSelect()}
    <button class="ghost" id="k-clear">${ico("trash-2")} Clear key</button>`;
  renderActs(curList());
  $("k-name").oninput = (e) => { k.name = e.target.value; changed(["title"], true); };
  $("ic-filter").oninput = (e) => { state.iconFilter = e.target.value; $("icons").innerHTML = iconGrid(k); };
  $("k-anim").onchange = (e) => { if (e.target.value) k.anim = e.target.value; else delete k.anim; changed(["structure"]); };
  $("k-toggle").onchange = (e) => { if (e.target.checked) k.toggle = true; else { delete k.toggle; delete k.off_actions; } changed(["structure"]); };
  $("k-add").onchange = onAdd;
  $("k-clear").onclick = () => { pg().keys[state.sel] = null; changed(["structure"]); };
}
const addSelect = () => `<label class="field"><span>Add action</span><select id="k-add"><option value="">Choose an action…</option>${CATS.map((c) => `<optgroup label="${c}">${Object.entries(ACTION_META).filter(([, m]) => m.cat === c).map(([t, m]) => `<option value="${t}">${m.label}</option>`).join("")}</optgroup>`).join("")}</select></label>`;
const FIELD_OF = { actions: "actions", hold: "hold_actions", off: "off_actions" };
const listKind = () => (state.mode === "hold" ? "hold" : state.mode === "off" ? "structure" : "actions");
const curList = () => { const k = selKey(); const f = FIELD_OF[state.mode] || "actions"; return f === "actions" ? k.actions : (k[f] ||= []); };
function onAdd(e) {
  const t = e.target.value; if (!t) return;
  curList().push({ type: t, ...structuredClone(ACTION_META[t].def) });
  changed([listKind()]);
}
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
    const m = ACTION_META[a.type] || { label: a.type, icon: "square", color: "#8a98ab", field: null };
    const input = ENUMS[a.type] ? `<select data-af="${i}" aria-label="${m.label}">${ENUMS[a.type].map((v) => `<option ${v === a[m.field] ? "selected" : ""}>${v}</option>`).join("")}</select>`
      : m.field ? `<input data-af="${i}" value="${esc(fieldVal(a))}" aria-label="${m.label} value">` : `<span class="hint">No settings</span>`;
    return `<div class="act" draggable="true" data-ai="${i}"><span class="ti" style="background:${m.color}">${kicon(m.icon, 16)}</span>
      <span class="bd"><b>${m.label}</b>${input}</span>
      <span class="ops"><button data-up="${i}" aria-label="Move up">${ico("arrow-up")}</button><button data-down="${i}" aria-label="Move down">${ico("arrow-down")}</button><button data-del="${i}" aria-label="Delete">${ico("x")}</button></span></div>`;
  }).join("");
}
side.addEventListener("input", (e) => { const i = e.target.dataset.af; if (i === undefined || e.target.tagName === "SELECT") return; setField(curList()[+i], e.target.value); changed([listKind()], true); });
side.addEventListener("change", (e) => { const i = e.target.dataset.af; if (i === undefined || e.target.tagName !== "SELECT") return; setField(curList()[+i], e.target.value); changed([listKind()], true); });
side.addEventListener("click", (e) => {
  const t = e.target.closest("button"); if (!t) return;
  if (t.dataset.up) { const i = +t.dataset.up, l = curList(); if (i > 0) [l[i - 1], l[i]] = [l[i], l[i - 1]]; changed([listKind()]); }
  if (t.dataset.down) { const i = +t.dataset.down, l = curList(); if (i < l.length - 1) [l[i + 1], l[i]] = [l[i], l[i + 1]]; changed([listKind()]); }
  if (t.dataset.del) {
    const kind = listKind();
    curList().splice(+t.dataset.del, 1);
    const k = selKey();
    for (const f of ["hold_actions", "off_actions"]) if (k[f] && !k[f].length) delete k[f];
    changed([kind]);
  }
  if (t.dataset.sw) { selKey().led_color = t.dataset.sw.split(",").map(Number); changed(["face"]); }
  if (t.dataset.ic) { selKey().icon = t.dataset.ic; changed(["face"]); }
  if (t.dataset.mode2) { state.mode = t.dataset.mode2; renderSide(); }
});
let actDrag = null;
side.addEventListener("dragstart", (e) => { const a = e.target.closest?.(".act"); if (a) { actDrag = +a.dataset.ai; a.classList.add("dragging"); e.dataTransfer.setData("text/plain", "action"); } });
side.addEventListener("dragover", (e) => { const a = e.target.closest(".act"); if (a && actDrag !== null) { e.preventDefault(); side.querySelectorAll(".act.over").forEach((n) => n.classList.remove("over")); a.classList.add("over"); } });
side.addEventListener("drop", (e) => { const a = e.target.closest(".act"); if (!a || actDrag === null) return; e.preventDefault(); const l = curList(), [m] = l.splice(actDrag, 1); l.splice(+a.dataset.ai, 0, m); actDrag = null; changed([listKind()]); });
side.addEventListener("dragend", () => { actDrag = null; side.querySelectorAll(".dragging,.over").forEach((n) => n.classList.remove("dragging", "over")); });

/* ============ grid interactions: select, drag to swap ============ */
const stScreen = $("st-screen");
stScreen.addEventListener("click", (e) => { const c = e.target.closest("[data-k]"); if (c) { state.sel = +c.dataset.k; state.mode = "actions"; renderStudio(); } });
stScreen.addEventListener("keydown", (e) => { const c = e.target.closest("[data-k]"); if (c && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); c.click(); } });
let tileDrag = null;
stScreen.addEventListener("dragstart", (e) => { const c = e.target.closest?.("[data-k]"); if (c) { tileDrag = +c.dataset.k; e.dataTransfer.setData("text/plain", "key"); } });
stScreen.addEventListener("dragover", (e) => { const c = e.target.closest(".cell"); if (c && tileDrag !== null) { e.preventDefault(); stScreen.querySelectorAll(".drop").forEach((n) => n.classList.remove("drop")); c.classList.add("drop"); } });
stScreen.addEventListener("drop", (e) => {
  const c = e.target.closest(".cell"); if (!c || tileDrag === null) return; e.preventDefault();
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
    const back = K(1, "Back", "arrow-left", [138, 152, 171], [{ type: "back" }]);
    prof().pages.push({ name: `Page ${prof().pages.length + 1}`, keys: [back, ...blankKeys().slice(1)] });
    state.page = prof().pages.length - 1; state.sel = 1;
    changed(["structure"]);
  }
  const pc = e.target.closest("[data-pcolor]");
  if (pc) { prof().color = pc.dataset.pcolor.split(",").map(Number); changed(["structure"]); }
  const v = e.target.closest(".rail2 [data-view]");
  if (v) showView(v.dataset.view);
});
$("p-name").addEventListener("input", (e) => { prof().profile_name = e.target.value; changed(["structure"], true); renderTop(); });
$("pg-name").addEventListener("input", (e) => { pg().name = e.target.value; changed(["structure"], true); });
$("pg-del").addEventListener("click", () => {
  const p = prof();
  if (p.pages.length < 2 || !confirm(`Delete page "${pg().name}"? A backup is taken before the keypad is written.`)) return;
  p.pages.splice(state.page, 1);
  state.page = Math.max(0, state.page - 1); state.sel = 0;
  changed(["structure"]);
});

/* ============ history (undo / redo) and key clipboard ============ */
// Each edit pushes the slot's previous version; typing in one field within 800 ms is one step.
const hist = { undo: [], redo: [], base: {}, at: 0, clip: null };
function track(fromInput) {
  const now = Date.now(), cur = JSON.stringify(prof()), base = hist.base[state.slot];
  if (base && base !== cur && !(fromInput && now - hist.at < 800)) {
    hist.undo.push({ slot: state.slot, json: base });
    if (hist.undo.length > 100) hist.undo.shift();
    hist.redo = [];
  }
  hist.at = fromInput ? now : 0;
  hist.base[state.slot] = cur;
}
function restore(from, to) {
  const e = from.pop();
  if (!e) return;
  to.push({ slot: e.slot, json: JSON.stringify(state.slots[e.slot]) });
  state.slot = e.slot;
  state.slots[e.slot] = JSON.parse(e.json);
  hist.base[e.slot] = e.json;
  state.page = Math.min(state.page, prof().pages.length - 1);
  setSave("busy", "Saving…");
  renderStudio();
  api.edit({ slot: state.slot, profile: prof(), page: state.page + 1, keyId: null, kinds: ["structure"] });
}
document.addEventListener("keydown", (e) => {
  if (state.view !== "editor" || e.target.closest("input, textarea, select")) return;
  const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase(), page = pg();
  if (!editable() && (mod || e.key === "Delete" || e.key === "Backspace")) return;
  if (mod && k === "z" && !e.shiftKey) { e.preventDefault(); restore(hist.undo, hist.redo); return; }
  if (mod && (k === "y" || (k === "z" && e.shiftKey))) { e.preventDefault(); restore(hist.redo, hist.undo); return; }
  if (isPlayerPage(page)) return;
  const key = selKey();
  if (mod && k === "c" && key) { e.preventDefault(); hist.clip = structuredClone(key); cli("sys", `Copied key \"${key.name}\".`); return; }
  if (mod && k === "v" && hist.clip) { e.preventDefault(); page.keys[state.sel] = { ...structuredClone(hist.clip), id: state.sel + 1 }; changed(["structure"]); return; }
  if ((e.key === "Delete" || e.key === "Backspace") && key) { e.preventDefault(); page.keys[state.sel] = null; changed(["structure"]); return; }
  const move = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -5, ArrowDown: 5 }[e.key];
  if (move && !mod) {
    const next = state.sel + move;
    if (next >= 0 && next < 15 && (Math.abs(move) === 5 || Math.floor(next / 5) === Math.floor(state.sel / 5))) { e.preventDefault(); state.sel = next; state.mode = "actions"; renderStudio(); }
  }
});

/* ============ edits -> main (live push 300 ms, autosave 1500 ms, backup first) ============ */
function changed(kinds, fromInput = false) {
  if (!editable()) {
    if (hist.base[state.slot]) state.slots[state.slot] = JSON.parse(hist.base[state.slot]);
    cli("sys", "! Connect the keypad to edit its profiles.");
    renderStudio();
    return;
  }
  track(fromInput);
  const k = isPlayerPage(pg()) ? null : selKey();
  setSave("busy", "Saving…");
  renderStudio(fromInput);
  api.edit({ slot: state.slot, profile: prof(), page: state.page + 1, keyId: k ? k.id : null, kinds });
}
function setSave(cls, text) { const el = $("save-ind"); el.className = `save-ind ${cls}`; el.lastElementChild.textContent = text; }

// Names for the slot strip without switching the keypad: each profile file read in place.
async function peekSlots() {
  for (let n = 1; n <= NUM_PROFILES; n++) {
    if (!state.conn.connected || n === state.slot) continue;
    const p = await api.peekProfile(n);
    state.empty[n] = !p;
    if (p) { state.slots[n] = p; hist.base[n] = JSON.stringify(p); }
  }
  renderTop();
}

async function loadSlot(n) {
  state.loading = n;
  if (n === state.slot) renderStudio();
  let p = null;
  try { p = await api.loadProfile(n); } finally { state.loading = null; }
  if (!p) { cli("sys", `! Could not read profile${n}.json; editing a local copy.`); if (n === state.slot) renderStudio(); return; }
  state.slots[n] = p;
  state.empty[n] = false;
  hist.base[n] = JSON.stringify(p);
  if (n === state.slot) { state.page = Math.min(state.page, p.pages.length - 1); renderStudio(); }
  renderTop();
}

/* ============ views ============ */
const TITLES = { editor: "Editor", device: "Device", settings: "Settings" };
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
  const look = c.connected ? await api.lookState() : null;
  if (look && look.theme) state.theme = look.theme;
  const dis = c.connected ? "" : "disabled";
  const pct = (v) => (look ? `${Math.round(v / 2.55)}%` : "—");
  const pw = look && look.power, onBle = c.path === "BLE";
  const power = !pw ? "—" : pw.usb ? (pw.pct < 0 ? "USB" : pw.charging ? `USB · charging, ${pw.pct}%` : "USB · battery full") : `Battery · ${pw.pct}%`;
  el.innerHTML = `
    <div class="book"><h2>Connection</h2>
      <label class="field"><span>Port</span><select id="d-port">${ports.map((p) => `<option value="${esc(p.path)}" ${p.path === c.path ? "selected" : ""}>${esc(p.label)}${p.ch340 ? " (CH340)" : ""}</option>`).join("") || "<option value=''>No serial ports</option>"}</select></label>
      <div class="row"><button class="primary" id="d-detect">${ico("search")} Find keypad</button><button id="d-connect">${ico("plug")} Connect to port</button><button class="ghost" id="d-disc" ${dis}>${ico("unplug")} Disconnect</button></div>
      <label class="check"><input type="checkbox" id="d-auto" ${state.settings.auto_connect ? "checked" : ""}> Connect automatically, over USB or Bluetooth</label>
      <dl class="kv"><dt>Link</dt><dd>${c.connected ? (onBle ? "Bluetooth" : `USB · ${esc(c.path)}`) : "—"}</dd><dt>Power</dt><dd>${power}</dd><dt>Firmware</dt><dd>${esc(st.ver || "—")}</dd><dt>Active profile</dt><dd>${esc(c.activeSlot || "—")} · page ${esc(c.page || "—")}</dd>
        <dt>Bluetooth</dt><dd>${+st.ble > 0 ? "host connected" : c.connected ? "advertising" : "—"}</dd><dt>Touch</dt><dd>${st.cal === "1" ? "calibrated" : c.connected ? "not calibrated" : "—"}</dd>
        <dt>Storage</dt><dd>${fs ? `${Math.round(fs.used / 1024)} KB of ${Math.round(fs.total / 1024)} KB` : "—"}</dd></dl>
      <div class="row"><button id="d-refresh" ${dis}>${ico("refresh-cw")} Refresh</button><button id="d-cal" ${dis}>${ico("crosshair")} Calibrate touch</button></div></div>
    <div class="book"><h2>Screen and light</h2>
      <div class="field"><span>Theme${c.connected ? "" : " · preview only while offline"}</span><div class="themes" role="group" aria-label="Theme">${THEMES.map(([id, title]) => `<button data-theme-set="${id}" aria-pressed="${state.theme === id}"><span class="dev chip" data-theme="${id}"><span class="key" style="--t:#4f8cff"></span></span>${title}</button>`).join("")}</div></div>
      <label class="field"><span>Screen brightness · ${pct(look && look.brightness)}</span><input type="range" id="d-bright" min="13" max="255" value="${look ? look.brightness : 200}" ${dis}></label>
      <div class="field"><span>Status LED</span><div class="seg" role="group" aria-label="LED pattern">${LED_PATTERNS.map((p) => `<button data-led="${p}" aria-pressed="${!!look && look.led === p}" ${dis}>${p[0].toUpperCase() + p.slice(1)}</button>`).join("")}</div></div>
      <div class="field"><span>LED colour · solid and breathe</span><div class="swatches">${TINTS.map((t) => `<button style="background:${rgb(t)}" data-ledc="${t.join(" ")}" aria-pressed="${!!look && look.ledColor === t.join(" ")}" aria-label="LED colour ${t.join(",")}" ${dis}></button>`).join("")}</div></div>
      <label class="field"><span>LED brightness · ${pct(look && look.ledBright)}</span><input type="range" id="d-ledb" min="0" max="255" value="${look ? look.ledBright : 153}" ${dis}></label>
      <label class="check"><input type="checkbox" id="d-click" ${look && look.click ? "checked" : ""} ${dis}> Key click</label>
      <label class="field"><span>On battery, sleep after</span><select id="d-sleep" ${dis}>${[[1, "1 minute"], [2, "2 minutes"], [5, "5 minutes"], [10, "10 minutes"], [15, "15 minutes"], [30, "30 minutes"], [0, "Never"]].map(([m, t]) => `<option value="${m}" ${pw && pw.sleep === m ? "selected" : ""}>${t}</option>`).join("")}</select></label>
      <p class="hint">On battery the screen dims after 20 seconds and turns off after a minute; a touch wakes it. Asleep, the keypad wakes on a touch and reconnects. On USB it stays at full power.</p></div>
    <div class="book"><h2>Bluetooth hosts</h2>
      ${ble.slots.length ? `<table><thead><tr><th>Host</th><th>State</th><th></th></tr></thead><tbody>${ble.slots.map((b) => `<tr><td>${esc(b.name)}</td><td>${b.state === "connected" ? `<span class="pill ok">connected</span>` : "paired"}</td><td><span class="row" style="flex-wrap:nowrap; justify-content:flex-end">${b.state !== "connected" ? `<button data-use="${b.slot}">Use</button>` : ""}<button class="danger" data-forget="${b.slot}">${ico("trash-2")} Forget</button></span></td></tr>`).join("")}</tbody></table>`
        : `<p class="hint">${c.connected ? "No host paired yet." : "Connect the keypad to see its hosts."}</p>`}
      <div class="row"><button id="d-pair" ${dis}>${ico("link")} Pair a new host</button></div>
      <p class="hint">Pairing shows a six-digit code on the keypad; type it on the computer. The keypad remembers three hosts. Forgetting removes the bond on the keypad; remove it on the computer too.</p></div>
    <div class="book"><h2>Firmware</h2>
      <p>${esc(flash.note)}</p>${onBle ? `<p class="hint">Connected over Bluetooth. Installing firmware needs the USB cable.</p>` : ""}
      ${flash.available ? `<div class="row"><button class="primary" id="d-flash">${ico("download")} Install firmware ${esc(flash.version || "")}</button></div><div class="prog" id="flash-prog"><i></i></div><p class="hint" id="flash-msg"></p>` : ""}</div>
    <div class="book wide"><h2>Backups</h2>
      <div class="row"><button id="b-all" ${dis}>${ico("download")} Back up all profiles</button><button id="b-import" ${dis}>${ico("folder-open")} Import JSON</button><button id="b-export">${ico("save")} Export this profile</button></div>
      <p class="hint">A backup is written before every keypad write (the last 20 per profile).</p>
      <div class="backups">${backups.slice(0, 40).map((b) => `<div class="row"><span class="hint">${b.kind} · profile ${b.slot} · ${esc(b.label)}</span><button data-restore="${esc(b.id)}" ${dis}>Open in slot ${state.slot}</button></div>`).join("") || `<p class="hint">No backups yet.</p>`}</div></div>`;
  const cmd = (s) => api.command(s).then(renderDevice);
  $("d-detect").onclick = async () => { const r = await api.connect(); cli("sys", r.ok ? `Connected to ${r.path}` : `! ${r.error}`); };
  $("d-connect").onclick = async () => { const p = $("d-port").value; if (!p) return; const r = await api.connect(p); cli("sys", r.ok ? `Connected to ${r.path}` : `! ${r.error}`); };
  $("d-disc").onclick = () => api.disconnect();
  $("d-auto").onchange = async (e) => { state.settings = await api.setSettings({ auto_connect: e.target.checked }); };
  $("d-refresh").onclick = async () => { await api.status(); renderDevice(); };
  $("d-cal").onclick = () => { api.command("calibrate"); cli("sys", "The keypad shows the calibration screen: press each cyan target with a fingernail or stylus."); };
  $("d-pair").onclick = () => api.command("ble pair");
  $("d-bright").onchange = (e) => cmd(`setbrightness ${e.target.value}`);
  $("d-ledb").onchange = (e) => cmd(`ledbright ${e.target.value}`);
  $("d-click").onchange = (e) => cmd(`click ${e.target.checked ? "on" : "off"}`);
  $("d-sleep").onchange = (e) => cmd(`power sleep ${e.target.value}`);
  el.querySelectorAll("[data-led]").forEach((b) => { b.onclick = () => cmd(`led ${b.dataset.led}`); });
  el.querySelectorAll("[data-theme-set]").forEach((b) => { b.onclick = async () => {
    state.theme = b.dataset.themeSet;
    state.settings = await api.setSettings({ preview_theme: state.theme });
    if (state.conn.connected) await api.command(`theme ${state.theme}`);
    renderDevice();
  }; });
  el.querySelectorAll("[data-ledc]").forEach((b) => { b.onclick = () => cmd(`led ${look && look.led === "breathe" ? "breathe" : "solid"} ${b.dataset.ledc}`); });
  el.querySelectorAll("[data-use]").forEach((b) => { b.onclick = () => cmd(`ble use ${b.dataset.use}`); });
  el.querySelectorAll("[data-forget]").forEach((b) => { b.onclick = async () => { if (!confirm("Forget this Bluetooth host?")) return; await api.bleForget(+b.dataset.forget); renderDevice(); }; });
  if ($("d-flash")) $("d-flash").onclick = async () => {
    if (!confirm("Install this firmware on the keypad? Profiles, pairings and calibration are kept.")) return;
    $("d-flash").disabled = true;
    const r = await api.flash();
    $("flash-msg").textContent = r.ok ? "Installed. The keypad restarts and Studio reconnects." : `Failed: ${r.error}`;
    cli("sys", r.ok ? "Firmware installed." : `! Firmware install failed: ${r.error}`);
  };
  $("b-all").onclick = async () => { const r = await api.backupAll(); cli("sys", r.ok ? `Backed up ${r.count} profiles to ${r.path}` : `! ${r.error}`); renderDevice(); };
  $("b-import").onclick = async () => { const r = await api.importProfile(); if (r && r.ok) { state.slots[state.slot] = r.profile; state.page = 0; state.sel = 0; changed(["structure"]); cli("sys", "Imported into the editor; autosave writes it to the keypad."); } else if (r) cli("sys", `! ${r.error}`); };
  $("b-export").onclick = async () => { const r = await api.exportProfile(prof()); if (r && r.ok) cli("sys", `Exported to ${r.path}`); };
  el.querySelectorAll("[data-restore]").forEach((b) => { b.onclick = async () => {
    const r = await api.backupRead(b.dataset.restore);
    if (!r.ok) { cli("sys", `! ${r.error}`); return; }
    if (!confirm(`Replace profile ${state.slot} with this backup? The current version is backed up first.`)) return;
    state.slots[state.slot] = r.profile; state.page = 0; state.sel = 0; changed(["structure"]); showView("editor");
  }; });
}

/* ---- Settings page ---- */
async function renderSettings() {
  const el = $("settings-pane"), s = state.settings = await api.getSettings();
  const [br, contexts] = await Promise.all([api.bridgeState(prof()), api.contexts()]);
  const failed = new Set(br.failed.map((f) => f.slot));
  const ctxRows = contexts.map((c) => `<tr><td>${esc(c)}</td><td><select data-ctx="${esc(c)}" aria-label="Profile for ${esc(c)}"><option value="">—</option>${Array.from({ length: NUM_PROFILES }, (_, i) => `<option value="${i + 1}" ${s.context_profiles[c] === i + 1 ? "selected" : ""}>${i + 1} · ${esc(state.slots[i + 1].profile_name)}</option>`).join("")}</select></td></tr>`).join("");
  el.innerHTML = `
    <div class="book wide"><h2>Host bridge</h2>
      <p class="hint">A <b>Host Action</b> key sends a reserved F13–F24 combo over Bluetooth; Studio catches it and runs the command. Commands: <code>open &lt;url, file or app&gt;</code>, <code>run &lt;command line&gt;</code>, <code>obs.scene &lt;scene&gt;</code>. Studio must be running (it stays in the tray).</p>
      ${Object.keys(br.slots).length ? `<table><thead><tr><th>Slot</th><th>Combo</th><th>Command</th><th>Status</th><th></th></tr></thead><tbody>${br.combos.map((c) => `<tr><td>${c.slot}</td><td><code>${esc(c.label)}</code></td><td><code>${esc(br.slots[c.slot])}</code></td><td>${failed.has(c.slot) ? `<span class="pill warn">taken by another app</span>` : `<span class="pill ok">listening</span>`}</td><td><button data-test="${esc(br.slots[c.slot])}">Test</button></td></tr>`).join("")}</tbody></table>`
        : `<p class="hint">No host actions saved yet.</p>`}
      ${br.conflicts.length ? `<p><b>Conflicts in this profile:</b></p><ul class="errors">${br.conflicts.map((x) => `<li>${esc(x.where)} sends ${esc(x.label)}, which is reserved for host actions</li>`).join("")}</ul>` : ""}
    </div>
    <div class="book"><h2>Media player</h2>
      <label class="check"><input type="checkbox" data-set="nowplaying_enabled" ${s.nowplaying_enabled ? "checked" : ""}> Send what's playing on this PC to the keypad's player page</label>
      <label class="check"><input type="checkbox" data-set="art_enabled" ${s.art_enabled !== false ? "checked" : ""}> Include album art</label>
      <p class="hint">Uses the Windows media session: Spotify, browsers and most players publish to it. Seeking on the keypad moves the track here.</p></div>
    <div class="book"><h2>OBS</h2>
      <label class="check"><input type="checkbox" data-set="obs_enabled" ${s.obs_enabled ? "checked" : ""}> Switch OBS scenes (OBS WebSocket v5)</label>
      <label class="field"><span>WebSocket URL</span><input data-set="obs_url" value="${esc(s.obs_url)}"></label>
      <label class="field"><span>Password</span><input type="password" data-set="obs_password" value="${esc(s.obs_password)}"></label></div>
    <div class="book"><h2>Keypad link</h2>
      <label class="check"><input type="checkbox" data-set="settime_enabled" ${s.settime_enabled ? "checked" : ""}> Set the keypad clock on connect</label>
      <label class="check"><input type="checkbox" data-set="auto_connect" ${s.auto_connect ? "checked" : ""}> Connect automatically</label>
      <label class="field"><span>Baud rate</span><select data-set="baud">${[921600, 460800, 115200].map((b) => `<option ${s.baud === b ? "selected" : ""}>${b}</option>`).join("")}</select></label></div>
    <div class="book"><h2>About</h2>
      <dl class="kv"><dt>Macropad Studio</dt><dd>${esc(state.conn.appVersion || "—")}</dd><dt>Keypad firmware</dt><dd>${esc((state.conn.status && state.conn.status.ver) || "not connected")}</dd><dt>Firmware Studio installs</dt><dd>${esc((await api.flashInfo()).version || "—")}</dd></dl>
      <p class="hint">Keys work as a Bluetooth keyboard with nothing installed; Studio adds editing, host actions, the media player feed and firmware installs. Docs: README.md, docs/PROTOCOL.md, firmware/DESIGN.md.</p></div>
    <div class="book"><h2>Switch profile by app</h2>
      <label class="check"><input type="checkbox" data-set="auto_switch_enabled" ${s.auto_switch_enabled ? "checked" : ""}> When the focused app changes, switch the keypad's profile</label>
      <table><thead><tr><th>App</th><th>Profile</th></tr></thead><tbody>${ctxRows}</tbody></table></div>`;
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
const playerShown = () => state.view === "editor" && isPlayerPage(pg());
api.onEvent(({ type, data }) => {
  switch (type) {
    case "tx": cli("cli", `macropad:$ ${data}`); break;
    case "rx":
      cli(data.startsWith("EVT:") ? "ev" : "sys", data);
      if (/^EVT:(CAL (saved|done|cancel|start)|UI )/.test(data)) { clearTimeout(state.stTimer); state.stTimer = setTimeout(() => api.status(), 300); }
      break;
    case "log": cli(/^host:/.test(data) ? "host" : "sys", String(data).replace(/\n$/, "")); break;
    case "state": {
      const was = state.conn.connected;
      state.conn = { ...state.conn, ...data };
      renderTop();
      if (state.view === "editor") { renderNotices(); if (was !== !!data.connected) renderStudio(); }
      if (!was && data.connected) loadSlot(data.activeSlot || state.slot).then(async () => {
        state.slot = data.activeSlot || state.slot;
        const look = await api.lookState();
        if (look && look.theme) state.theme = look.theme;
        renderStudio();
        peekSlots();
      });
      if (!data.connected) setSave("off", "Offline · edits are backed up on this PC");
      if (state.view === "device") { clearTimeout(state.devTimer); state.devTimer = setTimeout(renderDevice, 400); }
      break;
    }
    case "save-state": {
      if (data.slot !== state.slot) break;
      const m = { pending: ["busy", "Saving…"], saving: ["busy", "Writing to the keypad…"], saved: ["", "Saved to the keypad"], offline: ["off", "Backed up on PC · offline"], error: ["err", "Not saved"] }[data.state];
      if (m) setSave(...m);
      if (data.state === "saved" && state.empty[data.slot]) { state.empty[data.slot] = false; renderTop(); }
      $("st-errors").innerHTML = data.state === "error" ? (data.errors || []).map((x) => `<li>${esc(x)}</li>`).join("") : "";
      break;
    }
    case "key": {
      if (state.conn.activeSlot !== state.slot || data.page !== state.page + 1) break;
      const cell = stScreen.querySelector(`.cell[data-k="${data.id - 1}"]`);
      if (cell) { cell.classList.add("live"); if (data.state !== "1") setTimeout(() => cell.classList.remove("live"), data.state === "0" ? 60 : 400); }
      break;
    }
    case "profile": state.conn.activeSlot = data; renderTop(); break;
    case "page": state.conn.page = data; break;
    case "nowplaying": state.np = data; if (playerShown()) renderStudio(true); break;
    case "art": state.art = data; if (playerShown()) renderStudio(true); break;
    case "context": if (data.slot) cli("sys", `Focused app → ${data.context}: profile ${data.slot}`); break;
    case "bridge": if (data.failed && data.failed.length) cli("host", `! ${data.failed.length} host combo(s) are taken by another app: ${data.failed.map((f) => f.label).join(", ")}`); break;
    case "flash": { const p = $("flash-prog"), m = $("flash-msg"); if (p) p.firstElementChild.style.width = `${data.pct || 0}%`; if (m && data.msg) m.textContent = data.msg; break; }
  }
});

/* ============ boot ============ */
(async () => {
  state.settings = await api.getSettings();
  state.theme = state.settings.preview_theme || "daylight";
  api.flashInfo().then((f) => { state.fwBundled = f.available ? f.version : null; renderNotices(); });
  $("console-box").open = !!state.settings.console_open;
  hist.base[state.slot] = JSON.stringify(prof());
  state.conn = { ...state.conn, ...(await api.state()) };
  if (!state.conn.connected) setSave("off", state.conn.noSerial ? "Serial disabled" : "Offline · edits are backed up on this PC");
  renderStudio();
  if (state.conn.view) showView(state.conn.view);
  if (state.conn.connected) {
    await loadSlot(state.conn.activeSlot || 1);
    const look = await api.lookState();
    if (look && look.theme) { state.theme = look.theme; renderStudio(); }
    peekSlots();
  }
  // Self-check for the smoke test: the shared icon map loaded and the preview drew the screen.
  let undoOk = null;
  if (state.conn.smoke) {   // smoke only: an edit, undone, leaves the profile byte-identical; redo brings it back
    const before = JSON.stringify(prof());
    prof().profile_name += " (edit)"; changed(["structure"]);
    const edited = JSON.stringify(prof());
    restore(hist.undo, hist.redo);
    const undone = JSON.stringify(prof()) === before;
    restore(hist.redo, hist.undo);
    undoOk = undone && JSON.stringify(prof()) === edited;
  }
  api.ready({ undo: undoOk, icons: ICON_NAMES.length, screen: !!document.querySelector("#st-screen .dev"), missing: ACTION_META ? Object.values(ACTION_META).map((m) => m.icon).filter((n) => !window.KEY_ICONS?.[n]) : [] });
})();
