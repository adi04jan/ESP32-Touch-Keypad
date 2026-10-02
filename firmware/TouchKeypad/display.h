/* LovyanGFX config for the E32R40T: ST7796S + XPT2046 on one HSPI bus. */
#pragma once
#define LGFX_USE_V1
#include <LovyanGFX.hpp>

class LGFX : public lgfx::LGFX_Device {
 public:
  lgfx::Panel_ST7796  panel;
  lgfx::Bus_SPI       bus;
  lgfx::Light_PWM     light;
  lgfx::Touch_XPT2046 touch;
  LGFX();
};

extern LGFX lcd;

void displayBegin();             // init panel, backlight, NVS knobs (invert/bgr/spi MHz)
void displaySetBacklight(uint8_t level);
void displayShot();              // stream the screen as ###SHOT### + base64 lines + ###END###
void displayLcdCmd(const char *arg);   // `lcd` CLI: show/set invert, bgr, mhz
