# Macropad Studio 3.12: easier key setup, profiles and pages, device extras, less clutter

Date: 2026-10-21 · Studio 3.11.0 → 3.12.0 · firmware unchanged (3.11.0)

## Why

A review of Studio 3.11 (renderer/app.js, main.js, services/, screenshots of the three views
against the simulated keypad) found that the hard part of using it is setting up a key:

- The key panel shows Label → Colour → 214 icons → GIF → animation → toggle, and only then
  what the key does; at the default window size the actions are below the fold.
- A key combo is typed as `LEFT_CTRL + C`; a typo surfaces only after the save, at the
  bottom of the page.
- A new key is "New key" sending F13. There are no ready-made keys.
- Opening an app or a website is "Host Action" with `open …` typed by hand, explained
  only in Settings › Host bridge.
- Switch profile and Go to page take numbers; LED tint takes `r, g, b`; a Repeat's inner
  actions cannot be edited at all (it repeats Down arrow).

And around it: 16 slot tabs fill the top bar on every view; a profile can't be duplicated,
cleared or deleted; pages can't be reordered, and deleting one leaves later "Go to page"
actions pointing one page off; a folder takes several steps; the firmware's `reboot`,
`power off`, `shot` and `touch` go unused; the raw device log, baud rate and a duplicate
auto-connect sit in plain view; undo is keyboard-only.

Goal: set up a working key in a few clicks without knowing key names, and manage profiles
and pages the way one expects to.

## Decisions taken with the owner

- All four areas in this round, built and committed as four phases.
- The key panel is one column, actions first; Look and Toggle/animation fold away.
- Profiles are picked from a drop-down in the top bar with a ⋯ menu; Editor only.

## Architecture

Plain JavaScript as today, no framework, no new dependency. Everything uses firmware
commands that exist in 3.11.0.

| File | Change |
|---|---|
| `renderer/keylib.js` (new) | the ready-made keys, data only (`window.KEY_LIBRARY`), like keyicons.js |
| `renderer/lib.js` (new) | pure helpers, UMD (`window.KpLib` / `module.exports`) so `node --test` can load them: key-code → schema name, combo labels, page move/delete with action renumbering, folder creation, save-error paths |
| `renderer/app.js` | the panel, library, recorder, editors, profile/page menus, Test, Advanced |
| `renderer/index.html`, `styles.css` | top bar, menus, folds |
| `main.js`, `preload.js` | IPC: delete profile, test key, screenshot (+ save/copy), reboot, power off, browse for a file |
| `services/device.js` | `deleteProfile`, `testKey`, `screenshot` |
| `services/serial.js` | `readShot(onProgress)`: the `###SHOT###` block |
| `services/tiles.js` | `shotToBgra(buf)`: little-endian RGB565 → BGRA for `nativeImage` |
| `services/store.js` | `advanced: false` |
| `test/sim-device.js` | `rm`, `shot`, `touch`, `reboot`, `power off` where missing |

## Phase 1: easy key setup

### The key panel (one column)

1. Header: the key face, the label field, **Test** (phase 3), **Open folder ›** for a folder key.
2. **What it does**: `On tap` · `On hold` · `Turning off` (toggles only), then the action
   list, then **+ Add action**.
3. `▸ Look`: colour swatches, icon search and grid, Image or GIF, the moving-icon preview.
4. `▸ Toggle and animation`: the Toggle box and the Animation select.
5. **Clear key**.

The two folds remember open/closed for the session.

### The library (an empty key)

An empty key shows a search box and the ready-made keys by category, plus **Blank key** and
**Media player page**. Picking one fills name, icon, colour and actions; the ones that need
something (marked …) ask for it inline first. Each entry is
`{ cat, name, icon, color, actions, ask? }`, `ask` ∈ `url | app | folder | text | page`.

| Category | Keys |
|---|---|
| Editing | Copy (Ctrl+C), Cut (Ctrl+X), Paste (Ctrl+V), Paste plain (Ctrl+Shift+V), Undo (Ctrl+Z), Redo (Ctrl+Y), Select all (Ctrl+A), Find (Ctrl+F), Save (Ctrl+S) |
| Windows | Lock PC (Win+L), Screenshot (Win+Shift+S), Show desktop (Win+D), Task view (Win+Tab), File Explorer (Win+E), Settings (Win+I), Task Manager (Ctrl+Shift+Esc), Clipboard (Win+V), Emoji (Win+.), Snap left (Win+←), Snap right (Win+→), Next desktop (Win+Ctrl+→), Prev desktop (Win+Ctrl+←), Close window (Alt+F4) |
| Media | Play/pause, Next, Previous, Volume up, Volume down, Mute, Mic mute (telephony MIC_MUTE) |
| Meetings | Teams: Mute (Ctrl+Shift+M), Camera (Ctrl+Shift+O), Raise hand (Ctrl+Shift+K), Leave (Ctrl+Shift+H) · Zoom: Mute (Alt+A), Camera (Alt+V), Raise hand (Alt+Y) · Meet: Mute (Ctrl+D), Camera (Ctrl+E), Raise hand (Ctrl+Alt+H) |
| Browser | New tab (Ctrl+T), Close tab (Ctrl+W), Reopen tab (Ctrl+Shift+T), Next tab (Ctrl+Tab), Prev tab (Ctrl+Shift+Tab), Refresh (F5), Back (Alt+←) |
| Open | Website… (`host open <url>`), App or file… (Browse), Folder… (Browse) |
| Text | Type text… |
| Keypad | Folder… (phase 2), Go to page…, Back |

Meeting shortcuts are from the vendors' published lists (Microsoft Teams support, Zoom
support, Google Workspace support), checked 2026-10-21. Zoom's Alt+S is left out: sources
disagree on what it does. No entry uses F13–F24 (reserved for host actions).

### Shortcut recorder

Key Combo, Tap Key and Hold Key rows get **● Record**. While recording, Studio captures the
next key press (`keydown`, `e.code` → schema name via `KpLib.codeToKey`; Ctrl/Shift/Alt from
the event as LEFT_ modifiers); Esc cancels; a lone modifier waits for the main key (Hold Key
accepts a lone modifier on release). Windows takes Win combos before Studio sees them, so
the Key Combo row has a **Win** toggle that adds LEFT_GUI. The text field stays and accepts
`ctrl+shift+m` as today. Combos display as `Ctrl + Shift + M` (`KpLib.comboLabel`); the
saved JSON is unchanged.

`codeToKey`: `KeyA`–`KeyZ` → A–Z, `Digit0–9` and `Numpad0–9` → 0–9, `F1`–`F24`, `Enter`,
`NumpadEnter` → ENTER, `Escape` → ESC, `Backspace`, `Tab`, `Space`, `Minus`, `Equal`,
`BracketLeft/Right` → LEFT/RIGHT_BRACE, `Backslash`, `Semicolon`, `Quote`,
`Backquote` → TILDE, `Comma`, `Period` → DOT, `Slash`, `CapsLock`, `Insert`, `Home`, `End`,
`PageUp`, `PageDown`, `Delete`, `Arrow*` → *_ARROW. Anything else: not recordable, the row
says so.

### Action editors

The Add menu, grouped and in plain words:

| Group | Entries (schema type) |
|---|---|
| Keyboard | Shortcut (keycombo), Press a key (key), Type text (text), Type lines (multiline), Hold a key (hold), Release keys (release) |
| Open and run | Open an app, file or website (host `open`), Run a command (host `run`), Switch OBS scene (host `obs.scene`) |
| Media | Media key (media), Call control (telephony) |
| Mouse | Click (mouse_click), Move or scroll (mouse_move) |
| Keypad | Go to page (page), Back (back), Switch profile (profile), LED tint (led), LED animation (led_anim) |
| Timing | Delay (delay), Repeat (repeat), Note (comment) |

- Host actions keep the one `host` type; the row's editor follows the prefix (`open `,
  `run `, `obs.scene `, else raw text). Open has **Browse…** (main-process file dialog).
- Go to page: a select of this profile's page names. Switch profile: a select of the
  profiles in use by name.
- LED tint and LED animation colour: the twelve swatches.
- Type text / Type lines: a textarea, no `\n` escapes.
- Mouse move: x, y, wheel number boxes (−127…127). Delay: a number box in ms.
- Repeat: its count, then its inner actions as an indented list with their own Add, Move
  and Delete (depth up to 4, as the schema allows).

### Mistakes next to their cause

A save error already names its place (`pages[0].keys[3].actions[1]: …`).
`KpLib.errorPlace(msg)` → `{ page, key, list, index }`; the matching action row turns red
with the message, the key gets a red dot in the preview, and the top notice reads
"Not saved: <key> on <page> needs a fix" with a jump to it. Errors with no place stay in
the list as today.

## Phase 2: profiles and pages

### Profile drop-down (Editor only)

Top bar: `[● 1 · Daily ▾] [⋯]`. The list shows the slots in use (`state.empty` from
peekSlots), the active one marked, then **+ New profile** (first empty slot: Blank, or a
copy of this profile; disabled with a note when all 16 are used). Electron has no
`prompt()`, so names are typed in small inline popovers.

⋯ menu:
- **Rename**: inline field.
- **Colour**: the twelve swatches (the profile line), moved up from the bottom.
- **Duplicate to…**: a slot picker; empty slots first, a used slot asks before replacing.
  Tile names are shared on the keypad, so a copy costs no storage.
- **Use for apps…** (phase 3).
- **Clear**: one empty page named Main, the name kept; backup first (as every save).
- **Delete**: backup to the PC, then `rm /profileN.json`. If it is the keypad's active
  profile, the keypad first switches to another profile in use. Slots 1–3 come back as the
  shipped default the next time they are opened (firmware `loadProfile` → `writeDefault`);
  the confirm says so. Studio marks the slot empty and opens another.

### Pages

- Double-click a tab to rename it in place (Enter keeps, Esc cancels).
- Drag a tab to reorder; a ⋯ on the current tab: Rename, Duplicate, Move left, Move right,
  Delete.
- `KpLib.movePage(profile, from, to)` and `KpLib.deletePage(profile, i)` rewrite every
  `page` action (actions, hold_actions, off_actions, nested repeats) to follow the move.
  Deleting a page drops the page actions that opened it; a key left with no actions that
  was a folder for it is cleared. The confirm counts them.
- **+ Page** is disabled at 16 pages (firmware MAX_PAGES).
- The Profile name, Page name, Delete page and line colour fields at the bottom go away.

### Folder in one step

Library › Keypad › **Folder…** asks a name; it appends a page of that name with a Back key
in cell 1, and makes the selected key a folder key (icon `folder`, the page action). A
folder key's panel has **Open folder ›**.

## Phase 3: device extras

- **Restart** (`reboot`) and **Turn off** (`power off`) in Device › Connection. Turn off
  confirms: "Only the RESET button turns it back on." Auto-connect brings Studio back after
  a restart.
- **Screenshot** (Device › Connection): `shot` → `SerialLink.readShot` collects the 320
  base64 rows with a progress bar → `tiles.shotToBgra` → `nativeImage` → shown in a dialog
  with **Save PNG…** and **Copy**. USB or Bluetooth (slower over Bluetooth).
- **Test** (key panel): flushes pending edits, makes this profile and page the keypad's,
  wakes the screen (bare `setdim` wakes it, so the press is not eaten by the wake), then
  `touch x y` at the key's centre: `x = col·96 + 48`, `y = 30 + row·90 + 45`
  (board.h STATUS_H 30, CELL_W 96, CELL_H 90). A one-line note: the keys go to the window
  in front, which is Studio. Disabled on an empty key and on the player page.
- **Use for apps…** (profile ⋯): a checklist of the known apps (`CONTEXT_MATCH`), the
  generated ones, and the apps seen this session (`autogen.usage.minutes()`); ticking an
  app maps it to this profile (one profile per app, so it leaves any other). Turns on
  "switch by app" if it is off, and says so. The apps show as a chip beside the profile
  name. The Settings table stays as the overview.

## Phase 4: declutter

- `settings.advanced` (default off), a switch in Settings › Keypad link. Off hides the
  device console bar, the baud rate and the profile JSON.
- "Connect automatically" only in Device › Connection (removed from Settings).
- **↶ ↷** Undo/Redo buttons in the Editor top bar, disabled when there is nothing to undo
  or redo.
- Ask Claude folds to one line (input + Send); it opens on focus or when it has a
  conversation.
- Help text: one line where a paragraph is now.

## Testing

- `test/lib.test.js`: codeToKey (letters, digits, numpad, F13–F24, brackets, arrows, an
  unknown code), comboLabel, movePage and deletePage renumbering (nested repeat,
  hold_actions, off_actions; folder keys cleared), folder creation, errorPlace.
- `test/keylib.test.js`: each library key, with its `ask` filled by a sample, passes
  `schema.validateActions`; its icon is in KEY_ICONS; its name fits 14 characters; nothing
  conflicts with the host-action combos (`hostbridge.findActionConflicts`).
- `test/tiles.test.js`: shotToBgra on known pixels (byte order).
- `test/e2e.test.js` against the simulated keypad: delete (active and not), duplicate,
  readShot, testKey sends `touch` at the right point.
- Boot smoke test, and screenshots of each view and of the key panel, library and menus.
- The work keypad (bc:f2 on COM8, release firmware): Test with `hid dry on` (the press
  shows as `EVT:HID`, nothing reaches the PC), Screenshot, Restart. Turn off only on the
  simulated keypad.

## Not in this round

Offline editing, firmware updates over Bluetooth, a live screen mirror, a storage manager,
keyboard layouts other than US.
