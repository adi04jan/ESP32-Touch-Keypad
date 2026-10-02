---
target: Macropad Studio renderer
total_score: 26
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:D:\\Personal\\Project\\ESP32-Touch-Keypad\\studio\\renderer\\index.html"
target_fingerprint: "sha256:96d4b3b16b00df0773de66bbf14846202620eb2bd8b3ce0e05a672914ab04992"
target_path: "D:\\Personal\\Project\\ESP32-Touch-Keypad\\studio\\renderer\\index.html"
timestamp: 2026-10-02T16-36-51Z
slug: studio-renderer-index-html
---
⚠️ DEGRADED: single-context (the owner asked for inline work with no sub-agents)

# Critique: Macropad Studio (studio/renderer), Operate mode

## Design Health Score (before fixes)
| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 3 | Save and connection state shown, not announced to assistive tech |
| 2 | Match between system and real world | 4 | The preview is the keypad screen at device pixels, in the keypad's theme |
| 3 | User control and freedom | 2 | No undo in an editor that autosaves to the device |
| 4 | Consistency and standards | 3 | Card titles h3 under an h3 view title; no main landmark |
| 5 | Error prevention | 3 | Validation, PC backup before every write, confirms on destructive steps |
| 6 | Recognition rather than recall | 3 | Icon search, labelled actions; shortcuts undiscoverable |
| 7 | Flexibility and efficiency | 1 | No keyboard path: no copy/paste of keys, no arrow selection, no undo |
| 8 | Aesthetic and minimalist design | 2 | Console docked on every view with Studio's own polling; dead AI view |
| 9 | Recognize and recover from errors | 3 | Errors listed under the preview and in the console |
| 10 | Help and documentation | 2 | No About, versions or shortcut hints; a pointer to a missing README |
| **Total** | | **26/40** | Acceptable |

## Design specificity verdict
Specific. The editor's hero is the keypad's own screen drawn at device pixels in the keypad's current theme, with the same glyph inks and key styles the firmware draws; nothing about it is interchangeable with another product. The shell around it (B612, state-word colours) is the device's instrument system.

## Priority issues
- [P1] The device console sat docked under every view (a quarter of the window), echoing Studio's own readout polling; it pushed the profile and page fields below the fold.
- [P1] An "AI shortcuts" rail item led to a placeholder that said it was not ported, with a link to a file that does not exist.
- [P1] No undo, copy/paste or keyboard selection in an editor that writes to the device as you go.
- [P2] Heading and landmark structure: no main, no h1; status changes not live regions.
- [P2] The Device view refetched six serial readouts on every page or profile event.
- [P2] Ragged swatch rows (9 + 3); the header wrapped on narrow views.

## Detector (Assessment B)
- side-tab: the Paper empty-key well's 3 px inner top stripe. Real: also unfaithful to the firmware's 1 px edge.
- dark-glow: Daylight's blue-grey key drop. False positive: it sits on the light sky inside the preview and matches the firmware's shadow colour.
- repeating-stripes (advisory): Paper's laid rows and Retro's LCD rows. Intentional: the firmware draws the same textures.
- Browser overlay skipped: the renderer only runs inside Electron with its preload bridge; Electron captures were used instead.

## Audit (technical)
Accessibility 2, Performance 3, Responsive 3 (desktop app, min 1100 px), Theming 3, Implementation integrity 3: 14/20 Good. Gaps: no reduced-motion handling, landmarks, live regions; dead UI; polling noise.

## Fixed in this pass
Console folds to a one-line bar (remembered), Studio's readouts stay out of it; AI view removed; undo/redo (Ctrl+Z, Ctrl+Y), copy/paste (Ctrl+C/V), Delete, arrow selection, with a hint line; main/h1/h2 and live status; reduced motion; debounced Device view; 6-column swatches; one-line header; 1 px wells; About card with versions; console copy says magenta, not red. Smoke run checks undo and redo.
