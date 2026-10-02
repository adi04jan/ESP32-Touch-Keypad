/* The screen (firmware/DESIGN.md, mocked in docs/device/index.html): status
   band, glass key grid, page stations, media player, settings sheet, pairing,
   touch calibration, toasts and the volume panel.

   A damage-tracked renderer: any dirty rectangle of the scene is drawn into a
   small chunk buffer and sent by DMA while the next chunk renders. A 60 Hz
   frame clock drives the animations, each of which redraws only its own
   region (press, rings, page pop-in wave, sheet wipe, toast, volume). */
#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>

enum : uint8_t { G_DOWN, G_HOLD, G_TAP, G_SWIPE_L, G_SWIPE_R, G_SWIPE_U, G_SWIPE_D, G_MOVE };

void uiBegin();
void uiTick();                       // call every loop(); draws at most one frame per 16 ms
void uiMarkAll();
void uiMarkCell(int cell);
void uiMarkStatus();
void uiActivity();                   // resets the dim/off timers
bool uiWake();                       // true if the screen was dimmed/off (that touch is swallowed)
void uiGesture(uint8_t kind, int x0, int y0, int x1, int y1);

void uiGoPage(int idx, bool push);   // emits EVT:PAGE
void uiBack();
void uiSetProfile(int n);            // emits EVT:PROFILE, shows a toast
void uiFlash(int cell, bool ok);     // ok / alert ring on a key
void uiToast(const char *text);
void uiSetTime(uint32_t epoch, int tzMin);
void uiNowPlaying(JsonObjectConst o);   // {title, album, artist, app, pos, len, playing}
void uiVolume(JsonObjectConst o);       // {level 0-100, muted}: the volume panel shows the real level
void uiMediaKey(const char *value);     // a media action ran (volume panel, play state)
uint8_t *uiArtBuffer(size_t size);      // album art upload target: 128x128 big-endian RGB565
void uiArtDone(bool ok);
void uiPairShow(uint32_t passkey);
void uiPairClose();
void uiOpenSheet();
void uiCloseSheet();
bool uiSheetOpen();
void uiSetBrightness(int level);     // 0-255, live + NVS
int  uiBrightness();
void uiSetDim(int seconds);          // dim after N s idle (0 = never), NVS; wakes the screen
void uiCalibrate();                  // touch calibration screen (also on first boot and BOOT held 2 s)
void uiCalibrateCancel();
bool uiCalibrating();
const char *uiModeName();            // home | sheet | pair | cal
void uiPerf(bool reset);             // `perf`: frame timing of animated frames
void uiRenderBench();                // `rbench`: render cost per scene part
