#include "ui.h"
#include "board.h"
#include "display.h"
#include "profiles.h"
#include "macro_engine.h"
#include "ble_hid.h"
#include "touch.h"
#include <LittleFS.h>
#include <Preferences.h>
#include <time.h>

// ----- palette (DESIGN.md) -----
#define C(r, g, b) lgfx::color565(r, g, b)
static const uint16_t NIGHT = C(0x24, 0x34, 0x5c), PAPER = C(0xf4, 0xf4, 0xef), PAPER2 = C(0xfb, 0xfb, 0xf7),
  INK = C(0x1b, 0x18, 0x14), INK2 = C(0x4f, 0x48, 0x40), OXBLOOD = C(0x7a, 0x1f, 0x2b), GOLD = C(0xe2, 0xb0, 0x4a),
  GOLD2 = C(0xf3, 0xd2, 0x7c), TEAL2 = C(0x2f, 0x6b, 0x73), VERMILION = C(0xc2, 0x41, 0x2b), TEAL = C(0x26, 0x46, 0x53),
  VIRIDIAN = C(0x2f, 0x6b, 0x4f), MIST = C(0xd7, 0xe6, 0xe4), DOT = C(0x10, 0x18, 0x30), GREYINK = C(0x9a, 0x90, 0x86),
  SHADE = C(0x14, 0x1d, 0x34), SLOT = C(82, 94, 124), STAMP_OK = C(0x4f, 0xb3, 0x7f), STAMP_BAD = C(0xe2, 0x56, 0x3f),
  RULE = C(0xd6, 0xd5, 0xcf), MAGENTA = C(0xb0, 0x3a, 0x8c), GILT = C(0xc9, 0x95, 0x2e), HOUSE = C(0x0d, 0x14, 0x26);

static uint16_t mix(int r, int g, int b, int t, float a) {   // toward grey level t
  return C(r + (t - r) * a, g + (t - g) * a, b + (t - b) * a);
}

// ----- geometry -----
#define TILE_X  ((CELL_W - TILE_PX) / 2)
#define TILE_Y  2
#define CHIP_Y  71
#define CHIP_H  18
#define GEAR_X  (SCR_W - 18)
#define DIM_DEFAULT_S 120

static LGFX_Sprite spr(&lcd);
static bool sprOk = false;

static uint16_t dirtyCells = 0;
static bool dirtyStatus = false, dirtyDots = false, dirtySheet = false, dirtyPair = false;
static int8_t owner[NUM_CELLS];          // widget top-left cell covering this cell, or -1
static int pressed = -1;
static bool holdFired = false;
static uint32_t flashUntil[NUM_CELLS];
static uint16_t flashBad = 0;            // bit per cell: alert ring instead of ok
static int8_t backStack[8];
static int backDepth = 0;

static bool sheetOn = false, pairOn = false;
static uint32_t pairKey = 0;
static int brightness = 200, dimAfterS = DIM_DEFAULT_S, dimState = 0;   // 0 lit, 1 dim, 2 off
static uint32_t lastAct = 0;

static uint32_t timeEpoch = 0, timeBase = 0;
static int tzMin = 0, lastMinute = -1;

static struct { char title[65], artist[65], app[33]; int pos, len; bool playing; uint32_t at; bool have; } np;
static uint32_t lastNpSec = 0;

// ---------------------------------------------------------------- helpers
static JsonVariant keyAt(int c) { return pageDoc["keys"][c]; }

static void computeOwners() {
  for (int i = 0; i < NUM_CELLS; i++) owner[i] = -1;
  for (int i = 0; i < NUM_CELLS; i++) {
    JsonVariant k = keyAt(i);
    if (k.isNull() || !k["widget"].is<const char *>()) continue;
    int w = k["span"][0] | 1, h = k["span"][1] | 1;
    for (int dy = 0; dy < h; dy++)
      for (int dx = 0; dx < w; dx++) {
        int c = i + dy * GRID_COLS + dx;
        if (i % GRID_COLS + dx < GRID_COLS && c < NUM_CELLS) owner[c] = i;
      }
  }
}

static int hitCell(int x, int y) {
  if (y < STATUS_H || y >= DOTS_Y || x < 0 || x >= SCR_W) return -1;
  int c = (y - STATUS_H) / CELL_H * GRID_COLS + x / CELL_W;
  if (c < 0 || c >= NUM_CELLS) return -1;
  return owner[c] >= 0 ? owner[c] : c;
}

static void markOwned(int w) {
  for (int i = 0; i < NUM_CELLS; i++) if (owner[i] == w || i == w) dirtyCells |= 1 << i;
}

// Cut `s` to fit maxW with the current font, ending in "." when shortened.
template <typename G> static String fit(G &g, const char *s, int maxW) {
  String t = s;
  if (g.textWidth(t) <= maxW) return t;
  while (t.length() > 1 && (g.textWidth(t + ".") > maxW || t.endsWith(" "))) t.remove(t.length() - 1);
  return t + ".";
}

static void emitKey(int c, char state) { Serial.printf("EVT:KEY %d %d %c\n", currentPage + 1, c + 1, state); }

static void localTime(struct tm *out) {
  time_t t = timeEpoch + tzMin * 60 + (millis() - timeBase) / 1000;
  gmtime_r(&t, out);
}

static void fmtClock(char *buf, int secs) { sprintf(buf, "%d:%02d", secs / 60, secs % 60); }

static int npPos() {
  int p = np.pos + (np.playing ? (millis() - np.at) / 1000 : 0);
  return np.len > 0 && p > np.len ? np.len : p;
}

// ---------------------------------------------------------------- cell drawing (into the cell sprite)
static bool drawTileFile(const char *crc, int x, int y) {
  char path[24];
  snprintf(path, sizeof path, "/t/%.8s.565", crc);
  if (!LittleFS.exists(path)) return false;
  File f = LittleFS.open(path, "r");
  if (!f || f.size() != TILE_PX * TILE_PX * 2) return false;
  uint16_t row[TILE_PX];
  for (int r = 0; r < TILE_PX && f.read((uint8_t *)row, sizeof row) == sizeof row; r++)
    spr.pushImage(x, y + r, TILE_PX, 1, (const lgfx::swap565_t *)row);   // Studio writes big-endian
  f.close();
  return true;
}

// Two paper layers: a dark base and a lighter face cut up-left of it. A press
// flattens the face onto the base.
static void drawPaperTile(JsonVariant k, int x, int y, bool down) {
  int r = k["led_color"][0] | 110, g = k["led_color"][1] | 100, b = k["led_color"][2] | 92;
  int s = TILE_PX - 4;
  spr.fillRoundRect(x + 4, y + 6, s, s, 11, SHADE);
  spr.fillRoundRect(x + 4, y + 4, s, s, 11, mix(r, g, b, 0, .45));
  int o = down ? 4 : 0;
  spr.fillRoundRect(x + o, y + o, s, s, 11, mix(r, g, b, 255, .08));
  spr.drawFastHLine(x + o + 10, y + o + 1, s - 20, mix(r, g, b, 255, .3));
  // Initials stand in for the glyph Studio would render into a tile file.
  const char *name = k["name"] | "";
  char ini[3] = { 0 };
  int n = 0;
  for (const char *p = name; *p && n < 2; p++)
    if ((p == name || p[-1] == ' ') && isalnum((uint8_t)*p)) ini[n++] = *p;
  if (!n && *name) ini[0] = name[0];
  spr.setFont(&fonts::FreeSansBold18pt7b);
  spr.setTextDatum(middle_center);
  spr.setTextColor(mix(r, g, b, 0, .55));
  spr.drawString(ini, x + o + s / 2 + 1, y + o + s / 2 + 2);
  spr.setTextColor(TFT_WHITE);
  spr.drawString(ini, x + o + s / 2, y + o + s / 2);
}

static void drawLabel(const char *name, int cx) {
  if (!*name) return;
  spr.setFont(&fonts::FreeSansBold9pt7b);
  String t = name;
  if (spr.textWidth(t) > CELL_W - 10) { spr.setFont(&fonts::DejaVu12); t = fit(spr, name, CELL_W - 10); }
  int w = spr.textWidth(t) + 10;
  spr.fillRect(cx - w / 2 + 1, CHIP_Y + 2, w, CHIP_H, SHADE);
  spr.fillRect(cx - w / 2, CHIP_Y, w, CHIP_H, PAPER);
  spr.setTextColor(INK);
  spr.setTextDatum(middle_center);
  spr.drawString(t, cx, CHIP_Y + CHIP_H / 2);
}

static void drawBadge(const char *txt, int x, int y) {
  spr.setFont(&fonts::Font0);
  int w = spr.textWidth(txt) + 6;
  spr.fillRect(x - w + 1, y + 1, w, 11, SHADE);
  spr.fillRect(x - w, y, w, 11, GOLD);
  spr.setTextColor(INK);
  spr.setTextDatum(middle_center);
  spr.drawString(txt, x - w / 2, y + 6);
}

static void drawEmptySlot(int x, int y) {
  const int s = TILE_PX - 4, r = 11;
  for (int i = r + 2; i < s - r - 2; i += 9) {
    spr.fillRect(x + i, y, 5, 2, SLOT);
    spr.fillRect(x + i, y + s - 2, 5, 2, SLOT);
    spr.fillRect(x, y + i, 2, 5, SLOT);
    spr.fillRect(x + s - 2, y + i, 2, 5, SLOT);
  }
  spr.drawArc(x + r, y + r, r, r - 1, 200, 250, SLOT);
  spr.drawArc(x + s - r - 1, y + r, r, r - 1, 290, 340, SLOT);
  spr.drawArc(x + r, y + s - r - 1, r, r - 1, 110, 160, SLOT);
  spr.drawArc(x + s - r - 1, y + s - r - 1, r, r - 1, 20, 70, SLOT);
}

// Now Playing card at (ox, oy) in sprite coordinates; the sprite clips it to one cell.
static void drawNowPlaying(JsonVariant k, int ox, int oy, bool down) {
  int w = (k["span"][0] | 3) * CELL_W, h = (k["span"][1] | 2) * CELL_H;
  int d = down ? 2 : 0;
  spr.fillRoundRect(ox + 10, oy + 12, w - 16, h - 18, 8, SHADE);
  spr.fillRoundRect(ox + 6 + d, oy + 6 + d, w - 16, h - 18, 8, TEAL2);
  spr.drawFastHLine(ox + 16 + d, oy + 7 + d, w - 36, mix(0x2f, 0x6b, 0x73, 255, .25));
  // Cut-paper record sleeve.
  int ax = ox + 22 + d, ay = oy + (h - 84) / 2 + d, as = 84;
  spr.fillRoundRect(ax + 3, ay + 4, as, as, 6, SHADE);
  spr.fillRoundRect(ax, ay, as, as, 6, GOLD);
  spr.setClipRect(ax, ay, as, as);
  spr.fillCircle(ax + 18, ay + as - 10, 30, VERMILION);
  spr.fillCircle(ax + as - 22, ay + 24, 20, TEAL);
  spr.clearClipRect();
  int cx = ax + as / 2, cy = ay + as / 2;
  if (np.playing) { spr.fillRect(cx - 9, cy - 11, 6, 22, TFT_WHITE); spr.fillRect(cx + 3, cy - 11, 6, 22, TFT_WHITE); }
  else spr.fillTriangle(cx - 8, cy - 12, cx - 8, cy + 12, cx + 12, cy, TFT_WHITE);

  int tx = ax + as + 16, tw = ox + w - 22 - tx;
  spr.setTextDatum(top_left);
  spr.setFont(&fonts::DejaVu12);
  spr.setTextColor(GOLD2);
  String src = String("Now playing - ") + (np.app[0] ? np.app : "via Studio");
  spr.drawString(fit(spr, src.c_str(), tw), tx, oy + 22 + d);
  spr.setFont(&fonts::FreeSansBold12pt7b);
  spr.setTextColor(PAPER);
  spr.drawString(fit(spr, np.have && np.title[0] ? np.title : "Nothing playing", tw), tx, oy + 42 + d);
  spr.setFont(&fonts::FreeSans9pt7b);
  spr.setTextColor(MIST);
  spr.drawString(fit(spr, np.have ? np.artist : "Studio sends the track here", tw), tx, oy + 72 + d);
  int py = oy + h - 62 + d, pos = npPos();
  spr.fillRect(tx, py, tw, 5, C(0x23, 0x50, 0x56));
  if (np.len > 0) spr.fillRect(tx, py, tw * pos / np.len, 5, GOLD);
  char a[12], b[12];
  fmtClock(a, pos);
  fmtClock(b, np.len);
  spr.setFont(&fonts::DejaVu12);
  spr.setTextColor(MIST);
  spr.drawString(a, tx, py + 12);
  spr.setTextDatum(top_right);
  spr.drawString(b, tx + tw, py + 12);
}

static void drawCell(int c) {
  if (!sprOk) return;
  int cx = (c % GRID_COLS) * CELL_W, cy = STATUS_H + (c / GRID_COLS) * CELL_H;
  spr.fillScreen(NIGHT);
  int own = owner[c];
  if (own >= 0) {
    int ox = (own % GRID_COLS - c % GRID_COLS) * CELL_W, oy = (own / GRID_COLS - c / GRID_COLS) * CELL_H;
    drawNowPlaying(keyAt(own), ox, oy, pressed == own);
  } else {
    JsonVariant k = keyAt(c);
    if (k.isNull()) {
      drawEmptySlot(TILE_X + 2, TILE_Y + 2);
    } else {
      bool down = pressed == c;
      const char *tile = k["tile"] | "";
      if (!(strlen(tile) == 8 && drawTileFile(tile, TILE_X + (down ? 3 : 0), TILE_Y + (down ? 3 : 0))))
        drawPaperTile(k, TILE_X, TILE_Y, down);
      bool host = false;
      for (JsonVariant a : k["actions"].as<JsonArray>()) host |= !strcmp(a["type"] | "", "host");
      if (host) drawBadge("PC", TILE_X + TILE_PX + 2, 0);
      else if (k["hold_actions"].size()) drawBadge("HOLD", TILE_X + TILE_PX + 2, 0);
      drawLabel(k["name"] | "", CELL_W / 2);
    }
    if (flashUntil[c]) {   // rubber-stamp ring
      uint16_t col = (flashBad >> c) & 1 ? STAMP_BAD : STAMP_OK;
      spr.fillArc(TILE_X + TILE_PX / 2, TILE_Y + TILE_PX / 2, 39, 35, 0, 360, col);
    }
  }
  spr.pushSprite(cx, cy);
}

// ---------------------------------------------------------------- status strip, dots (direct to LCD)
static void drawBleRune(int x, int y, uint16_t col) {   // 8x14
  lcd.drawLine(x + 3, y, x + 3, y + 13, col);
  lcd.drawLine(x + 3, y, x + 7, y + 3, col);
  lcd.drawLine(x + 7, y + 3, x, y + 10, col);
  lcd.drawLine(x, y + 3, x + 7, y + 10, col);
  lcd.drawLine(x + 7, y + 10, x + 3, y + 13, col);
}

static void drawGear(int cx, int cy) {
  lcd.fillCircle(cx + 1, cy + 2, 11, C(0xb8, 0xb6, 0xae));
  lcd.fillCircle(cx, cy, 11, GOLD);
  for (int a = 0; a < 360; a += 45) {
    float r = a * DEG_TO_RAD;
    lcd.drawWideLine(cx + cosf(r) * 3, cy + sinf(r) * 3, cx + cosf(r) * 7.5f, cy + sinf(r) * 7.5f, 1.2f, INK);
  }
  lcd.fillCircle(cx, cy, 4, INK);
  lcd.fillCircle(cx, cy, 2, GOLD);
}

static void drawStatus() {
  lcd.startWrite();
  lcd.fillRect(0, 0, SCR_W, STATUS_H - 2, PAPER);
  lcd.drawFastHLine(0, STATUS_H - 2, SCR_W, C(0x8e, 0x8f, 0x92));
  lcd.drawFastHLine(0, STATUS_H - 1, SCR_W, SHADE);
  int x = 10;
  lcd.setTextDatum(middle_left);
  if (timeEpoch) {
    struct tm t;
    localTime(&t);
    char buf[8];
    sprintf(buf, "%d:%02d", t.tm_hour, t.tm_min);
    lcd.setFont(&fonts::FreeSansBold12pt7b);
    lcd.setTextColor(OXBLOOD);
    lcd.drawString(buf, x, 14);
    x += lcd.textWidth(buf) + 12;
  }
  lcd.setFont(&fonts::FreeSansBold9pt7b);
  lcd.setTextColor(INK2);
  const char *pname = pageDoc["name"] | "";
  int right = SCR_W - 104;
  String a = fit(lcd, profileName, (right - x) / 2);
  lcd.drawString(a, x, 14);
  x += lcd.textWidth(a) + 7;
  lcd.fillCircle(x, 15, 2, INK2);
  x += 7;
  lcd.drawString(fit(lcd, *pname ? pname : "Page", right - x), x, 14);

  drawBleRune(SCR_W - 52, 8, blePairing() ? MAGENTA : hidConnected() ? INK : GREYINK);
  if (hidDry()) {   // HID reports are logged, not sent (tests)
    lcd.setFont(&fonts::Font0);
    lcd.fillRect(SCR_W - 92, 9, 30, 12, VERMILION);
    lcd.setTextColor(PAPER);
    lcd.setTextDatum(middle_center);
    lcd.drawString("DRY", SCR_W - 77, 15);
  }
  drawGear(GEAR_X, 14);
  lcd.endWrite();
}

static int dotX(int i, int *w) {   // left edge of dot i; dots are centred, the current one is a pill
  int total = 0;
  for (int j = 0; j < pageCount; j++) total += (j == currentPage ? 22 : 8) + (j ? 8 : 0);
  int x = (SCR_W - total) / 2;
  for (int j = 0; j < i; j++) x += (j == currentPage ? 22 : 8) + 8;
  *w = i == currentPage ? 22 : 8;
  return x;
}

static void drawDots() {
  lcd.startWrite();
  lcd.fillRect(0, DOTS_Y, SCR_W, SCR_H - DOTS_Y, NIGHT);
  if (pageCount > 1)
    for (int i = 0; i < pageCount; i++) {
      int w, x = dotX(i, &w);
      if (i == currentPage) { lcd.fillRoundRect(x, DOTS_Y + 7, w, 8, 4, SHADE); lcd.fillRoundRect(x, DOTS_Y + 6, w, 8, 4, GOLD); }
      else lcd.fillRoundRect(x, DOTS_Y + 6, w, 8, 4, DOT);
    }
  lcd.endWrite();
}

static void dotTap(int x) {
  if (pageCount < 2) return;
  int best = -1, bestD = 9999;
  for (int i = 0; i < pageCount; i++) {
    int w, l = dotX(i, &w), d = abs(x - (l + w / 2));
    if (d < bestD) { bestD = d; best = i; }
  }
  if (best >= 0 && bestD <= 16 && best != currentPage) uiGoPage(best, false);
}

// ---------------------------------------------------------------- settings sheet
enum : uint8_t { B_CLOSE, B_DIM_DN, B_DIM_UP, B_PROF_DN, B_PROF_UP, B_PAIR, B_CAL, B_N };
static struct { int16_t x, y, w, h; } btn[B_N];

static void sheetButton(uint8_t id, int x, int y, int w, const char *txt, bool primary = false) {
  btn[id] = { (int16_t)x, (int16_t)y, (int16_t)w, 30 };
  lcd.fillRect(x + 1, y + 2, w, 30, RULE);
  lcd.fillRect(x, y, w, 30, primary ? OXBLOOD : PAPER2);
  lcd.drawRect(x, y, w, 30, primary ? OXBLOOD : RULE);
  lcd.setFont(&fonts::FreeSansBold9pt7b);
  lcd.setTextColor(primary ? PAPER : INK);
  lcd.setTextDatum(middle_center);
  lcd.drawString(txt, x + w / 2, y + 15);
}

static void sheetRow(int y, uint16_t ic, const char *title, const char *value) {
  lcd.fillRect(28, y + 9, 26, 26, SHADE);
  lcd.fillRect(26, y + 7, 26, 26, ic);
  lcd.setFont(&fonts::FreeSansBold9pt7b);
  lcd.setTextColor(INK);
  lcd.setTextDatum(middle_left);
  lcd.drawString(title, 64, y + 20);
  lcd.setFont(&fonts::DejaVu12);
  lcd.setTextColor(INK2);
  lcd.drawString(value, 176, y + 21);
  lcd.drawFastHLine(22, y + 44, SCR_W - 44, RULE);
}

static void drawSheet() {
  char v[64];
  lcd.startWrite();
  lcd.fillRect(0, STATUS_H, SCR_W, SCR_H - STATUS_H, NIGHT);
  lcd.fillRect(14, 42, SCR_W - 24, SCR_H - 42, SHADE);
  lcd.fillRect(10, 38, SCR_W - 20, SCR_H - 38, PAPER);
  lcd.setFont(&fonts::FreeSansBold12pt7b);
  lcd.setTextColor(OXBLOOD);
  lcd.setTextDatum(middle_left);
  lcd.drawString("Settings", 24, 58);
  sheetButton(B_CLOSE, SCR_W - 100, 44, 76, "Close");

  int y = 78;
  sprintf(v, "%d%%", (brightness * 100 + 127) / 255);
  sheetRow(y, VERMILION, "Brightness", v);
  sheetButton(B_DIM_DN, SCR_W - 120, y + 5, 44, "-");
  sheetButton(B_DIM_UP, SCR_W - 68, y + 5, 44, "+");
  y += 46;
  snprintf(v, sizeof v, "%d  %s", currentProfile, profileName);
  sheetRow(y, GOLD, "Profile", v);
  sheetButton(B_PROF_DN, SCR_W - 120, y + 5, 44, "<");
  sheetButton(B_PROF_UP, SCR_W - 68, y + 5, 44, ">");
  y += 46;
  snprintf(v, sizeof v, "%s, %d bonded", hidConnected() ? "connected" : "advertising", bleBondCount());
  sheetRow(y, TEAL2, "Bluetooth", v);
  sheetButton(B_PAIR, SCR_W - 128, y + 5, 104, "Pair new", true);
  y += 46;
  sheetRow(y, VIRIDIAN, "Touch", "tap the arrow tips");
  sheetButton(B_CAL, SCR_W - 128, y + 5, 104, "Calibrate");
  y += 50;
  snprintf(v, sizeof v, "Touch Keypad %s  -  heap %u KB  -  dim %ds", FW_VERSION, (unsigned)(ESP.getFreeHeap() / 1024), dimAfterS);
  lcd.setFont(&fonts::DejaVu12);
  lcd.setTextColor(INK2);
  lcd.setTextDatum(middle_left);
  lcd.drawString(v, 26, y + 6);
  lcd.endWrite();
}

static void sheetTap(int x, int y) {
  int hit = -1;
  for (int i = 0; i < B_N; i++)
    if (x >= btn[i].x - 4 && x < btn[i].x + btn[i].w + 4 && y >= btn[i].y - 6 && y < btn[i].y + btn[i].h + 6) hit = i;
  switch (hit) {
    case B_CLOSE: uiCloseSheet(); break;
    case B_DIM_DN: uiSetBrightness(max(13, brightness - 26)); dirtySheet = true; break;
    case B_DIM_UP: uiSetBrightness(min(255, brightness + 26)); dirtySheet = true; break;
    case B_PROF_DN: uiSetProfile(currentProfile > 1 ? currentProfile - 1 : NUM_PROFILES); break;
    case B_PROF_UP: uiSetProfile(currentProfile < NUM_PROFILES ? currentProfile + 1 : 1); break;
    case B_PAIR: uiCloseSheet(); blePairOpen(); break;
    case B_CAL: uiCalibrate(); break;
  }
}

// ---------------------------------------------------------------- pairing ticket
#define TK_X 90
#define TK_Y 50
#define TK_W 300
#define TK_H 220

static void drawPairRing() {
  int cx = SCR_W / 2, cy = TK_Y + 116;
  uint32_t left = blePairLeftMs();
  int deg = left * 360 / PAIR_WINDOW_MS;
  lcd.startWrite();
  lcd.fillArc(cx, cy, 66, 60, 0, 360, GILT);
  if (deg > 0) lcd.fillArc(cx, cy, 66, 60, 270, 270 + deg, OXBLOOD);
  lcd.fillRect(TK_X + 30, TK_Y + TK_H - 30, TK_W - 60, 20, GOLD);
  char s[40];
  sprintf(s, "Type it on your PC  -  %lus", (unsigned long)(left + 999) / 1000);
  lcd.setFont(&fonts::DejaVu12);
  lcd.setTextColor(INK2);
  lcd.setTextDatum(middle_center);
  lcd.drawString(s, cx, TK_Y + TK_H - 20);
  lcd.endWrite();
}

static void drawPair() {
  lcd.startWrite();
  lcd.fillRect(0, STATUS_H, SCR_W, SCR_H - STATUS_H, HOUSE);
  lcd.fillRect(TK_X + 5, TK_Y + 7, TK_W, TK_H, C(0x05, 0x08, 0x10));
  lcd.fillRect(TK_X, TK_Y, TK_W, TK_H, GOLD);
  lcd.fillCircle(TK_X, TK_Y + TK_H / 2, 16, HOUSE);            // admit-ticket notches
  lcd.fillCircle(TK_X + TK_W, TK_Y + TK_H / 2, 16, HOUSE);
  lcd.drawRect(TK_X + 8, TK_Y + 8, TK_W - 16, TK_H - 16, GILT);
  lcd.setFont(&fonts::FreeSansBold9pt7b);
  lcd.setTextColor(OXBLOOD);
  lcd.setTextDatum(middle_center);
  lcd.drawString("ADMIT ONE HOST", SCR_W / 2, TK_Y + 26);
  char pk[8];
  sprintf(pk, "%06lu", (unsigned long)pairKey);
  lcd.setFont(&fonts::FreeSansBold18pt7b);
  lcd.setTextColor(INK);
  lcd.drawString(pk, SCR_W / 2, TK_Y + 116);
  lcd.endWrite();
  drawPairRing();
}

// ---------------------------------------------------------------- public
void uiBegin() {
  Preferences p;
  p.begin("kp", true);
  brightness = p.getUChar("bright", 200);
  dimAfterS = p.getUShort("dim", DIM_DEFAULT_S);
  p.end();
  spr.setColorDepth(16);
  sprOk = spr.createSprite(CELL_W, CELL_H) != nullptr;
  if (!sprOk) Serial.println("ui: no RAM for the cell sprite");
  lcd.fillScreen(NIGHT);
  displaySetBacklight(profileBrightness >= 0 ? profileBrightness : brightness);
  lastAct = millis();
  uiMarkAll();
}

void uiMarkAll() {
  computeOwners();
  dirtyCells = (1 << NUM_CELLS) - 1;
  dirtyStatus = dirtyDots = true;
  if (sheetOn) dirtySheet = true;
  if (pairOn) dirtyPair = true;
}

void uiMarkCell(int c) {
  if (c < 0 || c >= NUM_CELLS) return;
  computeOwners();
  if (owner[c] >= 0) markOwned(owner[c]);
  else dirtyCells |= 1 << c;
}

void uiMarkStatus() { dirtyStatus = true; if (sheetOn) dirtySheet = true; }
void uiActivity() { lastAct = millis(); }

bool uiWake() {
  lastAct = millis();
  if (!dimState) return false;
  dimState = 0;
  displaySetBacklight(brightness);
  return true;
}

void uiSetBrightness(int level) {
  brightness = constrain(level, 0, 255);
  Preferences p;
  p.begin("kp", false);
  p.putUChar("bright", brightness);
  p.end();
  if (!dimState) displaySetBacklight(brightness);
}
int uiBrightness() { return brightness; }

void uiSetDim(int seconds) {
  dimAfterS = constrain(seconds, 0, 3600);
  Preferences p;
  p.begin("kp", false);
  p.putUShort("dim", dimAfterS);
  p.end();
  uiWake();
}

static void releasePress() {
  if (pressed < 0) return;
  int c = pressed;
  pressed = -1;
  emitKey(c, '0');
  uiMarkCell(c);
}

void uiGesture(uint8_t kind, int x0, int y0, int x1, int y1) {
  if (pairOn) {
    if (kind == G_TAP && !(x1 >= TK_X && x1 < TK_X + TK_W && y1 >= TK_Y && y1 < TK_Y + TK_H)) blePairCancel();
    return;
  }
  if (sheetOn) {
    if (kind == G_TAP) sheetTap(x1, y1);
    else if (kind == G_SWIPE_D) uiCloseSheet();
    return;
  }
  switch (kind) {
    case G_DOWN: {
      int c = hitCell(x0, y0);
      if (c >= 0 && !keyAt(c).isNull()) {
        pressed = c;
        holdFired = false;
        emitKey(c, '1');
        uiMarkCell(c);
      }
      break;
    }
    case G_HOLD:
      if (pressed >= 0 && keyAt(pressed)["hold_actions"].size()) {
        holdFired = true;
        emitKey(pressed, 'H');
        macroEngine.start(keyAt(pressed), true, pressed);
      }
      break;
    case G_TAP: {   // a tap fires on release, inside the cell it started in
      int c = pressed;
      bool fire = c >= 0 && !holdFired && hitCell(x1, y1) == c;
      releasePress();
      if (fire) macroEngine.start(keyAt(c), false, c);
      else if (c < 0 && y0 < STATUS_H && x0 >= GEAR_X - 26) uiOpenSheet();
      else if (c < 0 && y0 >= DOTS_Y) dotTap(x0);
      break;
    }
    case G_SWIPE_L: releasePress(); if (currentPage + 1 < pageCount) uiGoPage(currentPage + 1, false); break;
    case G_SWIPE_R: releasePress(); if (currentPage > 0) uiGoPage(currentPage - 1, false); break;
    case G_SWIPE_U: releasePress(); uiOpenSheet(); break;
    case G_SWIPE_D: releasePress(); break;
  }
}

void uiGoPage(int idx, bool push) {
  if (idx < 0 || idx >= pageCount) return;
  int from = currentPage;
  if (!loadPage(idx)) { loadPage(from); return; }
  if (push && idx != from) {
    if (backDepth == (int)sizeof backStack) memmove(backStack, backStack + 1, --backDepth);
    backStack[backDepth++] = from;
  }
  pressed = -1;
  memset(flashUntil, 0, sizeof flashUntil);
  Serial.printf("EVT:PAGE %d\n", idx + 1);
  uiMarkAll();
}

void uiBack() { uiGoPage(backDepth ? backStack[--backDepth] : 0, false); }

void uiSetProfile(int n) {
  macroEngine.abort();
  backDepth = 0;
  pressed = -1;
  memset(flashUntil, 0, sizeof flashUntil);
  loadProfileSafe(n);
  if (!dimState) displaySetBacklight(profileBrightness >= 0 ? profileBrightness : brightness);
  uiMarkAll();
}

void uiFlash(int c, bool ok) {
  if (c < 0 || c >= NUM_CELLS) return;
  flashUntil[c] = (millis() + 900) | 1;
  if (ok) flashBad &= ~(1 << c); else flashBad |= 1 << c;
  uiMarkCell(c);
}

void uiSetTime(uint32_t epoch, int tz) {
  timeEpoch = epoch;
  timeBase = millis();
  tzMin = tz;
  lastMinute = -1;
  dirtyStatus = true;
}

void uiNowPlaying(JsonObjectConst o) {
  strlcpy(np.title, o["title"] | "", sizeof np.title);
  strlcpy(np.artist, o["artist"] | "", sizeof np.artist);
  strlcpy(np.app, o["app"] | "", sizeof np.app);
  np.pos = o["pos"] | 0;
  np.len = o["len"] | 0;
  np.playing = o["playing"] | false;
  np.at = millis();
  np.have = true;
  for (int i = 0; i < NUM_CELLS; i++) if (owner[i] == i) markOwned(i);
}

void uiPairShow(uint32_t key) {
  pairKey = key;
  pairOn = true;
  sheetOn = false;
  uiWake();
  dirtyPair = dirtyStatus = true;
}

void uiPairClose() {
  if (!pairOn) return;
  pairOn = false;
  uiMarkAll();
}

void uiOpenSheet() { if (!sheetOn) { sheetOn = true; dirtySheet = true; } }
void uiCloseSheet() { if (sheetOn) { sheetOn = false; uiMarkAll(); } }
bool uiSheetOpen() { return sheetOn; }

void uiTick() {
  uint32_t now = millis();

  // Backlight: dim, then off; the next touch only wakes it (uiWake).
  if (dimAfterS && !pairOn) {
    uint32_t idle = now - lastAct;
    if (dimState == 0 && idle > dimAfterS * 1000UL) { dimState = 1; displaySetBacklight(brightness * DIM_LEVEL_PCT / 100); }
    else if (dimState == 1 && idle > OFF_AFTER_MS) { dimState = 2; displaySetBacklight(0); }
  }

  if (timeEpoch) {
    struct tm t;
    localTime(&t);
    if (t.tm_min != lastMinute) { lastMinute = t.tm_min; dirtyStatus = true; }
  }
  if (dirtyStatus) { dirtyStatus = false; drawStatus(); return; }

  if (pairOn) {
    static uint32_t lastSec = 0;
    if (dirtyPair) { dirtyPair = false; drawPair(); lastSec = now / 1000; }
    else if (now / 1000 != lastSec) { lastSec = now / 1000; drawPairRing(); }
    return;
  }
  if (sheetOn) {
    if (dirtySheet) { dirtySheet = false; drawSheet(); }
    return;
  }

  for (int i = 0; i < NUM_CELLS; i++)
    if (flashUntil[i] && (long)(now - flashUntil[i]) >= 0) { flashUntil[i] = 0; uiMarkCell(i); }
  if (np.playing && now / 1000 != lastNpSec) {
    lastNpSec = now / 1000;
    for (int i = 0; i < NUM_CELLS; i++) if (owner[i] == i) markOwned(i);
  }

  if (dirtyCells) {   // one cell per pass: keeps the loop live and staggers the page reveal
    int c = __builtin_ctz(dirtyCells);
    dirtyCells &= ~(1 << c);
    drawCell(c);
    return;
  }
  if (dirtyDots) { dirtyDots = false; drawDots(); }
}

// ponytail: placeholder until the calibration screen lands with the new UI.
void uiCalibrate() {}
void uiCalibrateCancel() {}
bool uiCalibrating() { return false; }
