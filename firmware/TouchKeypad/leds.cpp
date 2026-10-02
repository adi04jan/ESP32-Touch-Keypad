#include "leds.h"
#include "board.h"
#include "ble_hid.h"
#include <Preferences.h>

enum { FX_NONE, FX_TINT, FX_FLASH, FX_BREATHE };
static uint8_t fx = FX_NONE, fxR, fxG, fxB;
static uint32_t fxUntil = 0;
static bool error = false, dark = false;
static uint8_t pattern = LED_RAINBOW, bright = 153, col[3] = { 155, 123, 255 };
static uint8_t shown[3];
static bool click = true;

static const char *const NAMES[LED_PATTERNS] = { "rainbow", "breathe", "solid", "status", "off" };

static void out(uint8_t r, uint8_t g, uint8_t b) {
  shown[0] = r; shown[1] = g; shown[2] = b;
  // Active low. The LED is very bright: full brightness maps to a quarter of its range.
  uint16_t k = bright;
  analogWrite(PIN_LED_R, 255 - r * k / 1020);
  analogWrite(PIN_LED_G, 255 - g * k / 1020);
  analogWrite(PIN_LED_B, 255 - b * k / 1020);
}

static void save(const char *key, const void *v, size_t n) {
  Preferences p;
  p.begin("kp", false);
  p.putBytes(key, v, n);
  p.end();
}

void ledsBegin() {
  Preferences p;
  p.begin("kp", true);
  pattern = p.getUChar("ledp", LED_RAINBOW);
  bright = p.getUChar("ledb", 153);
  p.getBytes("ledc", col, 3);
  click = p.getBool("click", true);
  p.end();
  if (pattern >= LED_PATTERNS) pattern = LED_RAINBOW;
  pinMode(PIN_AMP_EN, OUTPUT);
  digitalWrite(PIN_AMP_EN, HIGH);   // amp off between clicks: no hiss
  out(0, 0, 0);
}

static void setFx(uint8_t kind, uint8_t r, uint8_t g, uint8_t b, uint32_t ms) {
  fx = kind; fxR = r; fxG = g; fxB = b; fxUntil = millis() + ms;
}
void ledsTint(uint8_t r, uint8_t g, uint8_t b) { setFx(FX_TINT, r, g, b, 2000); }
void ledsFlash(uint8_t r, uint8_t g, uint8_t b) { setFx(FX_FLASH, r, g, b, 300); }
void ledsBreathe(uint8_t r, uint8_t g, uint8_t b) { setFx(FX_BREATHE, r, g, b, 5000); }
void ledsError(bool on) { error = on; }

void ledsSetPattern(uint8_t p) { if (p < LED_PATTERNS) { pattern = p; save("ledp", &pattern, 1); } }
uint8_t ledsPattern() { return pattern; }
const char *ledsPatternName(uint8_t p) { return p < LED_PATTERNS ? NAMES[p] : "?"; }
int ledsPatternFromName(const char *s) {
  for (int i = 0; i < LED_PATTERNS; i++) if (!strcasecmp(s, NAMES[i])) return i;
  return -1;
}
void ledsSetColor(uint8_t r, uint8_t g, uint8_t b) { col[0] = r; col[1] = g; col[2] = b; save("ledc", col, 3); }
void ledsGetColor(uint8_t rgb[3]) { memcpy(rgb, col, 3); }
void ledsSetBrightness(uint8_t level) { bright = level; save("ledb", &bright, 1); }
uint8_t ledsBrightness() { return bright; }
void ledsCurrent(uint8_t rgb[3]) { memcpy(rgb, shown, 3); }

static void hsv(float h, uint8_t *r, uint8_t *g, uint8_t *b) {   // full saturation and value
  float x = h * 6;
  int i = (int)x % 6;
  float f = x - floorf(x);
  uint8_t q = 255 * (1 - f), t = 255 * f;
  switch (i) {
    case 0: *r = 255; *g = t; *b = 0; break;
    case 1: *r = q; *g = 255; *b = 0; break;
    case 2: *r = 0; *g = 255; *b = t; break;
    case 3: *r = 0; *g = q; *b = 255; break;
    case 4: *r = t; *g = 0; *b = 255; break;
    default: *r = 255; *g = 0; *b = q; break;
  }
}

void ledsDark(bool on) { dark = on; }

void ledsTick() {
  static uint32_t last = 0;
  uint32_t now = millis();
  if (now - last < 20) return;
  last = now;
  bool blink = (now / 500) & 1;
  if (error) { out(255, 0, 0); return; }
  if (dark) { out(0, 0, 0); return; }
  if (blePairing()) { out(blink ? 255 : 60, 0, blink ? 255 : 60); return; }
  if (fx && (long)(now - fxUntil) < 0) {
    float k = 1.0f;
    if (fx == FX_FLASH) k = (fxUntil - now) / 300.0f;
    else if (fx == FX_BREATHE) k = 0.15f + 0.85f * (0.5f + 0.5f * sinf(now / 400.0f));
    out(fxR * k, fxG * k, fxB * k);
    return;
  }
  fx = FX_NONE;
  uint8_t r, g, b;
  switch (pattern) {
    case LED_RAINBOW: hsv((now % 6000) / 6000.0f, &r, &g, &b); out(r, g, b); break;
    case LED_BREATHE: {
      float k = 0.08f + 0.92f * (0.5f - 0.5f * cosf(now * (2 * PI / 4000.0f)));
      out(col[0] * k, col[1] * k, col[2] * k);
      break;
    }
    case LED_SOLID: out(col[0], col[1], col[2]); break;
    case LED_STATUS:
      if (hidConnected()) out(0, 0, 255);
      else out(0, 0, blink ? 255 : 0);
      break;
    default: out(0, 0, 0); break;
  }
}

void feedbackSetClick(bool on) { click = on; save("click", &click, 1); }
bool feedbackClickOn() { return click; }

// A 4 ms 2 kHz square wave through the DAC and the FM8002E amp.
void feedbackClick() {
  if (!click) return;
  digitalWrite(PIN_AMP_EN, LOW);
  for (int i = 0; i < 8; i++) {
    dacWrite(PIN_DAC, 150);
    delayMicroseconds(250);
    dacWrite(PIN_DAC, 105);
    delayMicroseconds(250);
  }
  dacWrite(PIN_DAC, 128);
  digitalWrite(PIN_AMP_EN, HIGH);
}
