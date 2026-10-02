/* ESP32 Touch Keypad firmware (LCDwiki E32R40T, Arduino-ESP32 core 3.2.1).

     board.h         pins, layout, limits
     display.*       LovyanGFX ST7796S + XPT2046, screen capture
     touch.*         polling, calibration, tap / hold / swipe (and CLI injection)
     ui.*            status strip, tile grid, page dots, widgets, sheet, pairing ticket
     profiles.*      schema v2 profiles, one page in RAM
     storage.*       LittleFS atomic writes + backups
     macro_engine.*  cooperative macro runner (from v2.1)
     ble_hid.*       NimBLE HID keyboard / consumer / mouse / telephony, pairing
     hid_maps.*      key name tables
     leds.*          RGB status LED
     cli.*           serial CLI and uploads (PLAN.md §8, docs/PROTOCOL.md)

   loop() never blocks: macros are scheduled, the UI redraws one cell per pass,
   and NimBLE runs in its own task, posting events that loop() prints. */
#include <Arduino.h>
#include <Preferences.h>
#include "esp_task_wdt.h"
#include "board.h"
#include "display.h"
#include "storage.h"
#include "profiles.h"
#include "touch.h"
#include "ui.h"
#include "macro_engine.h"
#include "ble_hid.h"
#include "leds.h"
#include "cli.h"

void setup() {
  Serial.setRxBufferSize(SERIAL_RX_BUF);
  Serial.begin(SERIAL_BAUD);
  Serial.printf("\nTouch Keypad v%s starting\n", FW_VERSION);
  pinMode(PIN_BOOT, INPUT_PULLUP);
  bool safeBoot = digitalRead(PIN_BOOT) == LOW;   // BOOT held: start on profile 1

  displayBegin();
  ledsBegin();
  if (fsBegin()) Serial.println("LittleFS mounted");

  Preferences p;
  p.begin("kp", true);
  int last = safeBoot ? 1 : p.getUChar("prof", 1);
  p.end();
  if (!loadProfileSafe(last) && last != 1) loadProfileSafe(1);

  touchBegin();
  uiBegin();       // allocates the cell sprite before NimBLE takes its share
  hidBegin();

  esp_task_wdt_config_t wdt = { .timeout_ms = WDT_TIMEOUT_MS, .idle_core_mask = 0, .trigger_panic = true };
  esp_task_wdt_reconfigure(&wdt);
  esp_task_wdt_add(NULL);

  Serial.println("Ready");
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
  delay(1);
}
