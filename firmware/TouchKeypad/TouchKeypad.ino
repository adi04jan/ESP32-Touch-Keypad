/* ESP32 Touch Keypad firmware (LCDwiki E32R40T, Arduino-ESP32 core 3.2.1).

     board.h         pins, layout, limits
     display.*       LovyanGFX ST7796S + XPT2046, screen capture
     touch.*         polling, calibration, tap / hold / swipe (and CLI injection)
     ui.*            the glass screen: keys, player, sheet, pairing, calibration, 60 Hz animation
     gfx.*           raster core: chunk canvas, antialiased shapes, glyph masks, VLW text
     profiles.*      schema v2 profiles, one page in RAM
     storage.*       LittleFS atomic writes + backups
     macro_engine.*  cooperative macro runner (from v2.1)
     ble_hid.*       NimBLE HID keyboard / consumer / mouse / telephony, pairing
     hid_maps.*      key name tables
     leds.*          RGB status LED patterns and the key click
     cli.*           serial CLI and uploads (PLAN.md §8, docs/PROTOCOL.md)

   loop() never blocks: macros are scheduled, the UI redraws one cell per pass,
   and NimBLE runs in its own task, posting events that loop() prints. */
#include <Arduino.h>
#include <Preferences.h>
#include "esp_task_wdt.h"
#include "board.h"
#include "console.h"
#include "display.h"
#include "storage.h"
#include "profiles.h"
#include "touch.h"
#include "ui.h"
#include "macro_engine.h"
#include "ble_hid.h"
#include "leds.h"
#include "cli.h"
#include "power.h"

void setup() {
  Serial.setRxBufferSize(SERIAL_RX_BUF);
  Serial.begin(SERIAL_BAUD);
  Con.printf("\nTouch Keypad v%s starting\n", FW_VERSION);
  pinMode(PIN_BOOT, INPUT_PULLUP);
  bool safeBoot = digitalRead(PIN_BOOT) == LOW;   // BOOT held: start on profile 1

  displayBegin();
  ledsBegin();
  if (fsBegin()) Con.println("LittleFS mounted");
  profilesInstallDefaults();

  Preferences p;
  p.begin("kp", true);
  int last = safeBoot ? 1 : p.getUChar("prof", 1);
  p.end();
  if (!loadProfileSafe(last) && last != 1) loadProfileSafe(1);

  touchBegin();
  uiBegin();       // allocates the cell sprite before NimBLE takes its share
  hidBegin();
  powerBegin();    // after the HID service: it publishes the battery level

  esp_task_wdt_config_t wdt = { .timeout_ms = WDT_TIMEOUT_MS, .idle_core_mask = 0, .trigger_panic = true };
  esp_task_wdt_reconfigure(&wdt);
  esp_task_wdt_add(NULL);

  Con.println("Ready");
  cliBegin();
}

void loop() {
  esp_task_wdt_reset();
  handleSerialInput();
  scanTouch();
  macroEngine.tick();
  blePoll();
  if (!cliUploading()) uiTick();
  ledsTick();
  powerTick();
  delay(1);
}
