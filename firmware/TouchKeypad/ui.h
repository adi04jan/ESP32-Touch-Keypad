/* Screen: status strip, 5x3 tile grid, page dots, Now Playing widget,
   settings sheet and pairing ticket. Redraws at most one dirty cell per
   uiTick(), composed in a cell-sized sprite (no full-frame buffer). */
#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>

enum : uint8_t { G_DOWN, G_HOLD, G_TAP, G_SWIPE_L, G_SWIPE_R, G_SWIPE_U, G_SWIPE_D, G_MOVE };

void uiBegin();
void uiTick();
void uiMarkAll();
void uiMarkCell(int cell);
void uiMarkStatus();
void uiActivity();               // resets the dim/off timers
bool uiWake();                   // true if the screen was dimmed/off (touch is swallowed)
void uiGesture(uint8_t kind, int x0, int y0, int x1, int y1);

void uiGoPage(int idx, bool push);   // emits EVT:PAGE
void uiBack();
void uiSetProfile(int n);
void uiFlash(int cell, bool ok);
void uiSetTime(uint32_t epoch, int tzMin);
void uiNowPlaying(JsonObjectConst o);
void uiPairShow(uint32_t passkey);
void uiPairClose();
void uiOpenSheet();
void uiCloseSheet();
bool uiSheetOpen();
void uiSetBrightness(int level);     // 0-255, live + NVS
void uiSetDim(int seconds);          // dim after N s idle (0 = never), NVS
void uiCalibrate();                  // touch calibration screen (non-blocking)
void uiCalibrateCancel();
bool uiCalibrating();
int  uiBrightness();
