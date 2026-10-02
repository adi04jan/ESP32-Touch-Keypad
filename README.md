# ESP32 Touch Keypad

A Stream Deck–style BLE macropad on the LCDwiki 4.0" ESP32-32E board (E32R40T: ESP32-WROOM-32E, ST7796S 480×320, XPT2046 resistive touch), with Macropad Studio for Windows.

| Path | What |
|---|---|
| `firmware/TouchKeypad/` | Arduino sketch: papercraft tile UI, gestures, profiles (schema v2), macro engine, NimBLE HID, line CLI |
| `studio/` | Electron app: profile editor, tile renderer, host bridge (F13–F24 → open / run / OBS), Now Playing and clock feeds |
| `tools/kp.py` | Build, flash, screen capture, touch injection and uploads over USB |
| `tools/tests/` | Hardware tests for the firmware (pytest) |
| `tools/e2e/` | BLE end to end: KpHelper (C#: pair/unpair, focused test window) and `run_e2e.py` |
| `docs/PLAN.md` | Plan and design · `docs/PROTOCOL.md` the serial protocol · `docs/viewer/` the design viewer |

## Build and flash

Needs `arduino-cli` with `esp32:esp32@3.2.1`, LovyanGFX 1.2.x, NimBLE-Arduino 2.5.x and ArduinoJson 7.x. The board shows up as a CH340; `kp.py` finds it (or set `KP_PORT=COMx`).

```
python tools/kp.py flash             # KP_TEST build: HID starts dry-run (reports logged, not sent)
python tools/kp.py flash --release   # normal build
python tools/kp.py cmd status
python tools/kp.py shot screen.png   # capture the LCD
python tools/kp.py touch 48 70       # tap cell 1;  hold / swipe too
```

## Tests, from fastest to fullest

```
cd studio && npm test                # 42 unit tests against a simulated keypad
python -m pytest tools/tests -v      # 22 tests on the board: uploads, keys, gestures, pixels, heap, reboot
cd studio && npm run test:hw         # Studio's services against the board
python tools/e2e/run_e2e.py          # pairs this PC over BLE, types into a test window, runs a host action through Studio, unpairs
cd studio && npm run smoke           # Electron boots and renders a tile
```

The E2E types only into the window it opens and keeps focused. It clears the keypad's bonds and removes this PC's pairing at the end.

## Hardware notes found in bring-up

- **Screen readback** needs `SPI_MISO_DELAY_MODE = 2` on HSPI, otherwise every pixel reads one bit shifted (`display.cpp`).
- **Serial uploads** collect in RAM and touch flash only after `###END###`. In this core the UART ISR isn't in IRAM, so a flash erase mid-stream drops RX bytes.
- **NimBLE** asks `onPassKeyDisplay()` only while the static passkey is the default. `bleForget` stops advertising first, because the resolving list can't change while advertising.
- **Heap:** about 147 KB free with NimBLE running and the cell sprite allocated; largest block 110 KB.
