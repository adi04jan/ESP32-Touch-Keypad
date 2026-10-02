/* XPT2046 polling, raw -> screen calibration (affine, NVS) and the gesture
   state machine. CLI-injected gestures go through the same machine as real
   touches. The calibration screen itself lives in ui.cpp. */
#pragma once
#include <Arduino.h>

void touchBegin();     // load calibration from NVS
void scanTouch();      // call every loop(); also watches the BOOT button (hold 2 s = calibrate)
// Injected gesture in screen coordinates: press at (x1,y1), slide to (x2,y2), release after ms.
// Prints "OK" and the prompt when the gesture has been processed.
void touchInject(int x1, int y1, int x2, int y2, uint32_t ms);
void touchInjectRaw(int rx, int ry, uint32_t ms);   // a press at raw ADC values (calibration tests)
void touchLog(bool on);

// Calibration: screen = affine(raw), x = m0*rx + m1*ry + m2, y = m3*rx + m4*ry + m5.
bool touchCalibrated();
void touchPressRaw(int *rx, int *ry);                // median raw of the press just released
void touchMap(int rx, int ry, int *x, int *y);       // with the current calibration
void touchMapWith(const float m[6], int rx, int ry, int *x, int *y);
bool touchFit(const int raw[][2], const int16_t scr[][2], int n, float m[6]);   // least squares
void touchSetCal(const float m[6], bool save);
void touchGetCal(float m[6]);
void touchClearCal();                                // forget it (the screen asks again on boot)
