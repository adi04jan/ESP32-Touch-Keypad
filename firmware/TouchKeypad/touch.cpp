#include "touch.h"
#include "board.h"
#include "display.h"
#include "ui.h"
#include <Preferences.h>
#include <algorithm>

static float cal[6];                 // screen = affine(raw)
static bool calibrated = false;

static struct { bool active, raw; int x1, y1, x2, y2; uint32_t t0, ms; } inj;
static bool down = false, holdSent = false, swallow = false, verbose = false;
static int sx, sy, lx, ly;
static uint32_t tDown, lastPoll;
static uint8_t misses;

// Raw samples of the current press; the calibration screen takes their median.
#define RAW_MAX 48
static int16_t rawX[RAW_MAX], rawY[RAW_MAX];
static int rawN = 0, pressRX = 0, pressRY = 0;

void touchLog(bool on) { verbose = on; }
bool touchCalibrated() { return calibrated; }
void touchPressRaw(int *rx, int *ry) { *rx = pressRX; *ry = pressRY; }
void touchGetCal(float m[6]) { memcpy(m, cal, sizeof cal); }

void touchMapWith(const float m[6], int rx, int ry, int *x, int *y) {
  *x = lroundf(m[0] * rx + m[1] * ry + m[2]);
  *y = lroundf(m[3] * rx + m[4] * ry + m[5]);
}
void touchMap(int rx, int ry, int *x, int *y) { touchMapWith(cal, rx, ry, x, y); }

static void unmap(int x, int y, int *rx, int *ry) {   // screen -> raw, for injected touches
  float det = cal[0] * cal[4] - cal[1] * cal[3];
  if (fabsf(det) < 1e-9f) { *rx = x; *ry = y; return; }
  float u = x - cal[2], v = y - cal[5];
  *rx = lroundf((cal[4] * u - cal[1] * v) / det);
  *ry = lroundf((cal[0] * v - cal[3] * u) / det);
}

// Least squares fit of x and y as a*rx + b*ry + c over n >= 3 points.
bool touchFit(const int raw[][2], const int16_t scr[][2], int n, float m[6]) {
  double s[3][3] = {}, tx[3] = {}, ty[3] = {};
  for (int i = 0; i < n; i++) {
    double v[3] = { (double)raw[i][0], (double)raw[i][1], 1 };
    for (int r = 0; r < 3; r++) {
      for (int c = 0; c < 3; c++) s[r][c] += v[r] * v[c];
      tx[r] += v[r] * scr[i][0];
      ty[r] += v[r] * scr[i][1];
    }
  }
  auto det3 = [](double a[3][3]) {
    return a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) +
           a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]);
  };
  double d = det3(s);
  if (fabs(d) < 1e-6) return false;
  for (int axis = 0; axis < 2; axis++) {   // Cramer's rule
    double *t = axis ? ty : tx;
    for (int k = 0; k < 3; k++) {
      double a[3][3];
      memcpy(a, s, sizeof a);
      for (int r = 0; r < 3; r++) a[r][k] = t[r];
      m[axis * 3 + k] = det3(a) / d;
    }
  }
  return true;
}

void touchSetCal(const float m[6], bool save) {
  memcpy(cal, m, sizeof cal);
  calibrated = true;
  if (!save) return;
  Preferences p;
  p.begin("touch", false);
  p.putBytes("aff", cal, sizeof cal);
  p.end();
}

// Before calibration: whatever LovyanGFX makes of the raw range in the panel config.
static void defaultCal() {
  int raw[3][2] = { { 300, 300 }, { 3900, 300 }, { 300, 3900 } };
  int16_t scr[3][2];
  for (int i = 0; i < 3; i++) {
    lgfx::touch_point_t tp;
    tp.x = raw[i][0];
    tp.y = raw[i][1];
    lcd.convertRawXY(&tp, 1);
    scr[i][0] = tp.x;
    scr[i][1] = tp.y;
  }
  if (!touchFit(raw, scr, 3, cal)) {
    const float rough[6] = { 0.133f, 0, -40, 0, 0.089f, -27 };
    memcpy(cal, rough, sizeof cal);
  }
}

void touchClearCal() {
  Preferences p;
  p.begin("touch", false);
  p.remove("aff");
  p.remove("cal");   // LovyanGFX-format data from earlier builds
  p.end();
  calibrated = false;
  defaultCal();
}

void touchBegin() {
  defaultCal();
  Preferences p;
  p.begin("touch", true);
  float m[6];
  if (p.getBytes("aff", m, sizeof m) == sizeof m) touchSetCal(m, false);
  p.end();
}

void touchInject(int x1, int y1, int x2, int y2, uint32_t ms) {
  inj = { true, false, x1, y1, x2, y2, millis(), ms < 20 ? 20 : ms };
}

void touchInjectRaw(int rx, int ry, uint32_t ms) {
  inj = { true, true, rx, ry, rx, ry, millis(), ms < 20 ? 20 : ms };
}

static int median(int16_t *v, int n) {
  std::nth_element(v, v + n / 2, v + n);
  return v[n / 2];
}

static void classifyRelease() {
  // Drop the first samples: a resistive panel reads wide while the finger settles.
  int skip = rawN > 6 ? 2 : 0;
  if (rawN - skip > 0) { pressRX = median(rawX + skip, rawN - skip); pressRY = median(rawY + skip, rawN - skip); }
  int dx = lx - sx, dy = ly - sy;
  uint8_t kind = G_TAP;
  if (abs(dx) > SWIPE_X_PX && abs(dx) > abs(dy)) kind = dx < 0 ? G_SWIPE_L : G_SWIPE_R;
  else if (abs(dy) > SWIPE_Y_PX && abs(dy) > abs(dx)) kind = dy < 0 ? G_SWIPE_U : G_SWIPE_D;
  if (verbose) Serial.printf("touch up %d,%d -> %d,%d kind %u raw %d,%d\n", sx, sy, lx, ly, kind, pressRX, pressRY);
  uiGesture(kind, sx, sy, lx, ly);
}

static void bootButton(uint32_t now) {   // hold BOOT 2 s: calibration, even when touch is unusable
  static uint32_t since = 0;
  static bool fired = false;
  if (digitalRead(PIN_BOOT) == LOW) {
    if (!since) since = now | 1;
    else if (!fired && now - since > 2000) { fired = true; uiCalibrate(); }
  } else {
    since = 0;
    fired = false;
  }
}

void scanTouch() {
  uint32_t now = millis();
  if (now - lastPoll < TOUCH_POLL_MS) return;
  lastPoll = now;
  bootButton(now);

  bool pressed;
  int x = lx, y = ly, rx = 0, ry = 0;
  bool injEnd = false;
  if (inj.active) {
    uint32_t t = now - inj.t0;
    pressed = t < inj.ms;
    if (pressed) {
      x = inj.x1 + (int)((int64_t)(inj.x2 - inj.x1) * t / inj.ms);
      y = inj.y1 + (int)((int64_t)(inj.y2 - inj.y1) * t / inj.ms);
    } else {
      x = inj.x2;
      y = inj.y2;
      injEnd = true;
    }
    if (inj.raw) { rx = x; ry = y; touchMap(rx, ry, &x, &y); }
    else unmap(x, y, &rx, &ry);
  } else {
    lgfx::touch_point_t tp;
    pressed = lcd.getTouchRaw(&tp, 1) > 0;
    if (pressed) {
      rx = tp.x;
      ry = tp.y;
      touchMap(rx, ry, &x, &y);
      if (verbose) Serial.printf("touch raw %d,%d -> %d,%d\n", rx, ry, x, y);
    }
  }
  x = constrain(x, 0, SCR_W - 1);
  y = constrain(y, 0, SCR_H - 1);

  if (pressed) {
    misses = 0;
    lx = x;
    ly = y;
    if (!down) {
      down = true;
      sx = x;
      sy = y;
      tDown = now;
      holdSent = false;
      rawN = 0;
      swallow = uiWake();   // first touch on a dark screen only wakes it
      if (!swallow) uiGesture(G_DOWN, sx, sy, x, y);
    } else if (!swallow) {
      if (!holdSent && now - tDown >= HOLD_MS && abs(lx - sx) < 20 && abs(ly - sy) < 20) {
        holdSent = true;
        uiGesture(G_HOLD, sx, sy, lx, ly);
      } else {
        uiGesture(G_MOVE, sx, sy, lx, ly);
      }
    }
    if (rawN < RAW_MAX) { rawX[rawN] = rx; rawY[rawN] = ry; rawN++; }
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
