---
name: ESP32 Touch Keypad
description: A Pollock's toy theatre for a touchscreen macropad, where every view is a printed sheet slotted into one gilt proscenium.
colors:
  house: "#13212b"
  oxblood: "#7a1f2b"
  oxblood-2: "#94283a"
  gold: "#e2b04a"
  gold-2: "#f3d27c"
  gold-ink: "#7d5300"
  gilt-shade: "#c9952e"
  teal: "#264653"
  teal-2: "#2f6b73"
  stage-teal: "#1f4450"
  viridian: "#2f6b4f"
  vermilion: "#c2412b"
  kraft: "#b98a5a"
  kraft-2: "#8f6337"
  ink: "#1b1814"
  ink-2: "#4f4840"
  paper: "#f4f4ef"
  paper-2: "#fbfbf7"
  rule: "rgba(27, 24, 20, .18)"
  screen-night: "#24345c"
typography:
  display:
    fontFamily: "Ultra, Rockwell Extra Bold, Rockwell, Georgia, serif"
    fontSize: "clamp(1.55rem, 3vw, 2.45rem)"
    fontWeight: 400
    lineHeight: 1.12
    letterSpacing: "0.005em"
  headline:
    fontFamily: "Ultra, Rockwell Extra Bold, Rockwell, Georgia, serif"
    fontSize: "1.1rem"
    fontWeight: 400
    lineHeight: 1.3
    letterSpacing: "0.01em"
  title:
    fontFamily: "Atkinson Hyperlegible, Segoe UI, system-ui, sans-serif"
    fontSize: "1.06rem"
    fontWeight: 700
    lineHeight: 1.3
  body:
    fontFamily: "Atkinson Hyperlegible, Segoe UI, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "Atkinson Hyperlegible, Segoe UI, system-ui, sans-serif"
    fontSize: "0.88rem"
    fontWeight: 700
    lineHeight: 1.3
  mono:
    fontFamily: "Red Hat Mono, ui-monospace, Consolas, monospace"
    fontSize: "0.82rem"
    fontWeight: 500
    lineHeight: 1.6
    letterSpacing: "0.04em"
rounded:
  paper: "2px"
  sm: "3px"
  md: "4px"
  screen: "8px"
  board: "10px"
  bezel: "14px"
  shell: "26px"
  tile: "16%"
spacing:
  xs: "6px"
  sm: "8px"
  md: "14px"
  lg: "22px"
  xl: "44px"
components:
  button-gold:
    backgroundColor: "{colors.gold}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "8px 14px"
  button-paper:
    backgroundColor: "{colors.paper-2}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "8px 14px"
  button-selected-oxblood:
    backgroundColor: "{colors.oxblood}"
    textColor: "{colors.paper}"
    rounded: "{rounded.sm}"
    padding: "5px 12px"
  rail-ticket:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.paper}"
    padding: "6px 13px 7px"
  rail-ticket-current:
    backgroundColor: "{colors.gold}"
    textColor: "{colors.ink}"
  scene-sheet:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    padding: "clamp(24px, 3.4vw, 40px) clamp(16px, 3.4vw, 44px)"
  cue-card:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    padding: "6px 14px"
  input-field:
    backgroundColor: "{colors.paper-2}"
    textColor: "{colors.ink}"
    rounded: "2px 2px 0 0"
    padding: "7px 9px"
  pill:
    backgroundColor: "#ffffff"
    typography: "{typography.mono}"
    rounded: "{rounded.paper}"
    padding: "2px 9px"
  paper-tile:
    rounded: "{rounded.tile}"
    size: "12.2cqw"
  tile-label-chip:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "0.3cqw"
    padding: "0.15cqw 1cqw"
---

# Design System: ESP32 Touch Keypad

## Overview

**Creative North Star: "The Pollock's Toy Theatre"**

The viewer is a hand-coloured lithograph toy theatre. One gilt proscenium fills the window: a coffered frieze carrying an arched playbill banner, hatched gilt pilasters, a bead-moulded stage opening, an oxblood swag valance, hatched paper curtains, three depths of wing flats and a painted prussian-teal backdrop. Every scene is a printed paper sheet slotted onto that one stage, and scenes are called from tickets on a footlights rail. The keypad is the player, a card figure riding a wire slider.

Everything is drawn, not rendered. Plates are authored SVG with ink outline (#1b1814, 1 to 3px), diagonal hatching at 45 degrees and flat hand-coloured fills; paper carries a faint fractal grain. Specs, tables, pin maps and code sit on clean paper-white sheets so the numbers stay crisp, and the theatre does the theatre around them. Depth is physical: stacked paper layers with soft offset shadows, deckled edges and a coloured endpaper under-sheet peeking out at a slight rotation.

The keypad's own screen is a separate world, watch glass under an avionics display discipline, recorded in `firmware/DESIGN.md` and mocked in `docs/device/index.html`; the viewer's stage still shows it in its player. Motion follows the stage: sheets slide on rails with exponential ease-out.

**Key Characteristics:**
- One proscenium, one stage; no header, tab strip or card grid.
- Ink outline plus hatching plus flat fills on every authored plate.
- Paper sheets with deckled top and bottom edges over a rotated endpaper under-sheet.
- Wood-type display (Ultra) in oxblood for titles; Atkinson Hyperlegible for reading; Red Hat Mono for data.
- Device state named by a lighting cue: a gel over the stage plus a written cue card.
- Slight, deliberate rotations (between -1.5 and 2.5 degrees) on loose paper pieces.

## Colors

A lithograph palette: oxblood and gilt framing a prussian-teal night, with ink linework and clean paper for everything that must be read.

### Primary
- **Playbill Oxblood** (oxblood): the curtains, the swag valance, every display title, ticket numerals, cue numbers, links, focus underline on inputs and the selected state of page tabs and chips. Its deeper sibling **Curtain Fold** (oxblood-2) is the swag shadow and an under-sheet colour.

### Secondary
- **Gilt** (gold): the proscenium, pilasters, the default button, the current ticket, the knob cap, selection highlight and the active page dot. **Gilt Highlight** (gold-2) is bead moulding, footlight lamps and the ticket slider; **Gilt Shade** (gilt-shade) is the frieze, bead ground and banner ribbon ends. **Gilt Ink** (gold-ink) is the only gold allowed as text on paper (console host lines).

### Tertiary
- **Prussian Teal** (teal) and **Backdrop Teal** (teal-2): the painted backdrop, the default endpaper under-sheet and the Now Playing widget. **Stage Teal** (stage-teal) is the stage ground behind the backdrop plate.
- **Viridian** (viridian) means reused / OK / connected; **Vermilion** (vermilion) means warning / busy. Both appear as pill outlines, diamond markers and console colours, always with a word beside them.

### Neutral
- **Lamp Ink** (ink): all outlines, body text, table header rules and double rules.
- **Faded Ink** (ink-2): secondary text, hints, table headers.
- **Clean Sheet** (paper) and **Bright Sheet** (paper-2): scene sheets, tickets, cue cards, label chips, inputs and paper buttons.
- **Hairline** (rule): table row lines, column rules, ghost borders.
- **House Dark** (house): the auditorium behind the theatre.
- **Kraft** (kraft) and **Stage Boards** (kraft-2): the footlights rail wood, the Studio side rail, knob and wire-slider tab, scrollbar thumb.
- **Screen Night** (screen-night): the keypad screen ground, a cut-paper night sky behind the tiles.

### Named Rules
**The Clean Sheet Rule.** Anything a collaborator must read exactly (tables, pin maps, code, protocol) sits on Clean Sheet with Lamp Ink. Colour belongs to the theatre, never under the numbers.

**The Gilt Is Not Text Rule.** Gold fills surfaces; it never sets text on paper. Use Gilt Ink when a gold-family text colour is required.

## Typography

**Display Font:** Ultra (with Rockwell Extra Bold, Rockwell, Georgia)
**Body Font:** Atkinson Hyperlegible (with Segoe UI, system-ui)
**Label/Mono Font:** Red Hat Mono (with ui-monospace, Consolas)

**Character:** Fat wood-type playbill slab for the show, a hyperlegible humanist sans for the reading, and a quiet mono for anything that is data. All three are inlined as woff2 so the playbill never falls back.

### Hierarchy
- **Display** (Ultra 400, clamp(1.55rem, 3vw, 2.45rem), 1.12): scene titles on the sheet's bill head, always oxblood, max 26ch, centred. The device title card uses clamp(1.4rem, 2.6vw, 2.1rem); the banner sets the project name along the arch path.
- **Headline** (Ultra 400, 1.08 to 1.3rem): part headings inside a sheet, prompt-book and Studio panel titles, act tags. Oxblood.
- **Title** (Atkinson 700, 1.06rem, 1.3): h3 subheads in ink.
- **Body** (Atkinson 400, 16px, 1.6): prose capped at 70ch; tables at .9rem; hints at .86rem in Faded Ink.
- **Label** (Atkinson 700, .8 to .9rem): buttons, tickets, cue text, field labels.
- **Mono** (Red Hat Mono 500, .76 to .82rem): table headers (uppercase, .04em tracking), pills, console, act dates, passkeys; numerals tabular.

### Named Rules
**The Wood-Type Is For Names Rule.** Ultra sets names (scene titles, part heads, ticket numerals, cue numbers, the clock). It never sets running text or data.

## Layout

The window is a three-by-three grid: the arch across the top (clamp(66px, 11vh, 104px)), pilasters left and right (clamp(12px, 3.2vw, 46px)), the footlights rail across the bottom, and the stage in the middle. The page itself never scrolls; each scene is an absolutely positioned layer on the stage that scrolls internally, padded clamp(38px, 7vh, 64px) at top to clear the valance and clamp(14px, 6.4vw, 104px) at the sides to clear curtains and wings.

Sheets cap at 1140px (Studio 1180px, device scene 1240px). Long reference prose sets in ruled newspaper columns (3 x 250px, 44px gap, hairline column rule). The device scene is a 1.4fr / 1fr split (player left, prompt book right) that stacks below 980px. Below 760px the back and middle wings drop out, the front wing narrows to 16px, the rail left-aligns and scrolls, and the arch side slip hides below 1080px. Everything holds at 390px.

Spacing rhythm runs 6, 8, 14, 22 and 44px; parts within a sheet separate with 22px above and below a double rule.

## Elevation & Depth

Depth is stacked paper, lit from above. One soft ambient shadow is the house shadow for every loose sheet and card; buttons and tickets carry a short drop; the keypad shell carries a heavier stage shadow. Under every scene sheet sits a second, deckled endpaper sheet offset about 12 x 10px and rotated under one degree, its colour set per sheet (teal, gold or oxblood). Wings sit in three z-depths and drift with parallax by depth (5, 9, 14).

### Shadow Vocabulary
- **House sheet** (`box-shadow: 0 14px 26px -14px rgba(5,10,14,.7), 0 2px 3px rgba(5,10,14,.18)`): scene sheets, under-sheets, cue cards, the title card, the arch slip.
- **Card drop** (`box-shadow: 0 6px 10px -6px rgba(0,0,0,.65), inset 0 -2px 0 rgba(0,0,0,.12)`): gold buttons; tickets use `0 6px 9px -6px rgba(0,0,0,.75)`.
- **Player** (`box-shadow: inset 0 0 0 3px #8f6337, 0 22px 30px -16px rgba(0,0,0,.85), 0 3px 4px rgba(0,0,0,.4)`): the keypad shell.
- **Paper tile** (base `0 1cqw 1.6cqw -.8cqw rgba(0,0,0,.8)`; face `0 .5cqw .9cqw -.3cqw rgba(0,0,0,.5), inset 0 .25cqw 0 rgba(255,255,255,.25)`): the two layers of a screen tile.

### Named Rules
**The Under-Sheet Rule.** Every scene sheet has a coloured endpaper under-sheet, deckled and slightly rotated. A sheet without one reads as a web card.

**The Soft Shadow Rule.** Paper shadows are soft and negative-spread. Hard zero-blur offset shadows do not belong to this world.

## Shapes

Paper is nearly square-cornered (2 to 4px). Sheet tops and bottoms are deckled with a repeating torn-edge mask (120 x 8px); the arch ribbon is a curved path; curtains end in a swept curve (100% 26% corner). Rule work is typographic: 3px double rules between parts, 5px double-hairline fleuron rules, rotated 9px diamonds as markers. Only the device is soft: the shell at 26px, bezel 14px, screen 8px, bare board 10px, tiles at 16%. The round admit-ticket on screen is cut with semicircular notches.

## Components

### Buttons
Paper cut-outs that tilt when touched.
- **Shape:** gently squared (3px).
- **Gold (default on the stage):** Gilt with grain, Lamp Ink label, 8px 14px, card drop.
- **Paper (inside sheets, prompt book and Studio):** Bright Sheet with a 1.5px hairline inset ring.
- **Ghost:** transparent with hairline ring; on the stage the ghost becomes paper with a 1.5px ink ring.
- **Hover / Active:** lifts 1px and rotates -.4deg on the press spring (cubic-bezier(.34, 1.4, .64, 1)); press drops 1px and flattens the shadow. Selected tabs and chips fill Playbill Oxblood with paper text; segmented mode fills ink.
- **Focus:** 2px ink outline, 2px offset, with a 5px paper halo.

### Chips (pills)
- **Style:** white ground, mono .78rem, 1.5px inset ring in currentColor, 2px corners, a rotated diamond dot.
- **State:** viridian ok, vermilion warn, oxblood accent; always worded.

### Cards / Containers (scene sheets)
- **Corner Style:** square, with deckled top and bottom edges.
- **Background:** Clean Sheet with grain.
- **Shadow Strategy:** house sheet, plus the endpaper under-sheet.
- **Internal Padding:** clamp(24px, 3.4vw, 40px) by clamp(16px, 3.4vw, 44px).
- **Bill head:** centred Ultra title, fleuron rule, Faded Ink lede.

### Inputs / Fields
- **Style:** Bright Sheet, no box, 2px hairline underline, 2px top corners.
- **Focus:** underline turns oxblood and the ground goes white; caret is oxblood.

### Navigation (footlights rail)
Tickets on a wooden rail under a strip of footlight lamps. Each ticket is a paper slip with an oxblood Ultra roman numeral, tilted by alternating small angles. Hover lifts 2px; the current ticket turns gold, straightens and rises 5px while a gilt slider glides beneath it (.55s ease-out). On narrow screens the rail scrolls horizontally.

### Lighting Cue (signature)
Device state is lit, then written. A full-stage gel layer recolours the scene (house warm, spot, pairing wash in magenta, blackout hatched dark, dim), and a rotated paper cue card below the player names it: oxblood Ultra cue number, then the state in words. The cue card is aria-live. Colour is never the only signal.

### Paper Tile (signature, keypad screen)
Two paper layers: a dark base (the tile colour mixed 45% toward black) and a light face (8% toward white) offset up-left, each with its own grain and a tiny seeded rotation. A white Lucide glyph sits on the face. Below sits a paper label chip in Atkinson 700, rotated a degree. Pressing flattens the face onto the base on the press spring (.32s). Confirmation is a rubber-stamp ring (green ok, red alert) that stamps in and fades.

### Scene Change (signature motion)
The outgoing sheet drops through the stage (translateY 112%, rotate 2.5deg, .55s ease-in), the incoming sheet slides in from the wing (from translateX -108%, rotate -2deg, .85s exponential ease-out, .1s delay), and the wings shift. Reduced motion removes all transitions and animations.

## Do's and Don'ts

### Do:
- **Do** draw new plates as authored SVG: Lamp Ink outline, 45-degree hatching, flat fills from this palette.
- **Do** put every new scene on a Clean Sheet with deckled edges and a coloured endpaper under-sheet.
- **Do** set scene and part titles in Ultra, oxblood; keep reading text in Atkinson Hyperlegible and data in Red Hat Mono.
- **Do** name every device state with a cue card in words alongside its gel.
- **Do** use the house sheet shadow for loose paper and the press spring for anything touched.
- **Do** keep loose-paper rotations small (under 2.5 degrees) and seeded, never random per render.

### Don't:
- **Don't** add a header bar, tab strip or card grid; navigation is tickets on the footlights rail.
- **Don't** set gold text on paper or put colour fills under tables, code or pin maps.
- **Don't** use hard zero-blur offset shadows on paper pieces.
- **Don't** signal state by colour alone; pills, cues and stamps always carry a word.
- **Don't** add small uppercase labels above titles; the bill head is title, fleuron, lede.
