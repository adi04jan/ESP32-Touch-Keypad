/* XPT2046 polling, calibration (NVS) and the gesture state machine.
   CLI-injected gestures go through the same machine as real touches. */
#pragma once
#include <Arduino.h>

void touchBegin();     // load calibration from NVS
void scanTouch();      // call every loop()
// Injected gesture: press at (x1,y1), slide to (x2,y2), release after ms.
// Prints "OK" and the prompt when the gesture has been processed.
void touchInject(int x1, int y1, int x2, int y2, uint32_t ms);
void touchCalibrate(); // blocking LovyanGFX calibration screen; saves to NVS
void touchLog(bool on);
