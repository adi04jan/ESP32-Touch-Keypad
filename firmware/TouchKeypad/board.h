/* ESP32 Touch Keypad: board pins (LCDwiki E32R40T, ESP32-WROOM-32E, no PSRAM)
   and firmware limits. Arduino-ESP32 core 3.2.1. */
#pragma once

#define FW_VERSION      "3.0.0"
#define SCHEMA_VERSION  2

#ifndef KP_TEST                 // tools/kp.py builds with -DKP_TEST=1
#define KP_TEST 0
#endif

// ----- Pins -----
#define PIN_LCD_SCK     14      // HSPI, shared with touch
#define PIN_LCD_MOSI    13
#define PIN_LCD_MISO    12      // strapping pin (flash voltage): never pull high at boot
#define PIN_LCD_CS      15
#define PIN_LCD_DC      2
#define PIN_LCD_BL      27      // high = on, PWM
#define PIN_TOUCH_CS    33
#define PIN_TOUCH_IRQ   36      // input only, low while touched
#define PIN_LED_R       22      // RGB status LED, active low
#define PIN_LED_G       16
#define PIN_LED_B       17
#define PIN_DAC         26      // speaker via FM8002E
#define PIN_AMP_EN      4       // low = amp on
#define PIN_BAT_ADC     34
#define PIN_BOOT        0

// ----- Screen layout (480x320 landscape) -----
#define SCR_W           480
#define SCR_H           320
#define STATUS_H        30
#define GRID_COLS       5
#define GRID_ROWS       3
#define NUM_CELLS       15
#define CELL_W          96
#define CELL_H          90
#define DOTS_Y          (STATUS_H + GRID_ROWS * CELL_H)   // 300
#define TILE_PX         72

// ----- Limits -----
#define SERIAL_BAUD         921600
#define SERIAL_RX_BUF       16384
#define CLI_LINE_MAX        8192     // longest CLI line (setkey JSON)
#define NUM_PROFILES        8
#define MAX_TEXT_LEN        4096
#define MAX_REPEAT_COUNT    50
#define TEXT_CHAR_DELAY_MS  12
#define MACRO_MAX_DEPTH     4
#define UPLOAD_MAX          65536
#define UPLOAD_TIMEOUT_MS   5000
#define MAX_BACKUPS_PER_FILE 3

// ----- Touch / gestures -----
#define HOLD_MS             500
#define SWIPE_X_PX          (SCR_W * 18 / 100)
#define SWIPE_Y_PX          (SCR_H * 14 / 100)
#define TOUCH_POLL_MS       10
#define TOUCH_RELEASE_MISSES 3

// ----- Power / timers -----
#define DIM_LEVEL_PCT       20
#define OFF_AFTER_MS        600000UL
#define PAIR_WINDOW_MS      60000UL
#define WDT_TIMEOUT_MS      8000
