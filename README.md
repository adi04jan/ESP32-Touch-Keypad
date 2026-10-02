# ESP32 Touch Keypad

A Stream Deck–style BLE macropad on the LCDwiki 4.0" ESP32-32E board (E32R40T: ESP32-WROOM-32E, ST7796S 480×320, XPT2046 resistive touch), with Macropad Studio for Windows.

Six device themes (Daylight by default, Glass, Paper, Aurora, Synth after the OP-1, Retro after the Game Boy), keys with real icons (214 built in, some animated), three ready profiles, a full-page media player fed from Windows (album art, live progress, tap to seek), a settings sheet (display, profiles, three Bluetooth hosts, LED patterns, key click, calibration), touch calibration on first boot, and every screen animating at 60 fps.

| Path | What |
|---|---|
| `firmware/TouchKeypad/` | Arduino sketch: glass UI renderer (DMA, damage rects, 60 fps), gestures, calibration, profiles (schema v2), macro engine, NimBLE HID, LED patterns, line CLI |
| `firmware/DESIGN.md` | The device's design system (colour as state, B612, the six themes) |
| `studio/` | Electron app: glass profile editor, media feed (track, art, seek), host bridge (F13–F24 → open / run / OBS), LED and display controls, firmware installer |
| `tools/kp.py` | Build, flash, screen capture, touch injection and uploads over USB |
| `tools/icons/`, `tools/fonts/`, `tools/gen_defaults.py` | Generate the key icons (Lucide, Simple Icons), the B612 fonts and the three default profiles |
| `tools/tests/` | Hardware tests for the firmware (pytest) |
| `tools/e2e/` | End to end on real Bluetooth and the real Windows media session: KpHelper (C#), `run_e2e.py`, `media_e2e.js` |
| `docs/PLAN.md` | Plan and design · `docs/PROTOCOL.md` the serial protocol · `docs/device/` the pixel-exact screen mock |

## Build and flash

Needs `arduino-cli` with `esp32:esp32@3.2.1`, LovyanGFX 1.2.x, NimBLE-Arduino 2.5.x and ArduinoJson 7.x. The board shows up as a CH340; `kp.py` finds it (or set `KP_PORT=COMx`).

```
python tools/kp.py flash             # KP_TEST build (build/fw): HID starts dry-run (reports logged, not sent)
python tools/kp.py flash --release   # normal build (build/fw-release)
python tools/kp.py cmd status
python tools/kp.py shot screen.png   # capture the LCD
python tools/kp.py touch 48 70       # tap cell 1;  hold / swipe too
```

On first boot the keypad asks for touch calibration: press the four targets, then the check point, then try the test pad. Hold BOOT for 2 s (or Settings → Device → Calibrate) to redo it.

## Studio

```
cd studio && npm start               # run from source
python tools/kp.py build --release && cd studio && npm run dist   # installer with the firmware bundled
```

Studio's Device view installs the bundled firmware over USB (profiles, pairings and calibration are kept).

## Tests, from fastest to fullest

```
cd studio && npm test                # 44 unit tests against a simulated keypad
cd studio && npm run smoke           # Electron boots and draws the glass preview with all icons
python -m pytest tools/tests -v      # 51 tests on the board: keys, gestures, pixels, calibration, LED, player, sheet, every theme, 60 fps floors
cd studio && npm run test:hw         # Studio's services against the board
node tools/e2e/media_e2e.js          # a silent Windows media session -> keypad player (title, album, cover) -> tap to seek -> back to Windows
python tools/e2e/run_e2e.py          # pairs this PC over BLE; types, toggles, host action through Studio, Play/Pause; unpairs
```

The BLE E2E types only into the window it opens and keeps focused, and presses Play/Pause only while its own silent media session is the one Windows routes media keys to. It clears the keypad's bonds and removes this PC's pairing at the end.

## Hardware notes found in bring-up

- **Screen readback** needs `SPI_MISO_DELAY_MODE = 2` on HSPI, otherwise every pixel reads one bit shifted (`display.cpp`). The panel runs clean at 80 MHz.
- **Serial uploads** collect in RAM and touch flash only after `###END###`. In this core the UART ISR isn't in IRAM, so a flash erase mid-stream drops RX bytes.
- **DTR and RTS** must be released after opening the port: DTR alone holds IO0 low, which reads as a BOOT hold.
- **NimBLE** asks `onPassKeyDisplay()` only while the static passkey is the default. `bleForget` stops advertising first, because the resolving list can't change while advertising.
- **Heap:** about 114 KB free with NimBLE, the double DMA buffers and the album-art buffer.
