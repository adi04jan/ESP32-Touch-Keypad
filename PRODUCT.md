# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
The maker (the repo owner) and the collaborators they share the project with. They are building a 4" touchscreen BLE macropad and use the design viewer as the working reference: to check how the device behaves, what Studio will look like, and what the protocol, pin map and roadmap say. End users of the device itself are makers, streamers and developers at a Windows desk.

## Product Purpose
ESP32 Touch Keypad is a Stream Deck–style macropad on the LCDwiki E32R40T board (ESP32-WROOM-32E, 4.0" 480×320 ST7796S, XPT2046 resistive touch). Users tap customisable tiles on the touchscreen, and the device sends macros to the computer over Bluetooth LE. Success means a keypad that works daily as a plain Bluetooth keyboard and can be configured in seconds from Macropad Studio.

## Positioning
Keys work with nothing installed, because the device is a standard BLE HID keyboard, consumer-control, mouse and telephony device. Macropad Studio, the existing Electron app from Macropad v2.1, adds pages, rendered tiles, host actions (through F13–F24 global shortcuts), Now Playing, context-based profile switching and AI shortcut suggestions. Every Stream Deck is wired and needs its app running for any key to work.

## Operating Context
- Built on the owner's shipped ESP32-Macro-pad v2.1 (ESP32-S2, 12 mechanical keys, USB HID, Macropad Studio 2.1). The new device reuses its 16-action schema, line CLI (`macropad:$ ` prompt, `###BEGIN###` uploads, `EVT:` events), non-blocking macro engine, atomic storage, backups and AI pipeline.
- Configuration runs over USB-C serial (CH340C). Wireless config over BLE NUS comes later.
- Planning documents: `docs/PLAN.md` (plan and design) and `docs/viewer/index.html` (interactive viewer).

## Capabilities and Constraints
- Hardware: 4 MB flash, no PSRAM, LCD and touch share one SPI bus, LCD reset tied to EN, IO12 is a strapping pin.
- Firmware: Arduino core 2.0.17 pinned, NimBLE-Arduino, LovyanGFX, LittleFS, single non-blocking loop.
- Schema v2: v1's 16 action types plus `page`, `back` and `host`; `pages[]`, `icon`, `hold_actions`, widgets with `span`.
- 15 tiles per page (5×3), 72×72 RGB565 tiles pre-rendered by Studio.
- Undecided: battery use, default grid (5×3 vs 4×3 after the touch accuracy test), the optional EC11 dial.

## Brand Commitments
- Belongs to the Macropad family with Macropad Studio. Name: "ESP32 Touch Keypad".
- The user pinned a visual direction for the design viewer: a layered paper-over-paper look like a puppet or paper-theatre art show, including the device's on-screen UI rendered as papercraft.

## Evidence on Hand
- Real content: the research findings, pin map, protocol, roadmap and risks in `docs/PLAN.md`; the Macropad v2.1 codebase at `D:\Personal\Project\ESP32-Macro-pad`.
- No customers, testimonials, prices, benchmarks or measurements exist yet. Heap, SPI clock and timing figures are estimates and must stay labelled as such.

## Product Principles
1. Keys work without any app; host software only adds things.
2. Reuse what Macropad v2.1 already proved before building anything new.
3. Changing macros needs someone physically at the device.
4. Specs stay exact and scannable; every estimate is labelled.

## Accessibility & Inclusion
Technical tables, pin maps and protocol references must stay crisp and readable at all times. Motion must stay smooth on a laptop and respect reduced-motion settings.
