---
target: keypad device themes (10) and Studio theme preview
total_score: 27
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:D:\\Personal\\Project\\ESP32-Touch-Keypad\\firmware\\TouchKeypad\\themes.h"
target_fingerprint: "sha256:7bc2563a90eaaba4a95c48d1fe10cf06714e5f6e023cca1c2efd104673f1c3d6"
target_path: "D:\\Personal\\Project\\ESP32-Touch-Keypad\\firmware\\TouchKeypad\\themes.h"
timestamp: 2026-11-14T08-05-50Z
slug: firmware-touchkeypad-themes-h
---
Method: dual-agent (A: design-review sub-agent · B: detector + measurement sub-agent)

Target: the keypad's 10 device themes (firmware 3.14.0, themes.h + themes_gen.h) and Studio's theme preview, against the design handoff boards. Evidence: 40 TFT framebuffer shots (home, Media, Settings, shade per theme), token contrast math, Studio preview renders.

## Design Health Score
| # | Heuristic | Score | Key Issue |
|---|---|---|---|
| 1 | Visibility of System Status | 3 | Lit bar button ink under 4.5:1 in 6/10 themes (Synth 2.28 measured) |
| 2 | Match System / Real World | 3 | The six have real referents; the generated four only adjectives |
| 3 | User Control and Freedom | 3 | One tap, theme default, 320 ms wipe; no preview before commit |
| 4 | Consistency and Standards | 2 | Accent = cyan (Slate) / red (Ember); Studio preview bar drifts |
| 5 | Error Prevention | 2 | Ember's active colour is its fault colour; Paper crimson near its red |
| 6 | Recognition Rather Than Recall | 3 | Chips sample ground + key, name in own ink; 11 px names |
| 7 | Flexibility and Efficiency | 3 | Settings, Studio, CLI; device-wide only |
| 8 | Aesthetic and Minimalist Design | 3 | Six disciplined; generated four dilute the picker |
| 9 | Error Recovery | 2 | Theme decides whether a refuse ring/Forget reads as an error |
| 10 | Help and Documentation | 3 | Roles documented; three docs disagree on the chip layout |
| **Total** | | **27/40** | **Acceptable** |

## Design Specificity Verdict
Six hand-tuned themes are authored materials (Paper card, Flat sink, Pixel drop). The four generated are recolours of those styles, two on grounds the style wasn't drawn for. Ten read as one family. Detector: Studio 0 findings; docs/device 30 advisory design-system-color/radius findings, false positives (device Glass palette from themes.h, detector reads root DESIGN.md only). Measured key labels on ground pass in all ten (6.2-12.3). No browser overlay.

## Priority Issues
- [P1] Lit bar button illegible: raw ACCENT ink on lit fill (fill 1.15-1.36 vs bar). Measured Synth 2.28, Nordic 2.74, Ember 2.90, Daylight 3.75, Forest 3.80, Focus 3.89. Fix: TXT or legible() vs fill, accent on icon, stronger fill. /impeccable colorize
- [P1] Generated four: accent = a state word (Slate=cyan, Ember=red, Forest~green, Nordic~cyan). Fix gen_themes.py roles(): ΔE>=25 vs cyan/green/red, else magenta. /impeccable colorize
- [P2] Generated four built wrong: Nordic key/ground 1.03; txt2~txt 1.03-1.18; crisp token -> Retro square controls in Slate/Forest. Fix: crisp = pixel only, derive txt2, Nordic key contrast; or cut two. /impeccable polish
- [P2] Studio preview drift: bar colour wrong for the six (ΔE up to 14; Paper inverted), Retro ON tag ink, nordic not light, keyInk only paper/daylight, no lit bar. Fix: generate roles for all ten; themes.test.js compares values. /impeccable harden
- [P2] Faint secondary marks: txt3 empty-bell <3:1 in all six (Retro 1.77); Retro txt2/bar 3.0-3.4; legible() not checked vs g0/g2 (Aurora mag 3.39). /impeccable polish

## Persona Red Flags
- Alex: no per-profile theme; preview drift; Synth label sizes vary in a row.
- Sam: 4.5:1 covers state words only; lit labels 2.3-3.9; Retro bar labels 3.4; bell 1.8. Safe: Paper, Glass, Aurora.
- Maker glancing: glyphs read in Paper/Glass/Daylight, not Forest/Nordic; lit Media hard to spot in Synth/Nordic; filled tags would read better.

## Minor Observations
- Stay active lights cyan; a latched toggle is "engaged" = green by the State Word Rule; cyan is Slate's accent.
- Ember's empty-cover placeholder = its red.
- Paper seek knob 1.06:1 vs ply.
- Chip layout documented three ways; DESIGN.md:171 still puts settings in the status band.
- Handoff right on filled tags and a stronger lit bar; shipped right to refuse glow, blur, 8-10 px text.

## Questions to Consider
- Should the generated four become light/dark variants of the authored six?
- Should two earn their place via the on-device review and two be cut?
- Would a per-profile accent help "where am I" more than ten skins?
