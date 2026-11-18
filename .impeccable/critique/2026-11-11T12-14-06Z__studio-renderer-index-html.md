---
target: Macropad Studio renderer
total_score: 25
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:D:\\Personal\\Project\\ESP32-Touch-Keypad\\studio\\renderer\\index.html"
target_fingerprint: "sha256:9e6bddde68b89b0b6a97864ba8792ab4f0d628d6e8bd6d929810372af5dd70c7"
target_path: "D:\\Personal\\Project\\ESP32-Touch-Keypad\\studio\\renderer\\index.html"
timestamp: 2026-11-11T12-14-06Z
slug: studio-renderer-index-html
---
Method: dual-agent (A: design review · B: detector + browser over CDP, Electron, simulated keypad)

# Critique: Macropad Studio (studio/renderer), Operate mode — 25/40

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility | 3 | Find/Connect errors only in the folded console's last line |
| 2 | Match | 2 | MIC_MUTE, Telephony, baud rate, schema v2 in everyday UI |
| 3 | Control | 3 | Undo/redo, backups, confirms |
| 4 | Consistency | 2 | Everything autosaves except the quick bar |
| 5 | Error prevention | 3 | Confirms; key combos typed as free text |
| 6 | Recognition | 2 | Icon-only rail; slots 11–16 hidden behind the connection pill |
| 7 | Flexibility | 3 | Keyboard editing, Ask Claude, console, import/export |
| 8 | Aesthetic | 2 | 13 "Empty" chips, a paragraph per card |
| 9 | Error recovery | 2 | Specific messages, often only in the console |
| 10 | Help | 3 | Inline hints; docs as filenames |

Specificity: split. The preview is the device; the shell (icon rail, checkbox cards) is a generic dev-tool layout.

Detector: 3 CLI findings (primary button 4.3:1 real/marginal; dark-glow false positive; stripes intentional). Overlay (CSP bypass needed): .tag.on 3.6:1 real, --txt-3 3.4:1 real, 20 em-dashes in Settings, ai-palette false positive.

Priority issues
- [P1] Device view buries Install firmware; grid leaves the third column empty twice (styles.css:145,148); "Open Device" lands at the top. /impeccable layout
- [P1] Two save models: quick bar needs its own Save and keeps a silent draft (app.js:620,701). /impeccable harden
- [P2] Key inspector leads with looks; actions last, raw values, hand-typed combos. /impeccable distill
- [P2] Slot strip: 16 chips, hidden scrollbar, 11–16 clipped. /impeccable distill
- [P2] Quick-bar rows hard-titled Explorer/Git/Commands (app.js:664), default icon "airplay". /impeccable clarify

Personas: Alex (hand-typed combos, separate save); Jordan (icon-only rail, baud rate); Sam (swatches read "Colour 79,140,255"); owner (Switch profile by app is the last card).

Minor: B612 parentheses read as brackets at small sizes; last Settings card leaves two empty columns; the preview's quick bar can't be clicked.

Audit: 15/20 (a11y 3, perf 3, responsive 3, theming 3, integrity 3). --txt-3 contrast P1; device-theme state accents fail in Synth/Daylight/Forest/Ember; 25 Hz GIF timer; full innerHTML rebuilds.
