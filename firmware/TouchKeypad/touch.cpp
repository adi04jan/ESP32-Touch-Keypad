#include "touch.h"
#include "board.h"
#include "display.h"
#include "ui.h"
#include <Preferences.h>
#include <esp_task_wdt.h>

static struct { bool active; int x1, y1, x2, y2; uint32_t t0, ms; } inj;
static bool down = false, holdSent = false, swallow = false, verbose = false;
static int sx, sy, lx, ly;
static uint32_t tDown, lastPoll;
static uint8_t misses;

void touchLog(bool on) { verbose = on; }

void touchBegin() {
  uint16_t cal[8];
  Preferences p;
  p.begin("touch", true);
  if (p.getBytes("cal", cal, sizeof cal) == sizeof cal) lcd.setTouchCalibrate(cal);
  p.end();
}

void touchCalibrate() {
  uint16_t cal[8];
  esp_task_wdt_delete(NULL);   // waits for a human
  lcd.fillScreen(TFT_BLACK);
  lcd.setTextColor(TFT_WHITE);
  lcd.setFont(&fonts::FreeSansBold9pt7b);
  lcd.setTextDatum(middle_center);
  lcd.drawString("Touch the arrow tips", SCR_W / 2, SCR_H / 2);
  lcd.calibrateTouch(cal, TFT_WHITE, TFT_BLACK, 20);
  esp_task_wdt_add(NULL);
  Preferences p;
  p.begin("touch", false);
  p.putBytes("cal", cal, sizeof cal);
  p.end();
  Serial.printf("calibrated %u %u %u %u %u %u %u %u\n", cal[0], cal[1], cal[2], cal[3], cal[4], cal[5], cal[6], cal[7]);
  uiMarkAll();
}

void touchInject(int x1, int y1, int x2, int y2, uint32_t ms) {
  inj = { true, x1, y1, x2, y2, millis(), ms < 20 ? 20 : ms };
}

static void classifyRelease() {
  int dx = lx - sx, dy = ly - sy;
  uint8_t kind = G_TAP;
  if (abs(dx) > SWIPE_X_PX && abs(dx) > abs(dy)) kind = dx < 0 ? G_SWIPE_L : G_SWIPE_R;
  else if (abs(dy) > SWIPE_Y_PX && abs(dy) > abs(dx)) kind = dy < 0 ? G_SWIPE_U : G_SWIPE_D;
  if (verbose) Serial.printf("touch up %d,%d -> %d,%d kind %u\n", sx, sy, lx, ly, kind);
  uiGesture(kind, sx, sy, lx, ly);
}

void scanTouch() {
  uint32_t now = millis();
  if (now - lastPoll < TOUCH_POLL_MS) return;
  lastPoll = now;

  bool pressed;
  int x = lx, y = ly;
  bool injEnd = false;
  if (inj.active) {
    uint32_t t = now - inj.t0;
    pressed = t < inj.ms;
    if (pressed) {
      x = inj.x1 + (int)((int64_t)(inj.x2 - inj.x1) * t / inj.ms);
      y = inj.y1 + (int)((int64_t)(inj.y2 - inj.y1) * t / inj.ms);
    } else {
      x = inj.x2; y = inj.y2;
      injEnd = true;
    }
  } else {
    lgfx::touch_point_t tp;
    pressed = lcd.getTouch(&tp, 1) > 0;
    if (pressed) { x = tp.x; y = tp.y; }
    if (pressed && verbose) Serial.printf("touch raw %d,%d\n", x, y);
  }

  if (pressed) {
    misses = 0;
    lx = x; ly = y;
    if (!down) {
      down = true;
      sx = x; sy = y;
      tDown = now;
      holdSent = false;
      swallow = uiWake();   // first touch on a dark screen only wakes it
      if (!swallow) uiGesture(G_DOWN, sx, sy, x, y);
    } else if (!swallow && !holdSent && now - tDown >= HOLD_MS && abs(lx - sx) < 20 && abs(ly - sy) < 20) {
      holdSent = true;
      uiGesture(G_HOLD, sx, sy, lx, ly);
    }
    uiActivity();
    return;
  }
  if (down && (injEnd || ++misses >= TOUCH_RELEASE_MISSES)) {
    down = false;
    if (injEnd) { lx = x; ly = y; }
    if (!swallow) classifyRelease();
  }
  if (injEnd) {
    inj.active = false;
    Serial.println("OK");
    Serial.print("macropad:$ ");
  }
}
