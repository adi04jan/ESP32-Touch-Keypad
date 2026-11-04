# Motion and swipe-up Media Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pages follow the finger and spring into place. A swipe up opens Media as a sheet that follows the finger. Settings moves to the bottom of the quick bar, and the gear leaves the status band. Firmware 3.14.0, Studio 3.14.0.

**Architecture:**
- **One spring model** (`motion.h`) drives three motions: page slides, the Media sheet and the Settings sheet.
- **Slides are drawn in software.** The damage-tracked renderer draws the view's page and its neighbour at an x offset, using a chunk-origin pan (`gfxPan`). The status band, the page line and the bar are never redrawn for motion, so they can't jitter.
- **Media becomes its own layer** above the bar panels. Closing it shows what was under it.
- **Page and layer state commit at the decision.** That is on release for a drag, and at once for a key, station or host command. What follows is only the picture catching up.

**Tech Stack:** ESP32 Arduino core 3.2.1, LovyanGFX, ArduinoJson 7, arduino-cli via `tools/kp.py`; device tests in pytest (`tools/tests/test_device.py`); Studio (Electron, `node --test`).

**Spec:** `docs/superpowers/specs/2026-11-04-motion-and-swipe-up-media-design.md`. Mockups: `.superpowers/brainstorm/26642-1793777437/content/motion.html` and `layout.html`. The hardware-scroll spike, kept for reference and never merged, is on branch `spike/hw-scroll`.

## Global Constraints

- **The board:** ESP32-WROOM-32E with no PSRAM. ST7796 at 80 MHz SPI. CPU, flash and SPI clocks stay as they are.
- **The motion constants:**
  - Drag lock: 14 px of movement, along the dominant axis.
  - Flick projection: position + velocity × 0.18 s.
  - Page spring: k 230, damping 0.78.
  - Sheet spring: k 240, damping 0.80.
  - End-of-row resistance: 35 % of the finger's travel.
  - Behind a rising sheet, the dim is 45 % black and the sink 5 %.
- **Frame-rate floors** (measured by `perf`):
  - Page slides and sheet rises: 25 fps, with 30 as the goal. Tasks 3–4 assert an interim 20, and Task 5 raises it to 25.
  - Every other animation: `FPS_FLOOR` 50.
- **Keys look exactly as they do at rest** while they move. No detail is cut without asking the owner.
- **The status band, the page line and the bar** are never redrawn by a slide.
- **The update keeps the user's data:** Bluetooth bonds, the touch calibration, profiles, settings and the quick bar (NVS `kp/qbar`, unchanged format).
- **The quick bar:** `quickbar` keeps four entries. Entry 1 is the swipe-up page (Media), entries 2–4 are the bar's buttons from the top, and Settings is fixed below them. `panel <n>` and `EVT:PANEL <n>` keep their numbering.
- **Device tests write slot 16 only.** The suite fails if slots 1–15 change.
- **Boards:** read the MAC before every flash (`esptool read-mac`). bc:f0 is the owner's daily board: back up its state before a test session and flash release firmware back after it. Ask the owner to quit Studio before USB work.
- **Commits:** local only, no Co-Authored-By or Claude-Session lines, never push. Work on branch `feature/motion` from `main`.
- **Secrets:** never print profile contents (one holds a password). Print names and pass/fail only.

**Device test session** (every task):

```bash
PY=/c/Users/Adity/AppData/Local/Microsoft/WindowsApps/PythonSoftwareFoundation.Python.3.11_qbz5n2kfra8p0/python.exe
"$PY" -m esptool --port $KP_PORT read-mac            # bc:f0 or 58:f8, never anything else
KP_PORT=$KP_PORT "$PY" tools/kp.py flash               # the test build (KP_TEST: HID dry-run)
KP_PORT=$KP_PORT "$PY" -m pytest tools/tests/test_device.py -k "<names>" -q > $WS/dev.log 2>&1; tail -5 $WS/dev.log
```

At the start of a session on bc:f0, run `keypad_state.save` (`tools/e2e/keypad_state.py`) into `build/dailyboard-before-motion/`, and save the `quickbar` reply there too. At the end, flash `--release` and compare `keypad_state` against that backup.

## Review Focus

1. **Auto-switch or a profile upload lands mid-drag or mid-spring.** The slide ends at once, the new profile shows on page 1, and no stale neighbour page is left drawing (Task 3, `test_profile_change_mid_drag_ends_the_slide`).
2. **A drag starts on the bar or on a player control.** It moves the page as anywhere else, and the control doesn't fire (Task 3, `test_drag_from_the_bar_or_a_player_button_slides_and_fires_nothing`).
3. **Everything is open at once:** a cover, a bar panel, Media dragging over it, and a neighbour page. The heap stays clear of `ERR no RAM`, and all of it is given back on close (Task 4, `test_media_drag_over_a_panel_with_a_cover_keeps_the_heap`).
4. **A finger lands while a page is still springing.** The slide finishes at once, and the touch works on the page that is now in place (Task 3, `test_a_touch_mid_spring_lands_on_the_settled_page`).
5. **Both ends of the page row.** A drag past the first or the last page gives a little, springs back, and sends no `EVT:PAGE` (Task 3, `test_both_ends_of_the_row_give_and_spring_back`).

---

### Task 1: The bar becomes Explorer, Git, Cmds, Settings; a swipe up opens entry 1; the gear goes

**Files:**
- Modify: `firmware/TouchKeypad/ui.cpp`: `drawBar`, `barHit`, `barTap`, `drawStatus`, and the `uiGesture` home and player branches.
- Modify: `studio/renderer/app.js`: `QB_ROWS`, the Quick bar hint, `qbarHTML`, and `devHTML`'s status band.
- Test: `tools/tests/test_device.py`

**Interfaces:**
- **Produces in `ui.cpp`:**
  - `#define QB_SETTINGS 5`.
  - `barHit(x, y)` returns -1 off the bar, 0 for the suggestion slot, 2–4 for the entry buttons (rows 0–2), and `QB_SETTINGS` for row 3.
- **Produces in the tests:**
  - `BAR = {2: (450, 118), 3: (450, 175), 4: (450, 232), "settings": (450, 289)}`.
  - `QB_TEST` becomes `[Media → SLOT p1, Panel → SLOT p1, Git → SLOT p3, None]`.
  - `QB_FULL` sets all four entries.
  - `swipe_up(d, ms=250)` is `d.swipe(210, 270, 210, 90, ms)`, and `swipe_down(d, ms=250)` is `d.swipe(210, 90, 210, 270, ms)`.

- [ ] **Step 1: Write the failing tests and move the old bar tests to the new rows**

Rewrite the existing tests as follows:
- Every test that taps `BAR[1]` taps `BAR[2]` and expects `EVT:PANEL 2 …` / `panel:2`.
- `test_tapping_an_empty_button_leaves_the_panel_open` taps `BAR[4]`.
- `test_button_to_a_missing_page_does_nothing` puts its page-9 button in entry 2 and taps `BAR[2]`.

The new tests:

```python
QB_TEST = [{"profile": SLOT, "page": 1, "icon": "music", "label": "Media"},
           {"profile": SLOT, "page": 1, "icon": "folder-open", "label": "Panel"},
           {"profile": SLOT, "page": 3, "icon": "git-branch", "label": "Git"}, None]
QB_FULL = QB_TEST[:3] + [{"profile": SLOT, "page": 1, "icon": "square-terminal", "label": "Cmds"}]
BAR = {2: (450, 118), 3: (450, 175), 4: (450, 232), "settings": (450, 289)}   # rows 0-3 under the suggestion slot

def swipe_up(d, ms=250): d.swipe(210, 270, 210, 90, ms)
def swipe_down(d, ms=250): d.swipe(210, 90, 210, 270, ms)

def test_bar_rows_are_entries_2_to_4_then_settings(d):
    set_qb(d, QB_FULL); since = len(d.events)
    for n, page in ((2, 1), (3, 3), (4, 1)):
        d.touch(*BAR[n]); d.wait_event(rf"^EVT:PANEL {n} {SLOT} {page}$", 2, since)
    d.ok("panel 0"); time.sleep(0.4)
    d.touch(*BAR["settings"]); d.wait_event(r"^EVT:UI sheet$", 2, since)

def test_swipe_up_opens_entry_1_and_swipe_down_closes_it(d):
    set_qb(d); since = len(d.events)
    swipe_up(d); d.wait_event(rf"^EVT:PANEL 1 {SLOT} 1$", 2, since)
    assert not evts(d, since, "EVT:UI sheet")
    swipe_down(d); d.wait_event(r"^EVT:PANEL 0$", 2, since)
    assert not evts(d, since, "EVT:UI shade")

def test_swipe_up_with_no_entry_1_does_nothing(d):
    set_qb(d, [None] + QB_TEST[1:]); since = len(d.events)
    swipe_up(d); time.sleep(0.6)
    assert not evts(d, since, "EVT:PANEL") and not evts(d, since, "EVT:UI")

def test_swipe_up_with_media_open_does_nothing(d):
    set_qb(d); swipe_up(d); time.sleep(0.6); since = len(d.events)
    swipe_up(d); time.sleep(0.6)
    assert not evts(d, since, "EVT:") and "panel:1" in d.cmd("status")[0]

def test_status_band_has_no_settings_button(d):
    since = len(d.events)
    d.touch(466, 14); time.sleep(0.5)                      # where the gear was
    assert not evts(d, since, "EVT:UI")
```

- [ ] **Step 2: Run them; they fail**

Run the five new tests with `-k "bar_rows or swipe_up or no_settings_button"`.
Expected: FAIL. Row 0 opens entry 1, a swipe up opens the sheet, and (466, 14) opens the sheet.

- [ ] **Step 3: Implement in `ui.cpp`**

- **`drawBar`:** draws `qb[1..3]` in rows 0–2. Row 3 is Settings: the UI glyph `"settings"` (`iconFind("settings", true)`), labelled "Settings", in the same look as a button.
- **`barHit`:** maps the rows as in Interfaces.
- **`barTap`:**
  - 2–4: as today, `uiPanel(panel.btn == i ? 0 : i)`.
  - `QB_SETTINGS`: `feedbackClick()` then `uiOpenSheet()`.
- **`drawStatus`:** the `rrFill(454, …)` gear and its glyph go. `int right = 450 - drawBattery(466, 14);`, so the right-aligned group moves 26 px right.
- **`uiGesture`:**
  - Both `y0 < STATUS_H && x0 >= 440` tap branches go.
  - `G_SWIPE_U`: `if (panel.btn != 1) uiPanel(1)`. An empty or broken entry 1 is a no-op inside `uiPanel`.
  - `G_SWIPE_D`: `panel.btn == 1 ? uiPanel(0) : uiOpenShade()`.
  - The same applies in the player branch.

- [ ] **Step 4: Run them, then the whole quick bar and sheet group**

Run: `-k "bar or panel or swipe or sheet or settings_button"`
Expected: all pass.

- [ ] **Step 5: Studio**

In `app.js`:
- `QB_ROWS[0] = ["Swipe up", "music"]`.
- The hint reads: "The first opens with a swipe up from the keys. The other three are buttons right of the keys, with Settings below them."
- `qbarHTML` maps `qb.slice(1)`, then appends a Settings cell (`kicon("settings", 22)` + "Settings").
- `devHTML` drops `<span class="gear">…</span>`.

Run `cd studio && npm test`. Expected: 85/85 pass.

Then look at the device preview in the running Studio: three buttons and Settings, and no gear.

- [ ] **Step 6: The full device suite, then commit**

Run: the whole `tools/tests/test_device.py`. Expected: all pass. The count grows by 5.

```bash
git add firmware/TouchKeypad/ui.cpp tools/tests/test_device.py studio/renderer/app.js
git commit -m "Bar: entries 2-4 then Settings; a swipe up opens entry 1 (Media); no gear in the status band"
```

### Task 2: Media is its own layer over the bar panels

**Files:**
- Modify: `firmware/TouchKeypad/ui.cpp`: the panel state, `keyAt`, `toggled`, `groundAt`, `emitKey`, `emitPanel`, `viewPage`, `viewPages`, `panelGo`, `uiPanel`, `uiPanelOpen`, `uiKeyGoPage`, `uiKeyBack`, `uiProfilesChanged`, `uiSetProfile`, `barTap`, `renderChunk`, `artSync`.
- Test: `tools/tests/test_device.py`

**Interfaces:**
- **Consumes:** Task 1's `barHit` rows, plus `swipe_up` and `swipe_down`.
- **Produces:**
  - `struct Layer { int8_t btn, prof, page, pages, start, back[8], depth; uint16_t toggles; uint8_t col[3]; JsonDocument doc; };`
  - `static Layer panel, media;`. The global `panelDoc` becomes `panel.doc`.
  - `static Layer *topLayer()` returns `&media` if `media.btn`, else `&panel` if `panel.btn`, else `nullptr`.
  - `keyAt`, `toggled`, `groundAt`, `emitKey`, `viewPage` and `viewPages` read `topLayer()`.
  - `uiPanel(1)` opens `media`, and `uiPanel(2..4)` opens `panel` and closes `media`. `uiPanel(0)` closes both.
  - `uiPanelOpen()` returns the top layer's `btn`.
  - `EVT:PANEL` always reports the top layer after a change, with `EVT:PANEL 0` only when both are closed.

- [ ] **Step 1: Write the failing tests**

```python
def test_media_opens_over_a_panel_and_closing_returns_to_it(d):
    set_qb(d); d.touch(*BAR[3]); d.wait_event(rf"^EVT:PANEL 3 {SLOT} 3$", 2)
    since = len(d.events)
    swipe_up(d); d.wait_event(rf"^EVT:PANEL 1 {SLOT} 1$", 2, since)
    assert "panel:1" in d.cmd("status")[0]
    swipe_down(d); d.wait_event(rf"^EVT:PANEL 3 {SLOT} 3$", 2, since)
    assert "panel:3" in d.cmd("status")[0]

def test_bar_tap_with_media_open_swaps_to_that_panel(d):
    set_qb(d); swipe_up(d); time.sleep(0.6); since = len(d.events)
    d.touch(*BAR[3]); d.wait_event(rf"^EVT:PANEL 3 {SLOT} 3$", 2, since)
    swipe_down(d); d.wait_event(r"^EVT:UI shade$", 2, since)          # media was closed, not hidden
    d.cmd("shade close")

def test_settings_from_media_comes_back_to_media(d):
    set_qb(d); swipe_up(d); time.sleep(0.6); since = len(d.events)
    d.touch(*BAR["settings"]); d.wait_event(r"^EVT:UI sheet$", 2, since)
    d.ok("sheet close"); d.wait_event(r"^EVT:UI home$", 2, since)
    assert "panel:1" in d.cmd("status")[0]

def test_media_keys_report_as_panel_keys(d):
    set_qb(d); swipe_up(d); time.sleep(0.6); since = len(d.events)
    tap(d, 1); d.wait_event(rf"^EVT:PKEY {SLOT} 1 1 1$", 2, since)
```

- [ ] **Step 2: Run them; they fail**

Run: `-k "media_opens_over or swaps_to_that_panel or comes_back_to_media or media_keys"`
Expected: FAIL. Media replaces the Git panel, so closing it gives `EVT:PANEL 0`.

- [ ] **Step 3: Implement the layer**

- **What reads the top layer:** everything that today reads `panel.*` to mean "what the grid shows" reads `topLayer()`.
- **Opening Media** loads `qb[0]`'s page into `media.doc`. `uiProfilesChanged`, the manual-switch close in `uiSetProfile`, and `test_saving_the_panels_profile_reloads_the_panel`'s path treat `media` like `panel`.
- **`renderChunk`** draws only the top layer over the key area, on `PLY`.
- **`artSync`** wants the cover when the top layer's page is a player.

- [ ] **Step 4: Run the panel group**

Run: `-k "panel or media or bar or suggestion"`
Expected: all pass.

- [ ] **Step 5: The full suite, then commit**

Expected: all pass.

```bash
git commit -am "Media is its own layer: it opens over a bar panel and closing it shows the panel again"
```

### Task 3: Pages follow the finger and spring

**Files:**
- Create: `firmware/TouchKeypad/motion.h`
- Modify:
  - `firmware/TouchKeypad/gfx.h` and `gfx.cpp`: `gfxPan`.
  - `ui.cpp`: the slide state, `renderChunk`, `animate`, `uiGesture`, `uiGoPage`, `panelGo` and `viewGo`.
  - `ui.h`: `uiSlidePx`, `uiMotionCmd`.
  - `cli.cpp`: the `status` field and the `motion` command.
- Test: `tools/tests/test_device.py`

**Interfaces:**
- **Consumes:** Task 2's `topLayer()`, `keyAt` and `viewPage`/`viewPages`.
- **Produces:**
  - **`motion.h`:**
    - `struct Spring { float x, v, to, k, z; bool on; };`
    - `bool springStep(Spring &s, float dt)` runs four semi-implicit Euler substeps of `a = -k(x - to) - 2z√k·v`. It returns true when settled (|x − to| < `eps`, |v| < 0.02/s), snapping `x = to` and setting `on = false`.
    - `float flickTarget(float x, float v, float lo, float hi)` returns `constrain(roundf(x + v * 0.18f), lo, hi)`.
    - `#define LOCK_PX 14`.
  - **`gfx.h`:** `void gfxPan(int dx, int dy)` moves the chunk's origin and its clip by (dx, dy). Whatever is drawn at (x, y) then lands at (x − dx, y − dy). The buffer is unchanged, and `gfxPan(-dx, -dy)` undoes it.
  - **`ui.h`:**
    - `int uiSlidePx()` gives the view page's offset in px: positive is moved left, 0 at rest.
    - `void uiMotionCmd(const char *arg)` prints or sets the springs: `motion` prints `motion page k:230 z:0.78 sheet k:240 z:0.80`, and `motion page <k> <z>` / `motion sheet <k> <z>` set them in RAM only.
  - **`status`** gains ` slide:<px>` after `panel:`.
  - **Tests:** `field(d, name)`, `full_profile()`, `SLIDE_FLOOR = 20`.

- [ ] **Step 1: Write the failing tests**

```python
SLIDE_FLOOR = 20   # Task 5 raises it to 25 (goal 30)

def field(d, name):
    return int(re.search(rf" {name}:(-?\d+)", d.cmd("status")[0]).group(1))

def full_profile():   # 2 pages x 15 icon keys, every 4th a host key (its PC tag): the owner's kind of page
    icons = ["copy", "type", "folder", "file-text", "play", "volume-x", "mic", "arrow-left", "layers", "flag"]
    acts = lambda i: [{"type": "host", "cmd": "open notepad", "slot": 5}] if i % 4 == 0 else [{"type": "key", "value": "A"}]
    page = lambda n: {"name": n, "keys": [key(i + 1, f"{n} {i + 1}", acts(i), icon=icons[i % 10]) for i in range(15)]}
    return {"schema_version": 2, "profile_name": "Full", "color": [80, 140, 255], "default_delay": 5, "pages": [page("One"), page("Two")]}

def test_page_follows_the_finger(d):
    d.swipe(400, 160, 100, 160, 1500); time.sleep(0.75)
    off = field(d, "slide")
    assert 80 <= off <= 200 and "page:1 " in d.cmd("status")[0], off   # mid-drag: moved, not committed
    d.wait_event(r"^EVT:PAGE 2$", 3); time.sleep(0.8)
    assert field(d, "slide") == 0

def test_a_flick_turns_the_page(d):
    d.swipe(300, 160, 240, 160, 60); d.wait_event(r"^EVT:PAGE 2$", 1.5)

def test_a_slow_short_drag_springs_back(d):
    since = len(d.events)
    d.swipe(300, 160, 220, 160, 800); time.sleep(1.6)
    assert not evts(d, since, "EVT:PAGE") and field(d, "slide") == 0

def test_both_ends_of_the_row_give_and_spring_back(d):               # Review Focus 5
    since = len(d.events)
    d.swipe(100, 160, 400, 160, 1200); time.sleep(0.6)
    assert field(d, "slide") < -20                                        # page 1 gives to the right
    time.sleep(1.4); d.ok("page 3"); time.sleep(0.8); since = len(d.events)
    d.swipe(400, 160, 100, 160, 600); time.sleep(1.4)
    assert not evts(d, since, "EVT:PAGE") and field(d, "slide") == 0

def test_a_wobbly_tap_fires_and_a_drag_does_not(d):
    x, y = cell_xy(1)
    d.swipe(x, y, x + 6, y, 90); assert hid_reports(d, 1, 1)             # Copy: a 6 px wobble is a tap
    d.clear_events(); d.swipe(x, y, x + 60, y, 400); time.sleep(0.8)
    assert not [l for _, l in d.events if l.startswith("EVT:HID")]

def test_stations_keys_and_host_page_slide(d):
    d.touch(210, G_LINE); d.wait_event(r"^EVT:PAGE 2$", 1); time.sleep(0.1)
    assert field(d, "slide") != 0
    time.sleep(1.0); d.ok("page 3"); time.sleep(0.1)
    assert field(d, "slide") != 0 and "page:3 " in d.cmd("status")[0]   # committed at once

def test_a_touch_mid_spring_lands_on_the_settled_page(d):            # Review Focus 4
    d.ok("page 3"); since = len(d.events)
    tap(d, 15); d.wait_event(r"^EVT:KEY 3 15 1$", 1, since)              # Last, on page 3

def test_slide_keeps_the_status_band_and_line_still(d):
    before = d.shot()
    d.swipe(400, 160, 100, 160, 7000); time.sleep(1.5)
    mid = d.shot()
    band = lambda im: im.crop((150, 0, 480, 30)).tobytes()              # past the clock
    line = lambda im: im.crop((0, 300, 480, 320)).tobytes()
    assert band(mid) == band(before) and line(mid) == line(before)
    assert mid.crop((0, 30, 420, 300)).tobytes() != before.crop((0, 30, 420, 300)).tobytes()
    time.sleep(6)

def test_profile_change_mid_drag_ends_the_slide(d):                   # Review Focus 1
    d.swipe(400, 160, 100, 160, 2000); time.sleep(0.6)
    d.ok(f"setprofile {SLOT}"); time.sleep(2.0)
    assert field(d, "slide") == 0 and "page:1 " in d.cmd("status")[0]
    since = len(d.events); tap(d, 2); d.wait_event(r"^EVT:KEY 1 2 1$", 1, since)

def test_drag_from_the_bar_or_a_player_button_slides_and_fires_nothing(d):   # Review Focus 2
    since = len(d.events)
    d.swipe(450, 200, 150, 200); d.wait_event(r"^EVT:PAGE 2$", 1.5, since)   # from the bar: page 2, the player
    time.sleep(0.8); since = len(d.events)
    d.swipe(210, 248, 400, 248); d.wait_event(r"^EVT:PAGE 1$", 1.5, since)   # from play/pause
    assert not [l for _, l in d.events[since:] if l.startswith("EVT:HID 2")]

def test_pages_slide_inside_a_panel_and_in_media(d):
    set_qb(d); d.touch(*BAR[2]); time.sleep(0.4); since = len(d.events)
    d.swipe(400, 160, 100, 160); d.wait_event(rf"^EVT:PANEL 2 {SLOT} 2$", 1.5, since)
    d.ok("panel 0"); time.sleep(0.4); swipe_up(d); time.sleep(0.6); since = len(d.events)
    d.swipe(400, 160, 100, 160); d.wait_event(rf"^EVT:PANEL 1 {SLOT} 2$", 1.5, since)

def test_motion_command_tunes_the_springs(d):
    assert d.cmd("motion")[0] == "motion page k:230 z:0.78 sheet k:240 z:0.80"
    d.cmd("motion page 300 0.9"); assert "page k:300 z:0.90" in d.cmd("motion")[0]
    d.cmd("motion page 230 0.78")

def test_slide_holds_its_floor_on_a_full_page(d):
    try:
        d.upload_text(f"profile{SLOT}.json", json.dumps(full_profile())); d.ok(f"setprofile {SLOT}"); time.sleep(0.6)
        frames, rate, _ = fps(d, lambda: d.swipe(400, 160, 100, 160, 500), wait=1.4)
        print(f"slide fps {rate:.1f} over {frames} frames")
        assert frames >= 12 and rate >= SLIDE_FLOOR, (frames, rate)
    finally:
        d.upload_text(f"profile{SLOT}.json", json.dumps(PROFILE)); d.ok(f"setprofile {SLOT}")
```

Update these to `SLIDE_FLOOR`: `test_page_wave_frame_rate` becomes `test_page_slide_frame_rate`, and the `page 3` half of `test_each_theme_animates_at_60fps` changes too. The press half keeps `FPS_FLOOR`.

- [ ] **Step 2: Run them; they fail**

Run: `-k "follows_the_finger or flick or springs_back or ends_of_the_row or wobbly or slide or mid_spring or mid_drag or motion_command or inside_a_panel or drag_from_the_bar"`
Expected: FAIL, because `status` has no `slide:` field and `motion` is unknown.

- [ ] **Step 3: `motion.h` and `gfxPan`**

`motion.h` is as in Interfaces, header-only, with `eps` passed per use: 0.5/420 for pages and 0.5/290 for sheets.

For `gfxPan`, check that `P()`, `clipBox` and anything indexing `groundC[]` keep addressing the chunk buffer after a pan. A pan moves the origin, not the buffer, and a vertical pan only ever runs over the panel's flat `PLY` ground.

- [ ] **Step 4: The slide (`ui.cpp`)**

**State:**
- `static struct { bool on, drag; int8_t other; Spring s; JsonDocument doc; uint16_t otherToggles; int16_t sx[6]; uint32_t st[6]; uint8_t n; } slide;`
- `s.x` is the view page's offset in pages: +1 means fully moved left, with the next page in place.
- `other` is the page drawn beside it, or -1 for none (rubber band).

**Draw** (`renderChunk`, when `slide.on`):
- Clip to x 0–420, y 30–300.
- `gfxPan(off, 0)`, where `off = lroundf(s.x * KEYS_W)`. Draw the view's page: the player or the 15 cells.
- Pan to the other page's place. It is `gfxPan(off - KEYS_W, 0)` when `other` is a later page (it sits on the right) and `gfxPan(off + KEYS_W, 0)` when it is an earlier one (on the left). The side follows which page `other` is, not the sign of `s.x`. Set `slideDrawingOther = true`, so `keyAt`/`toggled` read `slide.doc`/`otherToggles` and the cell animations (`ca[]`) are ignored. Draw it.
- Unpan. `drawStations` and `drawBar` are not panned.

**Damage:** each frame the offset changes, mark the key area as cell-aligned rects, so every chunk holds one cell:

```text
f = ((off % CELL_W) + CELL_W) % CELL_W        // where the cell boundaries sit now
for x in (-f, -f + 84, ... < 420), for each of the 3 rows: mark(x, 30 + row*90, 84, 90)   // up to 18 rects; mark() clips to the screen
```

**Step and settle** (`animate`):
- Step `slide.s` with the real dt.
- On settle at 0: `slide.on = false`, clear `slide.doc`, and mark the key area once.
- Return `live` while `on`.
- Keep icons, rings and pops stopped while `on` (`stopIcons()`, `pop0 = 0`).

**Gestures** (home, with no sheet or shade):
- **`G_DOWN` while `slide.on && !slide.drag`:** finish at once (`s.x = s.to`, settle), then handle the touch as usual.
- **`G_MOVE`:** once |lx − sx| > `LOCK_PX` and |dx| > |dy|:
  1. Cancel the key press: emit `'0'`, don't fire it, `pressed = -1`, and clear `pressedBtn`.
  2. Load the neighbour in the direction of the drag into `slide.doc` with `loadPageInto` (the top layer's profile, or the active one).
  3. `slide.on = slide.drag = true`.

  While dragging, `s.x = (sx − lx) / 420`, at 35 % past an end with no neighbour. Reversing past 0 loads the other neighbour. Keep the last 6 (`millis()`, `lx`) samples.
- **The drag goes first.** All of this runs ahead of the bar's tap branch and the player's button branch in `uiGesture`. A drag that starts on the bar or on a player control slides the page.
- **Release** (`G_TAP`/`G_SWIPE_*` while `slide.drag`):
  1. `v = −(Δx / 420) / Δt` over the samples, in pages/s (a finger moving left gives v > 0).
  2. `t = flickTarget(s.x, v, lo, hi)`, so it can only reach the neighbour that is loaded:
     - with `other` the next page: `lo = 0`, `hi = 1`
     - with `other` the previous page: `lo = −1`, `hi = 0`
     - with none: `lo = hi = 0`
  3. If `t ≠ 0`, **commit**: the neighbour becomes the view's page, the old page moves into `slide.doc` as `other`, and `s.x −= t`.
  4. Spring to 0 with that velocity.
  5. Never run the old `viewGo` swipe path for a drag.

  The page dots and the status band's `n/N` change at the commit. The spec left "halfway or settle" to the builder; the commit point here is the release. Ledger it as a Ruling.
- **Commit and programmatic changes** (`uiGoPage`, `panelGo`, and `viewGo` for stations): keep today's bookkeeping (back stack, toggles, `EVT:PAGE` / `EVT:PANEL`). Replace `startWave`/`startWipe` with a slide from the old page: `other` = the old page, `s.x = ±1` (−1 when the new page is later), `v = 0`. Swap documents with `std::move` rather than reload where the page is already in RAM. A profile switch (`uiSetProfile`), a panel opening and a theme change end any slide (`slide.on = false`) and keep today's animation. They also ignore the rest of the touch in progress until the finger lifts, so a drag that was under way can't start a new slide on the new profile.

**CLI:** add ` slide:%d` (`uiSlidePx()`) to `status`, and `motion` to `cli.cpp` → `uiMotionCmd`. Springs read their `k`/`z` from two statics that `motion` sets.

- [ ] **Step 5: Run the new and changed tests**

Run: the Step 2 expression plus `-k "frame_rate or animates or swipes or station or folder or panel"`
Expected: all pass. `test_slide_holds_its_floor_on_a_full_page` prints the slide's fps. Ledger it.

- [ ] **Step 6: The full suite, then commit**

Expected: all pass.

```bash
git add firmware/TouchKeypad/motion.h firmware/TouchKeypad/gfx.* firmware/TouchKeypad/ui.* firmware/TouchKeypad/cli.cpp tools/tests/test_device.py
git commit -m "Pages follow the finger and spring; every page change slides; status slide:, motion command"
```

### Task 4: Media and Settings rise with the finger

**Files:**
- Modify: `firmware/TouchKeypad/ui.cpp`: the Media and sheet rise, `sheetTop`, `drawSheet`, `renderChunk`, `animate`, `uiGesture` and `uiOpenSheet`/`uiCloseSheet`.
- Modify: `ui.h` (`uiRisePx`) and `cli.cpp` (status).
- Test: `tools/tests/test_device.py`

**Interfaces:**
- **Consumes:** `Spring`/`springStep`/`flickTarget`/`LOCK_PX`, `gfxPan`, `topLayer()`, and `media`.
- **Produces:**
  - `int uiRisePx()` gives the height in px of whichever sheet is rising or open (Media or Settings) above the screen's bottom: 0 to 290.
  - `status` gains ` rise:<px>` after `slide:`.
  - Tests: `RISE_FLOOR = 20`.

- [ ] **Step 1: Write the failing tests**

```python
RISE_FLOOR = 20   # Task 5 raises it to 25 (goal 30)

def test_media_follows_a_drag_up(d):
    set_qb(d); since = len(d.events)
    d.swipe(210, 290, 210, 110, 1500); time.sleep(0.75)
    r = field(d, "rise")
    assert 40 <= r <= 150 and "panel:0" in d.cmd("status")[0], r     # following, not committed
    d.wait_event(rf"^EVT:PANEL 1 {SLOT} 1$", 3, since); time.sleep(0.8)
    assert field(d, "rise") == 290

def test_a_short_slow_drag_up_falls_back(d):
    set_qb(d); since = len(d.events)
    d.swipe(210, 290, 210, 230, 800); time.sleep(1.6)
    assert not evts(d, since, "EVT:PANEL") and field(d, "rise") == 0

def test_a_flick_up_opens_media_and_a_drag_down_closes_it(d):
    set_qb(d); since = len(d.events)
    d.swipe(210, 290, 210, 230, 60); d.wait_event(rf"^EVT:PANEL 1 {SLOT} 1$", 1.5, since)
    time.sleep(0.8); d.swipe(210, 60, 210, 250, 300); d.wait_event(r"^EVT:PANEL 0$", 1.5, since)
    time.sleep(0.8); assert field(d, "rise") == 0

def test_settings_rises_from_the_bar_and_a_drag_down_closes_it(d):
    since = len(d.events)
    d.touch(*BAR["settings"]); d.wait_event(r"^EVT:UI sheet$", 1, since); time.sleep(0.8)
    assert field(d, "rise") == 290
    d.swipe(60, 120, 60, 300, 300); d.wait_event(r"^EVT:UI home$", 1.5, since)

def test_rises_hold_their_floor(d):
    set_qb(d)
    frames, rate, _ = fps(d, lambda: d.ok("panel 1"), wait=1.0); d.ok("panel 0"); time.sleep(0.8)
    assert rate >= RISE_FLOOR, ("media", frames, rate)
    frames, rate, _ = fps(d, lambda: d.ok("sheet"), wait=1.0); d.ok("sheet close"); time.sleep(0.8)
    assert rate >= RISE_FLOOR, ("settings", frames, rate)

def test_media_drag_over_a_panel_with_a_cover_keeps_the_heap(d):  # Review Focus 3
    set_qb(d); d.upload_bin("ram:artj", make_jpg()); time.sleep(0.3)
    before = heap_free(d)
    d.touch(*BAR[3]); time.sleep(0.4)
    d.swipe(210, 290, 210, 110, 1500); time.sleep(0.75)
    assert heap_free(d) > 20000 and not [l for _, l in d.events if "no RAM" in l]
    time.sleep(1.2); d.ok("panel 0"); time.sleep(0.8)
    assert abs(heap_free(d) - before) < 1024
```

Update `test_sheet_frame_rate` to assert `RISE_FLOOR`.

- [ ] **Step 2: Run them; they fail**

Run: `-k "drag_up or flick_up or rises or media_drag_over"`
Expected: FAIL, because `status` has no `rise:` field.

- [ ] **Step 3: Implement**

**State:**
- The Media sheet: `static Spring mediaRise;`, from 0 to 1 over 290 px.
- The Settings sheet: `sheetRise`. It replaces `sheet0`'s 260 ms ease in `sheetTop`. `mode` stays `M_SHEET` until the close settles at 0, and `sheetClosing` keeps its meaning.

**Draw:**
- Below the Media sheet's top: the Media layer, panned down by `top − 30` (`gfxPan(0, 30 − top)`), clipped to x 0–420. It has 16 px top corners (4 in crisp themes) and the existing panel shadow edge.
- Above the top: whatever is under it (home or the bar panel), scaled toward (210, 165) by `1 − 0.05·x`, then `fillRect(…, BLACK, 115·x)`.
- Settings works the same over x 0–480, and dims the bar too. The Media rise leaves the bar undimmed and usable.

**Gestures:**
- **On home, or a panel with no sheet or shade**, a vertical lock upwards (dy < −`LOCK_PX`, |dy| > |dx|) cancels any press. If `qb[0]` is set and its page loads, it fills `media` without emitting an event, and Media follows: `x = (sy − ly)/290`.
- **On release:** use `flickTarget` over the sheet's samples. If it opens, commit (`EVT:PANEL 1 …`) and spring to 1. If not, spring to 0, then clear `media`.
- **Media open, a vertical lock downwards:** it follows down, and on release closes (commit `EVT:PANEL <below>`) or springs back.
- **`M_SHEET`, a vertical lock downwards** not on a slider (`dragSlider < 0`): the same, ending in `uiCloseSheet` semantics.
- **Programmatic opens and closes** (`panel 1`, `panel 0`, `sheet`, `sheet close`, Done, a bar tap while Media is open) spring with `v = 0`, and commit at once.

**CLI:** ` rise:%d` (`uiRisePx()`).

- [ ] **Step 4: Run the new tests and the sheet, media and panel groups**

Run: `-k "rise or drag_up or flick_up or media or sheet or panel or settings"`
Expected: all pass. Ledger the rise rates that `test_rises_hold_their_floor` saw: print them as `print(f"media rise {rate:.1f}")` and `print(f"settings rise {rate:.1f}")` before the asserts.

- [ ] **Step 5: The full suite, then commit**

Expected: all pass.

```bash
git commit -am "Media and Settings rise with the finger and spring; the keys dim and sink behind; status rise:"
```

### Task 5: Fast enough: the slide and the rises at 25 fps or better, aiming for 30

**Files:**
- Modify: `firmware/TouchKeypad/gfx.cpp` (the hot paths), and `ui.cpp` only where drawing order or damage change.
- Create: `tools/tests/key_goldens.py`
- Test: `tools/tests/test_device.py` (the floors)

**Interfaces:**
- **Consumes:** Task 3's and Task 4's fps tests, and `full_profile()`.
- **Produces:**
  - `SLIDE_FLOOR = RISE_FLOOR = 25`.
  - `key_goldens.py save DIR` / `check DIR`: screenshots of the key area (x 0–420, y 30–300) of `full_profile()` page 1 in each of `THEMES`, and in check mode the count of differing bytes per theme.

- [ ] **Step 1: Baseline**

Record each of these in the ledger:
- `rbench`.
- The three motion rates: `test_slide_holds_its_floor_on_a_full_page` and `test_rises_hold_their_floor`.
- A read-only probe of the owner's real page. It writes no file:
  1. Note the current profile and page.
  2. Run `setprofile 11`, `perf reset`, `swipe 400 160 100 160 500`, wait 1.4 s, then `perf`.
  3. Put the profile and page back.

Then run `key_goldens.py save build/goldens-before` on the unchanged firmware.

- [ ] **Step 2: Raise the floors (the failing test)**

Set `SLIDE_FLOOR = RISE_FLOOR = 25`. Run the three motion tests.
Expected: they fail wherever the baseline was under 25. If none fails, the floors are already met: carry on to Step 3 for the 30 fps goal.

- [ ] **Step 3: Optimize, measuring each change**

Profile with `rbench` and extra `run(...)` rows. Work biggest first:
1. **`rrFill`'s edge band.** The per-pixel `sdRR` with `sqrtf`, and the per-row `mix`/`dith` work. For example, compute the corner distance incrementally, or table the edge coverage per row.
2. **`glyphFrame` scaling at native size.**
3. **`text` for labels.**
4. **Only if 1–3 fall short:** split the chunk rendering across both cores. Core 0 renders the next chunk while core 1 renders this one. Every renderer global becomes per-chunk state. Bluetooth keeps priority on core 0.

After each change:
- Run `key_goldens.py check build/goldens-before`. Expected: 0 differing bytes in every theme. A non-zero theme means revert, or prove the change is invisible and ledger a Ruling.
- Rerun the motion tests.

**Stop and ask the owner** if 30 fps would need any drawing detail cut while keys move (shadows, tags, gloss). Report the measured rates.

- [ ] **Step 4: The full suite, then commit**

Expected: all pass with the floors at 25. Record the final slide and rise fps, with the owner's-page probe.

```bash
git add firmware/TouchKeypad/gfx.cpp firmware/TouchKeypad/ui.cpp tools/tests/key_goldens.py tools/tests/test_device.py
git commit -m "Renderer: faster key drawing; slides and rises hold 25 fps (measured: <n> fps slide, <m> fps rises)"
```

### Task 6: Docs, versions and release builds

**Files:**
- Modify:
  - `firmware/TouchKeypad/board.h` (`FW_VERSION "3.14.0"`) and `studio/package.json` (`3.14.0`).
  - `docs/PROTOCOL.md`: what the quick bar's entries mean, `status slide:`/`rise:`, and `motion`.
  - `firmware/DESIGN.md`: Layout (the bar rows, Settings, no gear) and a Motion section with the constants and how a slide draws.
  - `docs/PLAN.md`: a 3.14.0 entry with the measured fps.
  - `docs/superpowers/specs/2026-11-03-quick-bar-design.md`: a note that Settings now sits on the bar (it reverses "Settings is not on the bar").

- [ ] **Step 1: Write the docs and bump the versions**

- [ ] **Step 2: All the suites**

Run:
- The full device suite on the test build.
- `cd studio && npm test`.
- `"$PY" tools/kp.py build --release`.

Expected: all pass, and the release build succeeds.

- [ ] **Step 3: Commit**

```bash
git commit -am "3.14.0: pages follow the finger, Media on a swipe up, Settings on the bar"
```

Then use superpowers:finishing-a-development-branch. Merging, tagging, flashing bc:f0 with release 3.14.0 (and checking its theme, profile and quick bar against the backup), and installing Studio 3.14.0 are the owner's call at that point.
