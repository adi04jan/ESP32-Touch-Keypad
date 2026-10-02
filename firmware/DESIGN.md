---
name: Touch Keypad screen
description: Watch-glass keys run by an avionics multi-function-display discipline, where every colour is a state word.
colors:
  ground-top: "#0e141b"
  ground-bottom: "#06090c"
  ply: "#131a22"
  ply-2: "#0e141a"
  well: "#090d12"
  control: "#19212a"
  control-top: "#242e39"
  track: "#1f2832"
  hair: "rgba(214, 228, 243, .08)"
  hair-2: "rgba(214, 228, 243, .15)"
  text: "#e9eff5"
  text-2: "#9aa6b4"
  text-3: "#66737f"
  label: "#c9d3dd"
  cyan: "#4cc9ea"
  magenta: "#e56fd6"
  green: "#52d68f"
  amber: "#f2b746"
  red: "#ff6359"
  tint-cobalt: "#4f8cff"
  tint-cyan: "#3fc6e0"
  tint-teal: "#2fbf9a"
  tint-green: "#52d68f"
  tint-amber: "#f2b746"
  tint-orange: "#ff8a3d"
  tint-red: "#ff5f57"
  tint-pink: "#ff6fae"
  tint-magenta: "#d86ce8"
  tint-violet: "#9b7bff"
  tint-slate: "#8a98ab"
typography:
  head:
    fontFamily: "B612"
    fontSize: "25px"
    fontWeight: 700
    lineHeight: 1.12
  title:
    fontFamily: "B612"
    fontSize: "19px"
    fontWeight: 700
    lineHeight: 1.2
  clock:
    fontFamily: "B612"
    fontSize: "17px"
    fontWeight: 700
    fontFeature: "tnum"
  body:
    fontFamily: "B612"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.35
  body-bold:
    fontFamily: "B612"
    fontSize: "15px"
    fontWeight: 700
  label:
    fontFamily: "B612"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.1
  readout:
    fontFamily: "B612 Mono"
    fontSize: "13px"
    fontWeight: 400
  digits:
    fontFamily: "B612 Mono"
    fontSize: "46px"
    fontWeight: 700
rounded:
  key: "19px"
  key-ring: "22px"
  control: "12px"
  segment: "11px"
  sheet: "16px"
  tag: "6px"
  pill: "20px"
spacing:
  hair: "1px"
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  status: "28px"
  cell-w: "96px"
  cell-h: "90px"
components:
  key:
    backgroundColor: "linear-gradient(tint 74% over ground-top, tint 36% over ground-bottom)"
    rounded: "{rounded.key}"
    size: "66px"
  key-label:
    typography: "{typography.label}"
    textColor: "{colors.label}"
  button:
    backgroundColor: "{colors.control}"
    textColor: "{colors.text}"
    typography: "{typography.body-bold}"
    rounded: "{rounded.control}"
    height: "44px"
  button-primary:
    backgroundColor: "{colors.cyan}"
    textColor: "#ffffff"
    rounded: "{rounded.control}"
  segment-current:
    textColor: "{colors.magenta}"
    rounded: "{rounded.segment}"
  tab-current:
    textColor: "{colors.magenta}"
    rounded: "{rounded.control}"
---

# Design System: Touch Keypad screen

## Overview

The keypad's 480×320 screen is an instrument, not a toy: watch-glass keys run by the discipline of an avionics multi-function display. A graphite ground with a faint blue cast holds fifteen lit glass keys, each tinted by its user-chosen colour, with a status band of exact readouts above and the profile's line of page stations below. Every colour outside the keys is a state word, so the screen can be read at a glance from half a metre in a dim room.

It replaced a papercraft screen the owner judged too playful. It is drawn by an ESP32 at 16-bit colour over SPI, so every effect is something the firmware can compute: gradients, rounded rectangles, 4-bit alpha glyphs, and per-cell blends. Nothing blurs at runtime.

**Key characteristics:**
- Vivid lit glass keys (tint 74% to 36% top to bottom, a one-pixel highlight, a tint-coloured edge, an upper gloss).
- One semantic palette for the system: cyan selectable, magenta current, green engaged or ok, amber caution, red fault.
- B612, the face Airbus and Intactile drew for cockpit screens, for every word and number.
- Strict ply order: ground, keys, overlays (toast, volume), sheet.

## Colors

### Primary
- **Key tints** (tint-cobalt … tint-slate): the user's key colours. Twelve tuned tints; each renders as lit glass, never flat.

### Secondary
- **Cyan** (#4cc9ea): selectable data and primary actions: the seek fill, the brightness slider, the PC tag, the primary button, calibration targets.
- **Magenta** (#e56fd6): the current thing: selected tab, selected segment, active profile card, the pairing passkey timer.
- **Green** (#52d68f): engaged or confirmed: toggles that are on, the ok ring, a connected host.
- **Amber** (#f2b746): caution: no host.
- **Red** (#ff6359): fault and destructive: the refused-key ring, Forget.

### Neutral
- **Ground** (#0e141b to #06090c): the screen field, a vertical gradient.
- **Ply** (#131a22 to #0e141a): the settings sheet.
- **Text** (#e9eff5), **Text 2** (#9aa6b4), **Label** (#c9d3dd), **Text 3** (#66737f, disabled only).

### Named Rules
**The State Word Rule.** System colour means state and nothing else. Cyan, magenta, green, amber and red each carry one meaning everywhere, and each is paired with a word, a tag, a shape or a position, never colour alone.

**The Line Rule.** Each profile owns a line colour; its pages are stations on that line at the bottom of the screen, and the status band repeats it as a dot.

## Typography

**Face:** B612 and B612 Mono (SIL OFL), rasterized to VLW smooth fonts by `tools/fonts/build_fonts.py`.

### Hierarchy
- **Head** (B612 Bold 25): the track title on the player.
- **Title** (B612 Bold 19): sheet and screen titles.
- **Clock** (B612 Bold 17, tabular): the status band clock.
- **Body** (B612 15): sheet rows, the album line, instructions. **Body Bold** (15): tabs, buttons, toasts.
- **Label** (B612 13): key labels, one line, truncated with an ellipsis.
- **Readout** (B612 Mono 13): identifiers (host name, page fraction, values). Times and numbers use B612 with tabular figures, not mono, so colons and points stay tight.
- **Digits** (B612 Mono Bold 46): the pairing passkey.

## Layout

A fixed 480×320 landscape canvas. Status band 28 px with a hairline under it; a 5×3 grid of 96×90 cells from y 30; a 66 px key 4 px from the cell top with its label 5 px below; the page line in the bottom 20 px. The whole cell is the touch target. The player and the sheet replace the grid area and keep the status band. Sheet controls are at least 44 px tall.

## Elevation & Depth

Depth is light on glass, not shadow on paper. Keys carry a one-pixel highlight on the top edge, an upper gloss, and a soft dark drop beneath (0 12px 16px -12px). Overlays sit on a lighter ply with a highlight and a dark drop. Coloured halos are not used; the only colour that leaves an object is the stamp ring.

### Named Rules
**The Ply Rule.** Four plies, one edge treatment each: ground (none), keys (highlight + drop), overlays (highlight + hairline + drop), sheet (highlight on the top edge).

## Shapes

Squircle-like rounding throughout: keys 19 px, rings 22 px, controls 12 px, the sheet's top corners 16 px, player buttons round. Empty cells are recessed wells in the key shape.

## Components

### Key
Lit glass, 66 px, glyph 36 px white (40 px masks scaled on device). Tags sit on the top-right corner: PC (cyan outline, host action), HOLD (slate outline), ON (green fill, engaged toggle). Pressed: scales to 0.90–0.94 and brightens with touch pressure, with a white inner edge. Confirm: a green ring that grows and fades; refuse: a red ring. Hold: a cyan arc fills over the 500 ms hold. Animated keys: eq (bars), pulse (ring), rec (blinks red).

### Buttons
44 px, 12 px corners, control gradient with a highlight and hairline. Primary is cyan glass; destructive is a red-outlined quiet button.

### Segmented control and tabs
Segments 44 px; the current one is magenta text on a magenta-tinted fill with a magenta edge. The sheet's tab rail is a column of 48 px soft keys; the current tab is magenta on a magenta-tinted pill.

### Player
128 px album art with a highlight, title in Head, album in Body, artist and source in Text 2 with the source in green and a live equalizer while playing, a seek bar (6 px track, cyan fill, white knob, 44 px touch band), tabular times, and six round controls with an 84 px cyan play key.

### Overlays
Toast: a 40 px pill under the status band with the profile line dot. Volume: a 260×76 panel with a 16-segment level and the number.

## Themes

Six whole-device themes (3.2), one setting for the whole keypad (Settings → Display, Studio's Device view, `theme <id>`), Glass by default. Each is a table of the roles above plus a key style, in `firmware/TouchKeypad/themes.h`; Studio's preview mirrors them in `studio/renderer/styles.css`.

**The Backlight Rule.** The panel is a TFT: its black glows grey under the backlight. Dark themes sit on deep coloured grounds (Glass navy, Aurora indigo to teal), never on near-black fields; light themes carry their contrast with ink, not with black. Gradients are dithered in a 2×2 checkerboard at half an RGB565 step, so skies and white tiles do not band (the pixel theme keeps its exact palette).

| Theme | From | Ground | Key | Current / selectable |
|---|---|---|---|---|
| Glass | Apple Watch | navy #121c28 → #0a1119 | lit glass in the tint, white glyph | magenta / cyan |
| Paper | the toy-theatre papercraft this screen replaced | cream #f4ecda → kraft #e5d6b6, faint laid rows | a cut card in the tint over a darker card, ink outline; a press slides it onto the card behind | crimson #a52f3d / teal #23697a |
| Daylight | iOS Control Centre, Car Thing | sky #c7daf1 → #e9f0f8 | frosted white tile, the glyph in the tint (darkened to read); an engaged toggle fills with the tint | pink #c23a8c / blue #0a6fd6 |
| Aurora | the northern lights | indigo #1e1450 → blue #1c2d6e → teal #0c5b62 | a translucent pane computed from the sky behind it, a luminous rim in the tint | pink #ff7cd8 / cyan #6ae6f8 |
| Synth | Teenage Engineering OP-1 | warm grey #dedbd5 → #cfccc4 | flat matte key on a darker side, the tint as a dot, mono capital labels; a press sinks it | orange #ff5a1f / blue #2160d0 |
| Retro | Game Boy DMG LCD | #9bbc0f with darker LCD rows | a pixel box with a hard shadow, crisp (no antialiasing); press drops it into the shadow, engaged inverts it | the four greens only |

Every theme keeps the State Word Rule in its own colours; Retro, with four greens, carries state by fill and shape (inverted boxes, rings, tags). Switching wipes the new theme down the screen in 320 ms.

## Do's and Don'ts

### Do:
- **Do** render every key in the current theme's key style, in its tint (Retro: its greens).
- **Do** keep system colour semantic and pair it with a word or shape.
- **Do** animate inside one cell at a time: press, rings, pop-in, glyph animation.
- **Do** use tabular figures for every time and number.

### Don't:
- **Don't** add coloured glows or halos around text, dots or knobs.
- **Don't** use full-screen fades or slides; transitions are staggered per cell or wiped by rows.
- **Don't** put a label above a title, or use monospace for running numbers.
- **Don't** introduce a sixth system colour.
