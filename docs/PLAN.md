# ESP32 Touch Keypad: Plan and Design

A BLE macropad in the style of Stream Deck, built on the LCDwiki 4.0" ESP32-32E display board (E32R40T). You tap customisable tiles on the touchscreen, and the device sends macros to the computer over Bluetooth LE. It is the touchscreen member of the Macropad family and is built on the owner's shipped ESP32-Macro-pad v2.1 and its Electron app, Macropad Studio.

Interactive viewer with device simulator, Studio mock, reference design, architecture, protocol, landscape and roadmap: [`docs/viewer/index.html`](viewer/index.html). Open it in any browser. The viewer is styled as a toy-theatre, papercraft world, including the device's on-screen UI; that style belongs to the viewer and does not constrain the firmware.

Status: firmware 3.1.0 and Studio 3.1.0 built and tested on hardware (2026-10-02). v0.2 of this plan (2026-10-01) is kept below; where 3.1 differs, §6.4, §6.9 and §6.10 say so.

**What 3.1 shipped**
- The device screen is a glass / avionics design (firmware/DESIGN.md) drawn by its own renderer: damage rects, double-buffered DMA, 80 MHz SPI, every animation at 50–62 fps (tested).
- Keys use 214 built-in icons (Lucide, Simple Icons); keys can animate (`eq`, `pulse`, `rec`) and act as toggles with `off_actions`.
- Three default profiles (Daily, Code, Stream), full pages, each with a line colour.
- A full-page media player: album art, title, album, artist and source, live progress, tap to seek, transport keys. Studio feeds it from the Windows media session and seeks back.
- Touch calibration: an affine fit from four targets, a check point (≤ 16 px) and a test pad. It runs on first boot, from the sheet, or by holding BOOT for 2 s.
- Settings sheet tabs: Display, Profiles, Bluetooth (three hosts, switch, forget, pair), LED (rainbow default, breathe, solid, status, off), Device (key click, calibrate, about).
- Studio: a glass device preview, icon search, tints, animation and toggle fields, LED and display controls, and a firmware installer (esptool, bundled in the installer).

**3.2 task list: device themes** (owner's brief, 2026-10-02: up to five whole-device themes, light and dark gradients among them, remembering that on this TFT black glows grey under the backlight; one device-wide setting, Studio's preview follows; the owner later made Daylight the default)
- [x] Theme engine in the firmware: one table of roles per theme (ground stops, plies, text, state colours, key style), switched at runtime; crisp mode for the pixel theme.
- [x] Six themes, each from a real device: **Glass** (watch glass, the default, its ground lifted off black), **Paper** (the old papercraft: cut cards on cream, ink lines), **Daylight** (iOS / Car Thing light: sky-to-white, frosted white keys, tinted glyphs), **Aurora** (indigo-to-teal night sky, translucent panes, luminous glyphs), **Synth** (Teenage Engineering OP-1: warm grey, flat matte keys with a lip, colour dots, orange current), **Retro** (Game Boy DMG LCD: four greens, pixel boxes, crisp glyphs).
- [x] Dark themes use deep coloured grounds, never near-black fields; light themes carry contrast with ink, not with black.
- [x] Per theme: keys (rest, pressed, toggle on, animated, empty well, tags, labels), status band, stations, player, sheet, pairing, calibration, toast, volume HUD.
- [x] Settings → Display gets a theme row with a live preview chip per theme; switching wipes the new theme down the screen at 60 fps.
- [x] CLI `theme [name]`, NVS `kp/theme`, `theme:` in `status`; Studio's Device view picks the theme and the editor preview renders it.
- [x] Tests: per-theme screenshots with pixel checks, the wipe and a key press at 50 fps or better in every theme, the theme command; Studio unit and hardware tests.
- [x] Impeccable critique of each theme from device screenshots; fix what it finds.
- [x] Docs (DESIGN.md theme tokens, PROTOCOL.md, README), release build, cleanup, commit.

Done 2026-10-02: firmware 3.2.0 and Studio 3.2.0. 51 board tests (15 for themes: ground and key style per theme, page wave and press at 50+ fps in each, the wipe, the sheet chip, survival across a reboot), Studio 44 unit + 10 hardware, both end-to-end runs. Gradients are dithered (2×2, half an RGB565 step), which also removed banding from the Glass and Aurora skies and a pink cast on near-white tiles.

**3.2.1 task list: power, speed, Studio over Bluetooth** (owner's brief, 2026-10-02: Studio works over Bluetooth alone; smart sleep on battery, full power on USB; a faster screen; the battery level shown with a cell, charging on USB)
- [x] USB or battery from the CH340's TX line; the Li-ion curve on IO34; the status band shows the charge, a bolt while charging on USB, a plug with no cell; the Battery Service level.
- [x] Battery policy: dim at 20 s, off at 60 s (CPU 80 MHz, LED dark), deep sleep after `power sleep` minutes (default 5), wake on touch. Edits from Studio light the screen; feeds don't.
- [x] Faster frames: two-pixel dither stores, a cheaper pop fade, clipped back cards. Every theme animates at 50+ fps on the board.
- [x] Bluetooth console: a Nordic UART service carries the same CLI to paired hosts; KpLink (C#, Windows GATT) bridges it to Studio, with USB still tried first.
- [x] Studio: the Link and Power rows, the battery sleep setting, a Bluetooth note on firmware install.
- [x] Tests: power on the board (readout, battery policy, the wake rule, sleep minutes); Bluetooth port units; the installed-app E2E in both USB and Bluetooth-only modes.

Done 2026-10-02: firmware 3.2.1 and Studio 3.2.1. 54 board tests, Studio 49 unit + 10 hardware, media E2E, installed-app E2E on USB and on Bluetooth (18/18 each), BLE E2E (media keys read from Windows' HID stack, typing with the 120-character line, host action, Play/Pause).

**3.3 task list: app profiles, quick switch, Autogenerate** (owner's brief, 2026-10-02: research the most used shortcuts of the apps used most and make a profile for each; a quick profile switch on the screen; a main-screen option that asks Claude, in real time, for a profile for the current app; keep Opus and cache a profile once made)
- [x] Usage from Windows' own records (UserAssist focus time): VS Code, Chrome, Slack, Windows Terminal, Signal, Claude, File Explorer, plus Notepad++ and Bruno.
- [x] Nine profiles from each app's documented default shortcuts (`tools/profiles/app_profiles.py`, sources in its header), slots 5–13, mapped in Studio's auto-switch table.
- [x] Sixteen profile slots (firmware, schema, Studio); the status band's profile name opens a 4 x 4 Profiles grid.
- [x] Generate: `EVT:AUTOGEN`, the `autogen` progress toast, Studio's Claude Code call (default model, structured output), one retry on a weak answer, the app mapped and cached; a second tap switches without asking Claude.
- [x] Tests: 4 board tests (button, grid switch, progress, no Studio), autogen units with a fake Claude Code, a live installed-app E2E (Paint, real Claude, then the cached switch).
- [x] Folder keys (only action `page`) drawn as a stack on the keypad and in Studio; VS Code page 1 gets a Git folder (VS Code's own Git commands through the Command Palette) and page 2 a Debug folder; generated profiles may use folders.
- [x] 3.3.1: console replies go only to the link that asked (events to both), so a Bluetooth listener left subscribed can't slow USB reads (the cause of slow profile reads in the E2E); KpLink unsubscribes on exit; an upload ignores the other link's lines.
- [x] 3.4.0: image and GIF keys. Studio decodes the file (ImageDecoder, up to 16 frames at 72 x 72), each frame is a tile; the keypad plays `frames` at `frame_ms`, redrawing on frame changes only, one flash read per screen frame (three 6-frame GIFs hold 61 fps); the tile collector keeps frames; Studio's preview animates them. Startup now opens the keypad's active profile.
- [x] 3.5.0: moving icons. Every key's built-in icon is animated on the keypad, a GIF for each of the 214 icons with no files: a motion per icon family (spin, swing, bounce, rise, slide, pulse, float), a phase per key, redrawn only when the pose changes (20 per second at most), translations on the fast native glyph path, rotation through a new bilinear glyph; idle redraws stay inside one frame (16 ms). `iconanim`, NVS `kp/ianim`, a Studio switch.
- [x] 3.6.0: designed icon animations. Each of the 214 key icons acts out its key, element by element, from `tools/icons/anim_designs.js` (copy pulls a second sheet out of the first, save stamps a check into the disk, wifi lights its arcs in turn, a bell rings with its clapper lagging, mail opens its flap, brand marks spin like a coin): rendered from the Lucide SVG parts by `build_anims.js` with the masks' own rasterizer, stored as changed pixels against each resting mask (`anims_gen.h`) and played at 60 ms a frame when a key fires; idle keys take turns, one every 1.6 s, instead of all moving at once. Studio's icon GIFs are decoded from the same frames.
- [x] 3.7.0: notifications, the shade and the host menu. The status band gets a bell (an unread badge) and a host chip; a new notification drops a banner over the band. A swipe down (or the bell) pulls a shade: brightness slider, profile stepper, the Bluetooth hosts to switch between, and the newest notifications (swipe one away, Clear all). The host chip drops a list of the saved hosts to switch to. Studio mirrors this PC's Windows notifications (it reads the Windows notification database with Node's sqlite, Settings › Notifications); the keypad adds its own (host connected or lost, key not sent, battery low, Generate). `notify`, `shade`.
- [x] 3.8.0: livelier idle icons. A few keys play at once (a new one every 0.5 s, three at most) and every 20-30 s a wave ripples across the grid, diagonal by diagonal like the page pop-in (six at once at most, so every frame stays under 16 ms: measured 8.7 ms worst for the few, 15.7 ms for the wave). Inflated animations are now shared per icon and counted by the keys playing them, inside a 36 KB budget that also keeps 36 KB of heap free; a fired key makes room by stopping the idle ones. Icon frames are redrawn only while a frame stays within a pixel budget (the rest show theirs a tick later), and a key's frame advances only with a whole-key repaint. The shade opens at once (it read every profile, 1.5 s) and its first frames no longer jump (its clock is signed); the battery reading no longer makes the shade or the Bluetooth tab walk the file system every few seconds. `iconanim wave`.
- [x] Ask Claude in Studio's editor: a chat that organizes, creates and edits the open profile (studio/services/chat.js). Claude's profile is validated as sent, before any repair, so a broken answer can never empty a profile; a change is one undo step and autosaves.

**3.9.0 task list: battery** (owner's brief, 2026-10-14: the battery is still planned; a battery optimization plan and USB or battery detected on its own, for every use: unplugged all day, a spare, days of standby. Approach: fix what needs no numbers now, measure the rest with a Nordic PPK2.) USB or battery detection and the battery policy shipped in 3.2.1; this list closes the gaps found reading it.
- [x] Deep sleep holds the pins that float otherwise (backlight IO27 low, amp enable IO4 high, the LED, LCD CS and touch CS high) and turns the click's DAC off; `powerUnhold()` frees them first thing at boot, or a woken LCD ignores its init.
- [x] Empty: at 0 % (3.30 V on the resting curve) a "Battery empty" notice, then deep sleep after 5 s, again after each touch-wake until USB; the 15 % warning stays above 0 % so it can't replace that notice. Advertising stops with the sleep.
- [x] The gauge only falls on battery (a lit screen sags the cell; it no longer climbs back when the screen goes dark); USB or a reboot takes a fresh reading. Known ceiling: it reads a few % low while lit, until a real cell's internal resistance is measured.
- [x] The main loop rests 20 ms a pass instead of 1 while the screen is off on battery (not while a macro runs).
- [x] Bluetooth: measured, Windows sets 15 ms with a peripheral latency of 30 for HID on its own and overrides a request for 0 within 2 s. So the keypad now asks for 7.5-15 ms, latency 30 always (key reports still leave at the next event); no idle/active switching. `EVT:BLE <slot> params`, `link:` in `power`.
- [x] Ruled out: light sleep with a live BLE link. The core is built without power management (`CONFIG_PM_ENABLE` off) and the ESP32 needs a 32 kHz crystal on IO32/33 for it (IO33 is the touch CS).
- [x] Tools: `power nap <s>` (deep sleep until a touch or the timer, for the profiler and tests), `power sim battery <mv>`, `EVT:POWER empty`, `EVT:POWER wake touch|timer`.
- [x] Tests: the gauge only falls, the cutoff warns then sleeps, a timer nap wakes to a screen that draws.
- [x] PPK2 (2026-10-19; source mode at 3.7 V on the battery connector, USB unplugged, the console over Bluetooth through KpLink): lit with icon animations 145 mA, lit still 141, dim 81.5, off at 80 MHz 52, deep sleep 0.24 (a first reading of 0.83 never came back in eight more, from every path). The backlight is linear, 0.47 mA a step (160 is 76 mA, 255 is 121); with it off the board draws 67 mA at 240 MHz. The radio is about 3.5 mA of the off state (48 with it off). A wake from deep sleep is back on Bluetooth in 1.5 s at about 160 mA. Advertising alone wasn't measured: the PC reconnects at once.
- [x] Found with the PPK2: on battery the board said `usb:1`, so none of the battery policy ran. The unpowered CH340 lets go of its TX line and the UART's pull-up held RX high. 3.9.1 samples RX pulled down (measured: 0 on battery, 1 on USB); the console drops the NUL that low line reads as.
- [x] The knobs on those numbers (3.9.1): dim on battery runs at 80 MHz (81 to 68 mA); the panel sleeps while the screen is off (52 to 38 mA; `displaySetBacklight(0)` sleeps it, any level wakes it, with the ST7796's 120 ms and 5 ms). Kept: lit at 240 MHz (160 saves 6-7 mA, but the shade takes 18 ms and a page change 21 ms, over the 16 ms frame); the off loop's 20 ms rest (1, 20 and 100 ms all draw 51-52 mA); the pin holds in deep sleep (0.19 mA without, 0.24 with, but fixed levels; TX held low costs more, 0.34); the backlight cap of 160 and the dim at 20 % (the owner's brightness; 0.47 mA a step). A bare `setdim` now reports instead of setting "Never".
- [x] 3.9.1 on the PPK2 with no `power sim` (2026-10-21): the board found the battery on its own (`pwr:bat usb:0`). Lit 143.7 mA with icons moving, 141.1 still; dim 66.6 at 80 MHz; off 38.0; lit again after off 143.5 (the panel woke); a `power nap` 0.20 mA, and its wake boots at 152 mA and is back on Bluetooth in 2.7 s. Left alone, the policy slept the board 5 min after its boot, at 0.20 mA.
- [x] Turn off (3.10.0, owner's ask 2026-10-21): Settings › Device › Turn off (and `power off`), tapped twice within 3 s, shows "Turned off" and 2 s later deep-sleeps with no touch or timer wake, so only RESET or a power cycle brings it back. It draws what deep sleep does (0.20 mA, the regulator and the dividers; only a hardware switch removes that), and a bag can't wake it. WiFi needed nothing: the firmware never starts it. Firmware over Bluetooth was weighed and left for now: two app slots (1.67 MB each) would shrink profile and GIF storage from 2 MB to about 0.5 MB. Found on the way: stamps set as `millis() | 1` (a millisecond ahead half the time) and compared unsigned wrap to 4 billion within that millisecond. The armed button disarmed at once about half the time, and the 2 s "Turned off" banner, the 5 s "Battery empty" banner (`delay(1)` can return within the same millisecond) and the panel's 120 ms wake guard could be skipped. All four compare signed now, as the shade and the key animations already did.
- [x] On USB the screen stays on (3.11.0, owner's ask 2026-10-21): no dim, no screen off, no sleep while USB powers it; plugging USB in relights a dark screen. Settings › Display's Dim after row (30 s to Never, then off at 10 min) only ever mattered on USB, since battery dims at 20 s whatever it says, so it is now a note: "On USB the screen stays on" and the battery's dim, off and sleep times. `setdim` stays for tests (on battery, min(s, 20)).
- [x] Faster Settings and page changes (3.11.2, owner's ask 2026-10-26). Settings took 2.8 s to open and a page change 64-204 ms (later pages slower) before anything moved: ArduinoJson read the profiles a byte per call, each an `fread` through the VFS (and `seekPages`' `available()` an `ftell`), about 11 µs a byte, and the sheet read all 16 profiles (236 KB) and walked the file system twice on every open and tab tap. Profiles are now read 512 bytes at a time (`FileReader`: every profile parse, so `gcTiles` and uploads too), the slots only for the Profiles tab and again only after a commit or `rm`, the used storage only for the Device tab, the total once. Measured on the work board: Settings opens in 5-6 ms, the Profiles tab in 5-13 ms (344 ms the first time after a boot or a change: opening a file is three LittleFS lookups, about 14 ms), a page in 26-33 ms whichever page. The pop-in wave after a page change (28 ms a key, about 0.5 s) is unchanged.
- [x] A quick bar beside the keys (3.12.0, owner's ask 2026-11-03; design `docs/superpowers/specs/2026-11-03-quick-bar-design.md`, plan `docs/superpowers/plans/2026-11-03-quick-bar.md`). The keys moved into five 84 px columns over the left 420 px (keys still 66 px, 15 a page; a label too wide at B612 13 steps down to 11, Synth's mono labels to Mono 11, so no label that fit before is cut), and a 60 px bar fills the right edge on every profile and page: four buttons (`quickbar`, NVS `kp/qbar`), each a page of any profile, opened as a panel over the keys with its own page line, folders, back and toggles while the active profile and page stay untouched underneath (Studio's `page`, `setprofile` and autosave act on them; a panel key sends `EVT:PKEY`). On top, the suggestion slot: Studio learns, per app in front, which profile the owner switches to on the keypad (the new `EVT:SWITCH <n> touch|suggest|back`) and presses keys on, with a 7-day half-life and a minimum of 3 (settings `suggest_half_life_days`, `suggest_min_weight`), and sends `suggest <n>`; a tap switches, and the slot then offers the way back. Studio › Device › Quick bar sets the buttons and lists what it learned. A fresh keypad starts with Media (profile 1 page 2) and Git (profile 2 page 2); an updated one with four empty buttons. Tested on the work board: 91 device tests pass (25 new; the panel holds 50 fps or better and costs under 12 KB of heap), Studio 75/75 and the boot smoke.
- [x] A system-wide mic mute key (Studio 3.12.1, owner's ask 2026-11-03; firmware unchanged). A `host` key with `mic toggle` (or `mic mute`, `mic unmute`) makes Studio mute or unmute every active microphone through Core Audio (`services/micmute.js`: one hidden PowerShell, warmed at start, about 2 ms a press), the way a laptop's or Logitech's mic key does, so every app hears silence. Logi Options+ shows its mic-muted icon (top left of the main display) for any endpoint mute, tested on TRK-ADITYA, so the key shows the same icon there; Studio draws none of its own. Needs Studio running, like every host key.
- [ ] With a real cell: its internal resistance (the lit sag), for a load-compensated gauge; the runtime per use from the measured currents. The board's own path already reads about 20 mV low at 145 mA from a stiff source (3.684 V lit, 3.705 V off, at 3.700 V).

**What changed since v0.1**
- The project now builds on Macropad v2.1 (§4) instead of starting fresh.
- Macropad Studio 3 replaces the planned Web Serial configurator and the Tauri companion. It gets a "Touch Keypad" device type (§10).
- The v2.1 line CLI, extended, replaces the binary frame protocol (§8).
- Host actions send a reserved F13–F24 combo that Studio catches as a global shortcut. There is no custom GATT event channel in v1 (§9).
- Schema v2 extends v1's 16 action types (§7).
- Firmware is one non-blocking loop as in v2.1, replacing the FreeRTOS task split (§6.3).

---

## 1. Goals and non-goals

**Goals**
1. Keys work on any computer, tablet or phone **with nothing installed**. The device is a standard BLE HID keyboard, consumer-control, mouse and telephony device.
2. A Stream Deck–grade software model: profiles, pages, folders (a page plus a back stack), multi-step actions, hold actions, icons, titles and widgets. Two-state toggles come in M5.
3. Configuration from Macropad Studio, the existing Electron app, over USB serial. A tile edit shows on the device in under a second.
4. Studio adds what HID can't: host actions (open an app or URL, OBS, scripts), the clock and Now Playing, live titles, profile switching by focused app, and AI shortcut suggestions.
5. Reuse what Macropad v2.1 already proved before building anything new.
6. Safe by default. A wireless keystroke injector must not be reprogrammable by a stranger.

**Non-goals (v1)**
- Wi-Fi features (cloud, Home Assistant).
- Running Stream Deck plugins directly. A Studio plugin API is planned for M5; OpenDeck is prior art for compatibility.
- Unicode typing. HID has no Unicode, so text is limited to the host keyboard layout.
- BLE firmware updates. v1 updates over USB from Studio's flasher.
- A custom BLE GATT event channel. Host actions use F13–F24 combos (§9); wireless CLI over BLE NUS comes in M4.
- Studio host features on macOS and Linux. Studio targets Windows; keys work on any OS without it.

---

## 2. Research summary

### 2.1 Commercial devices
| Product | Keys / display | Link | Keys work without host app |
|---|---|---|---|
| Stream Deck MK.2 | 15 keys (5×3), **72×72** images | USB | No |
| Stream Deck Mini / XL | 6 keys at 80×80 / 32 keys at 96×96 | USB | No |
| Stream Deck + | 8 keys at 120×120, 800×100 touch strip, 4 dials | USB | No |
| Stream Deck Neo | 8 keys at 96×96, info bar, 2 touch points | USB | No |
| Stream Deck Studio | 32 keys, 2 encoders | Ethernet PoE+ / USB-C | No |
| Loupedeck Live / Razer Stream Controller | 12 touch-LCD keys with haptics, 6 dials | USB | No |
| Logitech MX Creative Console | 9 LCD keys, dialpad | wired keypad | No |
| Touch Portal / Macro Deck | phone or tablet as the deck | Wi-Fi | No |
| Corsair iCUE Nexus | 640×48 touch bar | USB | No |

Takeaways:
- Every Stream Deck is wired, and nothing works unless the desktop app is running.
- Elgato's software concepts are the reference for this design:
  - Structure: profile → page → folder.
  - Actions: multi-action, Hotkey Switch (two-state toggle), and Key Logic (press, double-press and hold).
  - Smart Profiles switch the profile when the focused app changes.
  - The host owns key state and pushes it with `setTitle`, `setImage`, `setState`, `showOk` and `showAlert`.
  - Plugins run as separate processes and talk WebSocket JSON. Each declares its actions in a `manifest.json` and supplies an HTML Property Inspector for settings.
- What users praise: drag-and-drop editing on a virtual copy of the device, live key states, an icon creator, and a plugin store.
- What users complain about: laggy config apps (Loupedeck), lock-in (iCUE), making icons by hand, the late arrival of long-press, phone-app subscriptions, and no wireless option.

Sources: [python-elgato-streamdeck](https://github.com/abcminiuser/python-elgato-streamdeck), [Elgato SDK WebSocket reference](https://docs.elgato.com/streamdeck/sdk/references/websocket/plugin), [Elgato image guidelines](https://docs.elgato.com/guidelines/streamdeck/plugins/images-and-layouts/), [Key Logic](https://www.elgato.com/us/en/explorer/products/stream-deck/key-logic-stream-deck/), [Stream Deck Studio specs](https://help.elgato.com/hc/en-us/articles/29982976486669-Elgato-Stream-Deck-Studio-Technical-Specifications), [Touch Portal API](https://www.touch-portal.com/api/index.php?section=communication_setup_connection), [Razer Stream Controller review](https://www.windowscentral.com/accessories/razer-stream-controller-review), [iCUE Nexus review](https://www.techpowerup.com/review/corsair-icue-nexus/).

### 2.2 Open-source prior art
- **[FreeTouchDeck](https://github.com/DustinWatts/FreeTouchDeck)** is the closest ancestor.
  - Built on ESP32, a 3.5" ILI9488 screen and XPT2046 touch, using TFT_eSPI and T-vK BLE-Keyboard.
  - The ESP32 serves a Wi-Fi web configurator and stores icons as 75×75 BMP files in SPIFFS.
  - It is stale: it breaks on Arduino core 3.x, and its author says the configurator "requires modernization".
- **[ESP32-BLE-Macropad](https://github.com/saiprashanth802/ESP32-BLE-Macropad)** moved to NimBLE to fix ghost connections after Windows sleep/wake. It supports **3 hosts by giving each slot its own static random address**, and has a .NET companion app.
- **[OpenDeck](https://github.com/nekename/OpenDeck)** (Tauri, Rust, Svelte) runs Elgato plugins outside Elgato's app. **[StreamController](https://github.com/StreamController/StreamController)** is a Linux alternative. **[Bitfocus Companion Satellite](https://companion.free/for-developers/Satellite-API/)** shows a protocol simple enough for a microcontroller. **[deej](https://github.com/omriharel/deej)** controls per-app volume through a serial agent.
- **BLE HID libraries:**
  - [T-vK ESP32-BLE-Keyboard](https://github.com/T-vK/ESP32-BLE-Keyboard) is effectively unmaintained (240+ issues). In its NimBLE mode, free heap rises from 143 KB to 260 KB and flash use drops from 76% to 44%.
  - NimBLE successors: [ESP32-NIMBLE-Keyboard](https://github.com/Berg0162/ESP32-NIMBLE-Keyboard), [ESP32-NimBLE-Combo](https://github.com/A-box1000/ESP32-NimBLE-Combo), [HijelHID](https://github.com/HijelHub/HijelHID_BLEKeyboard).
- **Known BLE pitfalls:**
  - Persist bonds in NVS and resolve RPAs (iOS rotates its address).
  - Scanning before the server starts breaks bonded reconnects ([NimBLE #1187](https://github.com/h2zero/NimBLE-Arduino/issues/1187)).
  - A host that deleted its bond can't re-pair unless the device forgets its side too ([esp-idf #14082](https://github.com/espressif/esp-idf/issues/14082)).
  - A crash has been reported when macOS Chrome reconnects after bonding ([esp-idf #12050](https://github.com/espressif/esp-idf/issues/12050)).
- **Web Bluetooth:**
  - Works in Chrome and Edge on Windows, macOS, Android and ChromeOS. Not in Firefox or Safari, so not on iOS.
  - The HID service `0x1812` is [blocklisted](https://github.com/WebBluetoothCG/registries/blob/master/gatt_blocklist.txt), but a custom service on the same device is allowed.
  - Discovering a device that is already connected to the OS as a keyboard is unreliable on Windows ([btleplug #459](https://github.com/deviceplug/btleplug/issues/459), [bleak #740](https://github.com/hbldh/bleak/issues/740)). **This is why configuration runs over USB serial.** Those two issues are in native libraries, so the BLE NUS link planned for M4 needs the same check.

### 2.3 What we take and what we change
**Take from Stream Deck:**
- Profile, page and folder structure.
- Multi-step actions and a separate hold action. Two-state toggles in M5.
- A drag-and-drop virtual device editor.
- The host pushes live state to keys.
- Smart profiles, through Studio's existing context switching.
- 72×72 key art, so existing icon packs work.
- An icon and colour picker; Studio renders the tile.

**Change:**
- Basic keys need no host app.
- Start from Macropad v2.1's schema, CLI, macro engine and Studio instead of writing new tools (§4).
- Studio pre-renders tiles and the device stores them, so only titles, state and widget data cross the link at run time.
- Gestures (tap, hold, swipe) are detected on the device.
- Visible press feedback plus an optional speaker click.
- Wireless and battery-capable.
- F13–F24 keys for zero-protocol host bindings: Studio's host bridge, or AutoHotkey and similar.
- Avoid FreeTouchDeck's Wi-Fi configurator, BMP icons and unpinned toolchain.

### 2.4 UI references
The look of the device UI borrows from products that are not macropads.

| Product | What we take |
|---|---|
| Spotify Car Thing (4" touchscreen, dial, 4 presets) | True-black background led by album art; one big dial with an on-screen ring; large tap targets; a Now Playing card |
| Apple Watch | Glossy rounded tiles with labels below; rings for progress and countdowns; settings as grouped lists with coloured icon squares; page dots |
| Samsung Galaxy Watch | The rotating bezel becomes the optional EC11 dial; swipe between full-screen tile pages; the quick panel becomes the swipe-up settings sheet |

---

## 3. Hardware: E32R40T (verified from LCDwiki docs)

| Item | Value |
|---|---|
| Module | ESP32-WROOM-32E (ESP32-D0WD-V3), 2× LX6 at 240 MHz, BT 4.2 + BLE |
| Memory | 520 KB SRAM, **4 MB flash, no PSRAM** |
| Display | ST7796S, 320×480, 4.0" TN, 4-wire SPI, RGB565 |
| Touch | XPT2046 resistive, **shares the LCD SPI bus** |
| Power | USB-C via CH340C; TP4054 Li-ion charger and 1.25 mm battery connector; ME6217 LDO |
| Audio | Internal DAC on IO26 → FM8002E amp (enable on IO4, active low), 1.25 mm speaker connector |
| Other | RGB LED (active low), microSD on its own SPI bus, BOOT and RESET buttons. No light sensor. |
| Draw | ~230 mA with the display on; backlight 142 mA at full brightness |

| Function | GPIO | Notes |
|---|---|---|
| LCD SCK / MOSI / MISO | 14 / 13 / 12 | Shared with touch. **IO12 is the flash-voltage strapping pin**: it must not be high at boot. |
| LCD CS / DC | 15 / 2 | Strapping pins |
| LCD reset | EN | Tied to chip reset (`RST = -1`) |
| Backlight | 27 | High = on, LEDC PWM |
| Touch CS / IRQ | 33 / 36 | IRQ is input-only, active low; touch SPI runs at ~2 MHz |
| RGB LED R/G/B | 22 / 16 / 17 | Active low, so drive high at boot |
| SD CS/SCK/MISO/MOSI | 5 / 18 / 19 / 23 | Separate bus |
| Battery ADC | 34 | ADC1 |
| BOOT | 0 | Usable as a button after boot (factory reset hold) |
| Free | 21, 25, 32; 35 and 39 input-only | I2C header on 25/32 |
| Optional EC11 dial | 32 / 25 / 21 | A / B / push on the free pins; uses the I2C header pins (M4) |

Vendor software notes:
- Tested with Arduino core **2.0.17** and 3.0.3.
- Uses TFT_eSPI with a **custom `ST7796_Init.h`**.
- Supports **LVGL 8.3 only; the vendor says v9 does not work.**
- **Unverified:** the maximum SPI clock. Measure it in M0, starting at 40 MHz.

Sources: [LCDwiki page](https://www.lcdwiki.com/4.0inch_ESP32-32E_Display), [Arduino demo instructions (PDF)](https://www.lcdwiki.com/res/E32R40T/4.0inch_E32R40T_E32N40T_Arduino_Demo_Instructions.pdf), [specification (PDF)](https://www.lcdwiki.com/res/E32R40T/E32R40T_E32N40T_Specification_V1.0.pdf), [schematic (PDF)](https://www.lcdwiki.com/res/E32R40T/4.0inch_ESP32-32E_E32R40T_E32N40T_Schematic.pdf).

---

## 4. Reference design: Macropad v2.1

Macropad v2.1 runs on an ESP32-S2 with 12 mechanical keys over USB HID, and ships with Macropad Studio 2.1, an Electron app. Its schema, serial protocol, non-blocking macro engine, atomic storage, backups, AI shortcuts and context switching are proven in daily use. The Touch Keypad keeps all of that and replaces only what the new hardware forces: the HID transport, the input layer, the screen, and the flasher's reset method.

| Area | Macropad v2.1 | Touch Keypad | Change |
|---|---|---|---|
| Board | LOLIN S2 Pico (ESP32-S2), native USB | E32R40T (ESP32-WROOM-32E), CH340C USB-UART | replaced |
| Input | 12 mechanical keys, 2 capacitive pads | 4.0" resistive touch, 15 tiles per page, optional EC11 dial | replaced |
| HID transport | TinyUSB: keyboard, mouse, consumer, telephony (ID 8) | NimBLE HID over GATT, same four reports, 3 host slots | replaced |
| Feedback | 12 WS2812 key LEDs and idle animations | Screen tiles with glow, 1 RGB status LED, key click | extended |
| Schema | v1: 16 action types, `keys[12]`, `led_color` | v2: same 16 types + `page`, `back`, `host`; `pages[]`, `icon`, `hold_actions`, widgets | extended |
| Firmware core | Single loop, non-blocking macro engine, watchdog, safe-boot | Same, plus `ui.tick()` and the NimBLE task | reused |
| Storage | LittleFS `profile1..3.json`, atomicWrite + 3 `.bak` | Same, up to 8 profiles + `/t/*.565` tiles | reused |
| Protocol | Line CLI, `###BEGIN###` uploads, `EVT:` events | Same + `page`, `setface`, `sethold`, `widget`, `settime`, `###BEGINB###` | extended |
| App | Macropad Studio 2.1 (Electron): Editor, Device, AI, Settings | Studio 3: adds the device type, pages, tile renderer, host bridge | extended |
| Flasher | 1200-baud touch, port re-detect, bundled esptool | Classic DTR/RTS auto-reset over CH340, same bundled esptool | replaced |

**Reused as-is**
- `schema.py` as the single source: `validate_actions`, `repair_actions`, `ALIASES`.
- The non-blocking macro engine, with its repeat stack and abort on new press.
- atomicWrite with `.tmp` + 3 `.bak`, parse before commit, safe-boot.
- Studio's serialized serial queue, prompt detection and `EVT:` diversion.
- PC auto-backups (20 per slot), backup all, restore all.
- The AI shortcut pipeline (Ollama, OpenAI, Gemini) with programmatic repair.
- `activewin` + contexts for automatic profile switching.
- Tray, launch at login, electron-updater, command palette.

**Extended**
- Profile JSON: `pages[]`, `icon`, `hold_actions`, `widget` + `span`; `migrateProfile` v1 → v2.
- New actions: `page`, `back`, `host`.
- `led` and `led_anim` drive the tile glow and the status LED.
- Editor: page tabs, tile preview, icon and colour picker, hold tab.
- CLI: `page`, `setface`, `sethold`, `widget`, `settime`, `###BEGINB###` for tiles.
- Upload cap 16 KB → 64 KB; serial 115200 → 921600 baud.
- Device panel: BLE host slots and config lock.

**Lessons carried over**
- Expose logical key IDs to the app, never wiring order.
- Serialize every serial command; run `setprofile`, then `cat`.
- Back up before every write and carry every field through restore.
- Keep the Electron preload self-contained (a sandboxed `require` caused a blank window).
- Ship `latest.yml` with each release or auto-update silently fails.
- Guard flasher transport teardown with a timeout.
- One schema generates the AI prompts and validates everything sent to the device.

**Porting notes** (found while reading the v2.1 code)
- v2.1 builds on Arduino-ESP32 core 3.2.x. This board pins 2.0.17 (§6.1), so reused modules need small backports. Example: the watchdog setup uses `esp_task_wdt_reconfigure()`, which only exists in core 3; core 2.0.17 uses `esp_task_wdt_init()`. See open question 4.
- v2.1 collects a JSON upload in a RAM `String` before parsing. That is fine at 16 KB on the S2. At 64 KB, next to NimBLE with no PSRAM, it is not, so the port streams upload lines to `<file>.tmp` and parses from the file before the rename (§8.3).
- `hid_layer` (TinyUSB) is swapped for `ble_hid` with the same call surface, so `macro_engine` does not change.

---

## 5. System architecture

```
 Host: Windows with Studio, or any OS for HID only     ESP32 Touch Keypad (E32R40T)
 ┌──────────────────────────────────────┐             ┌─────────────────────────────────────┐
 │ OS HID stack ◄───────────────────────┼─ BLE HID ───┤ ble_hid (NimBLE HOGP, 3 host slots) │
 │   │ reserved F13–F24 combo           │             │   ▲                                 │
 │   ▼                                  │             │ macro_engine ◄── ui ◄── touch       │
 │ Macropad Studio 3 (Electron)         │             │   ▲                                 │
 │   hostbridge ─► open / OBS / script  │             │ profiles ◄── storage (LittleFS+NVS) │
 │   tiles, feeds, contexts, ai, backup │             │   ▲                                 │
 │   serial service ◄───────────────────┼─ USB serial ┤ cli (line CLI, uploads, EVT:)       │
 │                                      │  CH340C     │                                     │
 │   (M4) ◄─────────────────────────────┼─ BLE NUS ───┤ cli over NUS, behind config lock    │
 └──────────────────────────────────────┘             └─────────────────────────────────────┘
```

**Three paths to the host:**
1. **OS HID over BLE.** Always present. Keys, text, media, mouse and telephony. Needs nothing installed.
2. **Studio over USB serial** (CH340C, 921600 baud). Configuration (uploads and live previews), feeds (clock, Now Playing, live titles), `EVT:` events, context-based `setprofile`, and flashing. Until BLE NUS lands in M4, feeds and context switching need the cable.
3. **Host actions over BLE HID.** A `host` action sends a reserved F13–F24 combo, and Studio catches it with Electron's `globalShortcut` (§9). This needs no data link, so it works when only BLE is connected.

**Studio 3 services:**
- Reused from 2.1: serial, schema, store, backup, contexts, activewin, ai, flasher.
- New: `tiles` (renders 72×72 tiles from an icon and a colour, then uploads them), `hostbridge` (`globalShortcut` on F13–F24 combos → open an app or URL, OBS, scripts), `feeds` (clock, Now Playing from the Windows media session, live titles over serial).

**Key decisions**

| Decision | Why | Instead of |
|---|---|---|
| Studio is the configurator and the companion | Studio already has the serial service, schema, backups, AI, active-window switching, tray, auto-update and flasher. Adding a device type costs far less than building a web configurator and a companion app. | A separate Web Serial configurator and a Tauri companion (v0.1) |
| Keep the v2.1 line CLI | The host code is proven, you can read it in a terminal, and it already handles events and uploads. Binary tiles travel as base64 lines with a CRC. | The binary frame protocol from v0.1 |
| Host actions through F13–F24 global shortcuts | Works over plain BLE HID with no custom GATT service and no pairing quirks, and Studio already runs in the tray. | A custom BLE event channel, deferred to the NUS work in M4 |
| Studio pre-renders tiles | Studio draws the gradient, gloss and icon on a 72×72 canvas, and the device just blits RGB565. The look costs the ESP32 nothing. | Drawing gradients on the device, which is slow without PSRAM |
| NimBLE HID with 3 host slots | About twice the free heap of Bluedroid, fixes reconnects after sleep and wake, and gives each slot its own static address. | |
| Single loop, as in v2.1 | The non-blocking engine already proves the pattern. Redrawing one tile per pass keeps typing smooth and gives the staggered reveal. | The FreeRTOS task split from v0.1 |

---

## 6. Firmware design

### 6.1 Stack
| Layer | Choice | Why |
|---|---|---|
| Build | `arduino-cli`, Arduino-ESP32 core 3.2.1 (decided in M0; `tools/kp.py build`) | Same core as v2.1, so modules port unchanged; LovyanGFX 1.2.21 and NimBLE-Arduino 2.5.0 run on it |
| BLE | NimBLE-Arduino 2.x with an HID device class (keyboard + consumer + mouse + telephony); NUS service in M4 | Roughly 2× the free heap of Bluedroid; fixes sleep/wake reconnects |
| Graphics | LovyanGFX: `Panel_ST7796` with the vendor init table, `Touch_XPT2046` on the shared bus, DMA | The UI is a grid of pre-rendered tiles plus a few widgets, so direct drawing is enough. LVGL 8.3 is deferred until the UI needs real forms |
| Storage | LittleFS (2 MB), NVS | As in v2.1; power-safe; content-addressed tile files |
| JSON | ArduinoJson 7 | As in v2.1. Parses the profile with a filter, so only the page on screen stays in RAM |

### 6.2 Modules
| Module | Origin | Job |
|---|---|---|
| `macro_engine` | reused | Non-blocking, one step per `tick()`, repeat stack, aborts on a new press |
| `storage` | reused | atomicWrite + 3 `.bak`, safe-boot |
| `profiles` | reused, extended | Loads schema v2, accepts v1 files (§7.3), up to 8 profiles |
| `cli` | reused, extended | Line commands, `###BEGIN###` and `###BEGINB###` uploads, `EVT:` events (§8) |
| `hid_maps` | extended | Same enums and aliases; adds F13–F24 |
| `ble_hid` | new | NimBLE HOGP: keyboard 1, consumer 2, mouse 3, telephony 8; 3 host slots; pairing |
| `display` / `ui` | new | LovyanGFX ST7796S, tile blit, labels, widgets, settings sheet, overlays |
| `touch` | new | XPT2046, calibration, tap / hold / swipe |
| `leds` | extended | One RGB status LED; `led` actions also tint the tile glow |

### 6.3 Main loop
Same shape as v2.1:
1. `esp_task_wdt_reset()` (8 s watchdog).
2. `handleSerialInput()`: CLI lines and uploads.
3. `scanTouch()`: reads the XPT2046 while IRQ is low; gesture state machine.
4. `macroEngine.tick()`: one step, never blocks.
5. `ui.tick()`: redraws at most one dirty tile per pass, which also gives the staggered page reveal.
6. `ledsTick()`, and a battery sample every 5 s.

NimBLE runs in its own task on core 0. The loop owns the shared LCD and touch SPI bus, so it needs no locks.

### 6.4 Device UI (480×320 landscape)
As built in 3.1 (docs/device/index.html is the pixel-exact mock, firmware/DESIGN.md the rules): a 30 px status band (clock, profile dot and name, page fraction, host name or "No host", gear); 66 px glass keys in 96×90 cells with PC / HOLD / ON tags; page stations on the profile's line at y 310; the media player as a whole page instead of a 3×2 widget; a five-tab settings sheet; the pairing screen with a 60 s ring; the calibration screen; toast and volume HUD. The list below is the v0.2 plan.
- **Status bar** (top): clock, `profile · page`, BLE host state, battery or USB, and a gear. Studio pushes the time with `settime`; the clock stays blank until it has done so since boot.
- **Grid:** 5×3 cells of about 96×94 px (estimate until the layout is final). Each cell shows a 72×72 tile and a one-line label of up to 14 characters drawn by the firmware. A small badge marks tiles with a host action ("PC") or a hold action.
- **Page dots** (bottom): one per page; tap a dot to jump.
- **Widgets:** Now Playing, 3×2 cells: title, artist, progress bar and times, fed by Studio with `widget now_playing {…}`. A tap runs the widget's actions.
- **Settings sheet:** swipe up, or tap the gear. Groups: Display (brightness, dim after), Profile (active slot), Bluetooth hosts (list, tap to switch, pair new host), Device (config lock, key click, calibrate touch, about with firmware version and free heap).
- **Overlays:**
  - Pairing: the 6-digit passkey inside a 60 s countdown ring.
  - Volume ring: shown when a volume action runs or the dial turns, hidden about 1.3 s after the last change.
  - Toasts, and the touch calibration screen.
- **Tile feedback:** pressed, ok flash and alert flash (`show`), and a live title (`title`).
- **Optional EC11 dial** (M4) on GPIO 32 / 25 / 21: turning it sends volume up or down and shows the volume ring.

### 6.5 Touch and gestures
- XPT2046 is read only while IRQ (IO36) is low. Each reading is the median of 5 samples, filtered by a Z (pressure) threshold, then mapped through a 4-corner calibration stored in NVS. If no calibration exists, the device runs the calibration screen on first boot.
- **A tap fires on release**, inside the same cell. This way a swipe never triggers a key. The whole cell is the hit area, not just the tile. Resistive panels give a single point, so a swipe is just the distance between press and release.
- **A hold fires at 500 ms** and runs `hold_actions` if the key has them. Otherwise holding does nothing extra and the tap fires on release.
- Swiping sideways more than 18% of the screen width changes page. Swiping up more than 14% opens the settings sheet. When the screen is dimmed, the first touch only wakes it.

### 6.6 HID
- Report map, with v2.1's report IDs:
  - Keyboard (ID 1): 8 bytes, modifiers plus 6 keys, standard boot-style layout.
  - Consumer (ID 2): one 16-bit usage, for media and volume.
  - Mouse (ID 3): buttons, X, Y and wheel.
  - Telephony (ID 8): mic mute, answer, decline. Kept from v2.1; behaviour over BLE on Windows is checked in M0 (§14).
- Battery Service: level from IO34, reports 100% on USB. Device Information Service with PnP ID.
- Connection interval 7.5–15 ms with a peripheral latency of 30 (3.9.0): key reports leave at the next event and the radio may skip idle ones. Windows sets 15 ms / 30 for HID itself.
- **Host slots:** 3 slots, each with its own static random address and bond. Switch from the settings sheet. Forget from the sheet or with `ble forget <n>`.
- **Pairing:** IO capability DisplayOnly, LE Secure Connections, and a passkey shown on screen. Just Works is a fallback, allowed only inside a 60 s pairing window started from the device. Don't scan before the server starts. RPA resolution stays on.

### 6.7 Macro engine
v2.1's engine, unchanged in structure. It runs one step per `tick()`, waits `default_delay` ms between actions, and keeps a stack for nested `repeat`. A new press aborts a running macro. If no BLE host is connected, HID actions are dropped and the tile shows the alert flash; `page`, `back`, `profile`, `led`, `led_anim`, `delay` and `comment` still run. The action types are in §7.2. Text types at about 12 ms per character (estimate).

### 6.8 Storage
- **Flash partitions (4 MB, no OTA):** boot, nvs and phy about 96 KB, factory app 1.81 MB, LittleFS 2 MB, coredump 64 KB. Studio flashes over USB, as in v2.1, so no OTA slots are needed.
- **LittleFS contents:**
  - `/profile1.json` … `/profile8.json`, each with up to 3 `.bak` copies.
  - `/t/<crc32>.565`: tiles, 72×72 raw RGB565 at 10,368 B each.
  - `<file>.tmp`: written during an upload, renamed after it validates.
- **Space (estimate):** a 3-page profile is about 6 KB, so 8 profiles with 3 backups each take about 200 KB, leaving room for about 170–190 tiles. At the 64 KB upload cap, 8 profiles with backups would fill the whole partition, so Studio checks `fsinfo` before uploading and warns when space is low.
- **NVS:** bonds (NimBLE), touch calibration, brightness, timers, last profile and page, config-lock state, key click.
- Tiles are content-addressed, so a shared tile is stored once and re-syncs skip unchanged tiles.

### 6.9 RAM budget (estimates)
Measured on firmware 3.1.0: about 114 KB heap free with NimBLE up, two 96×90 DMA chunk buffers (17 KB each) and the 32 KB album-art buffer. That is enough to buffer a 64 KB upload in RAM (§8.3). The renderer composes damaged regions in chunks of at most 96×90 px and pushes one chunk by DMA while it draws the next. (3.0.0: 147 KB with a single cell sprite.)

| Item | Size |
|---|---|
| NimBLE | ~60 KB |
| Draw buffers | 2 × 480×16 RGB565 = 31 KB (DMA ping-pong) |
| Current page model + filtered JSON doc | ~40 KB |
| Upload line buffer and base64 decode (streamed to `.tmp`) | ~2 KB |
| Stacks and core | ~50 KB |
| Headroom | ~140 KB |

### 6.10 Power and feedback
- **Backlight PWM on IO27:** dims to 20% after 2 minutes, turns off after 10, and wakes on touch.
- **RGB LED:** in 3.1 a selectable pattern (rainbow by default, breathe, solid, status, off) with its own colour and brightness, from the sheet or Studio (`led`, `ledbright`). Pairing blinks magenta and errors show red over any pattern. The v0.2 plan was solid blue when connected, blinking blue while advertising, magenta in pairing mode, amber when config is unlocked, red on error. `led` and `led_anim` actions tint it.
- **Key click:** a 4 ms DAC tone on IO26 with the amp enabled on IO4. The amp is disabled between clicks to avoid hiss and save power.
- **Battery mode (3.2.1, 3.9.0):** dims sooner, darkens and slows down with the screen off, deep-sleeps when idle, warns at 15 % and sleeps at 0 % (which stops advertising). See the 3.9.0 task list and PROTOCOL.md › Power.

---

## 7. Data model: schema v2

### 7.1 Profile file
One file per profile, `/profile<n>.json`, n = 1–8, in v2.1's format with pages added:

```jsonc
{
  "schema_version": 2,
  "profile_name": "Daily",
  "default_delay": 20,                  // ms between actions
  "brightness": 200,                    // backlight, 0–255
  "pages": [
    {
      "name": "Main",
      "keys": [
        {
          "id": 1,                      // logical cell 1–15, row by row
          "name": "Mute mic",           // label under the tile, up to 14 chars
          "icon": "mic",                // Studio's source for the tile art
          "led_color": [61, 220, 132],  // tile colour and status LED tint
          "tile": "3fa9c2d1",           // /t/3fa9c2d1.565, written by Studio
          "actions": [ { "type": "telephony", "value": "MIC_MUTE" } ]
        },
        {
          "id": 2,
          "name": "Play",
          "icon": "play",
          "led_color": [54, 198, 255],
          "tile": "b2041e7c",
          "actions":      [ { "type": "media", "value": "PLAY_PAUSE" } ],
          "hold_actions": [ { "type": "media", "value": "NEXT" } ]
        },
        {
          "id": 3,
          "name": "GitHub",
          "icon": "github",
          "led_color": [130, 136, 150],
          "tile": "51c0d9e3",
          "actions": [ { "type": "host", "cmd": "open https://github.com", "slot": 0 } ]
        },
        null,                           // empty cell
        {
          "id": 5,
          "name": "Media",
          "icon": "music",
          "led_color": [255, 90, 95],
          "tile": "07ad3b6f",
          "actions": [ { "type": "page", "value": 2 } ]
        }
        // … always 15 entries per page
      ]
    },
    {
      "name": "Media",
      "keys": [
        { "id": 1, "name": "Now Playing", "widget": "now_playing", "span": [3, 2],
          "actions": [ { "type": "media", "value": "PLAY_PAUSE" } ] },
        null, null,                     // cells 2–3 covered by the widget
        {
          "id": 4,
          "name": "Back",
          "icon": "undo-2",
          "led_color": [130, 136, 150],
          "tile": "e81f4c20",
          "actions": [ { "type": "back" } ]
        }
        // … cells 6–8 are null (covered); 15 entries in all
      ]
    }
  ]
}
```

Rules:
- `keys` always has 15 entries (5×3); `null` means an empty cell.
- A widget sits in its top-left cell with `span: [cols, rows]`. The cells it covers are `null`.
- `led_color` sets the tile colour. `icon` is the name Studio renders from; `tile` is the CRC32 of the rendered RGB565 bytes, and the device draws `/t/<tile>.565`.
- `hold_actions` is optional.
- For `host` actions, Studio assigns `slot` (0–47) when it saves; the device sends that combo and never reads `cmd` (§9). The viewer's mock omits `slot`.
- Studio validates everything against the shared schema. The device parses the whole file before it commits and keeps the old profile on any error.

### 7.2 Action types
v1's 16 types are unchanged; v2 adds `page`, `back` and `host`.

| Type | Fields | Notes |
|---|---|---|
| `comment` | `value?` | No-op |
| `delay` | `ms` | Non-blocking wait |
| `key` | `value` | One named key or printable character. F13–F24 added in v2 |
| `keycombo` | `keys[]` | Modifiers and keys pressed together, then released |
| `text` | `value` | Up to 4096 chars, host keyboard layout (US first) |
| `multiline` | `value` | Like `text`, keeps newlines |
| `hold` | `key` | Press and hold a key or modifier |
| `release` | — | Release everything held |
| `repeat` | `count`, `actions[]` | 1–50 times, nesting depth up to 4 |
| `media` | `value` | `PLAY_PAUSE`, `STOP`, `NEXT`, `PREVIOUS`, `MUTE`, `VOLUME_UP`, `VOLUME_DOWN`; consumer report. Volume values show the volume ring |
| `mouse_move` | `x`, `y`, `wheel?` | Relative, −127…127 per axis |
| `mouse_click` | `button` | `LEFT`, `RIGHT`, `MIDDLE` |
| `led` | `color` | Tints this tile's glow and the status LED |
| `led_anim` | `value`, `color?` | `flash` or `breathe` |
| `profile` | `value` | Switch to profile 1–8 |
| `telephony` | `value` | `MIC_MUTE`, `ANSWER`, `DECLINE`; report ID 8 |
| `page` | `value` | **New.** Go to page n and push the current page on the back stack (folders) |
| `back` | — | **New.** Pop the back stack; page 1 if it is empty |
| `host` | `cmd`, `slot` | **New.** Send reserved combo `slot` for Studio to catch (§9) |

### 7.3 Migration from v1
Studio's `migrateProfile` converts a v1 profile (`keys[12]`, no `schema_version`) to v2 on import and restore: the 12 keys become page 1, padded to 15 cells, with `led_color` kept and a plain colour tile rendered from the name. The firmware's profile loader accepts a v1 file the same way, so a profile copied from a v2.1 device loads without Studio.

---

## 8. Device protocol: the v2.1 line CLI

### 8.1 Transport
- **USB serial** over the CH340C at 921600 baud (v2.1: 115200 over native USB). This is the v1 config path.
- **BLE NUS** (M4) carries the same CLI wirelessly, behind the config lock (§11). Native BLE libraries have the same Windows discovery problem noted in §2.2, so NUS gets a spike before M4 commits to it.
- The device prints the prompt `macropad:$ ` when it is ready for the next command. Studio's serial service queues commands one at a time, waits for the prompt, and diverts lines that start with `EVT:` to its event handler. Everything new is either another command or a binary upload carried as base64 lines, so the host code changes very little.

### 8.2 Commands
| Command | Since | Notes |
|---|---|---|
| `help` · `ls` · `cat <f>` · `fsinfo` · `reboot` | v2.1 | unchanged |
| `status` | v2.1 | reply adds `model:touch`, `page:`, `ble:` |
| `setprofile <n>` | v2.1 | 1–8 instead of 1–3 |
| `setkey <id> <json>` | v2.1 | applies to the current page; RAM preview |
| `setled` · `setidle` · `setbrightness` | v2.1 | `setled` tints the tile glow |
| `page <n>` | new | show and edit page n |
| `setface <id> <tile> <r> <g> <b>` | new | live tile and colour preview |
| `sethold <id> <json>` | new | `hold_actions` preview |
| `widget <name> <json>` | new | Now Playing data |
| `settime <epoch> <tz>` | new | status bar clock |
| `title <id> <text>` | new | live title (RAM) |
| `show <id> ok\|alert` | new | flash ring on a tile |
| `ble list` · `ble forget <n>` | new | host slots |

Example `status` reply: `Profile:1 loaded:1 idle:0 mode:ble ver:3.0.0 model:touch page:1 ble:1`. Studio uses the CH340 port plus `model:touch` to pick the device type.

**Events (device → Studio)**

| Event | Notes |
|---|---|
| `EVT:KEY <page> <id> <1\|0\|H>` | page and hold added |
| `EVT:PROFILE <n>` | unchanged |
| `EVT:PAGE <n>` | new |
| `EVT:BLE <slot> <up\|down>` | new |
| `EVT:IDLE <name>` | unchanged |

### 8.3 Uploads
```
> ###BEGIN### profile1.json
> {"schema_version":2,"profile_name":"Daily",…}
> ###END###
< SAVED profile1.json 6214
> ###BEGINB### /t/3fa9c2d1.565 10368 crc=9c1e07aa
> (base64, 76 chars per line)
> ###END###
< SAVED /t/3fa9c2d1.565
```
- JSON uploads keep v2.1's parse-before-commit, atomicWrite and 5 s stall timeout. The size cap rises from 16 KB to 64 KB for multi-page profiles. The device acknowledges the header with `RECV <path>`. It collects the upload in RAM and writes `<file>.tmp` only after `###END###`: streaming to flash dropped bytes, because this core's UART ISR is not in IRAM and a flash erase overflows the RX FIFO (found in M0; see `docs/PROTOCOL.md`).
- Tile uploads (`###BEGINB### <path> <size> crc=<crc32>`) are decoded line by line into `<path>.tmp`, checked against the size and CRC32, and only then renamed into place.

### 8.4 Sync
1. `status`: model, firmware version, current page and host.
2. `ls`: tiles already on the device.
3. Upload the missing tiles with `###BEGINB###`.
4. Upload `profile<n>.json` with `###BEGIN###`.
5. `setprofile <n>` reloads it; `cat` confirms it (v2.1 lesson).
6. After a profile is saved, the firmware deletes `/t` files that no profile references.

Live editing uses the RAM preview commands (`setkey`, `sethold`, `setface`, `title`) and Studio's autosave sends the full file. A first sync of 25 tiles is about 350 KB of base64 lines, about 4–5 s over USB at 921600 baud. A later sync after editing one tile is about 14 KB, well under a second. (Estimates: CH340C throughput and LittleFS write speed are not measured yet; BLE NUS throughput is unknown.)

---

## 9. Host actions

- A `host` action makes the keypad send a reserved combo such as `Ctrl+Alt+Shift+F13` over plain BLE HID.
- **Reserved set:** F13–F24 × 4 modifier sets (`Ctrl+Alt+Shift`, `Ctrl+Alt`, `Ctrl+Shift`, `Ctrl+Alt+Shift+Win`) = 48 slots.
- Studio gives each distinct `cmd` a slot when it saves the profile, registers the combos with Electron's `globalShortcut`, and runs the mapped command:
  - `open` an app, file or URL;
  - an OBS scene switch through OBS WebSocket v5 (port 4455);
  - a script.
- Studio reports any combo it fails to register, because another app already holds it.
- If Studio isn't running, the combo does nothing harmful. Users without Studio can bind the same combos in AutoHotkey or Karabiner.
- There is no custom GATT event channel in v1. Studio learns about presses on USB from `EVT:KEY`, and over BLE only through these combos.

---

## 10. Macropad Studio 3: Touch Keypad device type

The Touch Keypad joins Macropad Studio as a second device type. The left rail, slot pills, ActionBuilder, live push and autosave work as they do in Studio 2.1. Studio 3 work happens in the Macropad repo's `studio/`; this repo holds the firmware and the design docs.

- **Device detection:** CH340 port plus `model:touch` in the `status` reply.
- **Editor:**
  - Page tabs, and a grid that mirrors the device. Click a tile to edit; drag tiles to swap.
  - Label, icon and colour picker. `led_color` drives the tile colour.
  - "On tap" and "On hold" tabs for `actions` and `hold_actions`.
  - Widgets: add Now Playing (3×2) at the selected cell if it fits.
  - Profile JSON (schema v2) view.
- **Tile renderer** (`tiles` service): draws the tile on a 72×72 canvas (colour gradient, gloss or papercraft layering, and the icon), converts it to RGB565 in the byte order the device blits, names it by CRC32, and caches by hash. Tile style is a Studio choice and costs the device nothing.
- **Live push:** edits go out as `setkey`, `sethold`, `setface` and `page` previews; autosave uploads the profile with a backup first, as in 2.1.
- **Feeds** (`feeds` service): `settime` on connect and periodically; Now Playing from the Windows media session as `widget now_playing {…}`; live titles with `title`; `show <id> ok|alert` for results.
- **Host bridge** (`hostbridge` service): §9.
- **Context switching:** the existing `activewin` + contexts send `setprofile` when the focused app changes.
- **AI shortcuts and backups:** unchanged from 2.1, driven by the same schema with a device capability flag (12 keys vs 15 cells and pages).
- **Device panel:** BLE host slots (`ble list`, `ble forget <n>`) and config-lock state.
- **Flasher:** classic DTR/RTS auto-reset over the CH340 with the bundled esptool. v2.1 used a 1200-baud touch to reset the S2 into its bootloader; the CH340 board needs the DTR/RTS path instead. Transport teardown keeps v2.1's timeout guard.

---

## 11. Security

1. Passkey pairing, with a 6-digit passkey and a 60 s countdown ring on the device (MITM-protected). The pairing window opens only on request. Just Works is allowed only inside that window.
2. HID reports only on encrypted, bonded links. 3 host slots, each with its own static address and bond, and a forget button for each.
3. **Config lock:** writes over BLE NUS (M4) are rejected unless someone has tapped Unlock on the device. It relocks after 10 minutes. USB writes are trusted, as in v2.1, because they need the cable. (v0.1 locked USB writes too.)
4. Uploads are parsed and validated before commit, the last 3 versions are kept as `.bak`, and the device safe-boots to a default profile if the active one fails to load. Holding BOOT for 10 s at power-on resets to factory settings.
5. Macros are data, not code. The device has no scripting. Host commands live only in Studio; the device only sends a combo.

---

## 12. Repository layout

```
docs/PLAN.md           this document
docs/viewer/           interactive design viewer (index.html)
PRODUCT.md             product context for the viewer
firmware/              PlatformIO project (from M0)
  platformio.ini       pinned platform, core 2.0.17, libs; custom partitions.csv
  src/main.cpp         setup, loop (§6.3)
  src/config.h         pin map (§3), limits
  src/macro_engine.*   from v2.1
  src/storage.*        from v2.1
  src/profiles.*       from v2.1; schema v2 and v1 migration
  src/cli.*            from v2.1; new commands, ###BEGINB###
  src/hid_maps.*       from v2.1; adds F13–F24
  src/ble_hid.*        NimBLE HID, host slots, pairing
  src/display.*        LovyanGFX config, tile blit
  src/ui.*             grid, status bar, widgets, sheet, overlays
  src/touch.*          calibration, gestures
  src/leds.*           status LED, tile glow
  test/                PlatformIO native tests: CLI parsing, schema v2 + migration, base64/CRC, macro sequencing
```

Studio 3 changes live in the Macropad repo (§10).

---

## 13. Roadmap

| M | Name | Deliverables | Exit criterion |
|---|---|---|---|
| M0 | Bring-up | PlatformIO with Arduino core 2.0.17 pinned; LovyanGFX with the vendor ST7796 init + XPT2046. NimBLE HID types on Windows, macOS and Android, and survives host sleep. Measure heap, SPI clock and tile blit time | Tap a tile and the PC gets Ctrl+C over BLE |
| M1 | Firmware port | Copy `macro_engine`, `storage`, `profiles`, `cli` and `hid_maps` from v2.1; swap `hid_layer` for `ble_hid`. Schema v2 + `migrateProfile`; pages, `hold_actions`, `page`/`back`. Tiles from LittleFS, labels, dots, swipe, settings sheet, pairing ring | A daily-usable keypad with profiles uploaded through the v2.1 CLI |
| M2 | Studio 3 | Device type detection (CH340 + `status` `model:touch`). Page tabs, tile renderer (canvas → RGB565), icon and colour picker, hold tab. Flasher: classic DTR/RTS reset path for the CH340 board | Edit a tile in Studio and it changes on the device in under a second |
| M3 | Host features | `hostbridge`: F13–F24 `globalShortcut` → open, OBS WebSocket, scripts. Now Playing from the Windows media session, `settime`, live titles. Context auto-switch sends `setprofile` when focus changes | One tile switches OBS scene, and Now Playing follows Spotify |
| M4 | Wireless and hardware add-ons | Line CLI over BLE NUS, behind the config lock. EC11 dial on GPIO 32/25/21 with the volume ring. Enclosure: 3D-printed wedge stand | Change a profile with no cable; turn the dial for volume |
| M5 | Polish | Two-state toggles, plugin API in Studio, icon packs. UK, DE and FR typing layouts; battery mode | Stream Deck feature parity for daily use |

## 14. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| BLE HID reconnects after host sleep | High | NimBLE, persisted bonds, RPA; test each OS in M0 |
| Telephony page over BLE on Windows | Medium | Verify in M0; fall back to the Teams or Zoom hotkey through `keycombo` |
| F13–F24 combos taken by other apps | Low | Use Ctrl+Alt+Shift sets; Studio reports conflicts when it registers them |
| Resistive touch accuracy | Medium | Calibration, tap on release, the whole cell as hit area |
| Studio code drifting between two device types | Medium | One schema with a device capability flag; shared services |
| Keystroke injection | High | Passkey pairing; config lock for wireless writes |

## 15. Open questions

1. ~~Is a battery planned?~~ Yes (owner, 2026-10-14). Battery mode shipped in 3.2.1 and 3.9.0, ahead of M5.
2. Should the default be 5×3 (Stream Deck MK.2 parity), or 4×3 with larger keys for resistive touch? Decide after the M0 touch accuracy test.
3. Is the optional EC11 dial worth the enclosure work? It uses the I2C header pins.
4. ~~Arduino core: stay on 2.0.17 or move to 3.x?~~ Decided in M0: core 3.2.1. LovyanGFX, NimBLE HID, touch, LittleFS and screen readback all run on it (screen readback needs SPI MISO delay mode 2).
