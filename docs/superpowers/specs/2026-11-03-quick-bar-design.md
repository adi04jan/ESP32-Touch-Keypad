# Quick bar: four profile panels and a suggested profile on every screen

Date: 2026-11-03 · firmware 3.11.2 (uncommitted in the tree) → next minor · Studio → next minor

## Why

The owner works in VS Code and Windows Terminal all day and keeps reaching for the same
few things whatever profile is up: git commands, API calls (Bruno collections, curl
one-liners), a gateway login, media, File Explorer. Today these live on particular
profiles (on the owner's keypad, git sits on page 2 of Terminal and page 4 of VS Code), so
they are one or more profile switches
away, and auto-switch moves the profile under them every time focus changes. On an older
macropad the owner kept a "command shortcut" profile of small curl scripts typed into the
terminal. They want that, and git, one tap away from any profile, in any app.

They also switch profile by hand when auto-switch's pick is not what they want in an app.
The keypad should learn those choices and offer that profile next time.

## What it is

1. **The quick bar**: a 60 px column on the right edge of the key area, on every profile
   and every page, in every theme. Four buttons, each an icon over a label, each pointing
   at a page of one of the 16 profiles.
2. **Panels**: tapping a bar button shows that button's profile page over the key area.
   The active profile underneath does not change.
3. **The suggested profile**: a fifth slot at the top of the bar. Studio fills it from what
   it has learned about manual switches. Tapping it switches profile for real, and the slot
   then offers the way back.

Mockups from the conversation (not committed; `.superpowers/` is git-ignored):
`.superpowers/brainstorm/136946-1793688253/content/quickbar-layout.html` (layouts A and B,
a Git panel), `quickbar-profiles.html` (Commands panel, the Studio settings sketch),
`quickbar-suggest.html` (the suggestion slot, the learned list).

## Decided by the owner

- **Layout A**: the bar is 60 px wide with icons and labels. Keys keep their 66 px size.
  The grid becomes five 84 px columns over 420 px, so the gaps between keys shrink from
  30 px to 18 px. A page still holds 15 keys (5×3).
- **The four buttons by default: Media, Explorer, Git, Commands.** Settings is *not* on the
  bar, because the status band already has the gear.
- **Each button opens a dedicated, ordinary profile** that the owner configures in Studio
  like any other. Commands is where the owner keeps what they run while working: Bruno
  calls and curl commands typed into the terminal, and a gateway login.
- **A suggested profile** is learned from manual profile switches followed by key presses
  on that profile, and weighted by how much they happen.
- **Tapping the suggestion switches to that profile for real.** It stays until auto-switch
  moves it (focus goes to another app), the owner switches by hand, or they tap go-back.
- **There is a go-back.**
- **A button points at a profile and a page** (decided after the review). The owner's
  keypad has all 16 slots in use, each mapped to an app by auto-switch, so there's no room
  for new bar profiles. Each button opens a page of a profile the owner already has. On
  their keypad that would likely be Git → Terminal page 2 (typed git commands), Media →
  Home page 2 (the player), Explorer → the Explorer profile, and Commands → a page of
  Bruno or Terminal. They'll set these in Studio. No new profiles are created and the
  16-profile limit stays.
- **The quick bar comes before the Studio 3.12 redesign** (`2026-10-21-studio-ease-of-use-design.md`,
  written but not built; Studio is still 3.11.0). The quick bar's Studio work is built on
  today's Studio. The 3.12 design gets a note that its key "Test" taps
  (`x = col·96 + 48`) move to the 84 px grid.

## Calls stated to the owner (they agreed to the summary; check these when reading)

- A panel stays open until its button is tapped again. Tapping another bar button swaps
  panels. Pressing a key in a panel does not close it.
- Opening a panel never changes the active profile or its page. Auto-switch keeps acting
  underneath, and the panel stays open across an auto-switch.
- Media points at a page that holds the Now Playing player (the existing
  `widget: "media"`, `span: [5,3]` page), so all four buttons behave the same way.
- Studio gets a Quick bar section. For each of the four buttons the owner picks a profile,
  a page and an icon. The label is prefilled from the page's name and can be edited (my
  call after the review, since a profile's name, like "Terminal", is wrong for a Git
  button).
- Suggestions are per app in front. Recent presses count more and old ones fade.
- The suggestion never switches profile on its own.
- The slot is empty when there is nothing to suggest, or when the suggestion is the
  profile already active.
- Go-back lives in the same top slot. After a suggestion tap it shows ↩ and the name of the
  profile left behind. Any other profile change (auto-switch, manual) clears it, and the
  slot goes back to suggesting.
- Key presses after a suggestion tap count toward the learning, like a manual switch.
- Studio lists what it has learned, and a wrong row can be cleared.
- The bar is on the player page too. The player is re-laid out to fit 420 px.
- The bar only responds to taps. Swipes and holds on the keys behave as today.
- Inside a panel, the panel profile's own pages, folders and Back keys work. A panel key
  whose action switches profile (`{type:'profile'}`) switches the real profile and closes
  the panel. (Replaced after the review: the starter-profiles step is dropped, since
  buttons point at pages of existing profiles.)
- The firmware update keeps the Bluetooth bonds, the touch calibration, the profiles and
  the settings, like every update so far.
- Git and command keys type into whichever window has focus. If the VS Code editor has
  focus rather than its terminal, `git status` is typed into the file. That is a known
  limit, and this work does not fix it.
- The gateway password: the owner was told that a key typing it stores it as plain text on
  the keypad, in Studio's profile files and in backups, and that it types into whatever
  window has focus. Nothing special is built for it.

## Calls made after the design review (not yet heard by the owner)

- **A manual profile change closes an open panel.** That covers the sheet's Profiles tab,
  the shade's stepper, the profile chip, a `profile` key, the suggestion slot and go-back.
  The owner just picked a profile, so it shouldn't stay hidden behind the panel. If the
  change happens with the sheet or shade open, closing them shows the new profile. An
  auto-switch still leaves the panel open, as agreed.
- **A go-back tap counts as a manual switch for learning.** Presses after it build up the
  profile the owner went back to. Rejecting a suggestion this way gradually corrects it
  instead of the same wrong offer coming back.
- **No label that fits today gains a "…" on the 84 px grid.** Labels lose about 10 px of
  width (cut at about 80 px instead of 92 px). The builder picks how to keep them whole,
  for example a step down in label size for long labels before truncating.
- **`back` on a panel's start page closes the panel.** Its page history starts at the
  page the button points at.

## Goals

- From any profile and any page: one tap opens Git, Commands, Explorer or Media, and one
  more tap runs a key.
- Everything on the bar is set up in Studio with the profile editing that exists today.
- The suggestion offers the profile the owner would have switched to by hand.

## Non-goals

- New action types. Panel keys use the existing ones (`key`, `keycombo`, `text`,
  `multiline`, `delay`, `media`, `telephony`, `page`, `back`, `profile`, `host`).
- Making typed commands reach a terminal whatever has focus.
- Storing secrets securely.
- Auto-switching on learned data.
- More or fewer than four fixed buttons, a bar on the left, or a configurable width.
- Suggestions without Studio. The four buttons work without Studio, but the suggestion
  needs Studio because only Studio knows the app in front.

## Anti-goals (a failure even if it works)

- Keys shrink, a page holds fewer than 15 keys, or existing profiles have to be edited to
  fit.
- Opening a panel loses the owner's place (profile or page) underneath.
- The suggestion moves the owner around on its own or nags (flashing, banners, sounds).
- The update wipes bonds, calibration or profiles.
- Frame-rate regressions: the device tests hold animations at 50 fps or better, and they
  still must, with the bar and with a panel open.
- The owner's real password ends up anywhere in the repo, the default profiles, the tests
  or the logs. Tests use placeholders. Personal profiles that hold
  credentials already live in the git-ignored `/profiles/` (see `.gitignore`), never in
  `defaults_gen.h`.

## Constraints and facts

**Screen and firmware layout** (`firmware/TouchKeypad/board.h`, `ui.cpp`,
`firmware/DESIGN.md` › Layout):
- 480×320 landscape. The status band is 0–30 (`STATUS_H`), the grid runs y 30–300, and the
  page line is y 300–320 (`LINE_Y`).
- New: the key area is x 0–420, and the bar is x 420–480 from y 30 to 320, including
  beside the page line.
- `CELL_W` 96 becomes 84. The code that uses the grid width includes `cellX`, the touch hit
  test (`ui.cpp` around the `y < STATUS_H || y >= LINE_Y || x >= SCR_W` check),
  `markCellRect`, `drawPlayer` and its marks (`mark(0, STATUS_H, SCR_W, ...)`), the page
  wipe, `drawStations` (page line), and the swipe threshold (`SWIPE_X_PX`, 18 % of
  `SCR_W`). Grep for `SCR_W` across `ui.cpp`.
- The sheet, the shade, the host menu, pairing and calibration are full-screen modes. They
  cover the bar as they cover the keys today.
- The status band's profile chip keeps showing the active profile and its page while a
  panel is open. The panel shows its own page line inside the key area.
- Six themes (`themes.h`). Each needs the bar, a lit button state for the open panel, the
  suggestion slot and an empty-slot look, using the design system's plies
  (`firmware/DESIGN.md`). The panel sits on the overlay ply. Studio's preview
  (`studio/renderer/styles.css`, `app.js`) mirrors the themes and must show the bar and the
  84 px grid.
- Profiles are referenced by slot 1–16 and are 4–7 KB of JSON each. A panel means a second
  profile's keys are in use alongside the active one, so watch the heap.
- A button whose profile slot is empty or deleted, or whose page no longer exists, shows
  as empty and does nothing.
- A fresh keypad (shipped defaults) needs a default bar config built from the default
  profiles: Media → Daily page 2 (the player) and Git → Code page 2 ("Git & build"). The
  other buttons can stay empty until set.

**Studio** (`studio/main.js`, `services/`):
- It already knows the app in front: `services/activewin.js`, with `startFocusWatch` and
  `appKey(proc)` in `main.js`, which runs whether or not auto-switch is on. Auto-switch
  settings live in `services/store.js` (`auto_switch_enabled`, `context_profiles`).
- `EVT:PROFILE <n>` is sent for every profile load, including Studio's own `setprofile`.
  Learning has to tell Studio's switches from the owner's.
- `EVT:KEY <page> <id> 1|0|H` reports presses. Presses inside a panel must be
  distinguishable from presses on the active profile, so learning ignores them and nothing
  in Studio mistakes them for the active profile's keys.
- Host actions carry their slot in the action (`services/hostbridge.js`, `assignSlots`
  over all profiles), so `host` keys in a panel work with no change.

**Repo and device**:
- The working tree has uncommitted 3.11.2 work (Profiles tab caching: `profiles.cpp`,
  `storage.*`, `ui.cpp`, `cli.cpp`, `board.h`, `tools/tests/test_device.py`,
  `docs/PLAN.md`). Build on top of it. Never discard it.
- `tools/tests/test_device.py` taps cells at 96 px (`cell_xy`, and the helper below it).
  Those helpers move to 84 px.
- Firmware builds against ESP32 Arduino core 3.2.1.
- Commits are local, on `dev/firmware`, with no Co-Authored-By or Claude-Session lines.
- Two boards exist: the daily keypad (MAC 58:FA…) and a work board (bc:f2…, COM8). Check
  the MAC before flashing. The daily keypad is in use, so keep its bond, calibration and
  user state.
- Docs to update: `docs/PROTOCOL.md` (new commands and events), `firmware/DESIGN.md`
  (Layout, Components), `docs/PLAN.md` (a version entry), and a note in
  `docs/superpowers/specs/2026-10-21-studio-ease-of-use-design.md` about the 84 px grid.

## Behaviour

**The bar**
- From top to bottom: the suggestion slot, a hairline, then the four buttons. With the
  suggestion slot added the buttons get a little shorter (about 58 px each instead of
  72 px). Every target stays at least 44 px.
- The bar's configuration (four × {profile slot, page, icon, label}) lives on the keypad,
  so the bar works without Studio. Studio sets and reads it.

**Panels**
- Tap a button: its profile shows over the key area on the button's page, and the button
  is lit. Tap the lit button: the panel closes and the active profile shows again,
  exactly where it was. Tap another button: that panel replaces this one.
- Keys in the panel fire their actions as usual. Page and folder actions, and `back`, move
  within the panel's profile. A `profile` action switches the real profile and closes the
  panel.
- Opening a full-screen mode (the sheet, the shade) over a panel is fine. Closing it
  returns to the panel.

**Learning (in Studio)**
- A manual switch is any profile change Studio did not cause itself: the keypad's profile
  chip, the sheet, the shade's stepper, a `profile` key, or a suggestion tap.
- After a manual switch to profile P with app A in front, each key press on P while A is
  still in front adds weight to (A, P).
- These don't count: presses on a profile that Studio's auto-switch chose, presses inside a
  panel, and presses after the app in front changed.
- The weight is a sum of presses where recent presses count more and old ones fade. The
  suggestion for A is the heaviest P above a minimum, unless P is already active.
- Learning runs whether auto-switch is on or off, since the focus watch always runs.
- The data is kept in Studio's data directory, next to its settings.
- Studio sends the keypad the suggestion for the app in front (a profile slot, or none)
  whenever it changes. It sends none when it disconnects, or the keypad clears it when the
  link drops.

**The suggestion slot and go-back (on the keypad)**
- With a suggestion, the slot shows the profile's name in its colour. Tap: the keypad
  remembers the profile and page it is leaving, loads the suggestion, and reports it as a
  manual switch. The slot then shows ↩ and the name of the profile it left.
- Tap ↩: the keypad loads the remembered profile on the remembered page, and the slot goes
  back to suggesting.
- Any other profile change clears the go-back.

**Studio's Quick bar section** (Device view)
- Four rows, each with a profile picker, a page picker (that profile's page names), an
  icon picker from the key icon set, and a label prefilled from the page name.
- The learned list: app → profile, a weight bar, the press count and when it was last
  used, and a clear button per row.

## Left to the builder

- Names and shapes of the new CLI commands and events (bar config, suggestion set/clear,
  panel open/close and which keys fired inside a panel, `status` fields), and where the
  bar config is persisted (NVS or a file).
- How the panel's profile is held in RAM (load on open, free on close, or otherwise).
- Bar, slot and panel visuals per theme within `firmware/DESIGN.md`. The panel's open and
  close motion should match the sheet's feel (260 ms).
- The player's layout at 420 px.
- The decay rate and the minimum weight for a suggestion. Make them tuning values in
  Studio's settings, not constants buried in code.
- Version numbers and the order of phases (firmware first is the natural order, since
  Studio needs the commands). Both come before the Studio 3.12 redesign.

## Done when

- Device tests pass on the 84 px grid, plus new ones: a bar tap opens and closes a panel on
  the button's page; a manual profile change closes it and an auto-switch doesn't; a
  panel key fires from the panel profile while the active profile and page are unchanged
  (`status`); a suggestion is set, tapped (the profile changes) and undone with go-back;
  50 fps or better with a panel open.
- A Studio unit test for the learning: manual versus auto switches, presses in panels
  ignored, recency weighting, and the minimum.
- Studio's preview shows the bar in all six themes.
- Flashed to the daily keypad with its bonds, calibration and profiles intact, and the
  owner's state restored.
