# Touch Keypad serial protocol

The wire contract between the firmware (`firmware/TouchKeypad/cli.cpp`), Studio
(`studio/services/serial.js`, `device.js`, `feeds.js`, `tiles.js`) and the test tools
(`tools/kp.py`). It extends the v2.1 line CLI (PLAN.md §8). Firmware 3.11.0.

## Transport

- USB serial through the CH340 (VID `1A86`, PID `7523`), **921600 baud**, 8N1.
- **Or Bluetooth:** the same console on a Nordic UART service: service `6E400001-B5A3-F393-E0A9-E50E24DCCA9E`, write host → device on `…0002` (with or without response), notifications device → host on `…0003`. Writes need an encrypted link, so only a paired host gets in. Output goes out in MTU-sized notifications (the keypad asks for MTU 247), and a prompt with no newline is flushed after 30 ms. Studio reaches it through `studio/native/KpLink` (Windows' GATT API on the paired keypad, no scan). `shot` answers on USB only. A Bluetooth upload doesn't pause the screen the way a USB one does.
- **Replies go back where the command came from;** events (`EVT:` lines) and anything printed outside a command go to both links. So two hosts never read each other's replies, and a USB reply never waits on a slow Bluetooth link. While one link is uploading, a line from the other gets `ERR busy: an upload from the other link is in progress`.
- **Release DTR and RTS after opening the port** (`kp.py` and Studio both do). On the board's auto-reset circuit RTS alone holds EN low (reset; `kp.py reset` uses that on purpose) and DTR alone holds IO0 (BOOT) low, which the keypad reads as a BOOT hold and answers by opening touch calibration after 2 s.
- Host → device: one command per line, ending `\n` (`\r` is ignored). Longest line: 8191 bytes.
- The device prints the prompt `macropad:$ ` (no newline) when it is ready for the next command.
- **Async events:** lines starting `EVT:` can arrive at any time. That includes right after a prompt, so a line can read `macropad:$ EVT:HID 1 …`. Treat a prompt that prefixes a line as a prompt seen, then handle the rest of the line.
- Hosts send one command, wait for the prompt, then send the next.

## Commands

| Command | Reply (before the prompt) | Notes |
|---|---|---|
| `help` | one line listing the commands | |
| `status` | `Profile:1 loaded:1 idle:0 mode:ble ver:3.2.1 model:touch page:1 ble:0 pages:3 dry:0 ui:home cal:1 theme:glass pwr:usb bat:96` | `ble:1` when an encrypted host link is up; `dry:1` when HID is dry-run; `ui:` home, sheet, pair or cal; `panel:` the open quick-bar panel (0 none, 1-4); `sug:` the suggested profile (0 none); `cal:1` once touch is calibrated; `theme:` the device theme; `pwr:` usb or bat; `bat:` the cell's charge in % (-1 when no cell is read) |
| `ls [dir]` | `path\tsize` per file, recursive, no leading slash (`t/3fa9c2d1.565\t10368`) | default `/` |
| `cat <file>` | the file, ending with a newline | `ERR no such file: /x` |
| `rm <file>` | `removed /x` or `ERR no such file: /x` | removing a profile also deletes tiles nothing references |
| `fsinfo` | `FS_INFO:<total>,<used>` | bytes |
| `reboot` | `rebooting` | no prompt; the board restarts |
| `setprofile <1-16>` | `Loaded profile <n> (<name>)` plus `EVT:PROFILE <n>` | an unreadable profile is restored to the default |
| `page <n>` | `page <n>` plus `EVT:PAGE <n>` | 1-based; `invalid page` |
| `setkey <id> <json-array>` | `Key <id> updated in RAM` | `actions` of a cell on the current page; RAM only |
| `sethold <id> <json-array>` | `Key <id> updated in RAM` | `hold_actions`; RAM only |
| `setface <id> <tile> <r> <g> <b>` | `face <id> ok` or `face <id> missing tile` | tile = 8 lowercase hex |
| `title <id> <text>` | `title <id>` | live label; RAM only |
| `show <id> ok\|alert` | `show <id> <what>` | green or red stamp ring |
| `widget now_playing <json>` | `widget now_playing` | `{"title","album","artist","app","pos","len","playing"}`; pos and len in seconds; the device advances pos while playing. A new title clears the cover until the next `ram:art` upload |
| `widget volume <json>` | `widget volume` | `{"level":0-100,"muted":bool}`: shows the volume HUD |
| `settime <epoch> <tzmin>` | `time set` | tz in minutes east of UTC (IST = 330) |
| `setled <id> <r> <g> <b>` | `setled ok` | key colour (RAM) |
| `setidle <name>` | `setidle ok` | accepted for v2.1 compatibility; no effect |
| `setbrightness [8-255]` | `brightness <n>` | live, saved to NVS; no argument reports |
| `setdim <s>` | `dim <s>` | on battery, dim after min(s, 20) seconds idle (0 = 20 s; under 20 is for tests); on USB the screen stays lit whatever it says. Bare, it only reports; also wakes the screen |
| `led [rainbow\|breathe\|solid\|status\|off] [r g b]` | `led <pattern> color <r g b> brightness <n> showing <r g b>` | the RGB status LED; rainbow is the default; the colour is for solid and breathe; no argument reports |
| `ledbright [0-255]` | `ledbright <n>` | no argument reports |
| `click [on\|off]` | `click on\|off` | key click on the speaker |
| `theme [id\|title\|1-6\|default]` | `theme <id>`, plus `EVT:THEME <id>` when it changes; `default` forgets the saved theme (Daylight); an unknown name lists `theme glass paper daylight aurora synth retro` | the whole-device theme (firmware/DESIGN.md, Themes); saved to NVS; the new theme wipes down the screen |
| `power [sim battery [mv]\|usb\|off \| sleep <min> \| divider <k> \| nap <s> \| off]` | `power usb:1 mv:4122 pct:96 charging:1 sleep:5 sim:-1 divider:2.000 link:15.00/30 cpu:240 screen:lit` | USB or battery, the cell's mV and %, charging, minutes on battery before deep sleep (0 never, at most 120; NVS `kp/bsleep`), the simulated supply (-1 real; for tests; `sim battery <mv>` holds the cell at that voltage), the battery divider (NVS `kp/batk`, a calibration knob), the first host's connection interval in ms and its peripheral latency (`0.00/-1` with none), CPU MHz, screen lit/dim/off. `nap <s>` deep-sleeps now until a touch or s seconds (1-3600): for tests and the power profiler. `off` is Settings › Device › Turn off: a "Turned off" banner, then 2 s later deep sleep that only RESET (or a power cycle) ends; it draws what deep sleep does, 0.20 mA |
| `iconanim [on\|off]` | `iconanim on\|off` | moving icons: every key icon has a signature animation that acts out its key (copy pulls a second sheet out of the first, a bell rings, wifi lights its arcs from the dot, a check draws itself), played when the key fires; while idle, a few keys play at once (a new one every 0.5 s, three at most) and every 20-30 s a wave runs across the grid diagonal by diagonal (six keys at once at most); none while the screen is dim. `iconanim wave` runs a wave now. Off, icons never move. NVS `kp/ianim`, on by default |
| `hostname <name>` | `hostname set` or `ERR no host connected` | names the connected host (20 chars); shown in the status band and the Bluetooth tab. Studio sends the PC name |
| `ble list` | `<n> <addr> connected\|bonded <name>` per bond, then `hosts:<n> connected:<n> advertising:0\|1 pairing:0\|1` | name is the `hostname` one, else `Host <n+1>` |
| `ble use <n>` | `using <n>` or `ERR no host <n>` | drop the current link and advertise only to bond n |
| `ble forget <n>` | `forgot <n>` or `ERR no host <n>` | |
| `ble pair` | `pair open` plus `EVT:BLE pair open`, `EVT:PASSKEY <6 digits>` | 60 s pairing window; the screen shows the passkey |
| `ble cancel` | `pair closed` | |
| `calibrate [cancel]` | `ui cal` / `ui home` | opens the calibration screen (four targets, a check point, a test pad); progress as `EVT:CAL` |
| `sheet [close\|profiles]` | `ui sheet` / `ui home` | the settings sheet; `profiles` opens it on Profiles (what the status band's profile button does) |
| `shade [close]` | `ui shade` / `ui home` | the pull-down shade (what a swipe down or the bell does): brightness, the profile stepper, the Bluetooth hosts and the newest notifications; `close` also closes the host menu |
| `notify <json>` | `notify` | a notification: `{"app", "title", "body", "icon", "tag", "banner"}`. The bell in the status band counts the unread, a banner drops in over the status band for 4 s (`banner:false`: none, and not counted), the shade lists the newest three; the keypad keeps eight. `icon` is a key icon's name (else a UI icon, else the bell); `tag` updates the notification with that tag. Studio sends this PC's Windows notifications; the keypad adds its own (host connected or lost, key not sent, battery low, Generate) |
| `notify list\|clear` | `notify <n> unread <u>` then `<i> <app>	<title>	<body>	<icon>` per notification / `notify clear` | the notifications, newest first |
| `autogen busy\|done\|fail <text>` | `autogen <state>` | Studio's progress for `EVT:AUTOGEN`: `busy` holds a toast with a breathing dot, `done` and `fail` end it |
| `toast <text>` | `toast` | a toast under the status band |
| `suggest [0-16]` | `suggest <n>` | the profile the quick bar's top slot offers (Studio's guess for the app in front; RAM only, 0 none, a missing profile counts as 0); hidden while it is the active profile. A tap switches to it (`EVT:SWITCH <n> suggest`) and the slot then offers the way back to the profile and page it left (`EVT:SWITCH <n> back`); any other profile change drops the way back |
| `panel [0-4]` | `panel <n>` | open quick-bar button n's page over the keys (what a tap on it does), 0 closes; no argument reports. The active profile and page stay as they are underneath: `page` and `setprofile` act on them, and a panel stays open through them. A button whose page is gone opens nothing |
| `quickbar [set <json> \| clear]` | `quickbar <json>` or `ERR quickbar: <why>` | the quick bar right of the keys: exactly four entries, each `{"profile":1-16,"page":1-16,"icon":"<key icon>","label":"<12 chars at most>"}` or `null` (an empty button); a button whose profile or page is missing draws empty. NVS `kp/qbar`; a fresh keypad starts with Media (profile 1 page 2) and Git (profile 2 page 2), an updated one with four empty buttons |

Cell ids are 1–15, row by row, on a 5×3 grid. Unknown commands reply `unknown`.

### Debug and test commands

| Command | Reply | Notes |
|---|---|---|
| `shot` | `###SHOT### 480 320 rgb565`, 320 base64 lines, `###END###` | each line is one screen row: 480 px of **little-endian** RGB565 (960 B, 1280 chars) |
| `touch <x> <y> [ms=80]` | `OK` when the gesture ends | injected press through the real gesture machine, in screen coordinates; prompt follows `OK` |
| `hold <x> <y> [ms=800]` | `OK` | a hold fires at 500 ms |
| `swipe <x1> <y1> <x2> <y2> [ms=250]` | `OK` | page swipe at more than 18 % of the width; open the sheet with more than 14 % upward |
| `traw <rx> <ry> [ms=120]` | `OK` | a press in raw panel units, through the calibration (tests the calibration screen) |
| `touchcal [set a b c d e f \| clear]` | `cal:<0\|1> a b c d e f` | the affine fit, screen = M · raw; `clear` restarts calibration on the next boot |
| `hid dry on\|off` | `hid dry <0\|1> connected <0\|1>` | dry: reports print as `EVT:HID` and are not sent. KP_TEST builds start dry |
| `heap` | `heap free:<b> min:<b> largest:<b>` | |
| `log on\|off` | `log on\|off` | touch logging |
| `lcd [invert\|bgr <0\|1> \| mhz <10-80>]` | current knobs | NVS; bgr and mhz apply after reboot. Default 80 MHz |
| `perf [reset]` | `perf frames:<n> avg_ms:<f> max_ms:<f> fps:<f>` | frame timing since the last reset; the tests hold animations at 50 fps or better |
| `bench` | SPI fill and push timings | |
| `rbench` | `rbench <name> <us>` per primitive | renderer timings |

Screen coordinates: landscape 480×320, a 30 px status band, then cells 84×90 over the left 420 px from y = 30, then the page stations at y 310 (centred on x 210). The cell centre for id n is x = ((n−1) mod 5)·84 + 42, y = 30 + ⌊(n−1)/5⌋·90 + 40. The quick bar fills x 420–480 below the band: the suggestion slot centred at (450, 59), buttons 1–4 centred at x 450, y 118, 175, 232, 289. The gear sits at (466, 14). On the player page: seek bar x 160–404 around y 153; transport buttons at y 248, x 35 (mute), 98 (vol −), 165 (previous), 240 (play/pause), 315 (next), 382 (vol +).

## Events (device → host)

| Event | When |
|---|---|
| `EVT:KEY <page> <id> 1\|0\|H` | touch down on a key, release, hold fired. A tap's actions run on release, inside the same cell |
| `EVT:PAGE <n>` | page shown (swipe, station, folder key, `back`, `page`) |
| `EVT:PANEL <btn> <profile> <page>` / `EVT:PANEL 0` | a quick-bar panel opened, or moved to another page of its profile (folder, swipe, station, `back`), 1-based; `0`: closed (its button again, `back` on its first page, a profile key in it, `panel 0`) |
| `EVT:PKEY <profile> <page> <id> 1\|0\|H` | a key in an open panel: like `EVT:KEY`, naming the panel's profile and page |
| `EVT:PROFILE <n>` | profile loaded |
| `EVT:SWITCH <n> touch\|suggest\|back` | right after `EVT:PROFILE`, when the owner chose it on the keypad: the sheet's cards, the shade's stepper or a profile key (`touch`), the quick bar's suggestion (`suggest`) or its way back (`back`). None for `setprofile` or an upload reload. A keypad switch closes an open panel |
| `EVT:UI home\|sheet\|pair\|cal\|shade\|menu` | the screen mode changed (`menu`: the status band's host list) |
| `EVT:THEME <id>` | the theme changed (`theme`, or a chip in Settings → Display) |
| `EVT:POWER sleep` | on battery, idle past the sleep time (or empty, or `power nap`): the keypad goes into deep sleep; a touch wakes it (a reboot). After `power off` only RESET does |
| `EVT:POWER empty` | on battery at 0 % (3.30 V): a "Battery empty" notice, then deep sleep 5 s later; a touch wakes it to say so again |
| `EVT:POWER wake touch\|timer` | at boot, after a deep sleep: what woke it |
| `EVT:AUTOGEN` | the Generate button in Profiles: the host should give the app in front a profile (Autogenerate below) |
| `EVT:SEEK <s>` | tap on the player's seek bar; the host should seek its media session there |
| `EVT:CAL start\|point <n> <rx> <ry>\|retry fit <px>\|retry verify <px>\|saved <px>\|redo\|done\|cancel` | calibration progress; `saved` carries the check-point error in px (at most 16) |
| `EVT:BLE <slot> up\|down` | host link up (encrypted) or down |
| `EVT:BLE <slot> params <ms> ms latency <n>` | the connection interval and peripheral latency the host granted (the keypad asks for 7.5-15 ms, latency 30; Windows sets 15 ms, 30 itself) |
| `EVT:BLE pair open\|ok\|timeout\|closed\|fail\|rejected` | pairing window |
| `EVT:PASSKEY <6 digits>` | the passkey on screen; type it into the host |
| `EVT:HID <report id> <hex>` | dry-run only: 1 = keyboard (8 B), 2 = consumer (2 B, little-endian usage), 3 = mouse, 8 = telephony |

## Uploads

```
> ###BEGIN### profile1.json
< RECV /profile1.json
> {"schema_version":2, …}          (lines; after every 4096 bytes:)
> ###SYNC###
< ACK 4103
> …                                (the rest)
> ###END###
< SAVED profile1.json 6214         (or SAVED profile1.json 6214 unchanged)
< macropad:$

> ###BEGINB### /t/3fa9c2d1.565 10368 crc=9c1e07aa
< RECV /t/3fa9c2d1.565
> (base64, 76 chars per line, ###SYNC### after every 4096 bytes of lines)
> ###END###
< SAVED /t/3fa9c2d1.565
< macropad:$
```

- Uploads stream to flash in chunks (3.12.1); no file is held whole in RAM, up to **65536 bytes**. In this core the UART interrupt is not in IRAM, so flash work during a stream overflows the 128-byte RX FIFO and drops bytes: the host sends `###SYNC###` after every 4096 bytes of lines and **waits for `ACK <bytes>`** before it sends more, and the device touches flash only then and at `###END###`. Without the syncs the chunk overflows: `ERR send ###SYNC### after every 4096 bytes and wait for ACK`. The screen holds still while a USB upload streams.
- Each chunk is first compared with the file it replaces; while they match nothing is written. A file sent again unchanged writes no flash at all: the reply ends `unchanged` (and a profile is not reloaded). At the first difference a temp file starts with the matching part copied over, the rest streams into it, and it is checked and swapped in at the end.
- `RECV` acknowledges the header. Hosts can stream right after it (Studio paces at 30 kB/s; `kp.py` sends unpaced).
- If no line arrives for 5 s, the device prints `Upload timed out; discarded.` and the prompt.
- Profile files (`/profile1.json` … `/profile8.json`) are validated before they replace the old file: valid JSON, schema 1 or 2, 1–16 pages, at most 15 cells each. On failure the device prints `Upload rejected: <why>` and keeps the old file. On success it keeps 3 backups, deletes `/t` tiles no profile references, and reloads the profile if it is active (staying on the same page).
- Other JSON files are checked for syntax only.
- Binary upload errors: `ERR size mismatch <got> != <want>`, `ERR crc mismatch <got> != <want>`, `ERR usage: …`.

### Album art

`###BEGINB### ram:artj <bytes> crc=…` (3.12.1, what Studio sends): the cover as a baseline JPEG of 128×128 px, at most 16 KB, kept in RAM. The device decodes it into the 32 KB RGB565 image only while a player page (the active page or a quick-bar panel) is on screen, and frees that image when none is, so the cover costs a few KB the rest of the time. Reply `SAVED ram:artj`. `art` reports `art jpg:<bytes> decoded:<0|1> ms:<the last decode>`.

`###BEGINB### ram:art 32768 crc=…` (raw, for tools) goes straight to the player's RAM buffer: 128×128 px, **big-endian** RGB565, held whatever page shows. Reply `SAVED ram:art`. Nothing is written to flash either way; Studio sends the cover after the `now_playing` that names the track, and again when a cover arrives late.

### Tiles

`/t/<name>.565`: 72×72 px, **big-endian** RGB565, 10,368 bytes: a custom key image (a key's `tile`). `<name>` is the IEEE CRC-32 (zlib) of those bytes as 8 lowercase hex digits, so identical tiles are stored once. Keys normally use a built-in `icon` (214 of them, the same names in Studio's `renderer/keyicons.js` and the firmware's `icons_gen.h`), drawn as a glass key in the key's `led_color`; a key with neither shows its label's initials.

## Profile fields beyond PLAN.md §7

| Field | Meaning |
|---|---|
| profile `color` `[r,g,b]` | the profile's line colour: the status-band dot and the page stations |
| key `anim` | `eq` (equalizer while media plays), `pulse` (while a toggle is off), `rec` (red blink while a toggle is on) |
| key `toggle: true` | the key keeps an on/off state and shows ON; `off_actions` run when it turns off (else `actions` both ways) |
| widget `media`, span `[5,3]` on cell 1 | the page is the full media player; optional `mic_actions` (an action list, e.g. `[{"type":"host","cmd":"mic toggle","slot":30}]`) adds a seventh control, the mic, at the right end (play stays in the middle), which runs them |

## Power

USB is detected from the CH340's TX line, which idles high while USB powers the chip
(sampled on RX, IO3, with a pull-down: unpowered the chip lets the line go). The cell is read on IO34 through the board's divider.
- **On USB:** full power and the owner's dim setting. A reading under 4.25 V is a cell charging (`charging:1`); the status band shows a green battery with a bolt. Higher is the charger with no cell, and the band shows a plug.
- **On battery:** the band shows the battery and its percentage (amber at 30 %, red at 15 %). The screen dims after 20 s (or sooner per `setdim`) and turns off after 60 s. From the dim on, the CPU drops to 80 MHz, the LED goes dark and the main loop rests 20 ms a pass instead of 1; off, the panel sleeps too. Measured at 3.7 V: lit 144 mA, dim 67, off 38, deep sleep 0.20-0.24. After `power sleep` minutes the keypad deep-sleeps; a touch on the panel (IO36) wakes it. In deep sleep the backlight, amp, LED and chip-select pins are held (they float otherwise) and the click's DAC is off. The flash rail (VDD_SDIO) stays powered: the LED's green and blue pins (IO16/17) sit on it, and without it they can't hold and the LED glows green (fixed in 3.11.1).
- **Empty:** at 0 % (3.30 V on the resting curve) the keypad shows "Battery empty" for 5 s and deep-sleeps; the 15 % warning stays above 0 %. On battery the percentage only falls (a lit screen sags the cell; the reading doesn't climb back when it goes dark); a USB visit or a reboot takes a fresh one.
- **Bluetooth:** the keypad asks for 7.5-15 ms with a peripheral latency of 30: key reports still leave at the next event, and the radio may skip up to 30 idle ones. Windows applies 15 ms / 30 to HID on its own and overrides a request for 0.
- Edits from Studio (`setprofile`, `page`, `setkey`, `sethold`, `setface`, `show`, `theme`, `setbrightness`, `sheet` with arguments) light a dark screen. Feeds (`widget`, `settime`) and readouts don't.
- The Bluetooth Battery Service carries the charge (100 when no cell is read).

## Image and GIF keys

A key may carry `tile` (one 72 x 72 image) or `frames` (2 to 16 tile names) with `frame_ms` (40 to 2000): a GIF. Each frame is an ordinary tile, `/t/<crc32>.565` (72 x 72 RGB565 big-endian, 10,368 bytes), uploaded like any tile, so a repeated frame is stored once. The keypad shows `frames[(millis / frame_ms) % count]`, redraws the key only when its frame changes, and pauses while the screen is off. A missing frame falls back to the icon. Removing a profile or saving one deletes tiles that no key's `tile` or `frames` names. Reading a tile from flash takes about 31 ms; four stay cached, and at most one is read per screen frame, so a page of GIF keys slows its GIFs, never the screen (three 6-frame GIFs hold 61 fps).

## Folders

A key whose only action is `page` is a folder: the keypad draws it as a stack (a second card behind it, up and to the right) and Studio's preview does the same. The page it opens holds a family of commands and ends with a Back key (`back`) in cell 15. Nothing in the file marks a folder; the single page action is the convention.

## Uploads are lines

A CLI line holds 8191 bytes, so send profile JSON on several lines (Studio indents it). A longer line inside an upload discards the upload with `ERR a line longer than 8191 bytes; send the JSON on several lines`.

## Quick switch and Autogenerate

- The status band's profile name is a button: it opens the sheet on Profiles, a 4 x 4 grid of all 16 slots (tap one to switch) with **Generate** beside Done.
- Generate sends `EVT:AUTOGEN`, closes the sheet and shows "Asking Studio..." until Studio answers with `autogen busy <text>`. With no answer in 4 s the keypad says Studio isn't running; a `busy` with no `done` or `fail` in 3 minutes ends as "Claude took too long".
- Studio (`studio/services/autogen.js`) picks the app in front (the focused window, Studio itself excluded). If that app already has a profile, mapped in Studio's auto-switch table and still on the keypad, it just switches. If Studio kept a copy from an earlier generation, it restores it. Otherwise it asks Claude through Claude Code (`claude -p --output-format json --json-schema ...`, the user's claude.ai login, no tools), sending the app's name, its window title and the minutes per app this session (never keystrokes). The answer is repaired, validated, saved to the app's slot or the first free one, mapped, kept in Studio's data folder and loaded.

## Pairing

The device is DisplayOnly with LE Secure Connections, MITM and bonding.

- **Pairing window:** opened by `ble pair` or the sheet's Pair new host. The host is asked for the passkey shown on screen (`EVT:PASSKEY`).
- **First host:** when the keypad has no bonds, a host that starts pairing opens the window by itself and gets a shown passkey.
- **Otherwise:** the passkey is never shown, and new bonds are rejected.
- Up to three hosts; `ble use <n>` or the Bluetooth tab switches between them with directed advertising.

## NVS

| Namespace / key | Meaning |
|---|---|
| `kp/prof` | last profile (boot loads it; hold BOOT while the board starts to come up on profile 1) |
| `kp/bright`, `kp/dim` | backlight 8–255; dim after N s |
| `kp/ledp`, `kp/ledb`, `kp/ledc`, `kp/click` | LED pattern, LED brightness, LED colour, key click |
| `kp/bsleep`, `kp/batk` | minutes on battery before deep sleep (default 5, 0 never); the battery divider (default 2.0) |
| `kp/theme` | the theme index (0 Glass, 1 Paper, 2 Daylight, 3 Aurora, 4 Synth, 5 Retro); missing = Daylight |
| `kp/defv`, `kp/dcrc1..3` | which default profiles were installed, and their CRCs (an edited default is never replaced) |
| `touch/aff` | 6 floats: the affine touch calibration. Missing = the calibration screen opens at boot |
| `hosts/<address>` | the name Studio gave each bonded host; forgetting the host removes it |
| `lcd/invert`, `lcd/bgr`, `lcd/mhz` | panel knobs |
| NimBLE store | bonds |
