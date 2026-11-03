# Design handoff review: themes (touchkeypad_design_handoff.zip)

Date: 2026-11-03 · branch `feature/handoff-themes` (from `release-3.12.1`) · inputs: `MASTER_HANDOFF.md`, `AGENT_PROMPT.md`, `theme_tokens.json` (copied to `tools/themes/`)

## What was built

- The four new themes, `nordic_calm`, `focus_slate`, `forest_field` and `ember_atelier`, are generated from one source, `tools/themes/theme_tokens.json`. `tools/themes/gen_themes.py` writes the firmware entries (`firmware/TouchKeypad/themes_gen.h`) and Studio's preview mirror (`studio/renderer/themes_gen.css`). The roles the tokens do not name are derived there, documented, the same way for both outputs.
- The themes are appended after the six existing ones (indices 6–9), because NVS stores the index. The six existing IDs are unchanged.
- Two new theme roles:
  - `accent`: the selected or active state, i.e. the quick bar's lit button, the current tab, theme chip, profile card and LED pattern, and the Synth play key.
  - `bar`: the quick bar's ground.
  - For the six existing themes these equal their current magenta and sheet colours, so those themes draw as before.
- Three key styles no longer use literal colours: Frost's tile, Flat's greys, and Paper's card and outline now come from the theme's control roles, so they work on a dark theme. A `caps` flag replaces "Flat style ⇒ mono capitals", so only Synth keeps them.
- Settings › Display shows ten themes: two rows of five chips, with the current theme's name beside the heading.
- Parity test: `studio/test/themes.test.js` checks that firmware, Studio and the token file list the same themes in the same order.

## The handoff's points, checked against the code

| Point | Verdict | Note |
|---|---|---|
| 480×320, 5×3 grid of 84×90 cells, 66 px keys, 30 px status band, 20 px page line, 60 px quick bar | Valid, already true | Matches 3.12.0 exactly. `keyY = cellY + 3` in the handoff vs `+ 4` in the code is cosmetic and left alone. Quick-bar buttons start at y 90 (a 2 px hairline gap), not 88. |
| Framebuffer format | Confirmed RGB565 | 16-bit chunk buffers, pushed by DMA as byte-swapped RGB565 (`lgfx::swap565_t`). The ground is checkerboard-dithered, so token values land within a code value or two. |
| Keep the six IDs | Valid, done | `glass paper daylight aurora synth retro`: same IDs, same indices. |
| Add four themes with the exact token roles | Done | `onAccent`, `ctlTop`/`ctlBot`, `knob`, `shadow` and others are derived (see the generator's docstring). |
| Omit `oled_quiet` | Agreed | Not in the token file either. |
| One source / generated mirror | Valid, done for the new four | The six existing themes stay hand-tuned in `themes.h` and `styles.css` (next row). |
| Token values for the **existing** six | **Not applied: owner decision** | The token file restyles all six (e.g. Daylight's ground `#c7daf1` becomes `#DCEAF2`; Glass's ground is lifted from about `#0e1620` to `#314966`). These are themes in daily use. Glass's lift is a reasonable TFT point (its ground is near-black), but it changes how Glass looks. Applying it means listing the six in `gen_themes.py`'s `NEW` and deleting their hand-written entries. |
| Active quick-bar state must use the primary accent, not magenta | Valid, done as a role | The `accent` role equals magenta in the first six themes (their established look) and the token's primary in the new four. |
| HOLD tag amber | Valid suggestion, not applied | HOLD is a slate outline today (DESIGN.md). Changing it restyles every theme; it's a one-line change in `drawCell` if wanted. |
| Unread uses red | Not applied | The unread badge is magenta today; same reasoning. |
| Textures: laid paper, glass highlight, LCD rows only | Already true | `texture` 1 = paper rows, 2 = LCD gaps every 3rd row, and Glass's top highlight. The new four use `none`. |
| Unknown persisted theme → safe default | Already true | `uiBegin` clamps the stored index to the table, and `theme <unknown>` lists the IDs. |
| Settings, shade, toast, volume, banner use the same roles | Mostly true already | They draw through the theme table. The new themes inherit it; verified in Studio's preview, the keypad pending (below). |
| Display-tab chips for 10 themes | **Not in the handoff; needed** | One row of ten would be 27 px chips, so it's now two rows of five. |
| Token problems | Flagged, kept as given | Forest Field and Ember Atelier have muted ≈ primary text (1.04:1 and 1.06:1 apart), so there's no visible hierarchy. Ember's red equals its primary accent (#F28B73), so an active button reads like an error. Retro's red equals its magenta (by design, four greens). The primary accent on the bar is 3.3:1 in Nordic Calm and 3.8:1 in Ember, under 4.5:1 for small text, though fine for the 22 px icon. Body text is 4.9:1 or better in every new theme. |

## Firmware ↔ Studio differences

- The preview draws keys with CSS and the keypad with its own renderer. Shapes and colours match, but the keypad dithers the ground and anti-aliases differently. Flat keys' lip and edge and Paper's back card follow the same formulas as the firmware.
- The preview has no settings sheet, so the Display tab's chips are keypad-only. Studio's Device view lists all ten themes.

## Validation status

- Studio's preview of the new four was checked by screenshot (light Nordic Calm, slate Focus Slate, green Forest Field, plum Ember Atelier). **This is browser rendering, not the TFT.**
- Firmware builds (90% of flash). On the keypad (test board 58:F8, the branch build), the full device suite passed 101/101. That includes the new tests: a second-row chip picks Focus Slate; each new theme loads and paints its token ground; all ten themes animate at the frame-rate floor.
- Two test faults surfaced on the way and are fixed. The per-theme paint test had expected colours for the first six themes only, so it now covers those six while the new four have their own token test. The volume test raced a 5 s screenshot against a 1.6 s panel.
- The run found a firmware bug the themes did not cause: the tile cache (four decoded custom tiles, 41 KB, never freed) left too little RAM for the player's cover and for an upload while the player shows. It is fixed in `c4ca1d0` with a device test, and the fix applies cleanly to `main` for a 3.12.x release.
- Pending, waiting on the board (it dropped off USB): the full suite on the fixed build, twice without a reboot; the after screenshots of the six existing themes against the before set; the new four photographed on the TFT (home, a quick-bar panel, Settings › Display).
