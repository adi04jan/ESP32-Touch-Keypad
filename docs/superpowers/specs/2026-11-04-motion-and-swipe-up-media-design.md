# Motion: pages under the finger, Media on a swipe up, Settings on the bar

Date: 2026-11-04 · firmware 3.13.2 → 3.14.0 · Studio 3.13.2 → 3.14.0

## Why

The owner's words: opening a page "like profile, setting etc", and scrolling "from bottom
to top or side to side", "feel cheap and outdated". "Motion looks rigid and cheap." They
want it to "follow my finger and spring like a phone". Their reference for the feel is
NXP's LVGL smartwatch demo.

Today nothing moves while a finger drags. A sideways swipe is classified on release, by
distance (`SWIPE_X_PX`, 18 % of the width). The new page's keys then pop in as a diagonal
wave (`startWave`), or wipe down when the page kind changes (`startWipe`). Settings is
uncovered from the bottom on a fixed timer, and neither can be dragged or flicked.

In the same conversation the owner also rearranged what a swipe up and the quick bar do:
Media moves off the bar onto a swipe up, and Settings moves from the status band to the
bottom of the bar.

Mockups (not committed; `.superpowers/` is git-ignored), in
`.superpowers/brainstorm/26642-1793777437/content/`:
- `motion.html`: page styles A/B/C and Settings styles A/B/C, with a "keypad estimate"
  frame-rate toggle.
- `layout.html`: the new layout, with page style B, a Media sheet that rises with a drag
  and spring, and Settings on the bar.

## Decided by the owner

- **Pages: "Follow + spring" (B).** During a sideways drag the page stays under the finger.
  On release it springs, with a little overshoot, to the nearest page, or to the next one
  on a flick. The owner did not pick C, the fade and depth.
- **A swipe up always opens Media, as "Drag + spring, keys fall back" (B).** The Media sheet
  follows the finger up and springs open. The keys behind dim and sink back a little. A
  drag down closes it, following the finger.
- **Media covers just the keys** (x 0–420). The bar stays lit and usable beside it.
- **The bar is Explorer, Git, Cmds, then Settings.** Settings is always there, at the
  bottom.
- **The gear leaves the status band**, so there are not two Settings buttons.
- **Clock speeds stay as they are.** The owner asked about raising the CPU and SPI clocks
  and was told they are all at their maximum already: the CPU at 240 MHz, the flash at
  80 MHz QIO, and the LCD SPI at 80 MHz (the ESP32's limit, measured clean on this panel).
  A full frame is 307 KB, about 31 ms over the wire, so roughly 30 fps for a full screen.
  The speed has to come from sending fewer pixels.
- **Pages slide in software, and the status band and page dots stay steady and visible.**
  The hardware-scroll test (see Constraints) gave 60 fps, but the band and dots jittered
  and smeared. Of the four options put to the owner, they chose the software slide: about
  25 fps as measured, with nothing jittering. They asked: "can we push upto 30fps?" The
  goal is **30 fps** for page slides.
- **The Media and Settings rise** is also redrawn every frame. The owner saw the mockup's
  estimate of about 30 fps and still picked B. Its goal is 30 fps too.

## Calls stated to the owner (check these)

- Tapping Settings on the bar brings Settings up with the same spring as Media. Done, or a
  drag down that follows the finger, closes it.
- The bar's saved entry 1 (on the owner's keypad, Media → profile 1, page 2, the player)
  becomes the swipe-up page. Entries 2–4 become the bar's three buttons. Nothing has to be
  set up again. Studio labels entry 1 "Swipe up".
- The profile chip in the status band still opens Settings › Profiles.

## Calls made while writing (not yet heard by the owner)

- **Every page change slides with the spring**, not only a drag. That covers the page
  line's stations, `page` and `back` keys, and host `page`. A jump of several pages slides
  the target page in from its side, without passing through the pages between.
- **Pages inside a bar panel** (Explorer, Git, Cmds) follow the finger the same way.
- **At either end of the page row** the page drags with resistance (about 35 % of the
  finger's travel) and springs back.
- **Closing Media shows what was under it**: the home keys, or the bar panel that was open.
  That layer is on screen, dimmed, for the whole drag anyway.
- **With Media open:**
  - Tapping Explorer, Git or Cmds opens that panel, and Media springs down.
  - Tapping Settings brings Settings up over everything.
  - A swipe up does nothing.
- **An empty entry 1**: a swipe up does nothing.
- **Media keeps today's paging.** Sideways swipes inside the Media sheet move through
  entry 1's profile pages and follow the finger, with its own page line and `back`, as the
  Media panel does today (`EVT:PANEL 1 <profile> <page>`,
  `test_panel_folder_back_and_swipe_stay_in_the_panel`).
- **A custom tile may arrive a few frames late.** On an incoming page, a key with a custom
  tile or GIF may show its plain face for a few frames until the tile is read. That does
  not count as "a missing tile". The owner's profiles have no custom tiles or GIFs today (0
  of 741 keys in `build/dailyboard-2026-11-04/`), so this rarely shows.
- **Unchanged animations**: profile switches, a bar panel opening, the shade, the host
  menu, pairing and calibration keep what they have today.
- **Frame-rate floors in the device tests**: page slides and the Media and Settings rise get
  a 25 fps floor, with 30 as the goal. Every other animation keeps the 50 fps floor.
- **If 30 fps is out of reach** without drawing keys with less detail while they move, the
  builder asks the owner before cutting any detail. The owner is told the measured rate
  either way.
- **The page dots** move to the new page when the slide passes halfway, or when it settles.
  That is the builder's choice; either way they don't move sideways.

## Goals

- During a sideways drag, the page moves with the finger. On release it settles with a
  spring, and a short flick is enough to turn the page.
- A swipe up, from anywhere on the keys or an open panel, opens Media in one motion.
- Settings has one way in: the bottom of the bar.
- Page slides and the Media and Settings rise reach 30 fps on the owner's real pages,
  measured with `perf` during an injected drag and swipe up. The floor is 25 fps.

## Non-goals

- Clock changes, overclocking, or a hardware change (for example a parallel display bus).
- Page style C (fade and depth), or Settings growing out of the gear.
- New motion for profile switches, the shade, panels opening, pairing or calibration.
- Spring settings in Studio.

## Anti-goals (a failure even if it works)

- **The page trails the finger** visibly, more than a frame or two behind.
- **Taps and drags get confused**: a tap on a key with a little wobble doesn't fire, or a
  deliberate drag fires the key it started on.
- **The status band or page line shimmers or tears** during a page slide.
- **`ERR no RAM`**, or a missing tile, when sliding between pages with custom tiles, or
  when opening Media while a cover is loaded.
- **The owner loses their place.** Closing Media or Settings must return to exactly where
  they were: the same profile, page and open panel.
- **The update wipes data**: Bluetooth bonds, the touch calibration, profiles, settings or
  the quick bar.
- **Other animations drop below 50 fps**: key presses, rings, the wave, toasts, the volume
  panel and the shade.

## Constraints and facts

**Hardware and renderer**:
- **Board**: ESP32-WROOM-32E with no PSRAM.
- **Display**: ST7796 over SPI at 80 MHz write, driven by LovyanGFX with DMA
  (`display.cpp`). The XPT2046 touch shares that SPI bus (`bus_shared`) and is polled
  every 10 ms (`TOUCH_POLL_MS`), so touch reads compete with display transfers.
- **Renderer**: `ui.cpp` is damage-tracked. Dirty rectangles render into `CHUNK_PX`
  (96×90) chunks, which go out by DMA while the next chunk renders. `uiTick` draws at most
  one frame per 16 ms.
- **Layout** (`board.h`, `ui.cpp`), on a 480×320 landscape screen:
  - The status band is y 0–30 (`STATUS_H`).
  - The keys are x 0–420 (`KEYS_W`), in 84×90 cells (5×3), over y 30–300.
  - The page line is y 300–320 (`LINE_Y`).
  - The bar is x 420–480 from y 30 to 320: the suggestion slot is `SUG_H` 58, and each
    button is `QB_H` 57.
  - The Settings sheet covers x 0–480, y 30–320.
- **The slide is drawn in software.** During a slide the key area (x 0–420, y 30–300) is
  redrawn every frame at the drag's offset, showing the two pages it lies between. The
  status band, the page line and the bar are not redrawn for the motion.
- **The 30 fps budget is about 33 ms a frame, and today's drawing needs about 39 ms.**
  `rbench` (cell 0 of profile 11, page 1) splits a cell's 2.6 ms into:
  - glass fill: 1.03 ms
  - the host tag, on host keys only: 0.54 ms
  - icon glyph: 0.44 ms
  - shadow: 0.18 ms
  - label: 0.17 ms
  - JSON reads: 0.12 ms

  The key area's 227 KB takes about 23 ms over SPI, and the chunk renderer overlaps that
  transfer with drawing. So a slide is bound by drawing, and 30 fps needs key drawing about
  20 % faster. The obvious levers:
  - the glass fill: solid interior spans, with antialiasing only at the edges
  - drawing on both of the ESP32's cores; Bluetooth runs on core 0
- **Hardware scroll was tried and dropped.** The ST7796's vertical scroll (VSCRDEF 0x33,
  VSCSAD 0x37) runs along the panel's 480-line axis, which is screen x in this rotation.
  - **Results** (2026-11-04, bc:f0, throwaway branch `spike/hw-scroll`, `spike_scroll.cpp`,
    command `vscroll`):
    - **Check 1 passes.** VSCRDEF TFA 0, VSA 420, BFA 60 slides x 0–420 sideways with the
      bar fixed. VSCSAD k puts frame-memory column (i + k) mod 420 at screen column i. A
      page's column j always lives in frame-memory column j, so only the columns coming
      into view are drawn.
    - **Speed:** a frame costs 6.8 ms. That is 1.5 ms for the incoming columns of synthetic
      keys, and about 5 ms to rewrite the status band and page line (420×50 px) at the new
      offset. 60 fps holds.
    - **The drag keeps up with the finger** (the owner).
    - **Check 2 fails as built.** The owner saw the status band and page line "jitter a
      little and also move with pages", and "pink lines" at the top and bottom. Those are
      the colored bits smearing: the bell's magenta badge, the profile color, the current
      page dot. Each scroll step shows the old band at the new offset until the rewrite
      lands.
    - **No tear-sync pin is wired** (`board.h`). The panel's scanline register (45h) does
      read back, but noisily. LovyanGFX's default gives a 10-bit count with low bits stuck
      high. A slide timed to the refresh is unproven.
    - **Software slide cost:** `rbench` puts one cell at 2.6 ms, so a full key area in
      software is about 39 ms, roughly 25 fps (an earlier guess said 30–40).
    - **Every theme's ground is a function of y only** (`groundAt(y)`). A status band or
      page line with its contents hidden is the same in every column, so the scroll can't
      show on it.
- **Two pages are visible at once** during a slide, so the neighbour page's keys are
  needed alongside the current page's. There is no PSRAM. A profile file is 4–7 KB of
  JSON.
- **Custom tiles**: they are 72 px RGB565 images (10,368 B each) in LittleFS. `TILE_CACHE`
  holds 4, and `uiDropTileCache()` frees them when RAM runs short. A slide can show up to
  30 tiles (two pages of 15).
- **The Media cover** is decoded into a 32 KB image while a player is on screen
  (`artSync`).
- **Media is a panel today** (`uiPanel(1)`, `EVT:PANEL`): `qb[0]`'s profile page, loaded
  into `panelDoc` and drawn over the key area. The player is a full-page widget
  (`widget: "media"` on cell 0, buttons `PB6`/`PB7`).
- **Themes**: there are ten (`themes.h`). The Media sheet, the dimming and the Settings
  button must look right in each. Crisp themes (Retro, Synth) use 4 px corners instead of
  12 px.

**Gestures** (`touch.cpp`, `ui.cpp` `uiGesture`):
- `G_MOVE` already arrives on every poll while a finger is down, with the start and current
  points. `G_SWIPE_*` and `G_TAP` come on release.
- Today a swipe up opens Settings (`uiOpenSheet`) and a swipe down opens the shade. In the
  sheet, a swipe down closes it. The status band's gear is the tap at `x >= 440`
  (`y0 < STATUS_H && x0 >= 440`, in both the player and key branches). The bar takes taps
  only (`barHit`, `barTap`).
- With this design:
  - A swipe up opens Media.
  - A swipe down opens the shade when nothing is open, and closes Media or Settings when
    they are.
  - The tap at `x >= 440` in the status band no longer opens Settings.

**Quick bar protocol** (`docs/PROTOCOL.md`, `qbParse`, NVS `kp/qbar`):
- `quickbar` keeps four entries in the same JSON.
- Entry 1 is the swipe-up page.
- Entries 2–4 are the bar's buttons, top to bottom.
- Settings sits below them and is not in the JSON.
- `panel <n>` and `EVT:PANEL <n>` keep their numbering, so 1 is Media.
- The owner's stored bar (`[Media, Explorer, Git, Cmds]`) becomes exactly what they asked
  for, with no migration.

**Studio**:
- The Quick bar editor (`studio/renderer/app.js` `qbDraft` and its form) labels entry 1
  "Swipe up".
- The device preview (`qbarHTML`, `styles.css`) draws entries 2–4 and a Settings button,
  and no gear in the status band.

**Tests and devices**:
- **Device tests**: `tools/tests/test_device.py`, run with the Store Python 3.11 and
  `KP_PORT`.
  - `swipe x1 y1 x2 y2 [ms]` interpolates the finger, so it produces a `G_MOVE` stream, and
    drag-follow can be tested.
  - `perf` measures frame timing. `FPS_FLOOR` is 50.
  - Tests that open panels from the bar, or Settings with a swipe up or the gear, change
    with this design.
  - Tests write slot 16 only. The suite fails if slots 1–15 change.
- **Boards**: the daily board is bc:f0, the owner's. Keep its bonds, calibration and state,
  and flash it with release firmware. 58:F8 is the second board. Read the MAC before
  flashing. Ask the owner to quit Studio before USB tests.
- **Commits**: local only, no Co-Authored-By or Claude-Session lines. Never push.
- **Docs to update**:
  - `docs/PROTOCOL.md`: what the quick bar's entries mean.
  - `firmware/DESIGN.md`: Layout and Motion.
  - `docs/PLAN.md`: a version entry.
  - A note in `docs/superpowers/specs/2026-11-03-quick-bar-design.md`. It decided "Settings
    is not on the bar, because the status band already has the gear", and this design
    reverses that.

## Left to the builder

- **The slide's mechanics**: how the renderer draws the key area at an offset, with two
  pages side by side.
- **How to reach 30 fps**: glass-fill and glyph speedups, two-core drawing, or anything
  else that keeps the keys looking exactly as they do at rest (see the call about detail).
- **The drag's feel**: the axis-lock distance, the velocity window and the flick
  projection. The mockup used an 8 px lock, the last ~6 samples, and position − velocity ×
  0.18 s.
- **The spring**: the mockup used stiffness 230 and damping 0.78 for pages, and 240 and
  0.8 for the sheets. Keep these in one place. Hardware feel needs tuning, so exposing them
  on the CLI is welcome.
- **RAM**: how the neighbour page's keys and tiles are held, within the heap.
- **The sink**: the scale for keys sinking back, and the dim amount (the mockup used 5 %
  and 45 % black). If scaling custom tiles every frame costs too much, keep the dim, drop
  the sink, and tell the owner.
- **Tests**: their design, including a `perf` measurement during an injected drag and an
  injected swipe up.
