---
target: Keypad on-screen UI
total_score: 25
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:D:\\Personal\\Project\\ESP32-Touch-Keypad\\firmware\\TouchKeypad\\ui.cpp"
target_fingerprint: "sha256:837624a17df7bf15bba5767bd2979a7d16c33287d34eadfcb7df6311bef049f5"
target_path: "D:\\Personal\\Project\\ESP32-Touch-Keypad\\firmware\\TouchKeypad\\ui.cpp"
timestamp: 2026-11-11T12-14-09Z
slug: firmware-touchkeypad-ui-cpp
---
Method: dual-agent (A: design review of device captures and ui.cpp/gfx.cpp · B: detector n/a for C++, firmware code review instead)

# Critique: keypad on-screen UI (firmware 3.14.0, Paper), Operate mode — 25/40

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility | 3 | Status chip says "Explorer 1/3" over a panel's own 2/5 dots |
| 2 | Match | 3 | "PC" tag and "Cmds" never explained |
| 3 | Control | 2 | Panel closes only via its lit button; Forget has no undo |
| 4 | Consistency | 2 | Turn off arms first, Forget does not; shade doesn't follow the finger |
| 5 | Error prevention | 2 | Forget 8 px from Use, one tap (ui.cpp:1376, 2998) |
| 6 | Recognition | 2 | Media is gesture-only; theme chips unnamed |
| 7 | Flexibility | 3 | Many ways to switch profile; hold actions |
| 8 | Aesthetic | 3 | Calm home; PC tags on 10/15 Cmds keys; blank suggestion slot |
| 9 | Error recovery | 3 | Calibration copy exemplary |
| 10 | Help | 2 | Gestures never taught |

Specificity: authored for this product; Settings sheet drifts generic (iOS cards, unnamed chips).

Priority issues
- [P1] One-tap sensitive actions: Forget; keys that type a secret. Arm Forget; per-key hold-to-fire. /impeccable harden
- [P1] Lost in layers: chip doesn't name the layer; only exit is the lit button; swipe down opens the shade. /impeccable clarify
- [P2] Theme chips 63x26, unnamed, 10 choices. /impeccable adapt
- [P2] 11 px labels; Profiles truncates 5/14 names; Media empty line cut at 150 px; idle seek bar. /impeccable typeset
- [P3] 120–160 ms animations stutter at 22 fps; shade not on the spring. /impeccable animate

Personas: Jordan (Media undiscoverable; "Explorer" means two things); Riley (Forget next to Use; deleted-profile bar button vanishes); owner (11 px labels, PC-tag clutter, idle icon wave).

Minor: Turn off shares the Generate slot next to Done; "Empty" host chip in the shade; lime keys clash with Paper cream; docs/device mock lacks quick bar, shade and layers.

Questions: Is the identity the instrument discipline rather than one skin (DESIGN.md retired Paper, the daily keypad runs it)? Should a key that types a secret ever fire on one tap on a resistive panel?
