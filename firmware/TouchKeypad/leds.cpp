#include "leds.h"
#include "board.h"
#include "ble_hid.h"

enum { FX_NONE, FX_TINT, FX_FLASH, FX_BREATHE };
static uint8_t fx = FX_NONE, fxR, fxG, fxB;
static uint32_t fxUntil = 0;
static bool error = false;

static void out(uint8_t r, uint8_t g, uint8_t b) {
  // Active low; the LED is very bright, so a quarter scale is plenty.
  analogWrite(PIN_LED_R, 255 - r / 4);
  analogWrite(PIN_LED_G, 255 - g / 4);
  analogWrite(PIN_LED_B, 255 - b / 4);
}

void ledsBegin() { out(0, 0, 0); }

static void setFx(uint8_t kind, uint8_t r, uint8_t g, uint8_t b, uint32_t ms) {
  fx = kind; fxR = r; fxG = g; fxB = b; fxUntil = millis() + ms;
}
void ledsTint(uint8_t r, uint8_t g, uint8_t b) { setFx(FX_TINT, r, g, b, 2000); }
void ledsFlash(uint8_t r, uint8_t g, uint8_t b) { setFx(FX_FLASH, r, g, b, 300); }
void ledsBreathe(uint8_t r, uint8_t g, uint8_t b) { setFx(FX_BREATHE, r, g, b, 5000); }
void ledsError(bool on) { error = on; }

void ledsTick() {
  static uint32_t last = 0;
  uint32_t now = millis();
  if (now - last < 20) return;
  last = now;
  if (fx && (long)(now - fxUntil) < 0) {
    float k = 1.0f;
    if (fx == FX_FLASH) k = (fxUntil - now) / 300.0f;
    else if (fx == FX_BREATHE) k = 0.15f + 0.85f * (0.5f + 0.5f * sinf(now / 400.0f));
    out(fxR * k, fxG * k, fxB * k);
    return;
  }
  fx = FX_NONE;
  bool blink = (now / 500) & 1;
  if (error) out(255, 0, 0);
  else if (blePairing()) out(blink ? 255 : 60, 0, blink ? 255 : 60);
  else if (hidConnected()) out(0, 0, 255);
  else out(0, 0, blink ? 255 : 0);
}
