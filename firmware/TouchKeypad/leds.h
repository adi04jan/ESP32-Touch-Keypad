/* Feedback: the board's RGB status LED (active low) and the key click.

   The LED shows a selectable pattern (rainbow by default), saved in NVS.
   States outrank the pattern: red on error, blinking magenta while a pairing
   window is open. `led` / `led_anim` actions tint it for a few seconds. */
#pragma once
#include <Arduino.h>

enum : uint8_t { LED_RAINBOW, LED_BREATHE, LED_SOLID, LED_STATUS, LED_OFF, LED_PATTERNS };

void ledsBegin();                                    // loads pattern, colour, brightness, click
void ledsTick();
void ledsTint(uint8_t r, uint8_t g, uint8_t b);      // 2 s
void ledsFlash(uint8_t r, uint8_t g, uint8_t b);     // 300 ms pulse
void ledsBreathe(uint8_t r, uint8_t g, uint8_t b);   // 5 s breathe
void ledsError(bool on);

void ledsSetPattern(uint8_t p);                      // saved
uint8_t ledsPattern();
const char *ledsPatternName(uint8_t p);              // rainbow breathe solid status off
int ledsPatternFromName(const char *s);              // -1 if unknown
void ledsSetColor(uint8_t r, uint8_t g, uint8_t b);  // solid and breathe colour, saved
void ledsGetColor(uint8_t rgb[3]);
void ledsSetBrightness(uint8_t level);               // 0-255, saved
uint8_t ledsBrightness();
void ledsCurrent(uint8_t rgb[3]);                    // what the LED shows now (tests)

void feedbackClick();                                // 4 ms tone on the speaker, if enabled
void feedbackSetClick(bool on);                      // saved
bool feedbackClickOn();
