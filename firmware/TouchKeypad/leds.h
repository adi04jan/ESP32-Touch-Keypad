/* RGB status LED (active low): blue = host connected, blinking blue =
   advertising, magenta = pairing window, red = error. `led`/`led_anim`
   actions tint it for a few seconds. */
#pragma once
#include <Arduino.h>

void ledsBegin();
void ledsTick();
void ledsTint(uint8_t r, uint8_t g, uint8_t b);      // 2 s
void ledsFlash(uint8_t r, uint8_t g, uint8_t b);     // 300 ms pulse
void ledsBreathe(uint8_t r, uint8_t g, uint8_t b);   // 5 s breathe
void ledsError(bool on);
