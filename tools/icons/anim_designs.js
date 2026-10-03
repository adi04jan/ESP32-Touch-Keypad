/* The signature animation of every key icon, for build_anims.js.
 *
 * Motion thesis: a key's icon acts out its key. Copy pulls a second sheet out of the first,
 * wifi lights its arcs from the dot outward, a bell rings, a check draws itself. The keypad plays
 * the animation when the key fires (feedback that names the action) and, while idle, lets one
 * key at a time perform, so the grid feels alive without fifteen things moving at once.
 * Every animation starts and ends on the resting icon. Moves stop on an expo ease-out; only
 * things with mass (bells, lids, pins) overshoot.
 *
 * A design is { ms, tracks, extra }. A track moves elements (indices into the icon's SVG
 * elements, in Lucide's order, or "*") through keys [t, props, ease], t in 0..1 of ms; props are
 * x, y (24-unit space), r (degrees), s, sx, sy (scale), o (opacity), d (stroke drawn, 0..1); p is
 * the pivot ("c" centre, "t", "b", "l", "r", corners "tl".., "i" the icon centre, or [x, y]).
 * `extra` adds elements after the icon's own; they must be hidden (o 0 or d 0) at both ends. */
"use strict";

// ---------------------------------------------------------------- vocabulary
const tr = (el, keys, opt = {}) => ({ el, keys, ...opt });
const lerp = (a, b, u) => a + (b - a) * u;

// Retract the stroke, then draw it again (a pen retracing it). rev draws from the path's end.
const draw = (el, t0 = 0.05, t1 = 0.75, rev = false) =>
  tr(el, [[t0, { d: 1 }], [lerp(t0, t1, 0.3), { d: 0 }, "in"], [t1, { d: 1 }, "out"]], { rev });
// Hidden early, then drawn from t0 to t1: for sequences that build up.
const build = (el, t0, t1, rev = false, hide = 0.04) =>
  tr(el, [[0, { d: 1 }], [hide, { d: 0 }, "in"], [t0, { d: 0 }], [t1, { d: 1 }, "out"]], { rev });
// Out along (dx, dy) fading, back in from the opposite side: a thing that leaves and returns.
const through = (el, dx, dy, t0 = 0.08, t1 = 0.85, mid = 0.45) => tr(el, [
  [t0, { x: 0, y: 0, o: 1 }],
  [lerp(t0, t1, mid), { x: dx, y: dy, o: 0 }, "in"],
  [lerp(t0, t1, mid) + 0.001, { x: -dx * 0.8, y: -dy * 0.8 }, "step"],
  [t1, { x: 0, y: 0, o: 1 }, "out"],
]);
// To an offset and back.
const nudge = (el, props, t0 = 0.1, tm = 0.35, t1 = 0.8, back = "out", p) => {
  const zero = {};
  for (const k of Object.keys(props)) zero[k] = k === "s" || k === "sx" || k === "sy" || k === "o" ? 1 : 0;
  return tr(el, [[t0, zero], [tm, props, "out"], [t1, zero, back]], p ? { p } : {});
};
// A wave of one prop: amp * sin, n cycles from t0 to t1, dying away (decay) or swelling and
// fading (not), sampled into linear keys.
const osc = (el, prop, amp, t0, t1, n = 3, { p, decay = true, phase = 0 } = {}) => {
  const keys = [], N = Math.max(12, Math.round(n * 10)), b0 = prop === "s" || prop === "sx" || prop === "sy" ? 1 : 0;
  for (let k = 0; k <= N; k++) {
    const u = k / N, env = decay ? Math.pow(1 - u, 1.6) : Math.sin(Math.PI * u);
    keys.push([lerp(t0, t1, u), { [prop]: b0 + amp * env * Math.sin(2 * Math.PI * (n * u + phase)) }, "lin"]);
  }
  keys[0][1][prop] = b0;
  keys[N][1][prop] = b0;
  return tr(el, keys, p ? { p } : {});
};
// Swing about a pivot, like a bell or a sign: a damped oscillation of r.
const swing = (el, deg, p, t0 = 0.05, t1 = 0.95, n = 3) => osc(el, "r", deg, t0, t1, n, { p });
// Turn by deg (a symmetry of the shape, so the end matches the rest).
const spin = (el, deg, p = "c", t0 = 0.05, t1 = 0.85, ease = "io") => tr(el, [[t0, { r: 0 }], [t1, { r: deg }, ease]], { p });
// Shrink away, then spring back: something new arriving.
const pop = (el, t0 = 0.1, t1 = 0.6, p) => tr(el, [[t0, { s: 1, o: 1 }], [lerp(t0, t1, 0.3), { s: 0.2, o: 0 }, "in"], [t1, { s: 1, o: 1 }, "back"]], p ? { p } : {});
// Hidden early, popping in at t0.
const appear = (el, t0, t1 = t0 + 0.2, p, hide = 0.04) =>
  tr(el, [[0, { s: 1, o: 1 }], [hide, { s: 0.3, o: 0 }, "in"], [t0, { s: 0.3, o: 0 }], [t1, { s: 1, o: 1 }, "back"]], p ? { p } : {});
// A double beat.
const beat = (el, amp = 0.16, t0 = 0.05, t1 = 0.7, p) => tr(el, [
  [t0, { s: 1 }], [lerp(t0, t1, 0.18), { s: 1 + amp }, "out"], [lerp(t0, t1, 0.36), { s: 1 - amp * 0.2 }, "io"],
  [lerp(t0, t1, 0.54), { s: 1 + amp * 0.7 }, "out"], [t1, { s: 1 }, "out"]], p ? { p } : {});
// Opacity flicker: on, off ... n times.
const blink = (el, t0, t1, n = 2, low = 0) => {
  const keys = [[t0, { o: 1 }]];
  for (let k = 0; k < n; k++)
    keys.push([lerp(t0, t1, (k + 0.5) / n), { o: low }, "step"], [lerp(t0, t1, (k + 1) / n), { o: 1 }, "step"]);
  return tr(el, keys);
};
// An element shown only between t0 and t1 (extras): fades in, holds, fades out.
const show = (el, t0, t1, fade = 0.08) => tr(el, [[0, { o: 0 }], [t0, { o: 0 }], [t0 + fade, { o: 1 }, "out"], [t1 - fade, { o: 1 }], [t1, { o: 0 }, "in"]]);
// A press: the whole icon dips and springs back.
const press = (t0 = 0.02, t1 = 0.4, amt = 0.86) => nudge("*", { s: amt }, t0, lerp(t0, t1, 0.35), t1, "back");
// Waves from a source: elements hidden, then each group grows in from pivot p at its time.
const waves = (groups, p, t0, step, hide = 0.06) => groups.map((g, k) =>
  tr(g, [[0, { o: 1, s: 1 }], [hide, { o: 0, s: 0.65 }, "in"], [t0 + k * step, { o: 0, s: 0.65 }], [t0 + k * step + 0.2, { o: 1, s: 1 }, "out"]], { p }));
// Typing dots in a speech bubble (extras 1..3 at y).
const typing = (y) => ({ ms: 1600, extra: [8, 12, 16].map((x) => `<path d="M${x} ${y}h.01"/>`),
  tracks: [1, 2, 3].map((e, k) => tr(e, [[0, { o: 0, s: 0.3, y: 0 }], [0.08 + k * 0.1, { o: 0, s: 0.3 }], [0.22 + k * 0.1, { o: 1, s: 1 }, "back"],
    [0.4 + k * 0.1, { y: -1.2 }, "out"], [0.55 + k * 0.1, { y: 0 }, "in"], [0.78, { o: 1 }], [0.92, { o: 0 }, "in"]])) });
const dance = { ms: 1400, tracks: [tr("*", [[0.05, { y: 0, r: 0 }], [0.2, { y: -1.8, r: -8 }, "out"], [0.35, { y: 0, r: 0 }, "in"], [0.5, { y: -1.8, r: 8 }, "out"],
  [0.65, { y: 0, r: 0 }, "in"], [0.8, { y: -0.6 }, "out"], [0.9, { y: 0 }, "in"]], { p: "b" })] };
// Corners of a frame moving in (dir -1) or out (1), and settling back.
const corners = (dir) => ({ ms: 1200, tracks: [[0, -1, -1], [1, 1, -1], [2, -1, 1], [3, 1, 1]].map(([e, sx, sy]) =>
  tr(e, [[0.05, { x: 0, y: 0 }], [0.3, { x: dir * sx * 2, y: dir * sy * 2 }, "out"], [0.75, { x: 0, y: 0 }, "back"]])) });

// ---------------------------------------------------------------- designs
const D = {
  "airplay": { ms: 1300, tracks: [through(1, 0, 5, 0.05, 0.85, 0.4), nudge(0, { s: 1.05 }, 0.55, 0.7, 0.95)] },
  "alarm-clock": { ms: 1700, tracks: [spin(1, 360, [12, 13], 0.02, 0.4), osc("*", "r", 10, 0.4, 1, 6, { p: [12, 13] }),
    osc(2, "y", -1.2, 0.4, 1, 6), osc(3, "y", -1.2, 0.4, 1, 6, { phase: 0.5 })] },
  "app-window": { ms: 1200, tracks: [press(0.02, 0.5, 0.8), build(2, 0.35, 0.7), appear(3, 0.55, 0.75), appear(1, 0.65, 0.85)] },
  "arrow-down": { ms: 1100, tracks: [through("*", 0, 9)] },
  "arrow-left": { ms: 1100, tracks: [through("*", -9, 0)] },
  "arrow-right": { ms: 1100, tracks: [through("*", 9, 0)] },
  "arrow-up": { ms: 1100, tracks: [through("*", 0, -9)] },
  "at-sign": { ms: 1400, tracks: [draw(1, 0.05, 0.8), pop(0, 0.5, 0.95)] },
  "audio-lines": { ms: 1500, tracks: [0, 1, 2, 3, 4, 5].map((e, k) => osc(e, "sy", 0.55, 0.02, 0.98, 2.5, { decay: false, phase: k * 0.17 })) },
  "audio-waveform": { ms: 1400, tracks: [draw(0, 0.02, 0.85)] },
  "battery-full": { ms: 1500, tracks: [...[[3, 0], [0, 1], [1, 2]].map(([e, k]) => tr(e, [[0, { o: 1, sy: 1 }], [0.1, { o: 0, sy: 0.2 }, "in"],
    [0.3 + k * 0.17, { o: 0, sy: 0.2 }], [0.45 + k * 0.17, { o: 1, sy: 1 }, "back"]])), blink(2, 0.85, 0.98, 1, 0.2)] },
  "beer": { ms: 1500, tracks: [tr("*", [[0.05, { r: 0 }], [0.35, { r: -16 }, "out"], [0.75, { r: 0 }, "back"]], { p: [11, 22] }), osc(3, "y", -1.3, 0.3, 0.95, 3)] },
  "bell": { ms: 1600, tracks: [swing("*", 16, [12, 2.5], 0.02, 0.98, 3.5), osc(0, "x", 1.4, 0.06, 0.98, 3.5, { phase: -0.12 })] },
  "bell-off": { ms: 1400, tracks: [swing([0, 1, 3], 7, [12, 3], 0.02, 0.6, 2.5), draw(2, 0.4, 0.95)] },
  "bluetooth": { ms: 1400, tracks: [draw(0, 0.02, 0.85)] },
  "bold": { ms: 1100, tracks: [tr(0, [[0.05, { sx: 1, sy: 1 }], [0.35, { sx: 1.22, sy: 0.92 }, "out"], [0.8, { sx: 1, sy: 1 }, "back"]])] },
  "bookmark": { ms: 1200, tracks: [tr(0, [[0.05, { y: 0, sy: 1 }], [0.3, { y: -3.5, sy: 1.05 }, "out"], [0.5, { y: 0, sy: 1 }, "in"], [0.6, { sy: 0.9 }, "out"], [0.85, { sy: 1 }, "back"]], { p: "b" })] },
  "braces": { ms: 1200, tracks: [nudge(0, { x: -2.5 }, 0.05, 0.35, 0.8, "back"), nudge(1, { x: 2.5 }, 0.05, 0.35, 0.8, "back")] },
  "bug": { ms: 1400, tracks: [osc("*", "x", 0.9, 0.02, 0.98, 4, { decay: false }), osc([3, 4, 5], "r", 16, 0.02, 0.98, 5, { p: "l", decay: false }),
    osc([6, 7, 8], "r", 16, 0.02, 0.98, 5, { p: "r", decay: false, phase: 0.5 }), osc(2, "r", 14, 0.02, 0.98, 3, { p: "bl" }), osc(9, "r", -14, 0.02, 0.98, 3, { p: "br" })] },
  "cake": { ms: 1600, tracks: [appear(6, 0.15), appear(7, 0.28), appear(8, 0.41), osc([6, 7, 8], "y", -0.7, 0.55, 1, 3)] },
  "calendar": { ms: 1500, tracks: [osc(0, "y", -1.4, 0.02, 0.5, 2), osc(1, "y", -1.4, 0.06, 0.54, 2), build(4, 0.3, 0.6), show(4, 0.25, 1, 0.12)],
    extra: ['<path d="m8.5 15 2.5 2.5 4.5-4.5"/>'] },
  "camera": { ms: 1200, tracks: [press(0.02, 0.5, 0.92), tr(1, [[0.05, { s: 1 }], [0.25, { s: 0.25 }, "in"], [0.6, { s: 1 }, "back"]]),
    show(2, 0.22, 0.55, 0.05), show(3, 0.22, 0.55, 0.05)], extra: ['<path d="M19 1.5v2"/>', '<path d="M21.8 3 20.3 4.2"/>'] },
  "car": { ms: 1400, tracks: [through("*", 11, 0, 0.1, 0.9, 0.45), osc(0, "y", -0.5, 0.02, 0.98, 5, { decay: false })] },
  "cast": { ms: 1500, tracks: [pop(3, 0.05, 0.3), build(2, 0.25, 0.5), build(1, 0.42, 0.72)] },
  "check": { ms: 1100, tracks: [draw(0, 0.02, 0.7), nudge(0, { s: 1.12 }, 0.6, 0.75, 0.95)] },
  "chevron-left": { ms: 1000, tracks: [through(0, -7, 0)] },
  "chevron-right": { ms: 1000, tracks: [through(0, 7, 0)] },
  "chevrons-left": { ms: 1100, tracks: [through(0, -7, 0, 0.05, 0.8), through(1, -7, 0, 0.15, 0.9)] },
  "chevrons-right": { ms: 1100, tracks: [through(1, 7, 0, 0.05, 0.8), through(0, 7, 0, 0.15, 0.9)] },
  "circle": { ms: 1300, tracks: [press(0.02, 0.45, 0.85), tr(1, [[0, { s: 1, o: 0 }], [0.25, { s: 1, o: 0 }], [0.3, { o: 0.9 }], [0.9, { s: 2.4, o: 0 }, "out"]])],
    extra: ['<circle cx="12" cy="12" r="4"/>'] },
  "circle-dot": { ms: 1200, tracks: [tr(0, [[0.05, { s: 1 }], [0.2, { s: 0.2 }, "in"], [0.55, { s: 2.6 }, "out"], [0.85, { s: 1 }, "io"]]), nudge(1, { s: 0.92 }, 0.15, 0.3, 0.7, "back")] },
  "clapperboard": { ms: 1200, tracks: [tr([0, 1, 3], [[0.05, { r: 0 }], [0.35, { r: -20 }, "out"], [0.5, { r: 0 }, "in"], [0.62, { r: -4 }, "out"], [0.75, { r: 0 }, "in"]], { p: [3, 11] }),
    nudge("*", { y: 0.7 }, 0.48, 0.53, 0.7)] },
  "clipboard": { ms: 1100, tracks: [tr(0, [[0.05, { y: 0 }], [0.3, { y: -2.5 }, "out"], [0.45, { y: 0 }, "in"]]), nudge(1, { sy: 0.94 }, 0.43, 0.5, 0.8, "back", "b")] },
  "clipboard-paste": { ms: 1200, tracks: [through([0, 2], 6, 0, 0.05, 0.85), nudge(4, { y: -1.5 }, 0.05, 0.25, 0.5, "back")] },
  "clock": { ms: 1500, tracks: [spin(1, 360, [12, 12], 0.05, 0.9)] },
  "cloud": { ms: 1800, tracks: [tr(0, [[0.02, { x: 0 }], [0.35, { x: 2.2 }, "io"], [0.7, { x: -1.2 }, "io"], [0.98, { x: 0 }, "io"]]), osc(0, "sy", 0.05, 0.02, 0.98, 2, { decay: false, p: "b" })] },
  "cloud-upload": { ms: 1200, tracks: [through([0, 2], 0, -7, 0.05, 0.85)] },
  "code": { ms: 1100, tracks: [nudge(0, { x: 2.2 }, 0.05, 0.35, 0.8, "back"), nudge(1, { x: -2.2 }, 0.05, 0.35, 0.8, "back")] },
  "code-xml": { ms: 1300, tracks: [nudge(0, { x: 2 }, 0.05, 0.35, 0.8, "back"), nudge(1, { x: -2 }, 0.05, 0.35, 0.8, "back"), draw(2, 0.2, 0.85)] },
  "coffee": { ms: 1800, tracks: [[3, 0], [0, 0.12], [1, 0.24]].map(([e, d]) => tr(e, [
    [0.02 + d, { y: 0, o: 1 }], [0.32 + d, { y: -2.5, o: 0 }, "in"], [0.33 + d, { y: 2 }, "step"], [0.6 + d, { y: 0, o: 1 }, "out"]])) },
  "copy": { ms: 1400, tracks: [tr(0, [[0.04, { x: 0, y: 0 }], [0.32, { x: -6, y: -6 }, "io"], [0.42, { x: -6, y: -6 }], [0.85, { x: 0, y: 0 }, "back"]])] },
  "cpu": { ms: 1500, tracks: [...[11, 1, 3, 9, 7, 8, 2, 0, 10, 5, 4, 6].map((e, k) => tr(e, [[0.02 + k * 0.05, { o: 1 }], [0.05 + k * 0.05, { o: 0.1 }, "lin"], [0.3 + k * 0.05, { o: 1 }, "out"]])),
    osc(13, "s", 0.12, 0.2, 0.95, 2)] },
  "crosshair": { ms: 1400, tracks: [spin("*", 90, "i", 0.02, 0.55), nudge(1, { x: -2.2 }, 0.5, 0.65, 0.95, "back"), nudge(2, { x: 2.2 }, 0.5, 0.65, 0.95, "back"),
    nudge(3, { y: 2.2 }, 0.5, 0.65, 0.95, "back"), nudge(4, { y: -2.2 }, 0.5, 0.65, 0.95, "back")] },
  "database": { ms: 1300, tracks: [nudge(0, { y: -2.5 }, 0.05, 0.3, 0.7, "back"), nudge(2, { y: -1.2 }, 0.12, 0.38, 0.78, "back")] },
  "disc-3": { ms: 1500, tracks: [spin([1, 3], 360, [12, 12], 0.02, 0.95)] },
  "download": { ms: 1300, tracks: [through([0, 2], 0, 7, 0.05, 0.85, 0.4), nudge(1, { sy: 0.8 }, 0.3, 0.42, 0.75, "back", "b")] },
  "droplet": { ms: 1300, tracks: [tr(0, [[0.05, { sx: 1, sy: 1, y: 0 }], [0.28, { sx: 0.88, sy: 1.12, y: -1.2 }, "out"], [0.45, { sx: 1.14, sy: 0.84, y: 0 }, "in"], [0.8, { sx: 1, sy: 1 }, "back"]], { p: "b" })] },
  "dumbbell": { ms: 1300, tracks: [tr("*", [[0.05, { y: 0, r: 0 }], [0.35, { y: -3.5, r: -10 }, "out"], [0.6, { y: 0, r: 0 }, "in"], [0.72, { y: -0.8 }, "out"], [0.84, { y: 0 }, "in"]], { p: "i" })] },
  "external-link": { ms: 1200, tracks: [through([0, 1], 5, -5, 0.05, 0.85)] },
  "eye": { ms: 1600, tracks: [tr("*", [[0.08, { sy: 1 }], [0.18, { sy: 0.1 }, "in"], [0.3, { sy: 1 }, "out"]], { p: "i" }),
    tr(1, [[0.38, { x: 0 }], [0.55, { x: -2.6 }, "io"], [0.72, { x: 2.6 }, "io"], [0.9, { x: 0 }, "io"]])] },
  "eye-off": { ms: 1300, tracks: [tr([0, 1, 2], [[0.05, { sy: 1 }], [0.15, { sy: 0.2 }, "in"], [0.28, { sy: 1 }, "out"]], { p: "i" }), draw(3, 0.3, 0.9)] },
  "fast-forward": { ms: 1100, tracks: [through(0, 7, 0, 0.05, 0.8), through(1, 7, 0, 0.13, 0.88)] },
  "file": { ms: 1200, tracks: [tr(1, [[0.05, { s: 1 }], [0.25, { s: 0.15 }, "in"], [0.7, { s: 1 }, "back"]], { p: "tr" }), nudge(0, { y: -1.2 }, 0.05, 0.3, 0.7)] },
  "file-code": { ms: 1300, tracks: [nudge(2, { x: -1.8 }, 0.05, 0.35, 0.8, "back"), nudge(3, { x: 1.8 }, 0.05, 0.35, 0.8, "back"), pop(1, 0.3, 0.8, "tr")] },
  "file-text": { ms: 1500, tracks: [build(2, 0.15, 0.35), build(3, 0.32, 0.6), build(4, 0.55, 0.85)] },
  "files": { ms: 1400, tracks: [tr([0, 1], [[0.04, { x: 0, y: 0 }], [0.32, { x: -6, y: 5 }, "io"], [0.42, { x: -6, y: 5 }], [0.85, { x: 0, y: 0 }, "back"]])] },
  "film": { ms: 1300, tracks: [through([2, 4, 6, 7], 0, 4.5, 0.05, 0.9, 0.5)] },
  "fingerprint": { ms: 1700, tracks: [0, 1, 8, 6, 2, 7, 3, 5, 4].map((e, k) => draw(e, 0.02 + k * 0.05, 0.45 + k * 0.05)) },
  "flag": { ms: 1600, tracks: [osc(0, "sx", -0.09, 0.02, 0.98, 3, { p: [4, 12], decay: false }), osc(0, "y", -0.6, 0.02, 0.98, 3, { decay: false, phase: 0.25 })] },
  "flame": { ms: 1500, tracks: [osc(0, "sy", 0.12, 0.02, 0.98, 3.5, { p: "b", decay: false }), osc(0, "sx", -0.07, 0.02, 0.98, 2.5, { p: "b", decay: false, phase: 0.3 })] },
  "folder": { ms: 1200, tracks: [tr(0, [[0.05, { sy: 1, sx: 1 }], [0.3, { sy: 0.86, sx: 1.06 }, "out"], [0.8, { sy: 1, sx: 1 }, "back"]], { p: "b" })] },
  "folder-open": { ms: 1200, tracks: [tr(0, [[0.05, { sy: 1, r: 0 }], [0.3, { sy: 0.86, r: -4 }, "out"], [0.8, { sy: 1, r: 0 }, "back"]], { p: "b" })] },
  "gamepad-2": { ms: 1300, tracks: [osc("*", "x", 0.8, 0.02, 0.6, 6), pop(2, 0.35, 0.65), pop(3, 0.5, 0.8), nudge([0, 1], { s: 0.8 }, 0.1, 0.2, 0.45)] },
  "gift": { ms: 1500, tracks: [tr([2, 3], [[0.05, { y: 0, r: 0 }], [0.35, { y: -3.5, r: -12 }, "out"], [0.75, { y: 0, r: 0 }, "back"]], { p: "l" }), nudge(1, { sy: 0.92 }, 0.7, 0.78, 0.95, "back", "b")] },
  "git-branch": { ms: 1500, tracks: [pop(2, 0.02, 0.35), draw(0, 0.1, 0.75, true), pop(1, 0.55, 0.95)] },
  "git-commit-horizontal": { ms: 1300, tracks: [pop(0, 0.02, 0.45), build(1, 0.35, 0.75, true), build(2, 0.35, 0.75)] },
  "git-merge": { ms: 1500, tracks: [pop(1, 0.02, 0.3), draw(2, 0.1, 0.7), pop(0, 0.55, 0.95)] },
  "git-pull-request": { ms: 1500, tracks: [pop(1, 0.02, 0.3), draw(2, 0.15, 0.7), pop(0, 0.55, 0.95)] },
  "globe": { ms: 1600, tracks: [tr(1, [[0.05, { sx: 1 }], [0.9, { sx: -1 }, "io"]]), nudge(2, { sx: 0.94 }, 0.3, 0.5, 0.8)] },
  "hammer": { ms: 1200, tracks: [tr("*", [[0.02, { r: 0 }], [0.32, { r: -28 }, "out"], [0.45, { r: 8 }, "in"], [0.72, { r: 0 }, "back"]], { p: [3.5, 20.5] })] },
  "hard-drive": { ms: 1300, tracks: [blink(3, 0.05, 0.75, 3), blink(0, 0.15, 0.85, 3)] },
  "headphones": { ms: 1400, tracks: [beat(0, 0.1, 0.05, 0.6), osc(0, "sx", 0.06, 0.55, 0.98, 2)] },
  "heart": { ms: 1300, tracks: [beat(0, 0.18, 0.02, 0.75)] },
  "highlighter": { ms: 1400, tracks: [tr("*", [[0.05, { x: 0, r: 0 }], [0.25, { x: -2.5, r: -6 }, "out"], [0.6, { x: 2.5, r: 4 }, "io"], [0.85, { x: 0, r: 0 }, "io"]], { p: "b" })] },
  "hourglass": { ms: 1500, tracks: [spin("*", 180, "i", 0.1, 0.8, "io")] },
  "house": { ms: 1400, tracks: [tr(0, [[0.05, { sx: 1 }], [0.35, { sx: 0.2 }, "io"], [0.6, { sx: 0.2 }], [0.9, { sx: 1 }, "io"]], { p: "l" })] },
  "image": { ms: 1500, tracks: [tr(1, [[0.05, { y: 0, o: 1 }], [0.3, { y: 5, o: 0 }, "in"], [0.75, { y: 0, o: 1 }, "out"]]), draw(2, 0.1, 0.65, true)] },
  "info": { ms: 1300, tracks: [tr(2, [[0.05, { y: 0 }], [0.28, { y: -4 }, "out"], [0.45, { y: 0 }, "in"], [0.58, { y: -1.4 }, "out"], [0.7, { y: 0 }, "in"]]),
    nudge(1, { sy: 0.8 }, 0.44, 0.5, 0.75, "back", "b")] },
  "italic": { ms: 1200, tracks: [nudge(0, { x: 1.8 }, 0.05, 0.35, 0.8, "back"), nudge(1, { x: -1.8 }, 0.05, 0.35, 0.8, "back"), nudge(2, { r: 12 }, 0.05, 0.35, 0.8, "back")] },
  "key-round": { ms: 1400, tracks: [tr("*", [[0.05, { r: 0 }], [0.4, { r: 40 }, "io"], [0.55, { r: 40 }], [0.9, { r: 0 }, "io"]], { p: [16.5, 7.5] })] },
  "keyboard": { ms: 1400, tracks: [...[5, 0, 2, 4, 7, 1, 3].map((e, k) => tr(e, [[0.04 + k * 0.08, { s: 1 }], [0.08 + k * 0.08, { s: 2 }, "out"], [0.2 + k * 0.08, { s: 1 }, "out"]])),
    nudge(6, { sx: 0.7 }, 0.65, 0.72, 0.95, "back")] },
  "laptop": { ms: 1300, tracks: [tr(0, [[0.05, { sy: 1 }], [0.3, { sy: 0.8 }, "out"], [0.8, { sy: 1 }, "back"]], { p: [12, 16] })] },
  "layers": { ms: 1400, tracks: [nudge(0, { y: -2.6 }, 0.05, 0.35, 0.8, "back"), nudge(1, { y: -1.1 }, 0.1, 0.4, 0.85, "back")] },
  "layout-grid": { ms: 1300, tracks: [0, 1, 2, 3].map((e, k) => tr(e, [[0.04 + k * 0.1, { s: 1, o: 1 }], [0.1 + k * 0.1, { s: 0.5, o: 0.3 }, "in"], [0.4 + k * 0.1, { s: 1, o: 1 }, "back"]])) },
  "leaf": { ms: 1600, tracks: [swing("*", 11, [2, 21], 0.02, 0.98, 2), osc(0, "s", 0.05, 0.1, 0.98, 3)] },
  "lightbulb": { ms: 1300, tracks: [tr(0, [[0.04, { o: 1 }], [0.1, { o: 0.2 }, "step"], [0.18, { o: 1 }, "step"], [0.24, { o: 0.35 }, "step"], [0.3, { o: 1 }, "step"]]), beat(0, 0.1, 0.35, 0.9)] },
  "link": { ms: 1300, tracks: [tr(0, [[0.05, { x: 0, y: 0 }], [0.35, { x: 2.2, y: -2.2 }, "out"], [0.55, { x: 0, y: 0 }, "in"]]),
    tr(1, [[0.05, { x: 0, y: 0 }], [0.35, { x: -2.2, y: 2.2 }, "out"], [0.55, { x: 0, y: 0 }, "in"]]), nudge("*", { s: 1.08 }, 0.55, 0.62, 0.85)] },
  "list": { ms: 1500, tracks: [...[0, 1, 2].map((e, k) => appear(e, 0.12 + k * 0.17, 0.3 + k * 0.17)), ...[3, 4, 5].map((e, k) => build(e, 0.18 + k * 0.17, 0.45 + k * 0.17))] },
  "list-checks": { ms: 1600, tracks: [build(4, 0.12, 0.38), build(0, 0.3, 0.52), build(1, 0.42, 0.62), build(3, 0.5, 0.76), build(2, 0.68, 0.9)] },
  "list-music": { ms: 1500, tracks: [osc([3, 4], "y", -1.6, 0.02, 0.98, 3, { decay: false }), build(0, 0.1, 0.4), build(1, 0.25, 0.55), build(2, 0.4, 0.7)] },
  "lock": { ms: 1300, tracks: [tr(1, [[0.05, { y: 0 }], [0.3, { y: -3.2 }, "out"], [0.45, { y: 0 }, "in"], [0.55, { y: -0.6 }, "out"], [0.62, { y: 0 }, "in"]]),
    nudge(0, { y: 0.8 }, 0.43, 0.48, 0.7)] },
  "lock-open": { ms: 1300, tracks: [tr(1, [[0.05, { y: 0 }], [0.25, { y: 1.6 }, "out"], [0.42, { y: -2.2 }, "out"], [0.8, { y: 0 }, "back"]]), nudge(0, { y: 0.6 }, 0.2, 0.26, 0.45)] },
  "mail": { ms: 1400, tracks: [tr(0, [[0.05, { sy: 1 }], [0.35, { sy: -0.9 }, "io"], [0.55, { sy: -0.9 }], [0.85, { sy: 1 }, "io"]], { p: "t" })] },
  "map-pin": { ms: 1300, tracks: [tr("*", [[0.05, { y: 0, sy: 1 }], [0.3, { y: -5, sy: 1.04 }, "out"], [0.5, { y: 0, sy: 1 }, "in"], [0.58, { sy: 0.86 }, "out"], [0.85, { sy: 1 }, "back"]], { p: [12, 22] })] },
  "maximize": corners(-1),
  "message-circle": typing(12),
  "message-square": typing(11),
  "mic": { ms: 1500, tracks: [tr(3, [[0, { d: 0 }], [0.12, { d: 0 }], [0.3, { d: 1 }, "out"], [0.42, { d: 0.35 }, "io"], [0.55, { d: 0.9 }, "out"], [0.68, { d: 0.5 }, "io"], [0.92, { d: 0 }, "in"]]),
    osc("*", "r", 4, 0.05, 0.95, 2, { p: [12, 22] })], extra: ['<path d="M12 12V6"/>'] },
  "mic-off": { ms: 1300, tracks: [osc([0, 1, 2, 3, 5], "x", 0.7, 0.02, 0.45, 4), draw(4, 0.3, 0.9)] },
  "mic-vocal": { ms: 1500, tracks: [swing("*", 10, [4, 20], 0.02, 0.98, 2)] },
  "minimize": corners(1),
  "minus": { ms: 1000, tracks: [tr(0, [[0.05, { sx: 1 }], [0.3, { sx: 0.35 }, "out"], [0.75, { sx: 1 }, "back"]])] },
  "monitor": { ms: 1300, tracks: [tr(0, [[0.05, { sy: 1, sx: 1 }], [0.22, { sy: 0.06, sx: 1.04 }, "in"], [0.32, { sy: 0.06, sx: 0.2 }, "in"], [0.5, { sy: 0.06, sx: 1 }, "out"], [0.8, { sy: 1 }, "out"]])] },
  "monitor-play": { ms: 1200, tracks: [tr(0, [[0.05, { s: 1, x: 0 }], [0.25, { s: 0.4 }, "in"], [0.55, { s: 1.25, x: 0.6 }, "out"], [0.85, { s: 1, x: 0 }, "io"]])] },
  "moon": { ms: 1600, tracks: [swing(0, 12, "c", 0.02, 0.98, 2), tr(1, [[0, { o: 0, s: 0.2, r: 0 }], [0.25, { o: 0, s: 0.2 }], [0.45, { o: 1, s: 1, r: 45 }, "back"], [0.75, { o: 1, s: 1 }], [0.95, { o: 0, s: 0.2, r: 90 }, "in"]])],
    extra: ['<path d="M18 4v3M16.5 5.5h3"/>'] },
  "mouse": { ms: 1300, tracks: [osc(1, "y", 1.4, 0.05, 0.95, 2.5, { decay: false })] },
  "mouse-pointer-click": { ms: 1500, tracks: [tr(4, [[0.02, { x: 0, y: 0, s: 1 }], [0.2, { x: 3, y: 3 }, "out"], [0.45, { x: 0, y: 0 }, "io"], [0.52, { s: 0.85 }, "out"], [0.65, { s: 1 }, "back"]], { p: [10, 10] }),
    ...[0, 1, 2, 3].map((e) => tr(e, [[0, { o: 1, s: 1 }], [0.05, { o: 0, s: 0.3 }, "in"], [0.5, { o: 0, s: 0.3 }], [0.7, { o: 1, s: 1 }, "back"]], { p: [9, 9] }))] },
  "music": dance,
  "music-2": dance,
  "paintbrush": { ms: 1500, tracks: [swing("*", 12, [20, 4], 0.02, 0.98, 2.5)] },
  "palette": { ms: 1400, tracks: [1, 4, 3, 2].map((e, k) => tr(e, [[0.05 + k * 0.1, { s: 1 }], [0.12 + k * 0.1, { s: 0.2 }, "in"], [0.3 + k * 0.1, { s: 2.2 }, "out"], [0.5 + k * 0.1, { s: 1 }, "io"]])) },
  "pause": { ms: 1100, tracks: [nudge(1, { sy: 0.7 }, 0.05, 0.25, 0.6, "back", "b"), nudge(0, { sy: 0.7 }, 0.2, 0.4, 0.75, "back", "b")] },
  "pen-line": { ms: 1500, tracks: [tr(1, [[0.04, { x: 0, y: 0 }], [0.2, { x: -6, y: -1.5 }, "io"], [0.3, { y: 0 }, "out"], [0.85, { x: 0 }, "io"]]),
    tr(0, [[0.04, { d: 1 }], [0.18, { d: 0 }, "in"], [0.3, { d: 0 }], [0.85, { d: 1 }, "io"]])] },
  "phone": { ms: 1600, tracks: [osc(0, "r", 12, 0.02, 0.7, 6, { p: "c" }), show(1, 0.1, 0.9), show(2, 0.25, 0.9)],
    extra: ['<path d="M14 6a4.5 4.5 0 0 1 4 4"/>', '<path d="M14 2a8.5 8.5 0 0 1 8 8"/>'] },
  "phone-off": { ms: 1300, tracks: [nudge([0, 2], { r: 18 }, 0.05, 0.3, 0.7, "back", "i"), draw(1, 0.3, 0.9)] },
  "pin": { ms: 1200, tracks: [tr("*", [[0.05, { y: 0 }], [0.3, { y: -3.5 }, "out"], [0.42, { y: 0.8 }, "in"], [0.7, { y: 0 }, "back"]])] },
  "pizza": { ms: 1300, tracks: [pop(0, 0.1, 0.45), pop(1, 0.25, 0.6), nudge("*", { r: -8 }, 0.05, 0.3, 0.8, "back", "c")] },
  "plane": { ms: 1400, tracks: [through("*", 9, -9, 0.08, 0.88, 0.45)] },
  "play": { ms: 1100, tracks: [tr(0, [[0.04, { s: 1, x: 0 }], [0.2, { s: 0.8 }, "in"], [0.45, { s: 1.14, x: 1 }, "out"], [0.85, { s: 1, x: 0 }, "io"]])] },
  "plug-zap": { ms: 1400, tracks: [nudge([0, 1, 2, 3], { x: -2.2, y: 2.2 }, 0.05, 0.3, 0.45, "in"),
    tr(4, [[0, { o: 1 }], [0.05, { o: 0 }, "in"], [0.45, { o: 0 }], [0.5, { o: 1 }, "step"], [0.56, { o: 0.2 }, "step"], [0.62, { o: 1 }, "step"]]), nudge(4, { s: 1.2 }, 0.48, 0.6, 0.9)] },
  "plus": { ms: 1100, tracks: [spin("*", 90, "i", 0.05, 0.75), nudge("*", { s: 0.8 }, 0.05, 0.4, 0.8)] },
  "podcast": { ms: 1500, tracks: [...waves([[1, 4], [2, 3]], [12, 11], 0.2, 0.18), nudge(6, { s: 1.12 }, 0.1, 0.22, 0.5)] },
  "power": { ms: 1300, tracks: [draw(1, 0.05, 0.75), tr(0, [[0.05, { y: 0, o: 1 }], [0.2, { y: -3, o: 0 }, "in"], [0.5, { y: -3, o: 0 }], [0.75, { y: 0, o: 1 }, "back"]])] },
  "printer": { ms: 1600, tracks: [tr(2, [[0.04, { y: 0, o: 1 }], [0.22, { y: -6, o: 0 }, "in"], [0.85, { y: 0, o: 1 }, "out"]]), osc([0, 1], "x", 0.35, 0.25, 0.85, 6, { decay: false })] },
  "radio": { ms: 1500, tracks: [nudge(4, { s: 1.4 }, 0.05, 0.15, 0.4), ...waves([[0, 3], [1, 2]], [12, 12], 0.18, 0.18)] },
  "radio-tower": { ms: 1500, tracks: [nudge(2, { s: 1.4 }, 0.05, 0.15, 0.4), ...waves([[1, 3], [0, 4]], [12, 9], 0.18, 0.18)] },
  "redo-2": { ms: 1300, tracks: [draw(1, 0.05, 0.65, true), tr(0, [[0.05, { o: 1, x: 0 }], [0.15, { o: 0 }, "in"], [0.55, { o: 0, x: -1.5 }], [0.8, { o: 1, x: 0 }, "back"]])] },
  "refresh-cw": { ms: 1300, tracks: [spin("*", 180, "i", 0.05, 0.85, "io")] },
  "repeat": { ms: 1400, tracks: [spin("*", 180, "i", 0.05, 0.85, "io")] },
  "repeat-1": { ms: 1400, tracks: [spin([0, 1, 2, 3], 180, [12, 12], 0.05, 0.75, "io"), pop(4, 0.6, 0.95)] },
  "rewind": { ms: 1100, tracks: [through(1, -7, 0, 0.05, 0.8), through(0, -7, 0, 0.13, 0.88)] },
  "rocket": { ms: 1600, tracks: [osc("*", "x", 0.6, 0.02, 0.35, 6, { decay: false }), through("*", 9, -9, 0.35, 0.95, 0.4), osc(1, "s", 0.25, 0.02, 0.35, 4, { p: "tr", decay: false })] },
  "rotate-ccw": { ms: 1300, tracks: [spin("*", -360, "i", 0.05, 0.85, "io")] },
  "save": { ms: 1500, tracks: [press(0.02, 0.4, 0.88), nudge(2, { x: 2.5 }, 0.05, 0.25, 0.55, "back"), build(3, 0.3, 0.6), show(3, 0.3, 1, 0.1)],
    extra: ['<path d="m9.5 17 2 2 3.5-3.5"/>'] },
  "scan": { ms: 1500, tracks: [tr(4, [[0, { o: 0, y: -6 }], [0.08, { o: 0, y: -6 }], [0.15, { o: 1 }, "out"], [0.45, { y: 6 }, "io"], [0.75, { y: 0 }, "io"], [0.92, { o: 0 }, "in"]]),
    ...[[0, 1, 1], [1, -1, 1], [2, -1, -1], [3, 1, -1]].map(([e, sx, sy]) => nudge(e, { x: sx * 1.2, y: sy * 1.2 }, 0.05, 0.2, 0.5, "back"))], extra: ['<path d="M6 12h12"/>'] },
  "scissors": { ms: 1300, tracks: [osc([0, 1, 4], "r", -12, 0.02, 0.9, 2, { p: [12, 12], decay: false }), osc([2, 3], "r", 12, 0.02, 0.9, 2, { p: [12, 12], decay: false })] },
  "screen-share": { ms: 1200, tracks: [through([3, 4], 4, -4, 0.05, 0.85)] },
  "search": { ms: 1500, tracks: [tr("*", Array.from({ length: 17 }, (_, k) => { const a = k / 16 * 2 * Math.PI; return [0.05 + k * 0.05, { x: 2 * Math.sin(a), y: 2 * Math.cos(a) - 2 }, "lin"]; })),
    nudge(1, { s: 1.12 }, 0.85, 0.92, 1)] },
  "send": { ms: 1400, tracks: [tr("*", [[0.04, { x: 0, y: 0 }], [0.18, { x: -1.2, y: 1.2 }, "out"]]), through("*", 9, -9, 0.18, 0.9, 0.4)] },
  "server": { ms: 1400, tracks: [nudge([0, 2], { x: 2.5 }, 0.05, 0.3, 0.7, "back"), blink(2, 0.4, 0.95, 3), blink(3, 0.45, 1, 3)] },
  "settings": { ms: 1500, tracks: [spin(0, 360, [12, 12], 0.04, 0.9, "io"), nudge(1, { s: 0.7 }, 0.1, 0.4, 0.85, "back")] },
  "shield": { ms: 1500, tracks: [press(0.02, 0.4, 0.9), build(1, 0.3, 0.6), show(1, 0.3, 1, 0.1)], extra: ['<path d="m9 12 2 2 4-4"/>'] },
  "shopping-cart": { ms: 1500, tracks: [tr(4, [[0, { o: 0, y: -7 }], [0.08, { o: 0, y: -7 }], [0.12, { o: 1 }], [0.4, { y: 0 }, "in"], [0.75, { o: 1 }], [0.9, { o: 0 }]]),
    nudge([0, 1, 2, 3], { sy: 0.92, x: 0.6 }, 0.38, 0.45, 0.75, "back", [12, 21])], extra: ['<path d="M13 8.5h.01"/>'] },
  "shuffle": { ms: 1400, tracks: [draw(2, 0.05, 0.65), draw(3, 0.15, 0.6), draw(4, 0.2, 0.75), nudge([0, 1], { x: 1.6 }, 0.55, 0.7, 0.95, "back")] },
  "skip-back": { ms: 1100, tracks: [through(0, -6, 0, 0.05, 0.85), nudge(1, { sy: 0.8 }, 0.3, 0.4, 0.7, "back")] },
  "skip-forward": { ms: 1100, tracks: [through(1, 6, 0, 0.05, 0.85), nudge(0, { sy: 0.8 }, 0.3, 0.4, 0.7, "back")] },
  "sliders-horizontal": { ms: 1600, tracks: [tr(2, [[0.05, { x: 0 }], [0.35, { x: -4 }, "io"], [0.65, { x: 2 }, "io"], [0.9, { x: 0 }, "io"]]),
    tr(7, [[0.1, { x: 0 }], [0.4, { x: 5 }, "io"], [0.7, { x: -1 }, "io"], [0.92, { x: 0 }, "io"]]), tr(3, [[0.15, { x: 0 }], [0.45, { x: -5 }, "io"], [0.75, { x: 1.5 }, "io"], [0.95, { x: 0 }, "io"]])] },
  "smartphone": { ms: 1200, tracks: [osc("*", "x", 1, 0.05, 0.8, 7, { decay: false }), osc("*", "r", 4, 0.05, 0.8, 3.5, { decay: false })] },
  "snowflake": { ms: 1600, tracks: [spin("*", 60, "i", 0.05, 0.9, "io"), nudge("*", { s: 0.88 }, 0.05, 0.45, 0.9, "io")] },
  "sparkles": { ms: 1500, tracks: [tr(0, [[0.04, { s: 1, r: 0 }], [0.2, { s: 0.6, r: -10 }, "in"], [0.5, { s: 1.15, r: 6 }, "out"], [0.8, { s: 1, r: 0 }, "io"]]),
    appear([1, 2], 0.3, 0.55), appear(3, 0.45, 0.7)] },
  "speaker": { ms: 1300, tracks: [beat([2, 3], 0.14, 0.05, 0.8), blink(1, 0.2, 0.7, 2)] },
  "square": { ms: 1200, tracks: [spin(0, 90, "c", 0.05, 0.75), nudge(0, { s: 0.8 }, 0.05, 0.4, 0.85)] },
  "square-terminal": { ms: 1500, tracks: [blink(1, 0.1, 0.95, 3), nudge(0, { x: 1.2 }, 0.05, 0.2, 0.45, "back")] },
  "star": { ms: 1400, tracks: [tr(0, [[0.04, { s: 1, r: 0 }], [0.22, { s: 0.6 }, "in"], [0.75, { s: 1, r: 72 }, "back"]], { p: [12, 12.6] })] },
  "sun": { ms: 1600, tracks: [spin([1, 2, 3, 4, 5, 6, 7, 8], 45, [12, 12], 0.05, 0.85, "io"), nudge([1, 2, 3, 4, 5, 6, 7, 8], { s: 1.1 }, 0.05, 0.45, 0.85, "io", [12, 12]), beat(0, 0.15, 0.1, 0.7)] },
  "terminal": { ms: 1500, tracks: [blink(0, 0.1, 0.95, 3), nudge(1, { x: 1.2 }, 0.05, 0.2, 0.45, "back")] },
  "thermometer": { ms: 1600, tracks: [show(1, 0.1, 0.95), show(2, 0.25, 0.95), show(3, 0.4, 0.95), nudge(0, { s: 1.06 }, 0.4, 0.55, 0.9, "out", [12, 18])],
    extra: ['<path d="M18 16h2"/>', '<path d="M18 11.5h2"/>', '<path d="M18 7h2"/>'] },   // degree marks light from the bottom up
  "timer": { ms: 1500, tracks: [nudge(0, { y: 1 }, 0.02, 0.1, 0.25), spin(1, 360, [12, 14], 0.1, 0.9, "io")] },
  "trash-2": { ms: 1400, tracks: [tr([3, 4], [[0.05, { r: 0, y: 0 }], [0.35, { r: -24, y: -1.2 }, "out"], [0.6, { r: 0, y: 0 }, "in"], [0.68, { r: -3 }, "out"], [0.76, { r: 0 }, "in"]], { p: [3, 6] }),
    nudge([0, 1, 2], { y: 0.6 }, 0.58, 0.63, 0.8)] },
  "triangle": { ms: 1200, tracks: [osc(0, "r", 9, 0.05, 0.85, 3, { p: [12, 13] })] },
  "trophy": { ms: 1600, tracks: [tr("*", [[0.05, { y: 0 }], [0.3, { y: -2 }, "out"], [0.85, { y: 0 }, "io"]]), osc("*", "r", 6, 0.25, 0.85, 2, { p: "b" }), appear(6, 0.35, 0.55), appear(7, 0.45, 0.65),
    show(6, 0.35, 0.95), show(7, 0.45, 0.95)], extra: ['<path d="M2.5 1.5v2M1.5 2.5h2"/>', '<path d="M21.5 1.5v2M20.5 2.5h2"/>'] },
  "tv": { ms: 1400, tracks: [osc(0, "r", 14, 0.02, 0.9, 3, { p: "b" }), tr(1, [[0.05, { sy: 1 }], [0.2, { sy: 0.08 }, "in"], [0.5, { sy: 1 }, "out"]])] },
  "type": { ms: 1400, tracks: [build(1, 0.1, 0.4), build(0, 0.35, 0.65), build(2, 0.6, 0.85)] },
  "umbrella": { ms: 1400, tracks: [tr(2, [[0.05, { sx: 1 }], [0.3, { sx: 0.25 }, "in"], [0.75, { sx: 1 }, "back"]], { p: "t" }), osc(0, "r", 6, 0.3, 0.95, 2, { p: [12, 13] })] },
  "undo-2": { ms: 1300, tracks: [draw(1, 0.05, 0.65, true), tr(0, [[0.05, { o: 1, x: 0 }], [0.15, { o: 0 }, "in"], [0.55, { o: 0, x: 1.5 }], [0.8, { o: 1, x: 0 }, "back"]])] },
  "upload": { ms: 1300, tracks: [through([0, 1], 0, -8, 0.1, 0.88, 0.4), nudge(2, { sy: 0.8 }, 0.02, 0.12, 0.4, "back", "b")] },
  "user": { ms: 1200, tracks: [tr(1, [[0.05, { y: 0 }], [0.28, { y: -2.2 }, "out"], [0.45, { y: 0 }, "in"], [0.55, { y: -0.6 }, "out"], [0.65, { y: 0 }, "in"]]), nudge(0, { sx: 1.08, sy: 0.94 }, 0.42, 0.5, 0.8, "back", "b")] },
  "users": { ms: 1400, tracks: [tr([1, 2], [[0.05, { x: 0, o: 1 }], [0.25, { x: 3, o: 0.1 }, "in"], [0.65, { x: 0, o: 1 }, "out"]]),
    tr(3, [[0.45, { y: 0 }], [0.6, { y: -1.8 }, "out"], [0.75, { y: 0 }, "in"]])] },
  "video": { ms: 1500, tracks: [nudge(0, { sx: 0.6 }, 0.05, 0.25, 0.6, "back", "l"), tr(2, [[0, { o: 0 }], [0.3, { o: 0 }], [0.31, { o: 1 }, "step"], [0.5, { o: 0 }, "step"], [0.65, { o: 1 }, "step"], [0.85, { o: 0 }, "step"]])],
    extra: ['<path d="M6 10h.01"/>'] },
  "video-off": { ms: 1300, tracks: [osc([0, 1], "x", 0.7, 0.02, 0.45, 4), draw(2, 0.3, 0.9)] },
  "volume": { ms: 1500, tracks: [beat(0, 0.08, 0.05, 0.75, "l"), tr(1, [[0, { o: 0, x: -1 }], [0.1, { o: 0, x: -1 }], [0.25, { o: 1, x: 0 }, "out"], [0.4, { o: 0, x: 2 }, "in"], [0.45, { x: -1 }, "step"],
    [0.6, { o: 1, x: 0 }, "out"], [0.85, { o: 0, x: 2 }, "in"]])], extra: ['<path d="M16 9a5 5 0 0 1 0 6"/>'] },
  "volume-1": { ms: 1400, tracks: [beat(0, 0.08, 0.05, 0.75, "l"), through(1, 2.2, 0, 0.05, 0.45, 0.5), through(1, 2.2, 0, 0.5, 0.9, 0.5)] },
  "volume-2": { ms: 1600, tracks: [beat(0, 0.08, 0.05, 0.8, "l"),
    tr(1, [[0, { o: 1 }], [0.05, { o: 0 }, "in"], [0.15, { o: 0 }], [0.25, { o: 1 }, "out"], [0.5, { o: 1 }], [0.56, { o: 0 }, "in"], [0.62, { o: 0 }], [0.72, { o: 1 }, "out"]]),
    tr(2, [[0, { o: 1 }], [0.05, { o: 0 }, "in"], [0.28, { o: 0 }], [0.38, { o: 1 }, "out"], [0.5, { o: 1 }], [0.56, { o: 0 }, "in"], [0.75, { o: 0 }], [0.85, { o: 1 }, "out"]])] },
  "volume-x": { ms: 1300, tracks: [osc(0, "x", 0.6, 0.02, 0.45, 4), build(1, 0.15, 0.5), build(2, 0.45, 0.8)] },
  "wand-sparkles": { ms: 1500, tracks: [swing([0, 1], 12, [2.5, 21.5], 0.02, 0.7, 2), appear([2, 5], 0.25, 0.45), appear([4, 7], 0.35, 0.55), appear([3, 6], 0.45, 0.65)] },
  "watch": { ms: 1500, tracks: [spin(0, 360, [12, 12], 0.05, 0.85, "io"), osc("*", "r", 5, 0.02, 0.98, 2, { p: "i" })] },
  "wifi": { ms: 1500, tracks: [pop(0, 0.06, 0.3), ...[3, 2, 1].map((e, k) => tr(e, [[0, { o: 1 }], [0.05, { o: 0 }, "in"], [0.22 + k * 0.14, { o: 0 }], [0.34 + k * 0.14, { o: 1 }, "out"]]))] },
  "wind": { ms: 1500, tracks: [build(2, 0.08, 0.5, true), build(1, 0.2, 0.65, true), build(0, 0.32, 0.8, true)] },
  "wrench": { ms: 1400, tracks: [tr(0, [[0.05, { r: 0 }], [0.3, { r: -26 }, "io"], [0.45, { r: 0 }, "io"], [0.65, { r: -26 }, "io"], [0.85, { r: 0 }, "io"]], { p: [17, 7] })] },
  "x": { ms: 1100, tracks: [build(0, 0.1, 0.45), build(1, 0.4, 0.75), nudge("*", { s: 1.1 }, 0.7, 0.8, 0.95)] },
  "zap": { ms: 1100, tracks: [tr(0, [[0.04, { o: 1 }], [0.1, { o: 0.15 }, "step"], [0.16, { o: 1 }, "step"], [0.22, { o: 0.3 }, "step"], [0.28, { o: 1 }, "step"]]), beat(0, 0.12, 0.3, 0.9)] },
};

// A brand mark spins like a coin (squeezed to its edge and back, never mirrored) and hops.
const BRAND = { ms: 1300, tracks: [tr(0, [[0.04, { sx: 1, y: 0 }], [0.22, { sx: 0.04, y: -0.8 }, "in"], [0.4, { sx: 1, y: -1.6 }, "out"],
  [0.55, { sx: 0.04, y: -1 }, "in"], [0.78, { sx: 1, y: 0 }, "back"]])] };

// An icon without its own design redraws its strokes, one after another.
function fallback(icon) {
  const n = (icon.d.match(/<(?:path|circle|rect|line|ellipse|polyline|polygon)\b/g) || []).length;
  return { ms: 1400, tracks: Array.from({ length: n }, (_, k) => draw(k, 0.04 + k * 0.4 / n, 0.5 + k * 0.4 / n)) };
}

function design(name, icon) {
  return icon.f ? BRAND : D[name] || fallback(icon);
}

module.exports = { design, DESIGNS: D };
