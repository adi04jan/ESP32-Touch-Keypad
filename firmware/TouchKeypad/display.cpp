#include "display.h"
#include "board.h"
#include <Preferences.h>
#include <esp_task_wdt.h>
#include "mbedtls/base64.h"
#include "soc/spi_reg.h"

LGFX lcd;

// Panel knobs live in NVS so a wrong guess can be fixed from the CLI without a
// rebuild: `lcd invert 1`, `lcd bgr 1`, `lcd mhz 27`, then reboot.
static bool    knobInvert = false;
static bool    knobBgr    = false;
static uint8_t knobMhz    = 40;

LGFX::LGFX() {
  {
    auto cfg = bus.config();
    cfg.spi_host    = HSPI_HOST;
    cfg.spi_mode    = 0;
    cfg.freq_write  = 40000000;
    cfg.freq_read   = 4000000;
    cfg.spi_3wire   = false;
    cfg.use_lock    = true;
    cfg.dma_channel = SPI_DMA_CH_AUTO;
    cfg.pin_sclk    = PIN_LCD_SCK;
    cfg.pin_mosi    = PIN_LCD_MOSI;
    cfg.pin_miso    = PIN_LCD_MISO;
    cfg.pin_dc      = PIN_LCD_DC;
    bus.config(cfg);
    panel.setBus(&bus);
  }
  {
    auto cfg = panel.config();
    cfg.pin_cs          = PIN_LCD_CS;
    cfg.pin_rst         = -1;      // tied to EN
    cfg.pin_busy        = -1;
    cfg.panel_width     = 320;
    cfg.panel_height    = 480;
    cfg.offset_rotation = 0;
    cfg.readable        = true;
    cfg.invert          = false;
    cfg.rgb_order       = false;
    cfg.dlen_16bit      = false;
    cfg.bus_shared      = true;    // touch shares the bus
    panel.config(cfg);
  }
  {
    auto cfg = light.config();
    cfg.pin_bl      = PIN_LCD_BL;
    cfg.invert      = false;
    cfg.freq        = 12000;
    cfg.pwm_channel = 7;
    light.config(cfg);
    panel.setLight(&light);
  }
  {
    auto cfg = touch.config();
    // Raw XPT2046 range; refined by the stored calibration (touch.cpp).
    cfg.x_min = 300;  cfg.x_max = 3900;
    cfg.y_min = 300;  cfg.y_max = 3900;
    cfg.pin_int    = PIN_TOUCH_IRQ;
    cfg.bus_shared = true;
    cfg.offset_rotation = 0;
    cfg.spi_host = HSPI_HOST;
    cfg.freq     = 2500000;
    cfg.pin_sclk = PIN_LCD_SCK;
    cfg.pin_mosi = PIN_LCD_MOSI;
    cfg.pin_miso = PIN_LCD_MISO;
    cfg.pin_cs   = PIN_TOUCH_CS;
    touch.config(cfg);
    panel.setTouch(&touch);
  }
  setPanel(&panel);
}

void displayBegin() {
  Preferences p;
  p.begin("lcd", true);
  knobInvert = p.getBool("invert", false);
  knobBgr    = p.getBool("bgr", false);
  knobMhz    = p.getUChar("mhz", 40);
  p.end();
  {
    auto cfg = lcd.panel.config();
    cfg.invert = knobInvert;
    cfg.rgb_order = knobBgr;
    lcd.panel.config(cfg);
  }
  {
    auto cfg = lcd.bus.config();
    cfg.freq_write = (uint32_t)knobMhz * 1000000UL;
    lcd.bus.config(cfg);
  }
  lcd.init();
  lcd.setRotation(1);   // landscape 480x320
  lcd.setBrightness(0);
}

void displaySetBacklight(uint8_t level) { lcd.setBrightness(level); }

void displayLcdCmd(const char *arg) {
  char key[12] = "";
  int val = -1;
  if (sscanf(arg, "%11s %d", key, &val) == 2) {
    Preferences p;
    p.begin("lcd", false);
    if (!strcmp(key, "invert")) { p.putBool("invert", val != 0); lcd.invertDisplay(val != 0); knobInvert = val != 0; }
    else if (!strcmp(key, "bgr")) { p.putBool("bgr", val != 0); knobBgr = val != 0; }
    else if (!strcmp(key, "mhz") && val >= 10 && val <= 80) { p.putUChar("mhz", (uint8_t)val); knobMhz = val; }
    else { p.end(); Serial.println("ERR lcd invert|bgr <0|1> | lcd mhz <10-80>"); return; }
    p.end();
  }
  Serial.printf("lcd invert:%d bgr:%d mhz:%d (bgr/mhz apply after reboot)\n", knobInvert, knobBgr, knobMhz);
}

// Read GRAM back over MISO one line at a time and stream it as base64 of
// little-endian RGB565. 480 px * 2 B = 960 B -> 1280 base64 chars per line.
// MISO_DELAY_MODE 2 on HSPI: the ST7796S drives MISO late at 4 MHz and the
// default sampling edge reads every pixel shifted one bit (measured, spid sweep).
static inline void readTiming() { REG_SET_FIELD(SPI_CTRL2_REG(2), SPI_MISO_DELAY_MODE, 2); }

void displayShot() {
  static uint16_t px[SCR_W];
  static unsigned char b64[1300];
  Serial.printf("###SHOT### %d %d rgb565\n", SCR_W, SCR_H);
  for (int y = 0; y < SCR_H; y++) {
    readTiming();
    lcd.readRect(0, y, SCR_W, 1, (lgfx::rgb565_t *)px);
    size_t n = 0;
    mbedtls_base64_encode(b64, sizeof(b64), &n, (const unsigned char *)px, sizeof(px));
    Serial.write(b64, n);
    Serial.write('\n');
    if ((y & 31) == 0) esp_task_wdt_reset();   // loop task is subscribed in setup()
  }
  Serial.println("###END###");
}
