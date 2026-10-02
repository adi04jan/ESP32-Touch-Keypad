# Touch Keypad serial protocol

The wire contract between the firmware (`firmware/TouchKeypad/cli.cpp`), Studio
(`studio/services/serial.js`, `device.js`, `tiles.js`) and the test tools
(`tools/kp.py`). It extends the v2.1 line CLI (PLAN.md §8). Firmware 3.0.0.

## Transport

- USB serial through the CH340 (VID `1A86`, PID `7523`), **921600 baud**, 8N1.
- Keep DTR and RTS low. RTS high holds EN low (reset); `kp.py reset` uses that on purpose.
- Host → device: one command per line, ending `\n` (`\r` is ignored). Longest line: 8191 bytes.
- The device prints the prompt `macropad:$ ` (no newline) when it is ready for the next command.
- **Async events:** lines starting `EVT:` can arrive at any time. That includes right after a prompt, so a line can read `macropad:$ EVT:HID 1 …`. Treat a prompt that prefixes a line as a prompt seen, then handle the rest of the line.
- Hosts send one command, wait for the prompt, then send the next.

## Commands

| Command | Reply (before the prompt) | Notes |
|---|---|---|
| `help` | one line listing the commands | |
| `status` | `Profile:1 loaded:1 idle:0 mode:ble ver:3.0.0 model:touch page:1 ble:0 pages:2 dry:0` | `ble:1` when an encrypted host link is up; `dry:1` when HID is dry-run |
| `ls [dir]` | `path\tsize` per file, recursive, no leading slash (`t/3fa9c2d1.565\t10368`) | default `/` |
| `cat <file>` | the file, ending with a newline | `ERR no such file: /x` |
| `fsinfo` | `FS_INFO:<total>,<used>` | bytes |
| `reboot` | `rebooting` | no prompt; the board restarts |
| `setprofile <1-8>` | `profile <n>` plus `EVT:PROFILE <n>` | an unreadable profile is restored to the default |
| `page <n>` | `page <n>` plus `EVT:PAGE <n>` | 1-based; `invalid page` |
| `setkey <id> <json-array>` | `Key <id> updated in RAM` | `actions` of a cell on the current page; RAM only |
| `sethold <id> <json-array>` | `Key <id> updated in RAM` | `hold_actions`; RAM only |
| `setface <id> <tile> <r> <g> <b>` | `face <id> ok` or `face <id> missing tile` | tile = 8 lowercase hex |
| `title <id> <text>` | `title <id>` | live label; RAM only |
| `show <id> ok\|alert` | `show <id> <what>` | green or red stamp ring for 0.9 s |
| `widget now_playing <json>` | `widget now_playing` | `{"title","artist","app","pos","len","playing"}`; pos and len in seconds; the device advances pos while playing |
| `settime <epoch> <tzmin>` | `time set` | tz in minutes east of UTC (IST = 330) |
| `setled <id> <r> <g> <b>` | `setled ok` | tile colour (RAM) |
| `setidle <name>` | `setidle ok` | accepted for v2.1 compatibility; no effect |
| `setbrightness <0-255>` | `brightness <n>` | live, saved to NVS |
| `setdim <s>` | `dim <s>` | dim after s seconds idle (0 = never); also wakes the screen |
| `ble list` | `<n> <addr> connected\|bonded` per bond, then `hosts:<n> connected:<n> advertising:0\|1 pairing:0\|1` | |
| `ble forget <n>` | `forgot <n>` or `ERR no host <n>` | |
| `ble pair` | `pair open` plus `EVT:BLE pair open`, `EVT:PASSKEY <6 digits>` | 60 s pairing window; the ticket shows the passkey |
| `ble cancel` | `pair closed` | |

Cell ids are 1–15, row by row, on a 5×3 grid. Unknown commands reply `unknown`.

### Debug and test commands

| Command | Reply | Notes |
|---|---|---|
| `shot` | `###SHOT### 480 320 rgb565`, 320 base64 lines, `###END###` | each line is one screen row: 480 px of **little-endian** RGB565 (960 B, 1280 chars) |
| `touch <x> <y> [ms=80]` | `OK` when the gesture ends | injected press through the real gesture machine; prompt follows `OK` |
| `hold <x> <y> [ms=800]` | `OK` | a hold fires at 500 ms |
| `swipe <x1> <y1> <x2> <y2> [ms=250]` | `OK` | page swipe at more than 18 % of the width; open the sheet with more than 14 % upward |
| `hid dry on\|off` | `hid dry <0\|1> connected <0\|1>` | dry: reports print as `EVT:HID` and are not sent. KP_TEST builds start dry |
| `heap` | `heap free:<b> min:<b> largest:<b>` | |
| `log on\|off` | `log on\|off` | touch logging |
| `lcd [invert\|bgr <0\|1> \| mhz <10-80>]` | current knobs | NVS; bgr and mhz apply after reboot |
| `calibrate` | `calibrated …` | blocking touch calibration screen; needs a person |

Screen coordinates: landscape 480×320, a 30 px status strip, then cells 96×90 from y = 30, then page dots at y 300–320. The cell centre for id n is x = ((n−1) mod 5)·96 + 48, y = 30 + ⌊(n−1)/5⌋·90 + 40. The gear sits at (462, 14).

## Events (device → host)

| Event | When |
|---|---|
| `EVT:KEY <page> <id> 1\|0\|H` | touch down on a key, release, hold fired. A tap's actions run on release, inside the same cell |
| `EVT:PAGE <n>` | page shown (swipe, dot, folder key, `back`, `page`) |
| `EVT:PROFILE <n>` | profile loaded |
| `EVT:BLE <slot> up\|down` | host link up (encrypted) or down |
| `EVT:BLE pair open\|ok\|timeout\|closed\|fail\|rejected` | pairing window |
| `EVT:PASSKEY <6 digits>` | the passkey on the ticket; type it into the host |
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

- The device collects an upload in RAM, up to **65536 bytes**, and writes flash only after `###END###`. In this core the UART interrupt is not in IRAM, so a flash erase during a stream overflows the 128-byte RX FIFO and drops bytes. Nothing may arrive during the write, so the host must wait for the reply before it sends anything else.
- `RECV` acknowledges the header. Hosts can stream right after it (Studio paces at 30 kB/s; `kp.py` sends unpaced).
- If no line arrives for 5 s, the device prints `Upload timed out; discarded.` and the prompt.
- Profile files (`/profile1.json` … `/profile8.json`) are validated before they replace the old file: valid JSON, schema 1 or 2, 1–16 pages, at most 15 cells each. On failure the device prints `Upload rejected: <why>` and keeps the old file. On success it keeps 3 backups, deletes `/t` tiles no profile references, and reloads the profile if it is active (staying on the same page).
- Other JSON files are checked for syntax only.
- Binary upload errors: `ERR size mismatch <got> != <want>`, `ERR crc mismatch <got> != <want>`, `ERR usage: …`.

### Tiles

`/t/<name>.565`: 72×72 px, **big-endian** RGB565, 10,368 bytes. `<name>` is the IEEE CRC-32 (zlib) of those bytes as 8 lowercase hex digits, so identical tiles are stored once. Studio renders each tile with its corners filled with the screen colour `#24345c`. A key without a tile file draws as two paper layers in its `led_color`, with the label's initials.

## Pairing

The device is DisplayOnly with LE Secure Connections, MITM and bonding.

- **Pairing window:** opened by `ble pair` or the sheet's Pair new. The host is asked for the passkey shown on the ticket (`EVT:PASSKEY`).
- **First host:** when the keypad has no bonds, a host that starts pairing opens the window by itself and gets a shown passkey.
- **Otherwise:** the passkey is never shown, and new bonds are rejected.

## NVS

| Namespace / key | Meaning |
|---|---|
| `kp/prof` | last profile (boot loads it; hold BOOT at power-on to start on profile 1) |
| `kp/bright`, `kp/dim` | backlight 0–255; dim after N s |
| `touch/cal` | 8 × uint16 LovyanGFX touch calibration |
| `lcd/invert`, `lcd/bgr`, `lcd/mhz` | panel knobs |
| NimBLE store | bonds |
