#pragma GCC optimize("O2")
#include "ui.h"
#include "gfx.h"
#include "themes.h"
#include "board.h"
#include "display.h"
#include "profiles.h"
#include "macro_engine.h"
#include "ble_hid.h"
#include "touch.h"
#include "leds.h"
#include "power.h"
#include "hid_maps.h"
#include <LittleFS.h>
#include <Preferences.h>
#include <NimBLEDevice.h>
#include <time.h>
#include <functional>

// ---------------------------------------------------------------- palette: the current theme's roles (themes.h)
static uint8_t themeIdx = THEME_DEFAULT;
static const Theme *T = &THEMES[THEME_DEFAULT];
static const C3 WHITE = HEXC(0xffffff), BLACK = HEXC(0x000000);
#define PLY (T->ply)
#define PLY2 (T->ply2)
#define WELL (T->well)
#define CTL (T->ctl)
#define CTL_TOP (T->ctlTop)
#define CTL_BOT (T->ctlBot)
#define TRACK (T->track)
#define HAIR (T->hair)
#define TXT (T->txt)
#define TXT2 (T->txt2)
#define TXT3 (T->txt3)
#define LBL (T->lbl)
#define CYAN (T->cyan)
#define MAG (T->mag)
#define GREEN (T->green)
#define AMBER (T->amber)
#define RED (T->red)
#define SLATE (T->slate)
#define CAL_BG (T->calBg)
#define DIMRET (T->dimRet)
#define TAG_BG (T->tagBg)
#define CARD (T->card)
#define SEGC (T->seg)
#define ON_INK (T->onAccent)
#define SW_OFF (T->swOff)
#define SEG_OFF (T->segOff)

#define KEY 66
#define KEY_R (T->keyR)
#define LINE_Y 300
#define POP_MS 120
#define POP_STEP 28
#define DIM_DEFAULT_S 120

static int cellX(int c) { return (c % GRID_COLS) * CELL_W; }
static int cellY(int c) { return STATUS_H + (c / GRID_COLS) * CELL_H; }
static float clamp01(float t) { return t < 0 ? 0 : t > 1 ? 1 : t; }
static float easeOut(float t) { t = clamp01(t); float u = 1 - t; return 1 - u * u * u; }
static float easeQuad(float t) { t = clamp01(t); return 1 - (1 - t) * (1 - t); }
static float easeBack(float t) { t = clamp01(t); float u = t - 1; return 1 + 2.70158f * u * u * u + 1.70158f * u * u; }
static bool inRect(int x, int y, int rx, int ry, int rw, int rh) { return x >= rx && x < rx + rw && y >= ry && y < ry + rh; }

// ---------------------------------------------------------------- state
enum Mode : uint8_t { M_HOME, M_SHEET, M_PAIR, M_CAL };
static Mode mode = M_HOME;
static const char *const MODE_NAMES[] = { "home", "sheet", "pair", "cal" };

struct CellAnim { uint32_t pop0, ring0; uint8_t ring; };   // ring: 0 none, 1 ok, 2 alert
static CellAnim ca[NUM_CELLS];
static int pressed = -1, released = -1;
static uint32_t press0 = 0, release0 = 0;
static float relScale = 1;
static bool holdFired = false;
static uint16_t toggles[MAX_PAGES];
static int8_t backStack[8];
static int backDepth = 0;

static int pressedBtn = -1;          // player control or sheet button under the finger
static int brightness = 200, dimAfterS = DIM_DEFAULT_S, dimState = 0;   // 0 lit, 1 dim, 2 off
static uint32_t lastAct = 0;
static uint32_t timeEpoch = 0, timeBase = 0;
static int litLevel() { return powerOnUsb() ? brightness : min(brightness, 160); }   // battery: about 60 % at most
static int tzMin = 0, lastMinute = -1;

static struct { char title[65], album[65], artist[65], app[33]; int pos, len; bool playing; uint32_t at; bool have; } np;
static uint16_t *art = nullptr;
static bool artOk = false;

static char toastText[48];
static uint32_t toast0 = 0;
static bool toastOn = false;
static uint32_t hud0 = 0;
static bool hudOn = false, hudMuted = false;
static int hudLevel = -1, hudDir = 1;   // dir: 1 up, -1 down

static uint8_t sheetTab = 0;
static uint32_t sheet0 = 0;
static bool sheetClosing = false;
static int sheetTopDrawn = SCR_H;
static int dragSlider = -1;          // 0 brightness, 1 LED brightness
static struct { char name[24]; int pages; uint8_t col[3]; bool ok; } slots[NUM_PROFILES];
// Readouts that are slow to fetch (LittleFS walks, NVS reads): taken when the sheet
// opens or changes, never inside a render.
static struct { size_t used, total; uint32_t heap; char mac[20]; int bonds; bool up[3]; char names[3][24]; } info;
static char hostName[24] = "";

static uint32_t pairKey = 0;
static uint32_t wipe0 = 0;           // keys <-> player, or a new theme: the new screen wipes in from the top
static bool wiping = false;
static int wipeDrawn = STATUS_H, wipeFrom = STATUS_H, wipeTo = LINE_Y, wipeMs = 220;

static int8_t calStep = -1;          // 0-3 corners, 4 verify, 5 test pad
static int calRaw[4][2];
static float calCand[6];
static int calErr = 0, calNote = 0;  // note: 0 none, 1 taps did not line up, 2 verify failed
static int16_t calDots[24][2];
static uint8_t calDotN = 0;
static const int16_t CAL_PT[4][2] = { { 36, 36 }, { 444, 36 }, { 444, 284 }, { 36, 284 } };
#define CAL_VX 240
#define CAL_VY 236

static struct { uint32_t frames, sumUs, maxUs, sumGap, gaps, lastAnim; } perf;

// ---------------------------------------------------------------- damage
struct Rect { int16_t x, y, w, h; };
static Rect dmg[24];
static uint8_t dmgN = 0;

static void mark(int x, int y, int w, int h) {
  if (x < 0) { w += x; x = 0; }
  if (y < 0) { h += y; y = 0; }
  if (x + w > SCR_W) w = SCR_W - x;
  if (y + h > SCR_H) h = SCR_H - y;
  if (w <= 0 || h <= 0) return;
  for (int i = 0; i < dmgN; i++) {
    Rect &r = dmg[i];
    if (x >= r.x && y >= r.y && x + w <= r.x + r.w && y + h <= r.y + r.h) return;
    if (r.x >= x && r.y >= y && r.x + r.w <= x + w && r.y + r.h <= y + h) { r = { (int16_t)x, (int16_t)y, (int16_t)w, (int16_t)h }; return; }
  }
  if (dmgN == 24) { dmgN = 1; dmg[0] = { 0, 0, SCR_W, SCR_H }; return; }
  dmg[dmgN++] = { (int16_t)x, (int16_t)y, (int16_t)w, (int16_t)h };
}
static void markCellRect(int c) { mark(cellX(c), cellY(c), CELL_W, CELL_H); }
static void markScreen() { dmgN = 1; dmg[0] = { 0, 0, SCR_W, SCR_H }; }

// ---------------------------------------------------------------- helpers
static JsonVariant keyAt(int c) { return pageDoc["keys"][c]; }
static bool playerPage() { JsonVariant k = keyAt(0); return !k.isNull() && k["widget"].is<const char *>(); }
static bool toggled(int c) { return currentPage < MAX_PAGES && ((toggles[currentPage] >> c) & 1); }
static C3 tintOf(JsonVariant k) { return { (uint8_t)(k["led_color"][0] | 138), (uint8_t)(k["led_color"][1] | 152), (uint8_t)(k["led_color"][2] | 171) }; }
static C3 lineC() {   // the profile's line colour, made to read on this theme's ground
  C3 c = { profileColor[0], profileColor[1], profileColor[2] };
  if (T->ks == KS_PIXEL) return T->txt2;   // four greens only
  for (int i = 0; T->light && i < 4 && ((c.r * 77 + c.g * 150 + c.b * 29) >> 8) > 140; i++) c = mix(c, BLACK, 50);
  return c;
}
static void emitKey(int c, char st) { Serial.printf("EVT:KEY %d %d %c\n", currentPage + 1, c + 1, st); }
static void emitMode() { Serial.printf("EVT:UI %s\n", MODE_NAMES[mode]); }
static int npPos() {
  int p = np.pos + (np.playing ? (int)((millis() - np.at) / 1000) : 0);
  return np.len > 0 && p > np.len ? np.len : p;
}
static void clockStr(char *b, int s) { if (s < 0) s = 0; sprintf(b, "%d:%02d", s / 60, s % 60); }

static int luma(C3 c) { return (c.r * 77 + c.g * 150 + c.b * 29) >> 8; }
static C3 inkOn(C3 fill) { return luma(fill) > 150 ? TXT : T->ks == KS_PIXEL ? T->g1 : WHITE; }   // readable ink on a filled shape
static C3 litHi() { return T->ks == KS_PIXEL ? T->g1 : WHITE; }                                   // "white" in this theme's palette
// The ground of theme th at row y, from its stops (themes need it before their table is live).
static C3 groundOf(const Theme &th, float y) {
  int t = constrain((int)(y * 255 / (SCR_H - 1)), 0, 255);
  return t < 128 ? mix(th.g0, th.g1, t * 2) : mix(th.g1, th.g2, (t - 128) * 2);
}

static Fill ctlFill() {
  Fill f = solidFill(CTL); f.top = CTL_TOP; f.bot = CTL_BOT; f.hi = WHITE; f.hiA = T->light ? 0 : 36;
  f.edge = HAIR; f.edgeA = T->light ? T->hairA : 38;
  return f;
}
static Fill pillFill() { Fill f = ctlFill(); if (!T->light) { f.top = mix(CTL_TOP, CTL, 100); f.hiA = 41; } return f; }
static Fill cardFill() {
  Fill f = solidFill(CARD); f.hi = WHITE; f.hiA = T->light ? 0 : 20;
  f.edge = HAIR; f.edgeA = T->light ? T->hairA : 20;
  return f;
}

static void button(int x, int y, int w, int h, const char *label, const char *icon, uint8_t kind, bool down, int alpha = 255) {
  // kind 0 normal, 1 primary (cyan), 2 quiet destructive
  Fill f = ctlFill();
  if (kind == 1) {
    if (T->ks == KS_GLASS) f = glassFill(CYAN, down ? 60 : 0);
    else { f = solidFill(down ? mix(CYAN, BLACK, 40) : CYAN); if (!T->crisp) f.top = mix(f.top, WHITE, 36); }
  }
  if (kind == 2) f = solidFill(PLY);
  if (down && kind == 0) {
    C3 to = T->light ? T->hair : WHITE;
    f.top = mix(f.top, to, T->light ? 26 : 30); f.bot = mix(f.bot, to, T->light ? 20 : 20);
    if (T->crisp) f = solidFill(T->track);
  }
  rrFill(x, y, w, h, T->crisp ? 4 : 12, f, alpha);
  if (kind == 2) rrRing(x + 0.5f, y + 0.5f, w - 1, h - 1, T->crisp ? 4 : 11.5f, T->crisp ? 2 : 1, T->crisp ? RED : mix(PLY, RED, 102), alpha);
  if (kind == 1 && T->crisp) rrRing(x + 1, y + 1, w - 2, h - 2, 3, 2, TXT, alpha);
  C3 ink = kind == 2 ? RED : kind == 1 ? (T->ks == KS_GLASS ? WHITE : inkOn(CYAN)) : TXT;
  int tw = textW(fBodyB, label), gw = icon ? 18 + 7 : 0, x0 = x + (w - tw - gw) / 2;
  if (icon) glyph(iconFind(icon, true), true, x0 + 9, y + h / 2, 18, ink, alpha);
  text(fBodyB, x0 + gw, y + h / 2 + 5, label, ink, alpha);
}

static void tag(int right, int top, const char *txt, C3 fill, bool stroke, C3 sc, C3 ink, int alpha) {
  int w = textW(fRead, txt) + 10, x = right - w;
  rrFill(x, top, w, 17, 6, solidFill(fill), alpha);
  if (stroke) rrRing(x + 0.5f, top + 0.5f, w - 1, 16, 5.5f, 1, sc, alpha);
  text(fRead, x + w / 2, top + 13, txt, ink, alpha, AL_C);
}

static void slider(int x, int y, int w, float f) {   // 44 px tall control, track centred
  int tx = x + 13, tw = w - 26, ty = y + 19;
  rrFill(tx, ty, tw, 6, 3, solidFill(TRACK));
  if (f > 0) rrFill(tx, ty, tw * f, 6, 3, solidFill(CYAN));
  float cx = tx + tw * f;
  softShadow(cx - 13, y + 9, 26, 26, 160);
  Fill th = solidFill(T->knob); th.bot = T->knobBot;
  if (T->light && luma(T->knob) > 200) { th.edge = HAIR; th.edgeA = 70; }
  rrFill(cx - 13, y + 9, 26, 26, 13, th);
}

// ---------------------------------------------------------------- key styles (themes.h)
// A key body in theme th's style: (x, y, w, h, r) is the box, tint its colour,
// pr the press (0..1, below 0 when not pressed), on an engaged toggle.
// Each style draws its own depth (drop, layer, lip or hard shadow).
static void keyBody(const Theme &th, float x, float y, float w, float h, float r, C3 tint, float pr, bool on, int A) {
  bool down = pr >= 0;
  float p = down ? pr : 0;
  switch (th.ks) {
    case KS_GLASS: {
      Fill f = glassFill(tint, down ? (int)(18 + p * 52) : 0);
      if (down) f.whiteEdge = (int)(p * 130);
      softShadow(x, y, w, h, down ? A / 2 : A);
      rrFill(x, y, w, h, r, f, A);
      break;
    }
    case KS_PAPER: {   // a card on a darker card: pressing slides it onto the one behind
      float o = max(2.0f, roundf(w * 0.05f)), d = down ? o * (0.55f + 0.45f * p) : 0;
      C3 card = mix(tint, th.g1, 46), back = mix(tint, th.txt, 125);
      // Only an o-wide strip of the card behind shows, right of and below the front card:
      // draw just those two (disjoint) strips, not the whole card under it.
      int clip[4];
      gfxClipGet(clip);
      gfxClipAnd((int)floorf(x + w - r), (int)floorf(y + o - 1), (int)ceilf(x + w + o + 1), (int)floorf(y + h - r));
      rrFill(x + o, y + o, w, h, r, solidFill(back), A);
      gfxClipSet(clip);
      gfxClipAnd((int)floorf(x + o - 1), (int)floorf(y + h - r), (int)ceilf(x + w + o + 1), (int)ceilf(y + h + o + 1));
      rrFill(x + o, y + o, w, h, r, solidFill(back), A);
      gfxClipSet(clip);
      Fill f = solidFill(card); f.top = mix(card, WHITE, 30);
      rrFill(x + d, y + d, w, h, r, f, A);
      rrRing(x + d + 0.5f, y + d + 0.5f, w - 1, h - 1, r - 0.5f, 1.4f, th.txt, A * 200 / 255);
      break;
    }
    case KS_FROST: {   // white tile; on fills it with the tint, a press tints it
      softShadow(x, y, w, h, down ? A / 2 : A);
      Fill f;
      if (on) { f = solidFill(tint); f.top = mix(tint, WHITE, 60); f.edge = mix(tint, BLACK, 70); f.edgeA = 150; }
      else { f = solidFill(HEXC(0xedf2f7)); f.top = WHITE; f.edge = th.wellEdge; f.edgeA = 230; }
      if (down) { f.top = mix(f.top, tint, (int)(26 + 50 * p)); f.bot = mix(f.bot, tint, (int)(36 + 60 * p)); }
      f.hiA = 0;   // one even border all round, as on iOS tiles
      rrFill(x, y, w, h, r, f, A);
      break;
    }
    case KS_PANE: {    // translucent over the sky, a luminous rim in the tint
      C3 g0 = groundOf(th, y), g1 = groundOf(th, y + h);
      Fill f = solidFill(g0);
      if (on) { f.top = mix(g0, tint, 200); f.bot = mix(g1, tint, 150); }
      else { int k = down ? (int)(70 + 60 * p) : 40; f.top = mix(g0, WHITE, k + 16); f.bot = mix(g1, WHITE, k - 16); }
      f.edge = mix(tint, WHITE, 100); f.edgeA = 235; f.hi = mix(tint, WHITE, 200); f.hiA = 235;
      f.whiteEdge = down ? (int)(p * 110) : 0;
      softShadow(x, y, w, h, A * 3 / 4);
      rrFill(x, y, w, h, r, f, A);
      break;
    }
    case KS_FLAT: {    // matte key on its darker side; a press sinks it; the tint is a dot
      float lip = max(2.0f, roundf(w * 0.045f)), sink = down ? lip * (0.55f + 0.45f * p) : 0;
      rrFill(x, y + lip, w, h, r, solidFill(HEXC(0xa39e95)), A);
      Fill f = solidFill(down ? HEXC(0xe0ded8) : HEXC(0xe8e6e1)); f.top = down ? HEXC(0xebe9e5) : HEXC(0xf7f6f3);
      f.edge = HEXC(0x99948b); f.edgeA = 255;
      rrFill(x, y + sink, w, h, r, f, A);
      if (r < w * 0.4f) {
        float dr = max(2.5f, w * 0.055f), dx = x + w * 0.19f, dy = y + sink + h * 0.19f;
        if (on) ringC(dx, dy, dr + 2.6f, 1.6f, tint, A);
        circle(dx, dy, dr, tint, A);
      }
      break;
    }
    case KS_PIXEL: {   // a box with a hard shadow; a press drops it into the shadow
      float o = max(2.0f, roundf(w * 0.045f)), d = down ? o : 0;
      x = roundf(x); y = roundf(y); w = roundf(w); h = roundf(h);
      rrFill(x + o, y + o, w, h, r, solidFill(th.txt2), A);
      rrFill(x + d, y + d, w, h, r, solidFill(on ? th.txt : down ? th.txt2 : th.track), A);
      rrRing(x + d + 1, y + d + 1, w - 2, h - 2, max(1.0f, r - 1), 2, th.txt, A);
      break;
    }
  }
}

// Glyph ink on a key, and whether the glyph gets a one-pixel drop.
static C3 keyInk(const Theme &th, C3 tint, bool down, bool on) {
  switch (th.ks) {
    case KS_PAPER: return luma(mix(tint, th.g1, 46)) > 165 ? th.txt : th.ink;
    case KS_FROST: {
      if (on) return luma(tint) > 175 ? th.txt : WHITE;
      C3 c = tint;
      for (int i = 0; i < 6 && luma(c) > 118; i++) c = mix(c, BLACK, 45);
      return c;
    }
    case KS_PANE: return on || down ? WHITE : mix(tint, WHITE, 130);
    case KS_FLAT: return th.ink;
    case KS_PIXEL: return on || down ? th.g1 : th.txt;
    default: return WHITE;
  }
}
static bool keyInkDrop(const Theme &th) { return th.ks == KS_GLASS || th.ks == KS_PANE; }
static float keySink(const Theme &th, float w, float pr) {   // how far the face moves down when pressed
  if (pr < 0) return 0;
  if (th.ks == KS_FLAT) return max(2.0f, roundf(w * 0.045f)) * (0.55f + 0.45f * pr);
  if (th.ks == KS_PAPER) return max(2.0f, roundf(w * 0.05f)) * (0.55f + 0.45f * pr);
  if (th.ks == KS_PIXEL) return max(2.0f, roundf(w * 0.045f));
  return 0;
}

static void keyWell(const Theme &th, float x, float y, float sz, float r, int A) {
  switch (th.ks) {
    case KS_GLASS: { Fill w = solidFill(th.well); w.hi = BLACK; w.hiA = 150; w.edge = th.wellEdge; w.edgeA = 120; rrFill(x, y, sz, sz, r, w, A); break; }
    case KS_PANE: {
      Fill w = solidFill(mix(groundOf(th, y + sz), WHITE, 14)); w.top = mix(groundOf(th, y), WHITE, 22);
      w.edge = th.wellEdge; w.edgeA = 120; rrFill(x, y, sz, sz, r, w, A);
      break;
    }
    case KS_PIXEL: rrRing(roundf(x) + 1, roundf(y) + 1, roundf(sz) - 2, roundf(sz) - 2, r, 2, th.track, A); break;
    default: {   // a recess: the upper band in the darker edge reads as its inner wall
      Fill w = solidFill(th.well); w.hi = th.wellEdge; w.hiA = 150; w.edge = th.wellEdge; w.edgeA = 70;
      rrFill(x, y, sz, sz, r, w, A);
    }
  }
}

// ---------------------------------------------------------------- keys
// Custom tile images, kept decoded for the last few keys drawn so an animation
// does not read flash every frame (a read also stalls the UART interrupt).
static struct { char crc[9]; uint16_t *img; uint32_t used; } tileCache[3];

static const uint16_t *tileImage(const char *crc) {
  int slot = 0;
  for (int i = 0; i < 3; i++) {
    if (tileCache[i].img && !strncmp(tileCache[i].crc, crc, 8)) { tileCache[i].used = millis(); return tileCache[i].img; }
    if (tileCache[i].used < tileCache[slot].used) slot = i;
  }
  char path[24];
  snprintf(path, sizeof path, "/t/%.8s.565", crc);
  if (!LittleFS.exists(path)) return nullptr;
  auto &t = tileCache[slot];
  if (!t.img) t.img = (uint16_t *)malloc(TILE_PX * TILE_PX * 2);
  File f = LittleFS.open(path, "r");
  bool ok = t.img && f && f.read((uint8_t *)t.img, TILE_PX * TILE_PX * 2) == TILE_PX * TILE_PX * 2;
  f.close();
  if (!ok) { t.crc[0] = 0; return nullptr; }
  strlcpy(t.crc, crc, sizeof t.crc);
  t.used = millis();
  return t.img;
}

static bool drawTile(const char *crc, float x, float y, float sz, int alpha) {
  const uint16_t *img = tileImage(crc);
  if (img) blitImage(img, TILE_PX, TILE_PX, x, y, sz, sz, KEY_R * sz / KEY, alpha);
  return img != nullptr;
}

static void eqBars(float cx, float cy, float s, C3 ink, C3 sh, bool drop, int alpha, uint32_t now) {
  static const float speed[4] = { 0.0063f, 0.0090f, 0.0070f, 0.0105f }, phase[4] = { 0, 1.7f, 3.1f, 4.4f };
  for (int i = 0; i < 4; i++) {
    float h = (0.2f + 0.8f * (0.5f + 0.5f * sinf(now * speed[i] + phase[i]))) * 30 * s;
    float x = cx - 18 * s + i * 10 * s, y = cy + 15 * s - h;
    if (drop) rrFill(x, y + 1, 6 * s, h, 3 * s, solidFill(sh), alpha * 110 / 255);
    rrFill(x, y, 6 * s, h, T->crisp ? 0 : 3 * s, solidFill(ink), alpha);
  }
}

static bool cellAnimating(int c, uint32_t now) {
  JsonVariant k = keyAt(c);
  if (k.isNull()) return false;
  const char *anim = k["anim"] | "";
  bool on = (k["toggle"] | false) && toggled(c);
  if (!strcmp(anim, "eq")) return np.playing;
  if (!strcmp(anim, "pulse")) return !on;
  return false;
}

static void drawCell(int c, uint32_t now) {
  int cx = cellX(c), cy = cellY(c);
  if (!gfxHits(cx, cy, CELL_W, CELL_H)) return;
  float a = 1, s = 1;
  if (ca[c].pop0) {
    float t = (int32_t)(now - ca[c].pop0) / (float)POP_MS;
    if (t < 0) return;   // its turn in the page wave has not come yet
    // Opaque after the first ~45 % (the scale carries the rest): translucent pixels take
    // the slow blend path, and a whole fading wave of them cost frames.
    if (t < 1) { float e = easeOut(t); a = clamp01(e * 2.2f); s = 0.82f + 0.18f * e; }
  }
  int A = (int)(a * 255);
  float kx = cx + 15, ky = cy + 4;
  JsonVariant k = keyAt(c);
  if (k.isNull()) {
    float sz = KEY * s, x = kx + (KEY - sz) / 2, y = ky + (KEY - sz) / 2;
    keyWell(*T, x, y, sz, KEY_R * s, A);
    return;
  }
  const Theme &th = *T;
  bool down = pressed == c;
  bool sinks = th.ks == KS_PAPER || th.ks == KS_FLAT || th.ks == KS_PIXEL;   // these press by moving, not shrinking
  float pr = down ? clamp01((now - press0) / 600.0f) : -1;
  if (!sinks) {
    if (down) s *= 0.94f - pr * 0.04f;
    else if (released == c && now - release0 < 260) s *= relScale + (1 - relScale) * easeBack((now - release0) / 260.0f);
  }
  C3 tint = th.ks == KS_PIXEL ? th.track : tintOf(k);
  bool on = (k["toggle"] | false) && toggled(c);
  float sz = KEY * s, x = kx + (KEY - sz) / 2, y = ky + (KEY - sz) / 2;
  float sink = keySink(th, sz, pr), mx = kx + KEY / 2 + (th.ks == KS_PAPER || th.ks == KS_PIXEL ? sink : 0), my = ky + KEY / 2 + sink;
  keyBody(th, x, y, sz, sz, KEY_R * s, tint, pr, on, A);
  if (on && (th.ks == KS_GLASS || th.ks == KS_PAPER || th.ks == KS_FLAT))
    rrRing(x + 1.5f + (th.ks == KS_PAPER ? sink : 0), y + 1.5f + sink, sz - 3, sz - 3, KEY_R * s - 1.5f, 2, GREEN, A);

  const char *anim = k["anim"] | "";
  C3 ink = keyInk(th, tint, down, on), sh = mix(tint, BLACK, 150);
  bool drop = keyInkDrop(th);
  if (!strcmp(anim, "eq") && np.playing) eqBars(mx, my, s, ink, sh, drop, A, now);
  else {
    if (!strcmp(anim, "pulse") && !on) {
      float t = (now % 1600) / 1600.0f;
      C3 pc = th.ks == KS_GLASS ? mix(tint, WHITE, 180) : ink;
      ringC(mx, my, (11 + 13 * easeOut(t)) * s, 2, pc, (int)(A * 0.9f * (1 - t)));
    }
    C3 gc = (!strcmp(anim, "rec") && on && (now / 600) % 2) ? (th.ks == KS_PIXEL ? th.track : RED) : ink;
    const char *icon = k["icon"] | "", *tile = k["tile"] | "";
    if (*icon && iconFind(icon, false)) {   // native size: no resampling per frame
      if (drop) glyphLit(icon, false, roundf(mx), roundf(my), 36, gc, sh, A);
      else glyph(iconFind(icon, false), false, roundf(mx), roundf(my), 36, gc, A);
    }
    else if (strlen(tile) == 8 && drawTile(tile, x, y + sink, sz, A)) {}
    else {
      const char *name = k["name"] | "";
      char ini[3] = { 0 };
      int n = 0;
      for (const char *p = name; *p && n < 2; p++)
        if ((p == name || p[-1] == ' ') && isalnum((uint8_t)*p)) ini[n++] = *p;
      text(fTitle, (int)mx, (int)(my + 7), ini, ink, A, AL_C);
    }
  }

  bool host = false;
  for (JsonVariant act : k["actions"].as<JsonArray>()) host |= !strcmp(act["type"] | "", "host");
  bool hasHold = k["hold_actions"].size() > 0, holding = down && hasHold && !holdFired;
  if (on) tag(cx + 87, cy, "ON", GREEN, false, GREEN, ON_INK, A);
  else if (host) tag(cx + 87, cy, "PC", TAG_BG, true, CYAN, CYAN, A);
  else if (hasHold && !holding) tag(cx + 87, cy, "HOLD", TAG_BG, true, mix(TAG_BG, HAIR, th.light ? 120 : 38), TXT2, A);

  if (th.ks == KS_FLAT) {   // OP-1 labels: small mono capitals
    char up[24];
    strlcpy(up, k["name"] | "", sizeof up);
    for (char *p = up; *p; p++) *p = toupper((uint8_t)*p);
    String lbl = ellipsize(fRead, up, 92);
    text(fRead, cx + 48, (int)(ky + KEY + 5 + fRead.asc), lbl.c_str(), LBL, A, AL_C);
  } else {
    String lbl = ellipsize(fLabel, k["name"] | "", 92);
    text(fLabel, cx + 48, (int)(ky + KEY + 5 + fLabel.asc), lbl.c_str(), LBL, A, AL_C);
  }

  if (ca[c].ring && now - ca[c].ring0 < 700) {
    float t = (now - ca[c].ring0) / 700.0f, sc = 0.9f + 0.18f * easeOut(t), rs = 72 * sc;
    int ra = t < 0.55f ? 255 : (int)(255 * (1 - (t - 0.55f) / 0.45f));
    rrRing(mx - rs / 2, my - rs / 2, rs, rs, 22 * sc, 2, ca[c].ring == 2 ? RED : GREEN, ra * A / 255);
  }
  if (holding) rrRing(kx - 3, ky - 3, 72, 72, 22, 3, CYAN, A, clamp01((now - press0) / (float)HOLD_MS));
}

// ---------------------------------------------------------------- status band and stations
// The power state at (cx, cy): a battery filled to its level (amber below 30 %, red below
// 15 %), with a bolt while USB charges it; the plug when USB runs it with no cell reading.
// Returns the width the level text took left of it, so the host label moves over.
static int drawBattery(int cx, int cy) {
  bool usb = powerOnUsb();
  int pct = powerBatteryPct();
  if (pct < 0) { glyph(iconFind("plug-zap", true), true, cx, cy, 18, usb ? GREEN : TXT3); return 0; }
  C3 ink = usb ? GREEN : pct <= 15 ? RED : pct <= 30 ? AMBER : TXT2;
  float x = cx - 12, y = cy - 6, w = 21, h = 12;
  rrRing(x + 0.5f, y + 0.5f, w - 1, h - 1, 3, T->crisp ? 2 : 1.3f, ink);
  fillRect((int)(x + w), cy - 2, 2, 5, ink);
  if (pct > 0) rrFill(x + 2.5f, y + 2.5f, max(1.0f, (w - 5) * pct / 100), h - 5, 1.2f, solidFill(ink));
  if (usb) {   // the bolt, knocked out of the fill, then drawn
    C3 g = gfxGroundAt(cy);
    seg(cx + 2, cy - 7, cx - 3, cy + 1, 3.2f, g); seg(cx - 3, cy + 1, cx + 3, cy - 1, 3.2f, g); seg(cx + 3, cy - 1, cx - 2, cy + 7, 3.2f, g);
    seg(cx + 2, cy - 7, cx - 3, cy + 1, 1.4f, ink); seg(cx - 3, cy + 1, cx + 3, cy - 1, 1.4f, ink); seg(cx + 3, cy - 1, cx - 2, cy + 7, 1.4f, ink);
    return 0;
  }
  char b[6];
  snprintf(b, sizeof b, "%d%%", pct);
  text(fRead, cx - 15, 19, b, ink, 255, AL_R);
  return textW(fRead, b) + 8;
}

static void drawStatus() {
  if (!gfxHits(0, 0, SCR_W, STATUS_H)) return;
  fillRect(0, 28, SCR_W, T->crisp ? 2 : 1, HAIR, T->hairA);
  int x = 12;
  if (timeEpoch) {
    time_t t = timeEpoch + tzMin * 60 + (millis() - timeBase) / 1000;
    struct tm tm;
    gmtime_r(&t, &tm);
    char b[8];
    sprintf(b, "%d:%02d", tm.tm_hour, tm.tm_min);
    text(fTitle, x, 21, b, TXT);
    x += textW(fTitle, b) + 12;
  }
  C3 line = lineC();
  ringC(x + 4, 14, 5, 2, line, 77);
  circle(x + 4, 14, 4, line);
  x += 14;
  String name = ellipsize(fBodyB, profileName, 150);
  text(fBodyB, x, 19, name.c_str(), TXT);
  x += textW(fBodyB, name.c_str()) + 6;
  char pg[12];
  sprintf(pg, "%d/%d", currentPage + 1, pageCount);
  text(fRead, x, 19, pg, TXT2);

  rrFill(454, 2, 24, 24, 12, ctlFill());
  glyph(iconFind("settings", true), true, 466, 14, 18, TXT);
  int right = 424 - drawBattery(440, 14);
  bool pairing = blePairing(), up = hidConnected();
  String host = pairing ? String("Pairing") : up ? String(hostName) : String("No host");
  host = ellipsize(fRead, host.c_str(), 120);
  C3 hc = pairing ? MAG : up ? GREEN : AMBER;
  int tw = textW(fRead, host.c_str());
  text(fRead, right - tw, 19, host.c_str(), hc);
  glyph(iconFind(pairing ? "bluetooth-searching" : up ? "bluetooth" : "bluetooth-off", true), true, right - tw - 12, 14, 18, hc);
  if (hidDry()) tag(right - tw - 26, 6, "DRY", RED, false, RED, inkOn(RED), 255);
}

static void drawStations() {
  if (pageCount < 2 || !gfxHits(0, LINE_Y, SCR_W, SCR_H - LINE_Y)) return;
  C3 line = lineC(), gnd = gfxGroundAt(310);
  int total = (pageCount - 1) * 30, x0 = 240 - total / 2;
  fillRect(x0, 309, total, 2, T->crisp ? line : mix(line, BLACK, 77));
  for (int i = 0; i < pageCount; i++) {
    int x = x0 + i * 30;
    if (i == currentPage) { circle(x, 310, 8, gnd); circle(x, 310, 6, line); circle(x, 310, 3, litHi()); }
    else { circle(x, 310, 4, gnd); ringC(x, 310, 3, 2, line); }
  }
}

// ---------------------------------------------------------------- media player
static const int16_t BTN_X[6] = { 40, 112, 188, 274, 360, 436 }, BTN_R[6] = { 28, 32, 32, 42, 32, 32 };
static const char *const BTN_ICON[6] = { "volume-x", "volume-1", "skip-back", "", "skip-forward", "volume-2" };
static const char *const BTN_MEDIA[6] = { "MUTE", "VOLUME_DOWN", "PREVIOUS", "PLAY_PAUSE", "NEXT", "VOLUME_UP" };
#define BTN_Y 248
#define SEEK_X 160
#define SEEK_W 304

static void drawPlayer(uint32_t now) {
  if (!gfxHits(0, STATUS_H, SCR_W, LINE_Y - STATUS_H)) return;
  // art
  if (gfxHits(10, 40, 140, 142)) {
    float ar = T->crisp ? 4 : T->keyR < 12 ? 10 : 16;
    if (artOk) {
      softShadow(16, 44, 128, 128, 255);
      blitImage(art, 128, 128, 16, 44, 128, 128, ar);
      if (T->light) rrRing(16.5f, 44.5f, 127, 127, ar - 0.5f, T->crisp ? 2 : 1, HAIR, T->hairA);
    } else {
      keyBody(*T, 16, 44, 128, 128, ar, T->art, -1, false, 255);
      C3 ink = keyInk(*T, T->art, false, false);
      if (keyInkDrop(*T)) glyphLit("music", false, 80, 108, 36, ink, mix(T->art, BLACK, 150));
      else glyph(iconFind("music", false), false, 80, 108, 36, ink);
    }
    if (!T->light) rrRing(16.5f, 44.5f, 127, 127, ar - 0.5f, 1, WHITE, 40);
  }
  // title (up to two lines), album, artist + source
  int base = 66;
  const char *title = np.have && np.title[0] ? np.title : "Nothing playing";
  String t = title;
  if (textW(fHead, title) > SEEK_W) {
    int cut = -1;
    for (int i = 0; title[i]; i++) if (title[i] == ' ') { String h = t.substring(0, i); if (textW(fHead, h.c_str()) <= SEEK_W) cut = i; else break; }
    if (cut > 0) {
      text(fHead, SEEK_X, base, t.substring(0, cut).c_str(), TXT);
      base += 28;
      t = ellipsize(fHead, t.substring(cut + 1).c_str(), SEEK_W);
    } else t = ellipsize(fHead, title, SEEK_W);
  }
  text(fHead, SEEK_X, base, t.c_str(), TXT);
  base += 24;
  if (np.have && np.album[0]) { text(fBody, SEEK_X, base, ellipsize(fBody, np.album, SEEK_W).c_str(), TXT); base += 22; }
  const char *artist = np.have ? np.artist : "Studio sends the track here";
  String ar = ellipsize(fBody, artist, 150);
  text(fBody, SEEK_X, base, ar.c_str(), TXT2);
  int x = SEEK_X + textW(fBody, ar.c_str()) + 10;
  if (np.have && np.app[0]) {
    bool spotify = strcasestr(np.app, "spotify") != nullptr;
    if (spotify) { glyph(iconFind("spotify", false), false, x + 7, base - 5, 14, GREEN); x += 18; }
    text(fBody, x, base, np.app, GREEN);
    x += textW(fBody, np.app) + 8;
    if (np.playing) for (int i = 0; i < 3; i++) {
      float h = 4 + 8 * (0.5f + 0.5f * sinf(now * (0.008f + i * 0.003f) + i * 2));
      fillRect(x + i * 5, base - (int)h, 3, (int)h, GREEN);
    }
  }
  // seek
  float p = np.len > 0 ? clamp01(npPos() / (float)np.len) : 0;
  rrFill(SEEK_X, 153, SEEK_W, 6, 3, solidFill(TRACK));
  if (p > 0) { Fill fl = solidFill(CYAN); if (!T->crisp) fl.top = mix(CYAN, BLACK, 100); rrFill(SEEK_X, 153, SEEK_W * p, 6, 3, fl); }
  softShadow(SEEK_X + SEEK_W * p - 7, 149, 14, 14, 200);
  circle(SEEK_X + SEEK_W * p, 156, 7, T->knob);
  if (T->light && luma(T->knob) > 200) ringC(SEEK_X + SEEK_W * p, 156, 7, 1, HAIR, 80);
  char a[12], b[13];
  clockStr(a, npPos());
  b[0] = 0;
  clockStr(b + 3, np.len - npPos());
  memcpy(b, "\xe2\x88\x92", 3);   // U+2212 minus
  text(fLabel, SEEK_X, 190, a, TXT2);
  text(fLabel, SEEK_X + SEEK_W, 190, b, TXT2, 255, AL_R);
  // controls
  for (int i = 0; i < 6; i++) {
    bool dn = pressedBtn == i;
    float r = BTN_R[i] * (dn && T->ks != KS_PAPER && T->ks != KS_FLAT && T->ks != KS_PIXEL ? 0.92f : 1);
    C3 t = i == 3 ? CYAN : SLATE;
    const char *ic = i == 3 ? (np.playing ? "pause" : "play") : BTN_ICON[i];
    float gs = i == 3 ? 36 : i == 0 ? 24 : 28, bx = BTN_X[i] - r, by = BTN_Y - r;
    if (T->ks == KS_GLASS) {   // the original: slate controls darker than keys, the play key lit
      softShadow(bx, by, 2 * r, 2 * r, 255);
      Fill f = glassFill(t, dn ? 50 : 0);
      if (i != 3) { f.top = mix(HEXC(0x10161d), t, 102); f.bot = mix(HEXC(0x070a0e), t, 36); }
      rrFill(bx, by, 2 * r, 2 * r, r, f);
      glyphLit(ic, false, BTN_X[i], BTN_Y, gs, WHITE, mix(t, BLACK, 150));
      continue;
    }
    bool fill = i == 3 && T->ks != KS_FLAT;   // the play key is the filled one
    float pr = dn ? 0.6f : -1, sink = keySink(*T, 2 * r, pr);
    keyBody(*T, bx, by, 2 * r, 2 * r, r, T->ks == KS_PIXEL ? T->track : t, pr, fill, 255);
    C3 ink = i == 3 && T->ks == KS_FLAT ? MAG : keyInk(*T, t, dn, fill);
    float gx = BTN_X[i] + (T->ks == KS_PAPER || T->ks == KS_PIXEL ? sink : 0), gy = BTN_Y + sink;
    if (keyInkDrop(*T)) glyphLit(ic, false, gx, gy, gs, ink, mix(t, BLACK, 150));
    else glyph(iconFind(ic, false), false, gx, gy, gs, ink);
  }
}

// ---------------------------------------------------------------- settings sheet
static const char *const TAB_NAME[5] = { "Display", "Profiles", "Bluetooth", "LED", "Device" };
static const char *const TAB_ICON[5] = { "sun", "layers", "bluetooth", "lightbulb", "cpu" };
static const int DIM_OPTS[5] = { 30, 60, 120, 300, 0 };
static const char *const DIM_TXT[5] = { "30 s", "1 min", "2 min", "5 min", "Never" };
static const C3 SWATCH[8] = { HEXC(0x4f8cff), HEXC(0x3fc6e0), HEXC(0x52d68f), HEXC(0xf2b746), HEXC(0xff8a3d), HEXC(0xff5f57), HEXC(0xff6fae), HEXC(0x9b7bff) };
#define PANE_X 128
#define PANE_W 338

static void refreshInfo() {
  info.used = LittleFS.usedBytes();
  info.total = LittleFS.totalBytes();
  info.heap = ESP.getFreeHeap();
  strlcpy(info.mac, NimBLEDevice::getAddress().toString().c_str(), sizeof info.mac);
  info.bonds = min(bleBondCount(), 3);
  for (int i = 0; i < info.bonds; i++) { info.up[i] = bleHostUp(i); strlcpy(info.names[i], bleHostName(i).c_str(), sizeof info.names[i]); }
}

static void loadSlots() {
  for (int i = 0; i < NUM_PROFILES; i++) slots[i].ok = profileMeta(i + 1, slots[i].name, sizeof slots[i].name, &slots[i].pages, slots[i].col);
  refreshInfo();
}

static void seg5(int y, int cur, const char *const *labels) {
  float w = (PANE_W - 16) / 5.0f;
  for (int i = 0; i < 5; i++) {
    float x = PANE_X + i * (w + 4);
    bool on = i == cur;
    rrFill(x, y, w, 44, T->crisp ? 4 : 11, solidFill(on ? (T->crisp ? TXT : mix(PLY, MAG, T->light ? 30 : 36)) : SEGC));
    rrRing(x + 0.5f, y + 0.5f, w - 1, 43, T->crisp ? 4 : 10.5f, T->crisp ? 2 : 1, on ? MAG : mix(SEGC, HAIR, T->light ? T->hairA : 20));
    text(fBodyB, (int)(x + w / 2), y + 27, labels[i], on ? (T->crisp ? T->g1 : MAG) : TXT2, 255, AL_C);
  }
}

// Settings → Display: one chip per theme, each a small live sample of that theme.
#define THEME_Y 254
#define THEME_H 36
static void themeChips() {
  float w = (PANE_W - (THEME_COUNT - 1) * 6) / (float)THEME_COUNT;
  for (int i = 0; i < THEME_COUNT; i++) {
    const Theme &th = THEMES[i];
    float x = PANE_X + i * (w + 6);
    bool cur = i == themeIdx;
    Fill g = solidFill(th.g1); g.top = th.g0; g.bot = th.g2;
    g.edge = th.light ? th.hair : WHITE; g.edgeA = th.light ? 50 : 30;
    rrFill(x, THEME_Y, w, THEME_H, T->crisp ? 4 : 10, g);
    float ks = 24, kx = x + (w - ks) / 2 - 1, ky = THEME_Y + 5;
    keyBody(th, kx, ky, ks, ks, th.keyR * ks / KEY, th.ks == KS_PIXEL ? th.track : HEXC(0x4f8cff), -1, false, 255);
    if (cur) rrRing(x - 2, THEME_Y - 2, w + 4, THEME_H + 4, T->crisp ? 5 : 12, 2, MAG);
    text(fLabel, (int)(x + w / 2), THEME_Y + THEME_H + 15, th.title, cur ? MAG : TXT2, 255, AL_C);
  }
}

static void drawPane() {
  char v[48];
  switch (sheetTab) {
    case 0: {
      sprintf(v, "%d%%", (brightness * 100 + 127) / 255);
      text(fBody, PANE_X, 106, "Brightness", TXT);
      text(fRead, PANE_X + PANE_W, 106, v, TXT2, 255, AL_R);
      slider(PANE_X, 110, PANE_W, brightness / 255.0f);
      text(fBody, PANE_X, 174, "Dim after", TXT);
      text(fRead, PANE_X + PANE_W, 174, "then off at 10 min", TXT2, 255, AL_R);
      int cur = 4;
      for (int i = 0; i < 5; i++) if (DIM_OPTS[i] == dimAfterS) cur = i;
      seg5(182, cur, DIM_TXT);
      text(fBody, PANE_X, 246, "Theme", TXT);
      themeChips();
      break;
    }
    case 1: {
      float w = (PANE_W - 24) / 4.0f;
      for (int i = 0; i < NUM_PROFILES; i++) {
        float x = PANE_X + (i % 4) * (w + 8);
        int y = 92 + (i / 4) * 108;
        bool cur = i + 1 == currentProfile;
        if (slots[i].ok) {
          rrFill(x, y, w, 100, T->crisp ? 4 : 12, cardFill());
          rrFill(x + 10, y + 10, 22, 4, 2, solidFill(T->crisp ? TXT2 : C3{ slots[i].col[0], slots[i].col[1], slots[i].col[2] }));
          text(fBodyB, (int)x + 10, y + 38, ellipsize(fBodyB, slots[i].name, (int)w - 16).c_str(), TXT);
          sprintf(v, "%d page%s", slots[i].pages, slots[i].pages == 1 ? "" : "s");
          text(fRead, (int)x + 10, y + 56, cur ? "Active" : v, cur ? MAG : TXT2);
        } else {
          rrRing(x + 0.5f, y + 0.5f, w - 1, 99, 11.5f, 1, mix(PLY, HAIR, 20));
          sprintf(v, "Slot %d", i + 1);
          text(fBodyB, (int)x + 10, y + 38, v, TXT3);
          text(fRead, (int)x + 10, y + 56, "Empty", TXT3);
        }
        if (cur) rrRing(x + 1, y + 1, w - 2, 98, 11, 2, MAG);
      }
      break;
    }
    case 2: {
      for (int i = 0; i < 3; i++) {
        int y = 92 + i * 58;
        if (i < info.bonds) {
          bool up = info.up[i];
          rrFill(PANE_X, y, PANE_W, 52, T->crisp ? 4 : 12, cardFill());
          glyph(iconFind("bluetooth", true), true, PANE_X + 22, y + 26, 20, TXT);
          text(fBodyB, PANE_X + 42, y + 22, ellipsize(fBodyB, info.names[i], 140).c_str(), TXT);
          text(fRead, PANE_X + 42, y + 40, up ? "Connected" : "Saved", up ? GREEN : TXT2);
          button(PANE_X + PANE_W - 86, y + 6, 80, 40, "Forget", nullptr, 2, pressedBtn == 20 + i);
          if (!up) button(PANE_X + PANE_W - 156, y + 6, 62, 40, "Use", nullptr, 0, pressedBtn == 10 + i);
        } else {
          rrRing(PANE_X + 0.5f, y + 0.5f, PANE_W - 1, 51, 11.5f, 1, mix(PLY, HAIR, 20));
          glyph(iconFind("bluetooth-off", true), true, PANE_X + 22, y + 26, 20, TXT3);
          text(fBodyB, PANE_X + 42, y + 31, "Empty slot", TXT3);
        }
      }
      button(PANE_X, 266, PANE_W, 44, "Pair new host", "link", 1, pressedBtn == 30);
      break;
    }
    case 3: {
      float w = (PANE_W - 24) / 5.0f;
      static const char *const PAT[5] = { "Rainbow", "Breathe", "Solid", "Status", "Off" };
      uint8_t col[3];
      ledsGetColor(col);
      C3 lc = { col[0], col[1], col[2] };
      for (int i = 0; i < 5; i++) {
        float x = PANE_X + i * (w + 6), cx = x + w / 2;
        bool cur = ledsPattern() == i;
        rrFill(x, 92, w, 76, T->crisp ? 4 : 12, cardFill());
        if (cur) rrRing(x + 1, 93, w - 2, 74, 11, 2, MAG);
        if (i == 0) {
          static const C3 RB[6] = { HEXC(0xff5f57), HEXC(0xf2b746), HEXC(0x52d68f), HEXC(0x4cc9ea), HEXC(0x9b7bff), HEXC(0xff6fae) };
          for (int k = 5; k >= 0; k--) rrRing(cx - 7, 115, 14, 14, 7, 14, RB[k], 255, (k + 1) / 6.0f);
        } else if (i == 1) { circle(cx, 122, 14, mix(T->light ? CARD : HEXC(0x2a2149), lc, 120)); circle(cx, 122, 9, lc); }
        else if (i == 2) circle(cx, 122, 14, lc);
        else if (i == 3) { circle(cx, 122, 14, T->light ? SEG_OFF : HEXC(0x0b1a20)); circle(cx, 122, 5, CYAN); }
        else circle(cx, 122, 14, SEG_OFF);
        text(fBodyB, (int)cx, 158, PAT[i], cur ? MAG : TXT2, 255, AL_C);
      }
      sprintf(v, "%d%%", (ledsBrightness() * 100 + 127) / 255);
      text(fBody, PANE_X, 192, "LED brightness", TXT);
      text(fRead, PANE_X + PANE_W, 192, v, TXT2, 255, AL_R);
      slider(PANE_X, 196, PANE_W, ledsBrightness() / 255.0f);
      if (ledsPattern() == LED_SOLID || ledsPattern() == LED_BREATHE)
        for (int i = 0; i < 8; i++) {
          float cx = PANE_X + 15 + i * 40;
          bool sel = SWATCH[i].r == col[0] && SWATCH[i].g == col[1] && SWATCH[i].b == col[2];
          if (sel) ringC(cx, 263, 18, 2, TXT);
          circle(cx, 263, 15, SWATCH[i]);
        }
      break;
    }
    default: {
      text(fBody, PANE_X, 119, "Key click", TXT);
      bool on = feedbackClickOn();
      rrFill(414, 99, 52, 30, 15, solidFill(on ? (T->light ? GREEN : mix(HEXC(0x0a0f13), GREEN, 178)) : SW_OFF));
      softShadow(on ? 439 : 417, 102, 24, 24, 160);
      Fill knob = solidFill(T->knob); knob.bot = T->knobBot;
      if (on && T->crisp) knob = solidFill(T->g1);
      rrFill(on ? 439 : 417, 102, 24, 24, 12, knob);
      text(fBody, PANE_X, 167, "Touch calibration", TXT);
      button(PANE_X + PANE_W - 130, 140, 130, 44, "Calibrate", "crosshair", 0, pressedBtn == 40);
      size_t used = info.used, total = info.total;
      const char *dt[5] = { "Firmware", "Free memory", "Storage", "Bluetooth", "Power" };
      char dd[5][40];
      snprintf(dd[0], 40, "%s", FW_VERSION);
      snprintf(dd[1], 40, "%u KB", (unsigned)(info.heap / 1024));
      snprintf(dd[2], 40, "%.1f of %.1f MB", used / 1048576.0f, total / 1048576.0f);
      snprintf(dd[3], 40, "%s", info.mac);
      int pct = powerBatteryPct();
      if (powerOnUsb()) snprintf(dd[4], 40, pct < 0 ? "USB" : pct < 100 ? "USB, charging (%d%%)" : "USB, battery full", pct);
      else snprintf(dd[4], 40, "Battery %d%%", pct);
      for (int i = 0; i < 5; i++) {
        text(fBody, PANE_X, 212 + i * 23, dt[i], TXT2);
        text(fBody, PANE_X + 130, 212 + i * 23, dd[i], TXT);
      }
    }
  }
}

static int sheetTop(uint32_t now) {
  float t = clamp01((now - sheet0) / 260.0f), e = easeQuad(t);
  if (sheetClosing) e = 1 - e;
  if (mode != M_SHEET) return SCR_H;
  return SCR_H - (int)((SCR_H - STATUS_H) * e);
}

static void drawSheet(int top) {
  if (top >= SCR_H || !gfxHits(0, top, SCR_W, SCR_H - top)) return;
  gfxClip(0, top, SCR_W, SCR_H);
  Fill f = solidFill(PLY); f.top = PLY; f.bot = PLY2; f.hi = WHITE; f.hiA = T->light ? 0 : 33;
  if (T->light) { f.edge = HAIR; f.edgeA = T->hairA; }
  rrFill(0, STATUS_H, SCR_W, SCR_H - STATUS_H + 20, T->crisp ? 4 : 16, f);
  if (T->crisp) fillRect(0, STATUS_H, SCR_W, 2, TXT);
  for (int i = 0; i < 5; i++) {
    int ty = 40 + i * 52;
    bool cur = i == sheetTab;
    C3 ti = cur ? (T->crisp ? T->g1 : MAG) : TXT2;
    if (cur) rrFill(8, ty, 108, 48, T->crisp ? 4 : 12, solidFill(T->crisp ? TXT : mix(PLY, MAG, T->light ? 34 : 41)));
    glyph(iconFind(TAB_ICON[i], true), true, 28, ty + 24, 20, ti);
    text(fBodyB, 47, ty + 29, TAB_NAME[i], ti);
  }
  text(fTitle, PANE_X, 71, sheetTab == 3 ? "Status LED" : TAB_NAME[sheetTab], TXT);
  button(390, 42, 76, 44, "Done", nullptr, 0, pressedBtn == 1);
  drawPane();
  gfxUnclip();
}

// ---------------------------------------------------------------- pairing, calibration
static void drawPair() {
  if (!gfxHits(0, STATUS_H, SCR_W, SCR_H - STATUS_H)) return;
  text(fTitle, 240, 68, "Pair a host", TXT, 255, AL_C);
  text(fBody, 240, 96, "On your computer open Bluetooth, add a device,", TXT2, 255, AL_C);
  text(fBody, 240, 118, "choose Touch Keypad, then type this code.", TXT2, 255, AL_C);
  char a[4], b[4];
  snprintf(a, 4, "%03lu", (unsigned long)(pairKey / 1000));
  snprintf(b, 4, "%03lu", (unsigned long)(pairKey % 1000));
  int wa = textW(fDigits, a), wb = textW(fDigits, b), x = 240 - (wa + 18 + wb) / 2;
  text(fDigits, x, 188, a, TXT);
  text(fDigits, x + wa + 18, 188, b, TXT);
  uint32_t left = blePairLeftMs();
  rrFill(150, 210, 220, 4, 2, solidFill(TRACK));
  rrFill(150, 210, 220.0f * left / PAIR_WINDOW_MS, 4, 2, solidFill(MAG));
  char s[8];
  clockStr(s, (left + 999) / 1000);
  text(fBody, 382, 216, s, MAG);
  button(198, 262, 84, 44, "Cancel", nullptr, 0, pressedBtn == 2);
}

static void reticle(int cx, int cy, C3 c) {
  ringC(cx, cy, 14, 2, c);
  fillRect(cx - 1, cy - 26, 2, 8, c);
  fillRect(cx - 1, cy + 18, 2, 8, c);
  fillRect(cx - 26, cy - 1, 8, 2, c);
  fillRect(cx + 18, cy - 1, 8, 2, c);
  circle(cx, cy, 2.5f, c);
}
static void checkMark(int cx, int cy, C3 c) {
  ringC(cx, cy, 14, 2.4f, c);
  seg(cx - 6, cy, cx - 2, cy + 4, 2.4f, c);
  seg(cx - 2, cy + 4, cx + 6, cy - 4, 2.4f, c);
}

static void drawCal() {
  if (calStep == 5) {
    char t[40];
    snprintf(t, sizeof t, "Calibrated, off by %d px", calErr);
    int w = textW(fTitle, t) + 26, x = 240 - w / 2;
    glyph(iconFind("check", true), true, x + 10, 57, 20, GREEN);
    text(fTitle, x + 26, 64, t, GREEN);
    text(fBody, 240, 92, "Tap anywhere: each dot is where", TXT2, 255, AL_C);
    text(fBody, 240, 114, "the screen feels you.", TXT2, 255, AL_C);
    for (int i = 0; i < calDotN; i++) circle(calDots[i][0], calDots[i][1], 4, CYAN);
    button(132, 262, 104, 44, "Redo", "rotate-ccw", 0, pressedBtn == 50);
    button(248, 262, 100, 44, "Done", "check", 1, pressedBtn == 51);
    return;
  }
  for (int i = 0; i < 4; i++) {
    if (i < calStep) checkMark(CAL_PT[i][0], CAL_PT[i][1], GREEN);
    else reticle(CAL_PT[i][0], CAL_PT[i][1], i == calStep ? CYAN : DIMRET);
  }
  if (calStep == 4) reticle(CAL_VX, CAL_VY, CYAN);
  text(fTitle, 240, 116, "Touch calibration", TXT, 255, AL_C);
  if (calNote == 1) {
    text(fBody, 240, 142, "Those taps did not line up.", AMBER, 255, AL_C);
    text(fBody, 240, 164, "Once more, a little slower.", AMBER, 255, AL_C);
  } else if (calNote == 2) {
    text(fBody, 240, 142, "That check missed the centre.", AMBER, 255, AL_C);
    text(fBody, 240, 164, "Let us run the corners again.", AMBER, 255, AL_C);
  } else if (calStep == 4) {
    text(fBody, 240, 142, "Now tap the centre target", TXT2, 255, AL_C);
    text(fBody, 240, 164, "to check the fit.", TXT2, 255, AL_C);
  } else {
    text(fBody, 240, 142, "Press and hold the lit target", TXT2, 255, AL_C);
    text(fBody, 240, 164, "until it turns green.", TXT2, 255, AL_C);
  }
  char s[12];
  if (calStep < 4) snprintf(s, sizeof s, "%d of 4", calStep + 1); else strcpy(s, "Check");
  text(fRead, 240, 190, s, CYAN, 255, AL_C);
}

// ---------------------------------------------------------------- overlays
static void toastRect(int *x, int *y, int *w, int *h) {
  *w = textW(fBodyB, toastText) + 44;
  *x = 240 - *w / 2; *y = 36; *h = 40;
}
static float toastProg(uint32_t now) {
  uint32_t t = now - toast0;
  if (t < 160) return easeOut(t / 160.0f);
  if (t < 1960) return 1;
  if (t < 2120) return 1 - easeOut((t - 1960) / 160.0f);
  return 0;
}
static void drawToast(uint32_t now) {
  if (!toastOn) return;
  int x, y, w, h;
  toastRect(&x, &y, &w, &h);
  float p = toastProg(now);
  if (p <= 0 || !gfxHits(x - 4, y, w + 8, h + 14)) return;
  gfxClip(0, 0, SCR_W, y + (int)((h + 14) * p));
  softShadow(x, y, w, h, 220);
  rrFill(x, y, w, h, 20, pillFill());
  circle(x + 18, y + 20, 5, lineC());
  text(fBodyB, x + 30, y + 25, toastText, TXT);
  gfxUnclip();
}

#define HUD_X 110
#define HUD_Y 122
#define HUD_W 260
#define HUD_H 76
static float hudAlpha(uint32_t now) {
  uint32_t t = now - hud0;
  if (t < 120) return easeOut(t / 120.0f);
  if (t < 1420) return 1;
  if (t < 1580) return 1 - (t - 1420) / 160.0f;
  return 0;
}
static void drawHud(uint32_t now) {
  if (!hudOn || !gfxHits(HUD_X - 4, HUD_Y, HUD_W + 8, HUD_H + 14)) return;
  float a = hudAlpha(now);
  if (a <= 0) return;
  int A = (int)(a * 255);
  float s = 0.9f + 0.1f * a, w = HUD_W * s, h = HUD_H * s, x = 240 - w / 2, y = 160 - h / 2;
  softShadow(x, y, w, h, A);
  rrFill(x, y, w, h, 22 * s, pillFill(), A);
  bool muted = hudMuted;
  glyph(iconFind(muted ? "volume-x" : hudDir < 0 ? "volume-1" : "volume-2", true), true, x + 31 * s, 160, 26 * s, TXT, A);
  if (hudLevel >= 0) {
    float sx = x + 56 * s, sw = 148 * s, segW = (sw - 45 * s) / 16;
    int lit = muted ? 0 : (hudLevel * 16 + 50) / 100;
    for (int i = 0; i < 16; i++) {
      C3 on = T->light ? TXT : WHITE;
      Fill f = solidFill(i < lit ? on : SEG_OFF);
      if (i < lit && !T->light) f.bot = HEXC(0xcfd9e2);
      rrFill(sx + i * (segW + 3 * s), 152, segW, 16 * s, 2, f, A);
    }
    char n[8];
    snprintf(n, sizeof n, "%d", muted ? 0 : hudLevel);
    text(fTitle, (int)(x + w - 18 * s), 167, n, TXT, A, AL_R);
  } else {
    text(fBodyB, (int)(x + 56 * s), 166, muted ? "Mute" : hudDir < 0 ? "Volume down" : "Volume up", TXT, A);
  }
}

// ---------------------------------------------------------------- frame
static void renderChunk(uint32_t now) {
  if (mode == M_CAL) { gfxFill(CAL_BG); drawCal(); return; }
  gfxGround();
  drawStatus();
  int top = sheetTop(now);
  bool sheetCovers = mode == M_SHEET && top <= STATUS_H;
  if (mode == M_PAIR) drawPair();
  else if (!sheetCovers) {
    gfxClip(0, 0, SCR_W, min(SCR_H, top + 18));   // nothing under the opaque sheet (its corners are 16 px)
    if (playerPage()) drawPlayer(now);
    else for (int c = 0; c < NUM_CELLS; c++) drawCell(c, now);
    drawStations();
    gfxUnclip();
  }
  drawSheet(top);
  drawToast(now);
  drawHud(now);
}

static uint16_t chunkBuf[2][CELL_W * CELL_H];

static void renderDamage(uint32_t now) {
  int bi = 0;
  lcd.startWrite();
  for (int i = 0; i < dmgN; i++) {
    Rect r = dmg[i];
    int rows = max(1, (CELL_W * CELL_H) / r.w);
    for (int y = r.y; y < r.y + r.h; y += rows) {
      int h = min(rows, r.y + r.h - y);
      gfxChunk(chunkBuf[bi], r.x, y, r.w, h);
      renderChunk(now);
      lcd.waitDMA();
      lcd.pushImageDMA(r.x, y, r.w, h, (const lgfx::swap565_t *)chunkBuf[bi]);
      bi ^= 1;
    }
  }
  lcd.waitDMA();
  lcd.endWrite();
  dmgN = 0;
}

// Marks what moves this frame; true when something animates every frame.
static bool animate(uint32_t now) {
  bool live = false;
  if (mode == M_HOME && !playerPage()) {
    for (int c = 0; c < NUM_CELLS; c++) {
      bool m = false;
      if (ca[c].pop0) {
        int32_t t = now - ca[c].pop0;
        if (t >= 0) { m = true; if (t > POP_MS + 20) ca[c].pop0 = 0; }
        live = true;
      }
      if (ca[c].ring) { if (now - ca[c].ring0 < 720) m = true; else { ca[c].ring = 0; m = true; } }
      if (pressed == c && now - press0 < 640) m = true;
      if (released == c) { if (now - release0 < 280) m = true; else released = -1; }
      if (cellAnimating(c, now)) m = true;
      JsonVariant k = keyAt(c);
      if (!k.isNull() && !strcmp(k["anim"] | "", "rec") && (k["toggle"] | false) && toggled(c)) {
        static uint32_t lastPhase = 0;
        if (now / 600 != lastPhase) { m = true; lastPhase = now / 600; }
      }
      if (m) { markCellRect(c); live = true; }
    }
  }
  if (mode == M_HOME && playerPage()) {
    static uint32_t lastSec = 0;
    if (np.playing) {
      mark(SEEK_X, 70, SEEK_W, 50);   // the live equalizer by the source
      live = true;
      if (now / 1000 != lastSec) { lastSec = now / 1000; mark(SEEK_X - 8, 140, SEEK_W + 16, 56); }
    }
    if (pressedBtn >= 0 || released >= 100) { mark(0, BTN_Y - 46, SCR_W, 92); live = true; if (released >= 100 && now - release0 > 200) released = -1; }
  }
  if (wiping) {
    float e = easeQuad((now - wipe0) / (float)wipeMs);
    int y = wipeFrom + (int)((wipeTo - wipeFrom) * e);
    if (y > wipeDrawn) { mark(0, wipeDrawn, SCR_W, y - wipeDrawn); wipeDrawn = y; }
    if (e >= 1) wiping = false;
    live = true;
  }
  if (mode == M_SHEET || sheetClosing) {
    int top = sheetTop(now);
    if (sheetClosing && now - sheet0 > 260) { sheetClosing = false; mode = M_HOME; emitMode(); top = SCR_H; }
    if (top != sheetTopDrawn) {
      int a = min(top, sheetTopDrawn), b = max(top, sheetTopDrawn);
      mark(0, a - 2, SCR_W, b - a + 4);
      sheetTopDrawn = top;
      live = true;
    }
  }
  if (mode == M_PAIR) {
    static uint32_t lastSec = 0;
    if (now / 1000 != lastSec) { lastSec = now / 1000; mark(140, 200, 300, 24); }
  }
  if (toastOn) {
    int x, y, w, h;
    toastRect(&x, &y, &w, &h);
    uint32_t t = now - toast0;
    if (t < 180 || (t > 1950 && t < 2140)) { mark(x - 6, y, w + 12, h + 16); live = true; }
    if (t >= 2140) { toastOn = false; mark(x - 6, y, w + 12, h + 16); }
  }
  if (hudOn) {
    uint32_t t = now - hud0;
    if (t < 140 || (t > 1410 && t < 1600)) { mark(HUD_X - 6, HUD_Y - 4, HUD_W + 12, HUD_H + 22); live = true; }
    if (t >= 1600) { hudOn = false; mark(HUD_X - 6, HUD_Y - 4, HUD_W + 12, HUD_H + 22); }
  }
  if (timeEpoch && mode != M_CAL) {
    time_t tt = timeEpoch + tzMin * 60 + (now - timeBase) / 1000;
    struct tm tm;
    gmtime_r(&tt, &tm);
    if (tm.tm_min != lastMinute) { lastMinute = tm.tm_min; mark(0, 0, 240, STATUS_H); }
  }
  return live;
}

void uiTick() {
  static uint32_t lastFrame = 0;
  uint32_t now = millis();
  // On USB the owner's dim setting and full power; on battery dim within 20 s, the screen
  // off after a minute (CPU slowed, LED dark), and deep sleep after the chosen minutes.
  bool usb = powerOnUsb();
  uint32_t dimMs = usb ? dimAfterS * 1000UL : min(dimAfterS ? dimAfterS : 20, 20) * 1000UL;
  uint32_t offMs = usb ? OFF_AFTER_MS : BAT_OFF_MS;
  if (dimMs && mode != M_PAIR && mode != M_CAL) {
    uint32_t idle = now - lastAct;
    if (dimState == 0 && idle > dimMs) { dimState = 1; displaySetBacklight(litLevel() * DIM_LEVEL_PCT / 100); }
    else if (dimState == 1 && idle > offMs) { dimState = 2; displaySetBacklight(0); if (!usb) powerSave(true); }
    else if (dimState == 2 && !usb && powerSleepMin() && idle > powerSleepMin() * 60000UL && !macroEngine.isRunning()) powerDeepSleep();
  }
  if (now - lastFrame < 16) return;
  bool live = animate(now);
  if (!dmgN) { lastFrame = now; return; }
  uint32_t t0 = micros();
  renderDamage(now);
  uint32_t us = micros() - t0;
  if (live) {
    perf.frames++;
    perf.sumUs += us;
    if (us > perf.maxUs) perf.maxUs = us;
    if (perf.lastAnim && now - perf.lastAnim < 60) { perf.sumGap += now - perf.lastAnim; perf.gaps++; }
    perf.lastAnim = now;
  }
  lastFrame = now;
}

// `rbench`: microseconds to render one 96x90 chunk of each kind of scene part.
void uiRenderBench() {
  uint32_t now = millis(), t;
  auto run = [&](const char *name, int x, int y, int w, int h, std::function<void()> draw) {
    t = micros();
    for (int i = 0; i < 10; i++) { gfxChunk(chunkBuf[0], x, y, w, h); gfxGround(); draw(); }
    Serial.printf("rbench %-10s %5u us\n", name, (unsigned)((micros() - t) / 10));
  };
  run("ground", 0, 30, 96, 90, [] {});
  run("glass", 0, 30, 96, 90, [] { rrFill(15, 34, 66, 66, 19, glassFill(HEXC(0x4f8cff))); });
  run("shadow", 0, 30, 96, 90, [] { softShadow(15, 34, 66, 66, 255); });
  run("glyph", 0, 30, 96, 90, [] { glyphLit("copy", false, 48, 67, 36, WHITE, BLACK); });
  run("label", 0, 30, 96, 90, [] { text(fLabel, 48, 117, "Screenshot", LBL, 255, AL_C); });
  run("tag", 0, 30, 96, 90, [] { tag(87, 30, "PC", TAG_BG, true, CYAN, CYAN, 255); });
  run("json", 0, 30, 96, 90, [] { JsonVariant k = keyAt(0); volatile int n = 0; for (int i = 0; i < 10; i++) n += (k["led_color"][0] | 0) + strlen(k["anim"] | "") + strlen(k["name"] | ""); });
  run("cell", 0, 30, 96, 90, [&] { drawCell(0, now); });
  pressed = 0; press0 = now - 300;
  run("pressed", 0, 30, 96, 90, [&] { drawCell(0, now); });
  pressed = -1;
  ca[1].pop0 = now - 60;
  run("popping", 96, 30, 96, 90, [&] { drawCell(1, now); });
  ca[1].pop0 = 0;
  run("status", 0, 0, 480, 18, [] { drawStatus(); });
  run("sheet", 0, 120, 480, 18, [] { int m = mode; mode = M_SHEET; sheetClosing = false; sheet0 = 0; drawSheet(STATUS_H); mode = (Mode)m; });
  run("player", 0, 200, 480, 18, [&] { drawPlayer(now); });
}

void uiPerf(bool reset) {
  if (reset) { memset(&perf, 0, sizeof perf); Serial.println("perf reset"); return; }
  float avgGap = perf.gaps ? perf.sumGap / (float)perf.gaps : 0;
  Serial.printf("perf frames:%u avg_ms:%.2f max_ms:%.2f fps:%.1f\n", (unsigned)perf.frames,
                perf.frames ? perf.sumUs / 1000.0f / perf.frames : 0.0f, perf.maxUs / 1000.0f, avgGap > 0 ? 1000.0f / avgGap : 0.0f);
}

// ---------------------------------------------------------------- themes
static void applyTheme(int i) {
  themeIdx = i;
  T = &THEMES[i];
  gfxSetCrisp(T->crisp);   // first: the ground table is dithered unless crisp
  gfxBegin(T->g0, T->g1, T->g2, T->texture);
  gfxSetShadow(T->shadow, T->shadowA);
}

// ---------------------------------------------------------------- public: lifecycle
void uiBegin() {
  Preferences p;
  p.begin("kp", true);
  brightness = p.getUChar("bright", 200);
  dimAfterS = p.getUShort("dim", DIM_DEFAULT_S);
  themeIdx = constrain(p.getUChar("theme", THEME_DEFAULT), 0, THEME_COUNT - 1);
  p.end();
  applyTheme(themeIdx);
  fontsBegin();
  lastAct = millis();
  displaySetBacklight(profileBrightness >= 0 ? profileBrightness : brightness);
  markScreen();
  if (!touchCalibrated()) uiCalibrate();
}

void uiMarkAll() { markScreen(); }
void uiMarkCell(int c) { if (c >= 0 && c < NUM_CELLS) { if (playerPage()) mark(0, STATUS_H, SCR_W, LINE_Y - STATUS_H); else markCellRect(c); } }
void uiMarkStatus() {   // BLE state changed: refresh the cached names, then redraw
  strlcpy(hostName, hidConnected() ? bleHostName(bleConnectedSlot()).c_str() : "", sizeof hostName);
  mark(0, 0, SCR_W, STATUS_H);
  if (mode == M_SHEET && sheetTab == 2) { refreshInfo(); mark(0, STATUS_H, SCR_W, SCR_H - STATUS_H); }
}
void uiActivity() { lastAct = millis(); }
const char *uiModeName() { return MODE_NAMES[mode]; }

bool uiWake() {
  lastAct = millis();
  if (!dimState) return false;
  dimState = 0;
  powerSave(false);
  displaySetBacklight(litLevel());
  return true;
}

const char *uiScreenState() { return dimState == 0 ? "lit" : dimState == 1 ? "dim" : "off"; }

void uiPowerChanged() {
  if (powerOnUsb()) powerSave(false);
  dimState = dimState ? 1 : 0;   // re-evaluate against the new policy from a lit screen
  uiWake();
  mark(0, 0, SCR_W, STATUS_H);
}

void uiSetBrightness(int level) {
  brightness = constrain(level, 8, 255);     // never fully dark: the screen is the only way back
  Preferences p;
  p.begin("kp", false);
  p.putUChar("bright", brightness);
  p.end();
  if (!dimState) displaySetBacklight(litLevel());
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

void uiSetTheme(int i, bool save) {
  if (i < 0 || i >= THEME_COUNT) return;
  if (save) {
    Preferences p;
    p.begin("kp", false);
    p.putUChar("theme", i);
    p.end();
  }
  if (i == themeIdx && T == &THEMES[i]) return;
  applyTheme(i);
  Serial.printf("EVT:THEME %s\n", T->id);
  // the new theme wipes down over the old one, a band of rows per frame
  for (int c = 0; c < NUM_CELLS; c++) ca[c].pop0 = 0;
  wiping = true;
  wipe0 = millis();
  wipeDrawn = wipeFrom = 0;
  wipeTo = SCR_H;
  wipeMs = 320;
}
int uiTheme() { return themeIdx; }
void uiThemeReset() {   // forget the saved choice: the out-of-box theme
  Preferences p;
  p.begin("kp", false);
  p.remove("theme");
  p.end();
  uiSetTheme(THEME_DEFAULT, false);
}
int uiThemeCount() { return THEME_COUNT; }
const char *uiThemeId(int i) { return i >= 0 && i < THEME_COUNT ? THEMES[i].id : ""; }
int uiThemeFind(const char *id) {
  for (int i = 0; i < THEME_COUNT; i++) if (!strcasecmp(id, THEMES[i].id) || !strcasecmp(id, THEMES[i].title)) return i;
  int n = atoi(id);
  return n >= 1 && n <= THEME_COUNT && isdigit((uint8_t)*id) ? n - 1 : -1;
}

// ---------------------------------------------------------------- public: pages and profiles
static void startWave() {
  uint32_t now = millis();
  // diagonal order from the top-left: each key pops in POP_STEP ms after the last
  int order = 0;
  for (int d = 0; d < GRID_COLS + GRID_ROWS - 1; d++)
    for (int c = 0; c < NUM_CELLS; c++)
      if (c % GRID_COLS + c / GRID_COLS == d) ca[c].pop0 = (now + order++ * POP_STEP) | 1;
  pressed = released = -1;
  for (int c = 0; c < NUM_CELLS; c++) ca[c].ring = 0;
  mark(0, 0, SCR_W, STATUS_H);
  mark(0, LINE_Y, SCR_W, SCR_H - LINE_Y);
}

// The page kind changes (keys <-> player): wipe the new page down over the old.
static void startWipe() {
  for (int c = 0; c < NUM_CELLS; c++) { ca[c].pop0 = 0; ca[c].ring = 0; }
  pressed = released = -1;
  wiping = true;
  wipe0 = millis();
  wipeDrawn = wipeFrom = STATUS_H;
  wipeTo = LINE_Y;
  wipeMs = 220;
  mark(0, 0, SCR_W, STATUS_H);
  mark(0, LINE_Y, SCR_W, SCR_H - LINE_Y);
}

void uiGoPage(int idx, bool push) {
  if (idx < 0 || idx >= pageCount) return;
  int from = currentPage;
  bool wasPlayer = playerPage();
  if (!loadPage(idx)) { loadPage(from); return; }
  if (push && idx != from) {
    if (backDepth == (int)sizeof backStack) memmove(backStack, backStack + 1, --backDepth);
    backStack[backDepth++] = from;
  }
  Serial.printf("EVT:PAGE %d\n", idx + 1);
  if (wasPlayer != playerPage()) startWipe(); else startWave();
}

void uiBack() { uiGoPage(backDepth ? backStack[--backDepth] : 0, false); }

void uiToast(const char *t) {
  int x, y, w, h;
  if (toastOn) { toastRect(&x, &y, &w, &h); mark(x - 6, y, w + 12, h + 16); }
  strlcpy(toastText, t, sizeof toastText);
  toast0 = millis();
  toastOn = true;
}

void uiSetProfile(int n) {
  macroEngine.abort();
  backDepth = 0;
  memset(toggles, 0, sizeof toggles);
  loadProfileSafe(n);
  if (!dimState) displaySetBacklight(profileBrightness >= 0 ? profileBrightness : brightness);
  if (mode == M_SHEET) { loadSlots(); mark(0, STATUS_H, SCR_W, SCR_H - STATUS_H); }
  char t[48];
  snprintf(t, sizeof t, "Profile %d \xc2\xb7 %s", currentProfile, profileName);
  uiToast(t);
  startWave();   // old keys stay until their turn in the wave replaces them
}

void uiFlash(int c, bool ok) {
  if (c < 0 || c >= NUM_CELLS) return;
  ca[c].ring = ok ? 1 : 2;
  ca[c].ring0 = millis();
  markCellRect(c);
}

void uiSetTime(uint32_t epoch, int tz) {
  timeEpoch = epoch;
  timeBase = millis();
  tzMin = tz;
  lastMinute = -1;
  mark(0, 0, SCR_W, STATUS_H);
}

// ---------------------------------------------------------------- public: media
void uiNowPlaying(JsonObjectConst o) {
  bool wasPlaying = np.playing;
  if (strcmp(np.title, o["title"] | "")) artOk = false;   // new track: the old cover is wrong until Studio sends one
  strlcpy(np.title, o["title"] | "", sizeof np.title);
  strlcpy(np.album, o["album"] | "", sizeof np.album);
  strlcpy(np.artist, o["artist"] | "", sizeof np.artist);
  strlcpy(np.app, o["app"] | "", sizeof np.app);
  np.pos = o["pos"] | 0;
  np.len = o["len"] | 0;
  np.playing = o["playing"] | false;
  np.at = millis();
  np.have = true;
  if (playerPage()) mark(0, STATUS_H, SCR_W, LINE_Y - STATUS_H);
  else if (wasPlaying != np.playing) for (int c = 0; c < NUM_CELLS; c++) { JsonVariant k = keyAt(c); if (!k.isNull() && !strcmp(k["anim"] | "", "eq")) markCellRect(c); }
}

void uiVolume(JsonObjectConst o) {
  int lvl = o["level"] | -1;
  bool muted = o["muted"] | false;
  if (hudLevel >= 0 && lvl >= 0) hudDir = lvl > hudLevel ? 1 : lvl < hudLevel ? -1 : hudDir;
  hudLevel = lvl;
  hudMuted = muted;
  if (!hudOn) hud0 = millis(); else hud0 = millis() - 130;   // already showing: hold, don't replay the entrance
  hudOn = true;
  mark(HUD_X - 6, HUD_Y - 4, HUD_W + 12, HUD_H + 22);
}

void uiMediaKey(const char *v) {
  int dir = !strcasecmp(v, "VOLUME_UP") ? 1 : !strcasecmp(v, "VOLUME_DOWN") ? -1 : !strcasecmp(v, "MUTE") ? 0 : 2;
  if (dir == 2) {
    if (!strcasecmp(v, "PLAY_PAUSE") && np.have) { np.pos = npPos(); np.at = millis(); np.playing = !np.playing; if (playerPage()) mark(0, STATUS_H, SCR_W, LINE_Y - STATUS_H); }
    return;
  }
  if (dir == 0) hudMuted = !hudMuted; else { hudDir = dir; hudMuted = false; }
  if (!hudOn) hud0 = millis(); else hud0 = millis() - 130;
  hudOn = true;
  mark(HUD_X - 6, HUD_Y - 4, HUD_W + 12, HUD_H + 22);
}

uint8_t *uiArtBuffer(size_t size) {
  if (size != 128 * 128 * 2) return nullptr;
  if (!art) art = (uint16_t *)malloc(size);
  artOk = false;
  return (uint8_t *)art;
}
void uiArtDone(bool ok) {
  artOk = ok && art;
  if (playerPage()) mark(0, STATUS_H, 160, 160);
}

// ---------------------------------------------------------------- public: overlays and modes
void uiPairShow(uint32_t key) {
  pairKey = key;
  if (mode == M_CAL) return;
  mode = M_PAIR;
  sheetClosing = false;
  uiWake();
  emitMode();
  markScreen();
}

void uiPairClose() {
  if (mode != M_PAIR) { mark(0, 0, SCR_W, STATUS_H); return; }
  mode = M_HOME;
  emitMode();
  markScreen();
}

void uiOpenSheet() {
  if (mode == M_SHEET && !sheetClosing) return;
  if (mode != M_HOME && mode != M_SHEET) return;
  loadSlots();
  mode = M_SHEET;
  sheetClosing = false;
  sheet0 = millis();
  sheetTopDrawn = SCR_H;
  pressed = -1;
  emitMode();
}

void uiCloseSheet() {
  if (mode != M_SHEET || sheetClosing) return;
  sheetClosing = true;
  sheet0 = millis();
  dragSlider = -1;
}
bool uiSheetOpen() { return mode == M_SHEET && !sheetClosing; }

// ---------------------------------------------------------------- calibration
void uiCalibrate() {
  mode = M_CAL;
  calStep = 0;
  calNote = 0;
  calDotN = 0;
  pressed = -1;
  uiWake();
  Serial.println("EVT:CAL start");
  emitMode();
  markScreen();
}

void uiCalibrateCancel() {
  if (mode != M_CAL) return;
  mode = M_HOME;
  calStep = -1;
  Serial.println("EVT:CAL cancel");
  emitMode();
  markScreen();
}
bool uiCalibrating() { return mode == M_CAL; }

static void calTap(int x, int y) {
  int rx, ry;
  touchPressRaw(&rx, &ry);
  if (calStep < 4) {
    calRaw[calStep][0] = rx;
    calRaw[calStep][1] = ry;
    Serial.printf("EVT:CAL point %d %d %d\n", calStep + 1, rx, ry);
    calNote = 0;
    if (++calStep == 4) {
      int worst = 999;
      if (touchFit(calRaw, CAL_PT, 4, calCand)) {
        worst = 0;
        for (int i = 0; i < 4; i++) {
          int sx, sy;
          touchMapWith(calCand, calRaw[i][0], calRaw[i][1], &sx, &sy);
          worst = max(worst, (int)hypotf(sx - CAL_PT[i][0], sy - CAL_PT[i][1]));
        }
      }
      if (worst > 30) { Serial.printf("EVT:CAL retry fit %d\n", worst); calStep = 0; calNote = 1; }
    }
  } else if (calStep == 4) {
    int sx, sy;
    touchMapWith(calCand, rx, ry, &sx, &sy);
    calErr = (int)hypotf(sx - CAL_VX, sy - CAL_VY);
    if (calErr <= 16) {
      touchSetCal(calCand, true);
      Serial.printf("EVT:CAL saved %d\n", calErr);
      calStep = 5;
      calDotN = 0;
    } else {
      Serial.printf("EVT:CAL retry verify %d\n", calErr);
      calStep = 0;
      calNote = 2;
    }
  } else {
    if (inRect(x, y, 132, 262, 104, 44)) { calStep = 0; calNote = 0; Serial.println("EVT:CAL redo"); }
    else if (inRect(x, y, 248, 262, 100, 44)) {
      mode = M_HOME;
      calStep = -1;
      Serial.println("EVT:CAL done");
      emitMode();
    } else if (calDotN < 24) { calDots[calDotN][0] = x; calDots[calDotN][1] = y; calDotN++; }
  }
  markScreen();
}

// ---------------------------------------------------------------- gestures
static void sheetSlider(int which, int x) {
  float f = clamp01((x - (PANE_X + 13)) / (float)(PANE_W - 26));
  if (which == 0) uiSetBrightness(max(13, (int)(f * 255)));
  else ledsSetBrightness((uint8_t)(f * 255));
  mark(PANE_X - 4, which == 0 ? 90 : 176, PANE_W + 8, 70);
}

static int sheetButtonAt(int x, int y) {   // ids match drawSheet's pressedBtn
  if (inRect(x, y, 390, 42, 76, 44)) return 1;
  if (sheetTab == 2) {
    for (int i = 0; i < bleBondCount() && i < 3; i++) {
      int ry = 92 + i * 58;
      if (inRect(x, y, PANE_X + PANE_W - 86, ry + 6, 80, 40)) return 20 + i;
      if (!bleHostUp(i) && inRect(x, y, PANE_X + PANE_W - 156, ry + 6, 62, 40)) return 10 + i;
    }
    if (inRect(x, y, PANE_X, 266, PANE_W, 44)) return 30;
  }
  if (sheetTab == 4 && inRect(x, y, PANE_X + PANE_W - 130, 140, 130, 44)) return 40;
  return -1;
}

static void sheetTap(int x, int y) {
  for (int i = 0; i < 5; i++)
    if (inRect(x, y, 8, 40 + i * 52, 108, 48)) {
      if (i == 1) loadSlots(); else refreshInfo();
      sheetTab = i;
      mark(0, STATUS_H, SCR_W, SCR_H - STATUS_H);
      return;
    }
  int b = sheetButtonAt(x, y);
  if (b == 1) { uiCloseSheet(); return; }
  if (b >= 10 && b < 13) { bleUse(b - 10); refreshInfo(); mark(0, STATUS_H, SCR_W, SCR_H - STATUS_H); return; }
  if (b >= 20 && b < 23) { bleForget(b - 20); refreshInfo(); mark(0, STATUS_H, SCR_W, SCR_H - STATUS_H); return; }
  if (b == 30) { mode = M_HOME; blePairOpen(); return; }
  if (b == 40) { uiCalibrate(); return; }
  switch (sheetTab) {
    case 0:
      if (inRect(x, y, PANE_X, 182, PANE_W, 44)) {
        int i = (x - PANE_X) * 5 / PANE_W;
        uiSetDim(DIM_OPTS[constrain(i, 0, 4)]);
        mark(PANE_X - 4, 176, PANE_W + 8, 56);
      } else if (inRect(x, y, PANE_X - 4, THEME_Y - 6, PANE_W + 8, THEME_H + 26)) {
        uiSetTheme(constrain((x - PANE_X) * THEME_COUNT / PANE_W, 0, THEME_COUNT - 1));
      }
      break;
    case 1:
      if (y >= 92 && y < 300) {
        int col = (x - PANE_X) * 4 / PANE_W, row = (y - 92) / 108;
        int n = row * 4 + constrain(col, 0, 3) + 1;
        if (n >= 1 && n <= NUM_PROFILES) uiSetProfile(n);
      }
      break;
    case 3:
      if (inRect(x, y, PANE_X, 92, PANE_W, 76)) { ledsSetPattern(constrain((x - PANE_X) * 5 / PANE_W, 0, 4)); mark(0, STATUS_H, SCR_W, SCR_H - STATUS_H); }
      else if (y >= 244 && y < 284 && (ledsPattern() == LED_SOLID || ledsPattern() == LED_BREATHE)) {
        int i = constrain((x - PANE_X) / 40, 0, 7);
        ledsSetColor(SWATCH[i].r, SWATCH[i].g, SWATCH[i].b);
        mark(PANE_X - 4, 240, PANE_W + 8, 48);
      }
      break;
    case 4:
      if (inRect(x, y, 400, 92, 70, 44)) { feedbackSetClick(!feedbackClickOn()); mark(400, 92, 70, 44); }
      break;
  }
}

static void runKey(int c, bool hold) {
  JsonVariant k = keyAt(c);
  if (hold) { macroEngine.start(k, true, c); return; }
  const char *field = nullptr;
  if (k["toggle"] | false) {
    if (currentPage < MAX_PAGES) toggles[currentPage] ^= 1 << c;
    if (!toggled(c) && k["off_actions"].size()) field = "off_actions";
  }
  macroEngine.start(k, false, c, field);
}

void uiGesture(uint8_t kind, int x0, int y0, int x1, int y1) {
  uint32_t now = millis();
  if (mode == M_CAL) { if (kind == G_TAP || kind >= G_SWIPE_L && kind <= G_SWIPE_D) calTap(x1, y1); return; }
  if (mode == M_PAIR) {
    if (kind == G_DOWN && inRect(x0, y0, 198, 262, 84, 44)) { pressedBtn = 2; mark(190, 256, 100, 56); }
    if (kind == G_TAP) { if (pressedBtn == 2 && inRect(x1, y1, 190, 254, 100, 60)) blePairCancel(); pressedBtn = -1; mark(190, 256, 100, 56); }
    return;
  }
  if (mode == M_SHEET && !sheetClosing) {
    if (kind == G_DOWN) {
      if (sheetTab == 0 && inRect(x0, y0, PANE_X, 110, PANE_W, 44)) { dragSlider = 0; sheetSlider(0, x0); }
      else if (sheetTab == 3 && inRect(x0, y0, PANE_X, 196, PANE_W, 44)) { dragSlider = 1; sheetSlider(1, x0); }
      else { pressedBtn = sheetButtonAt(x0, y0); if (pressedBtn >= 0) mark(0, STATUS_H, SCR_W, SCR_H - STATUS_H); }
    } else if (kind == G_MOVE && dragSlider >= 0) sheetSlider(dragSlider, x1);
    else if (kind == G_TAP || (kind >= G_SWIPE_L && kind <= G_SWIPE_D)) {
      bool wasDrag = dragSlider >= 0;
      dragSlider = -1;
      int b = pressedBtn;
      pressedBtn = -1;
      if (b >= 0) mark(0, STATUS_H, SCR_W, SCR_H - STATUS_H);
      if (wasDrag) return;
      if (kind == G_SWIPE_D) uiCloseSheet();
      else if (kind == G_TAP) sheetTap(x1, y1);
    }
    return;
  }
  if (mode != M_HOME) return;

  if (playerPage()) {
    if (kind == G_DOWN) {
      for (int i = 0; i < 6; i++)
        if (hypotf(x0 - BTN_X[i], y0 - BTN_Y) <= BTN_R[i] + 6) { pressedBtn = i; feedbackClick(); mark(0, BTN_Y - 46, SCR_W, 92); }
    } else if (kind == G_TAP) {
      int b = pressedBtn;
      pressedBtn = -1;
      if (b >= 0) {
        released = 100 + b;
        release0 = now;
        if (hypotf(x1 - BTN_X[b], y1 - BTN_Y) <= BTN_R[b] + 10) { hidSendMedia(mediaNameToCode(BTN_MEDIA[b])); uiMediaKey(BTN_MEDIA[b]); }
        mark(0, BTN_Y - 46, SCR_W, 92);
      } else if (inRect(x1, y1, SEEK_X - 8, 134, SEEK_W + 16, 44) && np.len > 0) {
        int sec = (int)(clamp01((x1 - SEEK_X) / (float)SEEK_W) * np.len);
        Serial.printf("EVT:SEEK %d\n", sec);
        np.pos = sec;
        np.at = now;
        mark(SEEK_X - 8, 140, SEEK_W + 16, 56);
      } else if (y0 < STATUS_H && x0 >= 440) uiOpenSheet();
      else if (y0 >= LINE_Y) {
        int total = (pageCount - 1) * 30, xs = 240 - total / 2, best = -1, bd = 99;
        for (int i = 0; i < pageCount; i++) { int d = abs(x0 - (xs + i * 30)); if (d < bd) { bd = d; best = i; } }
        if (best >= 0 && bd <= 16 && best != currentPage) uiGoPage(best, false);
      }
    } else if (kind == G_SWIPE_L) { pressedBtn = -1; if (currentPage + 1 < pageCount) uiGoPage(currentPage + 1, false); }
    else if (kind == G_SWIPE_R) { pressedBtn = -1; if (currentPage > 0) uiGoPage(currentPage - 1, false); }
    else if (kind == G_SWIPE_U) { pressedBtn = -1; uiOpenSheet(); }
    return;
  }

  auto hit = [](int x, int y) -> int {
    if (y < STATUS_H || y >= LINE_Y || x < 0 || x >= SCR_W) return -1;
    return (y - STATUS_H) / CELL_H * GRID_COLS + x / CELL_W;
  };
  auto release = [&](int c) {
    if (c < 0) return;
    pressed = -1;
    released = c;
    release0 = now;
    relScale = 0.94f - clamp01((now - press0) / 600.0f) * 0.04f;
    emitKey(c, '0');
    markCellRect(c);
  };
  switch (kind) {
    case G_DOWN: {
      int c = hit(x0, y0);
      if (c >= 0 && !keyAt(c).isNull()) {
        pressed = c;
        press0 = now;
        holdFired = false;
        emitKey(c, '1');
        feedbackClick();
        markCellRect(c);
      }
      break;
    }
    case G_HOLD:
      if (pressed >= 0 && keyAt(pressed)["hold_actions"].size()) {
        holdFired = true;
        emitKey(pressed, 'H');
        runKey(pressed, true);
        uiFlash(pressed, true);
      }
      break;
    case G_TAP: {
      int c = pressed;
      bool fire = c >= 0 && !holdFired && hit(x1, y1) == c;
      release(c);
      if (fire) { runKey(c, false); if (c >= 0) uiFlash(c, true); }
      else if (c < 0 && y0 < STATUS_H && x0 >= 440) uiOpenSheet();
      else if (c < 0 && y0 >= LINE_Y && pageCount > 1) {
        int total = (pageCount - 1) * 30, xs = 240 - total / 2, best = -1, bd = 99;
        for (int i = 0; i < pageCount; i++) { int d = abs(x0 - (xs + i * 30)); if (d < bd) { bd = d; best = i; } }
        if (best >= 0 && bd <= 16 && best != currentPage) uiGoPage(best, false);
      }
      break;
    }
    case G_SWIPE_L: release(pressed); if (currentPage + 1 < pageCount) uiGoPage(currentPage + 1, false); break;
    case G_SWIPE_R: release(pressed); if (currentPage > 0) uiGoPage(currentPage - 1, false); break;
    case G_SWIPE_U: release(pressed); uiOpenSheet(); break;
    case G_SWIPE_D: release(pressed); break;
  }
}
