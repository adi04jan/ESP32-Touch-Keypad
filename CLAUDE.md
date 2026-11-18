# CLAUDE.md

A 4" touchscreen Bluetooth macropad (LCDwiki E32R40T: ESP32-WROOM-32E, ST7796S 480×320, XPT2046 touch, CH340 USB, no PSRAM) and its Windows editor, Macropad Studio (Electron). The README has the hardware, the user-facing features and the full test list.

## Layout

- `firmware/TouchKeypad/`: the Arduino sketch (core `esp32:esp32@3.2.1`, LovyanGFX, NimBLE-Arduino, ArduinoJson). `*_gen.h` files are generated, never edit them by hand:
  - `icons_gen.h`, `anims_gen.h`: `tools/icons/` (`npm run build`: icons, animations and Studio's GIFs; `npm run anims`: animations and GIFs only). Animations are designed in `anim_designs.js`.
  - `themes_gen.h`: `python tools/themes/gen_themes.py` (the four newer themes; the original six are hand-tuned in `themes.h`).
  - `defaults_gen.h`: `python tools/gen_defaults.py`. `fonts_gen.h`: `python tools/fonts/build_fonts.py`.
- `studio/`: Electron app. `services/` talks to the keypad (`serial.js`, `device.js`; Bluetooth through the .NET helper `native/KpLink`), `renderer/` is the UI, `test/sim-device.js` simulates a keypad for the unit tests.
- `tools/kp.py`: build, flash and drive the keypad; its `Device` class is what the hardware tests use. `tools/tests/test_device.py`: the hardware suite. `tools/e2e/`: end-to-end runs. `tools/profiles/app_profiles.py`: the per-app profiles.
- Docs: `docs/PLAN.md` (spec and release log), `docs/PROTOCOL.md` (the console contract between `cli.cpp`, Studio and `kp.py`: update it with any command change), `firmware/DESIGN.md` (the screen's design system), root `DESIGN.md` / `PRODUCT.md` (the design viewer).

## Commands

```
python tools/kp.py build [--release]   # build/fw is a KP_TEST build (HID dry-run: keys logged, not sent); --release -> build/fw-release
python tools/kp.py flash [--release]   # app only: profiles (LittleFS), pairings and calibration (NVS) are kept
python tools/kp.py cmd status          # also: shot out.png | touch X Y | hold | swipe | upload | reset
cd studio && npm test                  # unit tests against the simulated keypad (seconds)
cd studio && npm run smoke             # Electron boots and draws the preview
python -m pytest tools/tests -v        # on the board, about 16 minutes
python tools/kp.py build --release && cd studio && npm run dist   # installer with the firmware bundled
```

Python needs pyserial, Pillow, esptool and pytest. `kp.py` finds the first CH340, or set `KP_PORT=COMx`; `KP_ARDUINO_CLI` overrides the arduino-cli path.

## Releases and git

- Bump `FW_VERSION` in `firmware/TouchKeypad/board.h` and `version` in `studio/package.json` together, and add a **Release x.y.z** entry to the release log in `docs/PLAN.md`.
- Commit messages carry no `Co-Authored-By: Claude` or `Claude-Session` trailers. Don't push unless asked.

## Limits

- **Flash:** the app partition is fixed at 0x1D0000 (1,900,544 B); changing `partitions.csv` wipes every profile on the keypad. 3.16.1 uses about 1,757,000 B. Check free space before adding icons or features: an icon costs 648 B of mask plus its animation (0.3-1 KB when one small part moves, 2-6 KB when the whole glyph turns).
- **RAM:** about 114 KB of heap, and it fragments. Avoid single allocations over about 16 KB; when one fails, drop the caches (`uiDropTileCache()`) and retry.
- **Console lines** are at most `CLI_LINE_MAX - 1` (8191) bytes: upload JSON indented over several lines.

## Working with a real keypad

The board on USB may be someone's daily keypad.

- Tests and experiments use profile slot 16 only. Slots 1-15 hold the user's profiles: never write or delete them (the suite fails if they change). Put back anything you change: the active profile, theme, calibration, HID dry-run.
- Quit Studio before USB work: it holds the COM port, and Windows opens COM ports exclusively.
- There may be more than one board: run `esptool read-mac` and confirm which one before flashing. After esptool, `kp.py reset` if the console gives no prompt.
- Leave the board on a release build (`flash --release`): a KP_TEST build sends no keystrokes.
- Check drawing changes pixel by pixel: `kp.py shot` before and after.
- Firmware before 3.15.1 drops lines from Bluetooth console replies: never read or verify profiles over Bluetooth on it.

## Privacy

- `/profiles/` (git-ignored) holds personal profiles, and one types a password. Never print profile contents or commit them; report names and pass/fail only.
- The PC's Bluetooth name shows on the status band and in the shade: blur it in any screenshot that goes into the repo.

## Gotchas

- `git worktree remove` deletes through junctions: if a worktree's (git-ignored) `node_modules` is a junction to the main checkout's, removing the worktree empties the main one. `rmdir` the junction first. To recover: `npm ci` in `studio/`.
