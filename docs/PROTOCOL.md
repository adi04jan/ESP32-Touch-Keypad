# Touch Keypad serial protocol

The wire contract between the firmware (`firmware/TouchKeypad/cli.cpp`), Studio
(`studio/services/serial.js`, `device.js`, `feeds.js`, `tiles.js`) and the test tools
(`tools/kp.py`). It extends the v2.1 line CLI (PLAN.md §8). Firmware 3.2.1.

## Transport

- USB serial through the CH340 (VID `1A86`, PID `7523`), **921600 baud**, 8N1.
- **Or Bluetooth:** the same console on a Nordic UART service: service `6E400001-B5A3-F393-E0A9-E50E24DCCA9E`, write host → device on `…0002` (with or without response), notifications device → host on `…0003`. Writes need an encrypted link, so only a paired host gets in. Output goes out in MTU-sized notifications (the keypad asks for MTU 247), and a prompt with no newline is flushed after 30 ms. Studio reaches it through `studio/native/KpLink` (Windows' GATT API on the paired keypad, no scan). `shot` answers on USB only. A Bluetooth upload doesn't pause the screen the way a USB one does.
- **Release DTR and RTS after opening the port** (`kp.py` and Studio both do). On the board's auto-reset circuit RTS alone holds EN low (reset; `kp.py reset` uses that on purpose) and DTR alone holds IO0 (BOOT) low, which the keypad reads as a BOOT hold and answers by opening touch calibration after 2 s.
- Host → device: one command per line, ending `\n` (`\r` is ignored). Longest line: 8191 bytes.
- The device prints the prompt `macropad:$ ` (no newline) when it is ready for the next command.
- **Async events:** lines starting `EVT:` can arrive at any time. That includes right after a prompt, so a line can read `macropad:$ EVT:HID 1 …`. Treat a prompt that prefixes a line as a prompt seen, then handle the rest of the line.
- Hosts send one command, wait for the prompt, then send the next.

## Commands

| Command | Reply (before the prompt) | Notes |
|---|---|---|
| `help` | one line listing the commands | |
| `status` | `Profile:1 loaded:1 idle:0 mode:ble ver:3.2.1 model:touch page:1 ble:0 pages:3 dry:0 ui:home cal:1 theme:glass pwr:usb bat:96` | `ble:1` when an encrypted host link is up; `dry:1` when HID is dry-run; `ui:` home, sheet, pair or cal; `cal:1` once touch is calibrated; `theme:` the device theme; `pwr:` usb or bat; `bat:` the cell's charge in % (-1 when no cell is read) |
| `ls [dir]` | `path\tsize` per file, recursive, no leading slash (`t/3fa9c2d1.565\t10368`) | default `/` |
| `cat <file>` | the file, ending with a newline | `ERR no such file: /x` |
| `rm <file>` | `removed /x` or `ERR no such file: /x` | removing a profile also deletes tiles nothing references |
| `fsinfo` | `FS_INFO:<total>,<used>` | bytes |
| `reboot` | `rebooting` | no prompt; the board restarts |
| `setprofile <1-8>` | `profile <n>` plus `EVT:PROFILE <n>` | an unreadable profile is restored to the default |
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
| `setdim <s>` | `dim <s>` | dim after s seconds idle (0 = never); also wakes the screen |
| `led [rainbow\|breathe\|solid\|status\|off] [r g b]` | `led <pattern> color <r g b> brightness <n> showing <r g b>` | the RGB status LED; rainbow is the default; the colour is for solid and breathe; no argument reports |
| `ledbright [0-255]` | `ledbright <n>` | no argument reports |
| `click [on\|off]` | `click on\|off` | key click on the speaker |
| `theme [id\|title\|1-6\|default]` | `theme <id>`, plus `EVT:THEME <id>` when it changes; `default` forgets the saved theme (Daylight); an unknown name lists `theme glass paper daylight aurora synth retro` | the whole-device theme (firmware/DESIGN.md, Themes); saved to NVS; the new theme wipes down the screen |
| `power [sim battery\|usb\|off \| sleep <min> \| divider <k>]` | `power usb:1 mv:4122 pct:96 charging:1 sleep:5 sim:-1 divider:2.000 cpu:240 screen:lit` | USB or battery, the cell's mV and %, charging, minutes on battery before deep sleep (0 never, at most 120; NVS `kp/bsleep`), the simulated supply (-1 real; for tests), the battery divider (NVS `kp/batk`, a calibration knob), CPU MHz, screen lit/dim/off |
| `hostname <name>` | `hostname set` or `ERR no host connected` | names the connected host (20 chars); shown in the status band and the Bluetooth tab. Studio sends the PC name |
| `ble list` | `<n> <addr> connected\|bonded <name>` per bond, then `hosts:<n> connected:<n> advertising:0\|1 pairing:0\|1` | name is the `hostname` one, else `Host <n+1>` |
| `ble use <n>` | `using <n>` or `ERR no host <n>` | drop the current link and advertise only to bond n |
| `ble forget <n>` | `forgot <n>` or `ERR no host <n>` | |
| `ble pair` | `pair open` plus `EVT:BLE pair open`, `EVT:PASSKEY <6 digits>` | 60 s pairing window; the screen shows the passkey |
| `ble cancel` | `pair closed` | |
| `calibrate [cancel]` | `ui cal` / `ui home` | opens the calibration screen (four targets, a check point, a test pad); progress as `EVT:CAL` |
| `sheet [close]` | `ui sheet` / `ui home` | the settings sheet |
| `toast <text>` | `toast` | a toast under the status band |

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

Screen coordinates: landscape 480×320, a 30 px status band, then cells 96×90 from y = 30, then the page stations at y 310. The cell centre for id n is x = ((n−1) mod 5)·96 + 48, y = 30 + ⌊(n−1)/5⌋·90 + 40. The gear sits at (466, 14). On the player page: seek bar x 160–464 around y 153; transport buttons at y 248, x 40 (mute), 112 (vol −), 188 (previous), 274 (play/pause), 360 (next), 436 (vol +).

## Events (device → host)

| Event | When |
|---|---|
| `EVT:KEY <page> <id> 1\|0\|H` | touch down on a key, release, hold fired. A tap's actions run on release, inside the same cell |
| `EVT:PAGE <n>` | page shown (swipe, station, folder key, `back`, `page`) |
| `EVT:PROFILE <n>` | profile loaded |
| `EVT:UI home\|sheet\|pair\|cal` | the screen mode changed |
| `EVT:THEME <id>` | the theme changed (`theme`, or a chip in Settings → Display) |
| `EVT:POWER sleep` | on battery, idle past the sleep time: the keypad goes into deep sleep; a touch wakes it (a reboot) |
| `EVT:SEEK <s>` | tap on the player's seek bar; the host should seek its media session there |
| `EVT:CAL start\|point <n> <rx> <ry>\|retry fit <px>\|retry verify <px>\|saved <px>\|redo\|done\|cancel` | calibration progress; `saved` carries the check-point error in px (at most 16) |
| `EVT:BLE <slot> up\|down` | host link up (encrypted) or down |
| `EVT:BLE pair open\|ok\|timeout\|closed\|fail\|rejected` | pairing window |
| `EVT:PASSKEY <6 digits>` | the passkey on screen; type it into the host |
| `EVT:HID <report id> <hex>` | dry-run only: 1 = keyboard (8 B), 2 = consumer (2 B, little-endian usage), 3 = mouse, 8 = telephony |

## Uploads

```
> ###BEGIN### profile1.json
< RECV /profile1.json
> {"schema_version":2, …}          (any number of lines)
> ###END###
< SAVED profile1.json 6214
< macropad:$

> ###BEGINB### /t/3fa9c2d1.565 10368 crc=9c1e07aa
< RECV /t/3fa9c2d1.565
> (base64, 76 chars per line)
> ###END###
< SAVED /t/3fa9c2d1.565
< macropad:$
```

- The device collects an upload in RAM, up to **65536 bytes**, and writes flash only after `###END###`. In this core the UART interrupt is not in IRAM, so a flash erase during a stream overflows the 128-byte RX FIFO and drops bytes. Nothing may arrive during the write, so the host must wait for the reply before it sends anything else. The screen holds still while an upload streams.
- `RECV` acknowledges the header. Hosts can stream right after it (Studio paces at 30 kB/s; `kp.py` sends unpaced).
- If no line arrives for 5 s, the device prints `Upload timed out; discarded.` and the prompt.
- Profile files (`/profile1.json` … `/profile8.json`) are validated before they replace the old file: valid JSON, schema 1 or 2, 1–16 pages, at most 15 cells each. On failure the device prints `Upload rejected: <why>` and keeps the old file. On success it keeps 3 backups, deletes `/t` tiles no profile references, and reloads the profile if it is active (staying on the same page).
- Other JSON files are checked for syntax only.
- Binary upload errors: `ERR size mismatch <got> != <want>`, `ERR crc mismatch <got> != <want>`, `ERR usage: …`.

### Album art

`###BEGINB### ram:art 32768 crc=…` goes straight to the player's RAM buffer (nothing is written to flash): 128×128 px, **big-endian** RGB565. Reply `SAVED ram:art`. Studio sends it after the `now_playing` that names the track, and again when a cover arrives late.

### Tiles

`/t/<name>.565`: 72×72 px, **big-endian** RGB565, 10,368 bytes: a custom key image (a key's `tile`). `<name>` is the IEEE CRC-32 (zlib) of those bytes as 8 lowercase hex digits, so identical tiles are stored once. Keys normally use a built-in `icon` (214 of them, the same names in Studio's `renderer/keyicons.js` and the firmware's `icons_gen.h`), drawn as a glass key in the key's `led_color`; a key with neither shows its label's initials.

## Profile fields beyond PLAN.md §7

| Field | Meaning |
|---|---|
| profile `color` `[r,g,b]` | the profile's line colour: the status-band dot and the page stations |
| key `anim` | `eq` (equalizer while media plays), `pulse` (while a toggle is off), `rec` (red blink while a toggle is on) |
| key `toggle: true` | the key keeps an on/off state and shows ON; `off_actions` run when it turns off (else `actions` both ways) |
| widget `media`, span `[5,3]` on cell 1 | the page is the full media player |

## Power

USB is detected from the CH340's TX line, which idles high while USB powers the chip
(sampled on RX, IO3). The cell is read on IO34 through the board's divider.
- **On USB:** full power and the owner's dim setting. A reading under 4.25 V is a cell charging (`charging:1`); the status band shows a green battery with a bolt. Higher is the charger with no cell, and the band shows a plug.
- **On battery:** the band shows the battery and its percentage (amber at 30 %, red at 15 %). The screen dims after 20 s (or sooner per `setdim`) and turns off after 60 s. While off, the CPU drops to 80 MHz and the LED goes dark. After `power sleep` minutes the keypad deep-sleeps; a touch on the panel (IO36) wakes it.
- Edits from Studio (`setprofile`, `page`, `setkey`, `sethold`, `setface`, `show`, `theme`, `setbrightness`, `sheet` with arguments) light a dark screen. Feeds (`widget`, `settime`) and readouts don't.
- The Bluetooth Battery Service carries the charge (100 when no cell is read).

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
