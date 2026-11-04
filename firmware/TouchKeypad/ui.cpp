#pragma GCC optimize("O2")
#include "ui.h"
#include "gfx.h"
#include "themes.h"
#include "board.h"
#include "console.h"
#include "display.h"
#include "profiles.h"
#include "macro_engine.h"
#include "ble_hid.h"
#include "touch.h"
#include "motion.h"
#include "leds.h"
#include "power.h"
#include "hid_maps.h"
#include "storage.h"
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
#define ACCENT (T->accent)   // selected / active (handoff: accents.primary); magenta in the first six themes
#define BARC (T->bar)
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
#define LABEL_W (CELL_W - 4)   // a label's widest: neighbours keep a 4 px gap (92 px at 13 px is 78 at 11: still whole)
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
enum Mode : uint8_t { M_HOME, M_SHEET, M_PAIR, M_CAL, M_SHADE, M_MENU };   // shade: the pull-down; menu: the host list
static Mode mode = M_HOME;
static const char *const MODE_NAMES[] = { "home", "sheet", "pair", "cal", "shade", "menu" };

struct CellAnim { uint32_t pop0, ring0; uint8_t ring; int8_t frame; uint32_t sig0; int16_t sig; const IconDef *sigIc; uint32_t waveAt; };   // ring: 0 none, 1 ok, 2 alert; frame: the GIF frame on screen; sig0: when the icon animation began, sig its frame on screen, sigIc the icon it holds; waveAt: its turn in a wave
static CellAnim ca[NUM_CELLS];
static int pressed = -1, released = -1;
static uint32_t press0 = 0, release0 = 0;
static float relScale = 1;
static bool holdFired = false;
static uint16_t toggles[MAX_PAGES];
static int8_t backStack[8];
static int backDepth = 0;

static int pressedBtn = -1;          // player control or sheet button under the finger
static uint32_t offArmedAt = 0;      // Settings › Device › Turn off, tapped once: a second tap within 3 s turns it off
static int brightness = 200, dimAfterS = DIM_DEFAULT_S, dimState = 0;   // 0 lit, 1 dim, 2 off
static uint32_t lastAct = 0;
static uint32_t timeEpoch = 0, timeBase = 0;
static int litLevel() { return powerOnUsb() ? brightness : min(brightness, 160); }   // battery: about 60 % at most
static int tzMin = 0, lastMinute = -1;

static struct { char title[65], album[65], artist[65], app[33]; int pos, len; bool playing; uint32_t at; bool have; } np;
static uint16_t *art = nullptr;
static bool artOk = false;
static uint8_t *artJpg = nullptr;   // the cover as a JPEG: the 32 KB image is made from it only while a player shows
static size_t artJpgLen = 0;
static uint32_t artMs = 0;          // the last decode, for `art`

static char toastText[48];
static uint32_t toast0 = 0;
static bool toastOn = false;
static uint8_t agState = 0xff;    // AG_ASK / AG_BUSY while a sticky autogenerate toast is up
static uint32_t agAt = 0;
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

// Notifications, newest first: the PC's (Studio sends them) and the keypad's own (host connected
// or lost, key not sent, battery low, Generate). The bell in the status band counts the unread (the
// newest noteUnread); a banner drops in for each new one; the shade lists them.
#define NOTE_MAX 8
struct Note { char app[20], title[48], body[96], icon[24], tag[12]; uint32_t at; };
static Note notes[NOTE_MAX], banNote;
static int noteN = 0, noteUnread = 0;
static uint32_t ban0 = 0, shade0 = 0, menu0 = 0;
static bool banOn = false, shadeClosing = false;
static int shadeBotDrawn = STATUS_H;

// The quick bar: a suggestion slot on top, then four buttons, each a page of a profile.
#define BAR_X KEYS_W
#define SUG_Y STATUS_H
#define SUG_H 58
#define QB_Y0 (SUG_Y + SUG_H + 2)
#define QB_H 57
#define QB_BUTTONS 4
struct QbBtn { int8_t prof, page; char icon[24], label[13]; bool ok; };   // prof 0: empty; page 1-based; ok: that page exists
static QbBtn qb[QB_BUTTONS];
static bool qbParse(const char *json, QbBtn out[QB_BUTTONS], String &err);
static void qbCheck();
// The layers over the keys (btn 0: closed), each with its own page document, page line, back stack and
// toggles: a bar panel (entries 2-4) and, above it, Media (entry 1, the swipe up). Closing Media shows the
// panel again. start: the page the entry opens.
struct Layer { int8_t btn, prof, page, pages, start, back[8], depth; uint16_t toggles; uint8_t col[3]; JsonDocument doc; };
static Layer panel, media;
// Media and Settings rise as sheets that follow the finger, then spring (x: 0 closed .. 1 open, over the
// 290 px under the status band). mediaRise.to 0 while Media is still up: it is falling (closing, or a drag
// that did not open it), and it is no longer the top layer.
static Spring mediaRise, sheetRise;
static bool mediaDrag, mediaDragOpen, sheetDrag;   // a finger holds it; mediaDragOpen: a drag up from closed
static int16_t ry[6];                               // the finger's latest y and when, for the release velocity
static uint32_t rt[6];
static uint8_t rn;
static uint32_t riseLast;
static Layer *topLayer() { return media.btn && mediaRise.to > 0.5f ? &media : panel.btn ? &panel : nullptr; }
static __thread int8_t viewForce = -1;   // drawing one layer: 0 the home page, 1 Media, 2 the panel; -1 the top one (per core)
static Layer *viewLayer() {     // the layer being drawn
  switch (viewForce) { case 0: return nullptr; case 1: return &media; case 2: return panel.btn ? &panel : nullptr; }
  return topLayer();
}
static __thread float sinkK = 1;         // under a rising sheet the keys sink back a little: drawCell scales them by this
static void layerClear(Layer &L) { L.doc.clear(); L.btn = L.depth = 0; L.toggles = 0; }
static void layerClose(Layer &L);   // that layer goes (EVT:PANEL, the wipe): Media shows the panel under it again

// The page slide: the view's page and a neighbour side by side at an offset that follows the finger, then
// springs (docs/superpowers/specs/2026-11-04-motion-and-swipe-up-media-design.md). Page state commits at the
// decision (a release, or at once for a key, station or host page); the slide is the picture catching up.
static struct {
  bool on, drag, ignore;    // ignore: the rest of this touch (a profile switch ended its slide)
  int8_t other;             // the page drawn beside the view's, -1 none
  Spring s;                 // s.x: the view page's offset in pages, + moved left (the next page coming in)
  JsonDocument doc;         // the other page
  uint16_t otherToggles;
  int16_t sx[6];            // the finger's latest x and when, for the release velocity
  uint32_t st[6];
  uint8_t n;
  uint32_t last;            // the spring's last step
  int drawn;                // the offset last marked
} slide;
static __thread bool slideOther;     // drawing the other page: keyAt and toggled read it (per core)
static float pageK = 230, pageZ = 0.78f, sheetK = 240, sheetZ = 0.80f;   // the springs; `motion` tunes them (RAM only)
// The suggestion slot: Studio's suggested profile, and once it is taken, the way back.
static struct { int8_t slot; char name[24]; uint8_t col[3]; } sug;
static struct { int8_t prof, page; char name[24]; uint8_t col[3]; } backTo;   // prof 0: no way back
static int viewPage() { Layer *L = viewLayer(); return L ? L->page : currentPage; }      // the page the grid shows
static int viewPages() { Layer *L = viewLayer(); return L ? L->pages : pageCount; }
static void startWave();
static void startWipe();

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
static struct { uint32_t at, us, px; } perfLog[24];   // the latest animated frames, for `perf log`
static uint8_t perfLogN;

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
static uint32_t dmgPx() { uint32_t px = 0; for (int i = 0; i < dmgN; i++) px += dmg[i].w * dmg[i].h; return px; }
#define FRAME_PX 30000   // dirty pixels a frame takes icon frames up to (~0.45 us a pixel: inside 16 ms)

// ---------------------------------------------------------------- helpers
static JsonVariant keyAt(int c) {
  if (slideOther) return slide.doc["keys"][c];
  Layer *L = viewLayer();
  return (L ? L->doc : pageDoc)["keys"][c];
}
static bool playerPage() { JsonVariant k = keyAt(0); return !k.isNull() && k["widget"].is<const char *>(); }
static bool toggled(int c) {
  if (slideOther) return (slide.otherToggles >> c) & 1;
  Layer *L = viewLayer();
  return L ? (L->toggles >> c) & 1 : currentPage < MAX_PAGES && ((toggles[currentPage] >> c) & 1); }
static C3 groundAt(int y) { return viewLayer() && y >= STATUS_H ? PLY : gfxGroundAt(y); }   // a panel lies on the overlay ply
static C3 tintOf(JsonVariant k) { return { (uint8_t)(k["led_color"][0] | 138), (uint8_t)(k["led_color"][1] | 152), (uint8_t)(k["led_color"][2] | 171) }; }
static C3 lineOf(const uint8_t col[3]) {   // a profile's line colour, made to read on this theme's ground
  C3 c = { col[0], col[1], col[2] };
  if (T->ks == KS_PIXEL) return T->txt2;   // four greens only
  for (int i = 0; T->light && i < 4 && ((c.r * 77 + c.g * 150 + c.b * 29) >> 8) > 140; i++) c = mix(c, BLACK, 50);
  return c;
}
static C3 lineC() { return lineOf(profileColor); }
static void emitKey(int c, char st) {
  if (Layer *L = topLayer()) Con.printf("EVT:PKEY %d %d %d %c\n", L->prof, L->page + 1, c + 1, st);
  else Con.printf("EVT:KEY %d %d %c\n", currentPage + 1, c + 1, st);
}
static void emitPanel() {   // the top layer: Media over a panel reports Media; closing it reports the panel again
  if (Layer *L = topLayer()) Con.printf("EVT:PANEL %d %d %d\n", L->btn, L->prof, L->page + 1); else Con.println("EVT:PANEL 0");
}
static void emitMode() { Con.printf("EVT:UI %s\n", MODE_NAMES[mode]); }
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
      C3 card = mix(tint, th.g1, 46), back = mix(tint, th.light ? th.txt : BLACK, 125);
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
      rrRing(x + d + 0.5f, y + d + 0.5f, w - 1, h - 1, r - 0.5f, 1.4f, th.light ? th.txt : mix(tint, BLACK, 150), A * 200 / 255);
      break;
    }
    case KS_FROST: {   // white tile; on fills it with the tint, a press tints it
      softShadow(x, y, w, h, down ? A / 2 : A);
      Fill f;
      if (on) { f = solidFill(tint); f.top = mix(tint, WHITE, 60); f.edge = mix(tint, BLACK, 70); f.edgeA = 150; }
      else { f = solidFill(th.ctlBot); f.top = th.ctlTop; f.edge = th.wellEdge; f.edgeA = 230; }
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
      // Synth keeps its hand-tuned warm greys; a dark Flat theme (Focus Slate) derives them from its control roles.
      // ponytail: a second light Flat theme would take Synth's greys; give Theme lip/edge roles then.
      bool s = th.light;
      C3 face = s ? HEXC(0xe8e6e1) : th.ctlBot, top = s ? HEXC(0xf7f6f3) : th.ctlTop;
      rrFill(x, y + lip, w, h, r, solidFill(s ? HEXC(0xa39e95) : mix(face, BLACK, 77)), A);
      Fill f = solidFill(down ? (s ? HEXC(0xe0ded8) : mix(face, BLACK, 9)) : face);
      f.top = down ? (s ? HEXC(0xebe9e5) : mix(top, BLACK, 11)) : top;
      f.edge = s ? HEXC(0x99948b) : mix(face, BLACK, 87); f.edgeA = 255;
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
    case KS_PAPER: { C3 card = mix(tint, th.g1, 46); return luma(card) > 165 ? (th.light ? th.txt : mix(card, BLACK, 190)) : th.ink; }
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
// Tiles (and GIF frames) are read from flash on a miss: about 31 ms for 10 KB, so keep four.
// Dropped (uiDropTileCache) when the player's cover or an upload cannot get its RAM.
#define TILE_CACHE 4
static struct { char crc[9]; uint16_t *img; uint32_t used; } tileCache[TILE_CACHE];
static int tileLoads = 0;   // flash reads this frame (uiTick resets it): GIF keys take turns

static bool tileCached(const char *crc) {
  for (auto &t : tileCache) if (t.img && !strncmp(t.crc, crc, 8)) return true;
  return false;
}

static SemaphoreHandle_t tileMux;   // both cores draw keys: the cache, and an image while it is blitted, one at a time

static const uint16_t *tileImage(const char *crc) {
  int slot = 0;
  for (int i = 0; i < TILE_CACHE; i++) {
    if (tileCache[i].img && !strncmp(tileCache[i].crc, crc, 8)) { tileCache[i].used = millis(); return tileCache[i].img; }
    if (tileCache[i].used < tileCache[slot].used) slot = i;
  }
  if (slide.on || mediaDrag || mediaRise.on || sheetDrag || (mode == M_SHEET && sheetRise.on))
    return nullptr;   // a page or sheet moving: no flash reads (~31 ms a tile); its key shows its face until it lands
  char path[24];
  snprintf(path, sizeof path, "/t/%.8s.565", crc);
  File f = LittleFS.open(path, "r");   // no exists() first: that alone is another 15 ms
  if (!f) return nullptr;
  tileLoads++;
  auto &t = tileCache[slot];
  if (!t.img) t.img = (uint16_t *)malloc(TILE_PX * TILE_PX * 2);
  bool ok = t.img && f && f.read((uint8_t *)t.img, TILE_PX * TILE_PX * 2) == TILE_PX * TILE_PX * 2;
  f.close();
  if (!ok) { t.crc[0] = 0; return nullptr; }
  strlcpy(t.crc, crc, sizeof t.crc);
  t.used = millis();
  return t.img;
}

void uiDropTileCache() {
  if (tileMux) xSemaphoreTake(tileMux, portMAX_DELAY);
  for (auto &t : tileCache) { free(t.img); t.img = nullptr; t.crc[0] = 0; }
  if (tileMux) xSemaphoreGive(tileMux);
}

static bool drawTile(const char *crc, float x, float y, float sz, int alpha) {
  if (tileMux) xSemaphoreTake(tileMux, portMAX_DELAY);   // the other core may be loading into this very slot
  const uint16_t *img = tileImage(crc);
  if (img) blitImage(img, TILE_PX, TILE_PX, x, y, sz, sz, KEY_R * sz / KEY, alpha);
  if (tileMux) xSemaphoreGive(tileMux);
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

// ---------------------------------------------------------------- icon animations
// Every key icon has a signature animation (tools/icons/anim_designs.js): copy pulls a second
// sheet out of the first, a bell rings, wifi lights its arcs from the dot. A key plays it when it
// fires, so the icon names what just happened. While the screen is idle a few keys play at once,
// a new one every half-second, and every 20-30 s a wave ripples across the grid from the top-left
// corner, diagonal by diagonal, like the page's pop-in. "Moving icons" (`iconanim`) off keeps every
// icon still. Each playing key holds its icon's inflated frames (gfx: shared, within a RAM budget).
static bool iconMotion = true;
#define TURN_MS 500        // an idle key starts its animation this often
#define TURN_MAX 3         // with at most this many playing
#define WAVE_MIN 20000     // a wave every 20-30 s
#define WAVE_SPAN 10000
#define WAVE_STEP 110      // the wave's step from one diagonal to the next
#define WAVE_MAX_MS 6000   // keys still waiting for room by then sit this wave out
#define WAVE_PLAYING 6     // at most this many keys playing at once in a wave: each frame stays in budget
static const uint8_t TURN_ORDER[NUM_CELLS] = { 6, 0, 13, 3, 10, 8, 1, 14, 5, 11, 2, 9, 4, 12, 7 };   // scattered over the grid
static uint32_t nextTurn, nextWave, wave0;
static uint8_t turnAt;
static bool waveOn;

// Key c's icon when it has an animation to play (a GIF key shows its frames instead).
static const IconDef *animIcon(int c) {
  JsonVariant k = keyAt(c);
  if (k.isNull() || k["frames"].size() >= 2) return nullptr;
  const IconDef *ic = iconFind(k["icon"] | "", false);
  return iconAnimFrames(ic) ? ic : nullptr;
}
// The frame of key c's animation on screen now; -1 at rest.
static int iconFrame(int c, uint32_t now) {
  if (!ca[c].sig0) return -1;
  int32_t dt = now - ca[c].sig0;   // signed: sig0 is now | 1, a millisecond ahead half the time
  int f = dt < 0 ? 0 : dt / ICON_ANIM_MS;
  return f < iconAnimFrames(ca[c].sigIc) ? f : -1;
}
static void stopIcon(int c) {   // back to rest, its frames let go
  if (!ca[c].sig0) return;
  iconAnimRelease(ca[c].sigIc);
  ca[c].sig0 = 0;
  ca[c].sigIc = nullptr;
  if (ca[c].sig >= 0) markCellRect(c);
  ca[c].sig = -1;
}
static void stopIcons() {
  for (int c = 0; c < NUM_CELLS; c++) { stopIcon(c); ca[c].waveAt = 0; }
  waveOn = false;
}
// Start key c's animation: false when it has none, or no room yet. A fired key is feedback, so
// it makes room by stopping the idle ones.
static bool playIcon(int c, uint32_t now, bool fired = false) {
  const IconDef *ic = iconMotion ? animIcon(c) : nullptr;
  if (!ic) return false;
  stopIcon(c);
  if (!iconAnimAcquire(ic)) {
    if (!fired) return false;
    stopIcons();
    if (!iconAnimAcquire(ic)) return false;
  }
  ca[c].sig0 = now | 1;
  ca[c].sig = -1;
  ca[c].sigIc = ic;
  return true;
}
static void startIconWave(uint32_t now) {
  waveOn = true;
  wave0 = now;
  for (int c = 0; c < NUM_CELLS; c++) ca[c].waveAt = animIcon(c) ? (now + (c % GRID_COLS + c / GRID_COLS) * WAVE_STEP) | 1 : 0;
}
// While idle: the wave when it is due (its keys start at their moment, as room allows), else a new
// key every TURN_MS while fewer than TURN_MAX play.
static void idleTurn(uint32_t now) {
  if (!iconMotion || dimState || pressed >= 0) return;
  if (!waveOn && (int32_t)(now - nextWave) >= 0) {
    startIconWave(now);
    nextWave = now + WAVE_MIN + esp_random() % WAVE_SPAN;
  }
  if (waveOn) {
    bool left = false;
    int playing = 0;
    for (auto &a : ca) playing += a.sig0 != 0;
    for (int c = 0; c < NUM_CELLS; c++) {
      if (!ca[c].waveAt) continue;
      if ((int32_t)(now - ca[c].waveAt) >= 0 && !ca[c].sig0 && playing < WAVE_PLAYING && playIcon(c, now)) { ca[c].waveAt = 0; playing++; }
      else if (now - wave0 > WAVE_MAX_MS) ca[c].waveAt = 0;
      else left = true;
    }
    waveOn = left;
    return;
  }
  if ((int32_t)(now - nextTurn) < 0) return;
  nextTurn = now + TURN_MS;
  int playing = 0;
  for (auto &a : ca) playing += a.sig0 != 0;
  if (playing >= TURN_MAX) return;
  for (int i = 0; i < NUM_CELLS; i++) {
    int c = TURN_ORDER[turnAt++ % NUM_CELLS];
    if (!ca[c].pop0 && !ca[c].sig0 && animIcon(c)) { playIcon(c, now); return; }
  }
}
void uiIconWave() {   // `iconanim wave`: one now
  if (iconMotion && mode == M_HOME && !playerPage()) startIconWave(millis());
}

void uiSetIconMotion(bool on) {
  iconMotion = on;
  Preferences p;
  p.begin("kp", false);
  p.putBool("ianim", on);
  p.end();
  markScreen();
}
bool uiIconMotion() { return iconMotion; }

// An animated key (a GIF from Studio): "frames" lists tiles, shown in turn for "frame_ms" each.
// -1 for a key without frames. Every key on the page runs on the same clock.
static int frameIndex(JsonVariant k, uint32_t now) {
  JsonArray fr = k["frames"].as<JsonArray>();
  if (fr.size() < 2) return -1;
  uint32_t ms = constrain(k["frame_ms"] | 100, 40, 2000);
  return (now / ms) % fr.size();
}

// A folder: a key whose only action opens another page. It is drawn as a stack.
static bool isFolder(JsonVariant k) {
  JsonArray a = k["actions"].as<JsonArray>();
  return a.size() == 1 && !strcmp(a[0]["type"] | "", "page");
}

static void drawCell(int c, uint32_t now) {
  int cx = cellX(c), cy = cellY(c);
  if (!gfxHits(cx, cy, CELL_W, CELL_H)) return;
  float a = 1, s = sinkK;
  if (ca[c].pop0) {
    float t = (int32_t)(now - ca[c].pop0) / (float)POP_MS;
    if (t < 0) return;   // its turn in the page wave has not come yet
    // Opaque after the first ~45 % (the scale carries the rest): translucent pixels take
    // the slow blend path, and a whole fading wave of them cost frames.
    if (t < 1) { float e = easeOut(t); a = clamp01(e * 2.2f); s = 0.82f + 0.18f * e; }
  }
  int A = (int)(a * 255);
  float kx = cx + (CELL_W - KEY) / 2, ky = cy + 4;
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
  if (isFolder(k)) {   // the next card of the stack, up and to the right; solid, so it stays on the fast path
    C3 back = mix(tint, groundAt((int)y), 90);
    rrFill(x + 6 * s, y - 5 * s, sz, sz, th.crisp ? 3 : KEY_R * s, solidFill(back), A);
    rrRing(x + 6 * s + 0.5f, y - 5 * s + 0.5f, sz - 1, sz - 1, th.crisp ? 3 : KEY_R * s - 0.5f, th.crisp ? 2 : 1, mix(back, th.light ? BLACK : WHITE, 60), A);
  }
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
    int fi = frameIndex(k, now);
    // One flash read per frame for all GIF keys: a key whose next frame isn't cached keeps its
    // last one this frame (still cached) and gets its turn on the next.
    if (fi >= 0 && fi != ca[c].frame && ca[c].frame >= 0 && tileLoads > 0 && !tileCached(k["frames"][fi] | "")) fi = ca[c].frame;
    if (fi >= 0 && drawTile(k["frames"][fi] | "", x, y + sink, sz, A)) ca[c].frame = fi;   // a frame missing on the keypad falls back to the icon
    else if (*icon && iconFind(icon, false)) {   // at native size, in its animation frame while it plays
      const IconDef *ic = iconFind(icon, false);
      int f = ca[c].sig0 ? ca[c].sig : -1;   // the frame animate() committed with a whole-key repaint
      float gx = roundf(mx), gy = roundf(my);
      if (drop) glyphFrame(ic, f, gx, gy + 1, sh, A * 110 / 255);
      glyphFrame(ic, f, gx, gy, gc, A);
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
  int tagR = (int)kx + KEY + 6;   // tags sit on the key's top-right corner
  if (on) tag(tagR, cy, "ON", GREEN, false, GREEN, ON_INK, A);
  else if (host) tag(tagR, cy, "PC", TAG_BG, true, CYAN, CYAN, A);
  else if (hasHold && !holding) tag(tagR, cy, "HOLD", TAG_BG, true, mix(TAG_BG, HAIR, th.light ? 120 : 38), TXT2, A);

  if (th.caps) {   // OP-1 labels: small mono capitals (Synth)
    char up[24];
    strlcpy(up, k["name"] | "", sizeof up);
    for (char *p = up; *p; p++) *p = toupper((uint8_t)*p);
    Font &lf = textW(fRead, up) <= LABEL_W ? fRead : fReadS;   // steps down like the other themes' labels
    String lbl = ellipsize(lf, up, LABEL_W);
    text(lf, cx + CELL_W / 2, (int)(ky + KEY + 5 + fRead.asc), lbl.c_str(), LBL, A, AL_C);
  } else {
    // A label that fit the old 96 px cell (92 px) still fits whole: too wide for 80 px at 13 px, it
    // steps down to 11 px (92 x 11/13 = 78) before anything is cut.
    const char *name = k["name"] | "";
    Font &lf = textW(fLabel, name) <= LABEL_W ? fLabel : fLabelS;
    String lbl = ellipsize(lf, name, LABEL_W);
    text(lf, cx + CELL_W / 2, (int)(ky + KEY + 5 + fLabel.asc), lbl.c_str(), LBL, A, AL_C);
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

static int profChipX = 0, profChipW = 0, hostChipX = 0, hostChipW = 0, bellX = 0;   // the status band's buttons
static bool onProfChip(int x, int y) { return y < STATUS_H && x < profChipX + profChipW + 4; }   // the clock too: a bigger target
static bool onBell(int x, int y) { return y < STATUS_H && x >= bellX - 4 && x < bellX + 30; }
static bool onHostChip(int x, int y) { return y < STATUS_H && x >= hostChipX - 2 && x < hostChipX + hostChipW + 2; }

static void drawStatus() {
  if (!gfxHits(0, 0, SCR_W, STATUS_H)) return;
  fillRect(0, 28, SCR_W, T->crisp ? 2 : 1, HAIR, T->hairA);
  // Right to left: the battery, the host switch (a tap lists the hosts), the bell. Settings is on the quick bar.
  int right = 450 - drawBattery(466, 14);
  bool pairing = blePairing(), up = hidConnected();
  String host = pairing ? String("Pairing") : up ? String(hostName) : String("No host");
  host = ellipsize(fRead, host.c_str(), 96);
  C3 hc = pairing ? MAG : up ? GREEN : AMBER;
  int tw = textW(fRead, host.c_str());
  hostChipW = 48 + tw;
  hostChipX = right - 2 - hostChipW;
  rrFill(hostChipX, 2, hostChipW, 24, 12, ctlFill());
  glyph(iconFind(pairing ? "bluetooth-searching" : up ? "bluetooth" : "bluetooth-off", true), true, hostChipX + 16, 14, 18, hc);
  text(fRead, hostChipX + 28, 19, host.c_str(), hc);
  glyph(iconFind("chevron-down", true), true, hostChipX + hostChipW - 12, 14, 14, TXT2);
  int left = hostChipX - 8;
  if (hidDry()) { tag(left, 6, "DRY", RED, false, RED, inkOn(RED), 255); left -= 38; }
  bellX = left - 30;
  rrFill(bellX, 2, 26, 24, 12, ctlFill());
  glyph(iconFind(noteUnread ? "bell-ring" : "bell", true), true, bellX + 13, 14, 16, noteUnread ? TXT : noteN ? TXT2 : TXT3);
  if (noteUnread) {   // the unread count on a badge
    char b[4];
    snprintf(b, sizeof b, noteUnread > 9 ? "9+" : "%d", noteUnread);
    int bw = max(14, textW(fLabel, b) + 6);
    rrFill(bellX + 31 - bw, 2, bw, 13, 6.5f, solidFill(MAG));
    text(fLabel, bellX + 31 - bw / 2, 13, b, inkOn(MAG), 255, AL_C);
  }
  // Left: the clock, then the profile switch (a tap opens Profiles) in the room that's left.
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
  char pg[12];
  sprintf(pg, "%d/%d", currentPage + 1, pageCount);
  int pgW = textW(fRead, pg);
  String name = ellipsize(fBodyB, profileName, constrain(bellX - 8 - (x - 6) - (pgW + 50), 24, 150));
  profChipX = x - 6;
  profChipW = textW(fBodyB, name.c_str()) + pgW + 50;
  rrFill(profChipX, 2, profChipW, 24, 12, ctlFill());
  ringC(x + 4, 14, 5, 2, line, 77);
  circle(x + 4, 14, 4, line);
  x += 14;
  text(fBodyB, x, 19, name.c_str(), TXT);
  x += textW(fBodyB, name.c_str()) + 6;
  text(fRead, x, 19, pg, TXT2);
  glyph(iconFind("chevron-down", true), true, x + pgW + 11, 14, 14, TXT2);
}

static void drawStations() {
  int pages = viewPages(), cur = viewPage();
  if (pages < 2 || !gfxHits(0, LINE_Y, SCR_W, SCR_H - LINE_Y)) return;
  Layer *L = viewLayer();
  C3 line = L ? lineOf(L->col) : lineC(), gnd = groundAt(310);
  int total = (pages - 1) * 30, x0 = KEYS_W / 2 - total / 2;
  fillRect(x0, 309, total, 2, T->crisp ? line : mix(line, BLACK, 77));
  for (int i = 0; i < pages; i++) {
    int x = x0 + i * 30;
    if (i == cur) { circle(x, 310, 8, gnd); circle(x, 310, 6, line); circle(x, 310, 3, litHi()); }
    else { circle(x, 310, 4, gnd); ringC(x, 310, 3, 2, line); }
  }
}

// ---------------------------------------------------------------- media player
// The controls, left of the quick bar. A widget with mic_actions gets a seventh, the mic, at the right end: all a
// little smaller to fit, play in the middle (x 210, the centre of the keys' width). The mic runs the widget's own actions (the host's `mic toggle` on the owner's keypad).
struct PBtn { int16_t x, r, gs; const char *icon, *media; };
static const PBtn PB6[6] = { { 35, 26, 24, "volume-x", "MUTE" }, { 98, 29, 28, "volume-1", "VOLUME_DOWN" }, { 165, 29, 28, "skip-back", "PREVIOUS" },
                             { 240, 38, 36, "", "PLAY_PAUSE" }, { 315, 29, 28, "skip-forward", "NEXT" }, { 382, 29, 28, "volume-2", "VOLUME_UP" } };
static const PBtn PB7[7] = { { 33, 24, 22, "volume-x", "MUTE" }, { 89, 24, 24, "volume-1", "VOLUME_DOWN" }, { 146, 24, 24, "skip-back", "PREVIOUS" },
                             { 210, 32, 30, "", "PLAY_PAUSE" }, { 274, 24, 24, "skip-forward", "NEXT" }, { 331, 24, 24, "volume-2", "VOLUME_UP" },
                             { 387, 24, 22, "mic-off", "" } };
static int playerBtns(const PBtn *&b) { bool m = keyAt(0)["mic_actions"].size() > 0; b = m ? PB7 : PB6; return m ? 7 : 6; }
#define BTN_Y 248
#define SEEK_X 160
#define SEEK_W 244

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
  const PBtn *B;
  int nb = playerBtns(B);
  for (int i = 0; i < nb; i++) {
    bool dn = pressedBtn == i, play = !strcmp(B[i].media, "PLAY_PAUSE");
    float r = B[i].r * (dn && T->ks != KS_PAPER && T->ks != KS_FLAT && T->ks != KS_PIXEL ? 0.92f : 1);
    C3 t = play ? CYAN : SLATE;
    const char *ic = play ? (np.playing ? "pause" : "play") : B[i].icon;
    float gs = B[i].gs, bx = B[i].x - r, by = BTN_Y - r;
    if (T->ks == KS_GLASS) {   // the original: slate controls darker than keys, the play key lit
      softShadow(bx, by, 2 * r, 2 * r, 255);
      Fill f = glassFill(t, dn ? 50 : 0);
      if (!play) { f.top = mix(HEXC(0x10161d), t, 102); f.bot = mix(HEXC(0x070a0e), t, 36); }
      rrFill(bx, by, 2 * r, 2 * r, r, f);
      glyphLit(ic, false, B[i].x, BTN_Y, gs, WHITE, mix(t, BLACK, 150));
      continue;
    }
    bool fill = play && T->ks != KS_FLAT;   // the play key is the filled one
    float pr = dn ? 0.6f : -1, sink = keySink(*T, 2 * r, pr);
    keyBody(*T, bx, by, 2 * r, 2 * r, r, T->ks == KS_PIXEL ? T->track : t, pr, fill, 255);
    C3 ink = play && T->ks == KS_FLAT ? ACCENT : keyInk(*T, t, dn, fill);
    float gx = B[i].x + (T->ks == KS_PAPER || T->ks == KS_PIXEL ? sink : 0), gy = BTN_Y + sink;
    if (keyInkDrop(*T)) glyphLit(ic, false, gx, gy, gs, ink, mix(t, BLACK, 150));
    else glyph(iconFind(ic, false), false, gx, gy, gs, ink);
  }
}

// ---------------------------------------------------------------- settings sheet
static const char *const TAB_NAME[5] = { "Display", "Profiles", "Bluetooth", "LED", "Device" };
static const char *const TAB_ICON[5] = { "sun", "layers", "bluetooth", "lightbulb", "cpu" };
static const C3 SWATCH[8] = { HEXC(0x4f8cff), HEXC(0x3fc6e0), HEXC(0x52d68f), HEXC(0xf2b746), HEXC(0xff8a3d), HEXC(0xff5f57), HEXC(0xff6fae), HEXC(0x9b7bff) };
#define PANE_X 128
#define PANE_W 338
#define CARD_Y 96              // Profiles: 4 x 4 cards under the title row
#define CARD_W 80
#define CARD_H 46
#define CARD_GAP 6
#define GEN_X 248              // the Generate button, left of Done
#define GEN_W 132

// ---------------------------------------------------------------- the page slide
static int slideOff() { return slide.on ? (int)lroundf(slide.s.x * KEYS_W) : 0; }
int uiSlidePx() { return slideOff(); }

// The key area in rects on the moving cell grid: every DMA chunk then holds one cell, drawn once
// (one 420-wide rect is cut into 20-row chunks, and each cell would be drawn about five times).
static void slideMark() {
  int f = ((slideOff() % CELL_W) + CELL_W) % CELL_W;
  for (int x = -f; x < KEYS_W; x += CELL_W)
    for (int r = 0; r < GRID_ROWS; r++) mark(x, STATUS_H + r * CELL_H, min(CELL_W, KEYS_W - x), CELL_H);
}

static void slideQuiet() {   // the keys' own animations stop while pages move
  stopIcons();
  for (auto &a : ca) { a.pop0 = 0; a.ring = 0; }
  pressed = released = -1;
  pressedBtn = -1;
}

static void slideEnd() {   // the page in place at once
  if (!slide.on) return;
  slide.on = slide.drag = false;
  slide.s.on = false;
  slide.other = -1;
  slide.doc.clear();
  slideMark();
}

static void slideAbort() { slideEnd(); slide.ignore = true; }   // and the rest of this touch is ignored

// The page beside the view's: page idx of the view's profile; out of range: none.
static bool slideLoad(int idx) {
  slide.other = -1;
  slide.doc.clear();
  slide.otherToggles = 0;
  if (idx < 0 || idx >= viewPages()) return false;
  Layer *L = topLayer();
  if (!loadPageInto(L ? L->prof : currentProfile, idx, slide.doc)) { slide.doc.clear(); return false; }
  slide.other = idx;
  if (!L && idx < MAX_PAGES) slide.otherToggles = toggles[idx];
  return true;
}

// The view just changed from page `from` (its document now in slide.doc): the new page slides in from
// the side the old one leaves by.
static void slideFrom(int from, uint16_t fromToggles) {
  slide.other = from;
  slide.otherToggles = fromToggles;
  slide.on = true;
  slide.drag = false;
  slide.s = { viewPage() > from ? -1.0f : 1.0f, 0, 0, pageK, pageZ, true };
  slide.last = millis();
  slideQuiet();
  mark(0, 0, SCR_W, STATUS_H);              // the page number
  mark(0, LINE_Y, SCR_W, SCR_H - LINE_Y);   // and the stations: once, for the new page
  slideMark();
  slide.drawn = slideOff();
}

// A drag lands on the neighbour: it becomes the view's page (its document swapped in, no reload), the old
// page the other, and the picture keeps its place.
static void slideCommit() {
  Layer *L = topLayer();
  int from = viewPage(), to = slide.other;
  swap(L ? L->doc : pageDoc, slide.doc);
  if (L) { slide.otherToggles = L->toggles; L->toggles = 0; L->page = to; emitPanel(); }
  else { slide.otherToggles = from < MAX_PAGES ? toggles[from] : 0; currentPage = to; Con.printf("EVT:PAGE %d\n", to + 1); }
  slide.other = from;
  slide.s.x -= to > from ? 1 : -1;
  mark(0, 0, SCR_W, STATUS_H);
  mark(0, LINE_Y, SCR_W, SCR_H - LINE_Y);
}

static void drawView(uint32_t now) {   // the grid's page (the other one while slideOther)
  if (playerPage()) drawPlayer(now);
  else for (int c = 0; c < NUM_CELLS; c++) drawCell(c, now);
}

static void drawSlide(uint32_t now) {
  int cl[4];
  gfxClipGet(cl);
  gfxClipAnd(0, STATUS_H, KEYS_W, LINE_Y);   // the bar, the band and the stations stay put
  int off = slideOff();
  gfxPan(off, 0);
  drawView(now);
  gfxPan(-off, 0);
  if (slide.other >= 0) {   // a later page sits on the right, an earlier one on the left
    int at = slide.other > viewPage() ? off - KEYS_W : off + KEYS_W;
    slideOther = true;
    gfxPan(at, 0);
    drawView(now);
    gfxPan(-at, 0);
    slideOther = false;
  }
  gfxClipSet(cl);
}

// A drag took the touch: what was under the finger goes up without firing.
static void slideCancelPress() {
  if (pressed >= 0) { int c = pressed; pressed = -1; emitKey(c, '0'); markCellRect(c); }
  if (pressedBtn >= 0) { pressedBtn = -1; mark(0, BTN_Y - 46, SCR_W, 92); }
}

// Sideways drags on the home screen (the keys, a panel, Media): the page under the finger. True when it
// took the gesture. Runs ahead of the bar's taps and the player's buttons, so a drag from either slides.
static bool slideGesture(uint8_t kind, int x0, int y0, int x1, int y1, uint32_t now) {
  if (kind == G_DOWN) {
    slide.ignore = false;
    slide.n = 0;
    if (slide.on && !slide.drag) slideEnd();   // a finger on a page still springing: it lands at once
    return false;
  }
  if (slide.ignore) return true;
  int dx = x1 - x0, dy = y1 - y0;
  if (kind == G_MOVE) {
    if (!slide.drag) {
      if (abs(dx) <= LOCK_PX || abs(dx) <= abs(dy)) return false;
      slideCancelPress();
      slideQuiet();
      slide.on = slide.drag = true;
      slide.s = { 0, 0, 0, pageK, pageZ, false };
      slideLoad(viewPage() + (dx < 0 ? 1 : -1));
    }
    if (slide.n == 6) { memmove(slide.sx, slide.sx + 1, 5 * sizeof *slide.sx); memmove(slide.st, slide.st + 1, 5 * sizeof *slide.st); slide.n = 5; }
    slide.sx[slide.n] = x1;
    slide.st[slide.n] = now;
    slide.n++;
    float raw = -dx / (float)KEYS_W;   // + the finger went left: the next page comes in
    if (raw != 0) {   // the neighbour on the side it is pulled from; reversing past the start swaps it
      int want = viewPage() + (raw > 0 ? 1 : -1);
      if (want != slide.other) { if (want >= 0 && want < viewPages()) slideLoad(want); else { slide.other = -1; slide.doc.clear(); } }
    }
    slide.s.x = constrain(slide.other >= 0 ? raw : raw * 0.35f, -1.0f, 1.0f);   // no page there: it gives a little
    return true;
  }
  if (!slide.drag) return false;   // no drag: a tap or a swipe as before
  if (kind == G_HOLD) return true;
  slide.drag = false;   // the release: where a flick of this speed lands
  if (slide.n && slide.sx[slide.n - 1] != x1) {   // it lifted somewhere the last poll did not see (an injected swipe's end)
    if (slide.n == 6) { memmove(slide.sx, slide.sx + 1, 5 * sizeof *slide.sx); memmove(slide.st, slide.st + 1, 5 * sizeof *slide.st); slide.n = 5; }
    slide.sx[slide.n] = x1;
    slide.st[slide.n] = now;
    slide.n++;
    float raw = -dx / (float)KEYS_W;
    slide.s.x = constrain(slide.other >= 0 ? raw : raw * 0.35f, -1.0f, 1.0f);
  }
  float v = 0;
  if (slide.n > 1 && slide.st[slide.n - 1] != slide.st[0])
    v = -(slide.sx[slide.n - 1] - slide.sx[0]) * 1000.0f / KEYS_W / (float)(slide.st[slide.n - 1] - slide.st[0]);
  float lo = 0, hi = 0;
  if (slide.other > viewPage()) hi = 1;
  else if (slide.other >= 0) lo = -1;
  if (flickTarget(slide.s.x, v, lo, hi) != 0) slideCommit();
  slide.s.v = v;
  slide.s.to = 0;
  slide.s.k = pageK;
  slide.s.z = pageZ;
  slide.s.on = true;
  slide.last = now;
  return true;
}

void uiMotionCmd(const char *arg) {   // `motion [page|sheet <k> <z>]`
  char which[8] = "";
  float k = 0, z = 0;
  if (sscanf(arg, "%7s %f %f", which, &k, &z) == 3 && k >= 20 && k <= 2000 && z >= 0.1f && z <= 3) {
    if (!strcmp(which, "page")) { pageK = k; pageZ = z; }
    else if (!strcmp(which, "sheet")) { sheetK = k; sheetZ = z; }
  }
  Con.printf("motion page k:%.0f z:%.2f sheet k:%.0f z:%.2f\n", pageK, pageZ, sheetK, sheetZ);
}

// ---------------------------------------------------------------- Media and Settings rise
static void markBar();
static int riseTop(const Spring &r) { return SCR_H - (int)lroundf(r.x * (SCR_H - STATUS_H)); }
static int mediaTop() { return media.btn && mediaRise.x > 0.002f ? riseTop(mediaRise) : SCR_H; }   // SCR_H: no Media sheet
int uiRisePx() {
  if (mode == M_SHEET) return SCR_H - riseTop(sheetRise);
  return media.btn ? SCR_H - riseTop(mediaRise) : 0;
}

static void riseMark(bool bar) {   // what a rise redraws, in cell rects (one chunk each); Settings covers the bar too
  for (int c = 0; c < NUM_CELLS; c++) markCellRect(c);
  mark(0, LINE_Y, KEYS_W, SCR_H - LINE_Y);
  if (bar) mark(BAR_X, STATUS_H, BAR_W, SCR_H - STATUS_H);
}

static void riseGo(Spring &r, float to, float v) { r.to = to; r.v = v; r.k = sheetK; r.z = sheetZ; r.on = true; riseLast = millis(); }
static void mediaShow() { riseGo(mediaRise, 1, mediaRise.on ? mediaRise.v : 0); riseMark(false); }   // up, on the spring
static void mediaDrop() { if (media.btn) { riseGo(mediaRise, 0, mediaRise.on ? mediaRise.v : 0); riseMark(false); } }   // it falls; cleared when it lands

static bool mediaPlayer() { JsonVariant k = media.doc["keys"][0]; return !k.isNull() && k["widget"].is<const char *>(); }

// Entry 1's page into the Media layer, quietly: a drag up shows it before it is committed.
static bool mediaLoad() {
  QbBtn &b = qb[0];
  char name[24];
  int pages = 0;
  uint8_t col[3];
  b.ok = b.prof && profileMeta(b.prof, name, sizeof name, &pages, col) && b.page <= pages && loadPageInto(b.prof, b.page - 1, media.doc);
  if (!b.ok) { media.doc.clear(); return false; }
  media.btn = 1;
  media.prof = b.prof;
  media.page = media.start = b.page - 1;
  media.pages = min(pages, MAX_PAGES);
  media.depth = 0;
  media.toggles = 0;
  memcpy(media.col, col, 3);
  return true;
}

static void riseSample(int y, uint32_t now) {
  if (rn == 6) { memmove(ry, ry + 1, 5 * sizeof *ry); memmove(rt, rt + 1, 5 * sizeof *rt); rn = 5; }
  ry[rn] = y;
  rt[rn] = now;
  rn++;
}
static float riseVelocity() {   // sheets per second, + up
  return rn > 1 && rt[rn - 1] != rt[0] ? -(ry[rn - 1] - ry[0]) * 1000.0f / (SCR_H - STATUS_H) / (float)(rt[rn - 1] - rt[0]) : 0;
}

static void drawGrid(uint32_t now) {   // a layer's page on the key area (the slide, if it is that layer) and its stations
  if (viewLayer()) fillRect(0, STATUS_H, KEYS_W, SCR_H - STATUS_H, PLY);
  if (slide.on && viewLayer() == topLayer()) drawSlide(now);
  else drawView(now);
  drawStations();
}

static void drawMediaSheet(uint32_t now, int top) {   // Media from `top` down, its page riding up with it
  Fill f = solidFill(PLY);
  f.hi = WHITE;
  f.hiA = T->light ? 0 : 33;
  if (T->light) { f.edge = HAIR; f.edgeA = T->hairA; }
  rrFill(0, top, KEYS_W, SCR_H - top + 20, T->crisp ? 4 : 16, f);
  if (T->crisp) fillRect(0, top, KEYS_W, 2, TXT);
  int dy = top - STATUS_H;
  gfxPan(0, -dy);
  viewForce = 1;
  if (slide.on && topLayer() == &media) drawSlide(now);
  else drawView(now);
  drawStations();
  viewForce = -1;
  gfxPan(0, dy);
}

// Up and down drags on the home screen: Media follows the finger. Up from the keys or a panel opens it; down
// on an open Media closes it. A drag down anywhere else is the shade's, as before (on release).
static bool riseGesture(uint8_t kind, int x0, int y0, int x1, int y1, uint32_t now) {
  if (kind == G_DOWN) {
    rn = 0;
    if (media.btn && mediaRise.on && !mediaDrag) {   // a finger on a sheet still moving: it lands at once
      mediaRise.x = mediaRise.to;
      mediaRise.v = 0;
      mediaRise.on = false;
      if (mediaRise.x == 0) { layerClear(media); markBar(); }
      riseMark(false);
    }
    return false;
  }
  int dx = x1 - x0, dy = y1 - y0;
  if (kind == G_MOVE) {
    if (!mediaDrag) {
      if (abs(dy) <= LOCK_PX || abs(dy) <= abs(dx)) return false;
      bool open = topLayer() == &media;
      if (open ? dy < 0 : dy > 0) return false;   // up on an open Media, or down on the keys (the shade's)
      if (!open && !mediaLoad()) return false;    // no entry 1: nothing to open
      slideCancelPress();
      slideEnd();
      mediaDrag = true;
      mediaDragOpen = !open;
      mediaRise.on = false;
      mediaRise.v = 0;
      if (!open) mediaRise.x = mediaRise.to = 0;
    }
    riseSample(y1, now);
    float f = (y0 - y1) / (float)(SCR_H - STATUS_H);   // + up
    mediaRise.x = constrain(mediaDragOpen ? f : 1 + f, 0.0f, 1.0f);
    return true;
  }
  if (!mediaDrag) return false;
  if (kind == G_HOLD) return true;
  mediaDrag = false;   // let go: it opens or closes where a flick of this speed lands
  if (rn && ry[rn - 1] != y1) {   // it lifted somewhere the last poll did not see (an injected swipe's end)
    riseSample(y1, now);
    float f = (y0 - y1) / (float)(SCR_H - STATUS_H);
    mediaRise.x = constrain(mediaDragOpen ? f : 1 + f, 0.0f, 1.0f);
  }
  float v = riseVelocity(), t = flickTarget(mediaRise.x, v, 0, 1);
  riseGo(mediaRise, t, v);
  if ((t == 1) == mediaDragOpen) emitPanel();   // it opened (Media on top) or closed (the layer under it is)
  markBar();
  return true;
}

// The saved hosts, cheaply (no file system walk): true when something shown changed.
static bool refreshHosts() {
  auto before = info;
  info.bonds = min(bleBondCount(), 3);
  for (int i = 0; i < info.bonds; i++) { info.up[i] = bleHostUp(i); strlcpy(info.names[i], bleHostName(i).c_str(), sizeof info.names[i]); }
  if (before.bonds != info.bonds) return true;
  for (int i = 0; i < info.bonds; i++) if (before.up[i] != info.up[i] || strcmp(before.names[i], info.names[i])) return true;
  return false;
}
static void refreshInfo() {
  // usedBytes and totalBytes each walk the file system (~95 ms with many tiles): the total once,
  // the used only for the Device tab, the one that shows it.
  if (!info.total) info.total = LittleFS.totalBytes();
  if (sheetTab == 4) info.used = LittleFS.usedBytes();
  info.heap = ESP.getFreeHeap();
  strlcpy(info.mac, NimBLEDevice::getAddress().toString().c_str(), sizeof info.mac);
  refreshHosts();
}

// What the open tab shows. The Profiles tab's 16 slots are a file each (~20 ms: three lookups to
// open one), read again only once a file has changed since.
static void loadSlots() {
  static uint32_t readAt = UINT32_MAX;   // storageCommits when the slots were read
  if (sheetTab == 1 && readAt != storageCommits) {
    for (int i = 0; i < NUM_PROFILES; i++) slots[i].ok = profileMeta(i + 1, slots[i].name, sizeof slots[i].name, &slots[i].pages, slots[i].col);
    readAt = storageCommits;
  }
  refreshInfo();
}

// Settings → Display: one chip per theme, each a small live sample of that theme.
#define THEME_Y 184
#define THEME_H 26
#define THEME_COLS 5
#define THEME_GAP 6
#define THEME_ROW (THEME_H + 6)
static float themeChipW() { return (PANE_W - (THEME_COLS - 1) * THEME_GAP) / (float)THEME_COLS; }
static void themeChips() {
  float w = themeChipW();
  for (int i = 0; i < THEME_COUNT; i++) {
    const Theme &th = THEMES[i];
    float x = PANE_X + (i % THEME_COLS) * (w + THEME_GAP);
    int cy = THEME_Y + (i / THEME_COLS) * THEME_ROW;
    bool cur = i == themeIdx;
    Fill g = solidFill(th.g1); g.top = th.g0; g.bot = th.g2;
    g.edge = th.light ? th.hair : WHITE; g.edgeA = th.light ? 50 : 30;
    rrFill(x, cy, w, THEME_H, T->crisp ? 4 : 10, g);
    float ks = 18, kx = x + (w - ks) / 2 - 1, ky = cy + 4;
    keyBody(th, kx, ky, ks, ks, th.keyR * ks / KEY, th.ks == KS_PIXEL ? th.track : HEXC(0x4f8cff), -1, false, 255);
    if (cur) rrRing(x - 2, cy - 2, w + 4, THEME_H + 4, T->crisp ? 5 : 12, 2, ACCENT);
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
      text(fBody, PANE_X, 176, "Theme", TXT);
      text(fRead, PANE_X + PANE_W, 176, T->title, ACCENT, 255, AL_R);
      themeChips();
      text(fBody, PANE_X, 268, "On USB the screen stays on", TXT);
      text(fRead, PANE_X, 289, "On battery: dim 20 s, off 1 min,", TXT2);
      snprintf(v, sizeof v, "deep sleep after %d min", powerSleepMin());
      text(fRead, PANE_X, 308, powerSleepMin() ? v : "no deep sleep", TXT2);
      break;
    }
    case 1: {   // all slots, 4 x 4: tap one to switch
      button(GEN_X, 42, GEN_W, 44, "Generate", "sparkles", 0, pressedBtn == 60);
      for (int i = 0; i < NUM_PROFILES; i++) {
        float x = PANE_X + (i % 4) * (CARD_W + CARD_GAP);
        int y = CARD_Y + (i / 4) * (CARD_H + CARD_GAP);
        bool cur = i + 1 == currentProfile;
        if (slots[i].ok) {
          rrFill(x, y, CARD_W, CARD_H, T->crisp ? 4 : 10, cardFill());
          rrFill(x + 8, y + 7, 18, 4, 2, solidFill(T->crisp ? TXT2 : C3{ slots[i].col[0], slots[i].col[1], slots[i].col[2] }));
          text(fBodyB, (int)x + 8, y + 34, ellipsize(fBodyB, slots[i].name, CARD_W - 14).c_str(), cur ? ACCENT : TXT);
        } else {
          rrRing(x + 0.5f, y + 0.5f, CARD_W - 1, CARD_H - 1, 9.5f, 1, mix(PLY, HAIR, 20));
          sprintf(v, "%d", i + 1);
          text(fRead, (int)x + 8, y + 32, v, TXT3);
        }
        if (cur) rrRing(x + 1, y + 1, CARD_W - 2, CARD_H - 2, 9, 2, ACCENT);
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
        if (cur) rrRing(x + 1, 93, w - 2, 74, 11, 2, ACCENT);
        if (i == 0) {
          static const C3 RB[6] = { HEXC(0xff5f57), HEXC(0xf2b746), HEXC(0x52d68f), HEXC(0x4cc9ea), HEXC(0x9b7bff), HEXC(0xff6fae) };
          for (int k = 5; k >= 0; k--) rrRing(cx - 7, 115, 14, 14, 7, 14, RB[k], 255, (k + 1) / 6.0f);
        } else if (i == 1) { circle(cx, 122, 14, mix(T->light ? CARD : HEXC(0x2a2149), lc, 120)); circle(cx, 122, 9, lc); }
        else if (i == 2) circle(cx, 122, 14, lc);
        else if (i == 3) { circle(cx, 122, 14, T->light ? SEG_OFF : HEXC(0x0b1a20)); circle(cx, 122, 5, CYAN); }
        else circle(cx, 122, 14, SEG_OFF);
        text(fBodyB, (int)cx, 158, PAT[i], cur ? ACCENT : TXT2, 255, AL_C);
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
      button(GEN_X, 42, GEN_W, 44, offArmedAt ? "Tap again" : "Turn off", "power", 2, pressedBtn == 41);
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
  return mode == M_SHEET ? riseTop(sheetRise) : SCR_H;
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
    bool inked = T->crisp && T->light;   // Retro: an ink fill
    C3 ti = cur ? (inked ? T->g1 : ACCENT) : TXT2;
    if (cur) rrFill(8, ty, 108, 48, T->crisp ? 4 : 12, solidFill(inked ? TXT : mix(PLY, ACCENT, T->light ? 34 : 41)));
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
  if (agState <= AG_BUSY) return t < 160 ? easeOut(t / 160.0f) : 1;   // sticky until Studio answers
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
  if (agState <= AG_BUSY) {   // working: the dot breathes
    float b = 0.5f + 0.5f * sinf(now * 0.008f);
    circle(x + 18, y + 20, 6, MAG, (uint8_t)(90 + 165 * b));
  } else circle(x + 18, y + 20, 5, lineC());
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

// ---------------------------------------------------------------- the shade
// Pulled down from the status band: brightness and the profile on top, the hosts, then the newest
// notifications. Its content stays put while its edge moves, like the sheet's.
#define SH_ROW1 38              // brightness, profile
#define SH_ROW2 90              // hosts
#define SH_LIST 162             // the first notification
#define SH_ROWH 46
#define SH_SLX 30               // the brightness slider
#define SH_SLW 256
#define SH_PRV 292              // the profile stepper: < name >
#define SH_NAME 334
#define SH_NAMEW 94
#define SH_NXT 432
static int shadeRows() { return min(noteN, 3); }
static int shadeHeight() { return SH_LIST + (noteN ? shadeRows() * SH_ROWH : 40) + 14; }   // the shade's bottom
static int shadeBot(uint32_t now) {
  if (mode != M_SHADE) return STATUS_H;
  if (!shade0) return shadeClosing ? shadeHeight() : STATUS_H;   // its first frame has not come yet
  float e = easeQuad((int32_t)(now - shade0) / 220.0f);   // signed: shade0 is now | 1, a millisecond ahead half the time
  if (shadeClosing) e = 1 - e;
  return STATUS_H + (int)((shadeHeight() - STATUS_H) * e);
}
static void markShade() { mark(0, STATUS_H, SCR_W, shadeHeight() - STATUS_H + 14); }

static void ago(char *b, size_t n, uint32_t at) {
  uint32_t s = (millis() - at) / 1000;
  if (s < 60) snprintf(b, n, "now");
  else if (s < 3600) snprintf(b, n, "%lum", (unsigned long)(s / 60));
  else snprintf(b, n, "%luh", (unsigned long)(s / 3600));
}
// A notification's icon: the key icon by that name, else the UI icon, else the bell.
static void noteIcon(const char *name, float cx, float cy, C3 c) {
  const IconDef *ic = iconFind(name, false);
  if (ic) glyph(ic, false, cx, cy, 22, c);
  else glyph(iconFind(iconFind(name, true) ? name : "bell", true), true, cx, cy, 20, c);
}
static void iconButton(int x, int y, int w, int h, const char *icon, bool down) {
  button(x, y, w, h, "", nullptr, 0, down);
  glyph(iconFind(icon, true), true, x + w / 2, y + h / 2, 18, TXT);
}
// One notification on a card: title and age, then the app and the text.
static void noteCard(const Note &n, int x, int y, int w, int h, float r, Fill f) {
  char v[8];
  rrFill(x, y, w, h, r, f);
  noteIcon(n.icon, x + 22, y + h / 2, TXT);
  ago(v, sizeof v, n.at);
  int vw = textW(fRead, v), ty = y + h / 2 - 3, by = y + h / 2 + 14;
  text(fRead, x + w - 10, ty, v, TXT3, 255, AL_R);
  text(fBodyB, x + 42, ty, ellipsize(fBodyB, n.title[0] ? n.title : n.app, w - 62 - vw).c_str(), TXT);
  String app = ellipsize(fRead, n.app, 110);
  int ax = x + 42 + textW(fRead, app.c_str()) + 6;
  text(fRead, x + 42, by, app.c_str(), CYAN);
  if (n.body[0]) text(fRead, ax, by, ellipsize(fRead, n.body, x + w - 10 - ax).c_str(), TXT2);
}

static void drawShade(int bot) {
  if (bot <= STATUS_H || !gfxHits(0, STATUS_H, SCR_W, bot - STATUS_H + 14)) return;
  int h = shadeHeight();
  gfxClip(0, STATUS_H, SCR_W, bot + 14);
  softShadow(0, STATUS_H, SCR_W, bot - STATUS_H, 200);
  gfxClip(0, STATUS_H, SCR_W, bot);
  Fill f = solidFill(PLY); f.top = PLY; f.bot = PLY2;
  if (T->light) { f.edge = HAIR; f.edgeA = T->hairA; }
  rrFill(0, STATUS_H - 20, SCR_W, h - STATUS_H + 20, T->crisp ? 4 : 16, f);
  if (T->crisp) fillRect(0, h - 2, SCR_W, 2, TXT);
  // brightness, and the profile: step through the saved ones; the name opens Profiles
  glyph(iconFind("sun", true), true, 17, SH_ROW1 + 22, 18, TXT2);
  slider(SH_SLX, SH_ROW1, SH_SLW, brightness / 255.0f);
  iconButton(SH_PRV, SH_ROW1, 38, 44, "chevron-left", pressedBtn == 101);
  button(SH_NAME, SH_ROW1, SH_NAMEW, 44, ellipsize(fBodyB, profileName, SH_NAMEW - 12).c_str(), nullptr, 0, pressedBtn == 102);
  iconButton(SH_NXT, SH_ROW1, 38, 44, "chevron-right", pressedBtn == 103);
  // the hosts: tap one to switch to it
  for (int i = 0; i < 3; i++) {
    int x = 12 + i * 154, y = SH_ROW2;
    if (i < info.bonds) {
      bool up = info.up[i];
      button(x, y, 148, 46, "", nullptr, 0, pressedBtn == 110 + i);
      if (up) rrRing(x + 1, y + 1, 146, 44, T->crisp ? 3 : 11, 2, GREEN);
      glyph(iconFind("bluetooth", true), true, x + 18, y + 23, 18, up ? GREEN : TXT2);
      text(fBodyB, x + 32, y + 21, ellipsize(fBodyB, info.names[i], 108).c_str(), TXT);
      text(fRead, x + 32, y + 38, up ? "Connected" : "Tap to use", up ? GREEN : TXT2);
    } else if (i == info.bonds) button(x, y, 148, 46, "Pair new", "link", 0, pressedBtn == 120);
    else {
      rrRing(x + 0.5f, y + 0.5f, 147, 45, T->crisp ? 4 : 11.5f, 1, mix(PLY, HAIR, 20));
      text(fRead, x + 74, y + 28, "Empty", TXT3, 255, AL_C);
    }
  }
  // the notifications
  char v[28];
  snprintf(v, sizeof v, noteN ? "Notifications \xc2\xb7 %d" : "Notifications", noteN);
  text(fRead, 14, SH_LIST - 9, v, TXT2);
  if (noteN) text(fBodyB, 466, SH_LIST - 8, "Clear all", pressedBtn == 130 ? TXT : CYAN, 255, AL_R);
  else text(fBody, 240, SH_LIST + 25, "No notifications", TXT3, 255, AL_C);
  for (int k = 0; k < shadeRows(); k++)
    noteCard(notes[k], 8, SH_LIST + k * SH_ROWH, 464, 42, T->crisp ? 4 : 12, pressedBtn == 140 + k ? ctlFill() : cardFill());
  rrFill(220, h - 9, 40, 4, 2, solidFill(mix(PLY, TXT2, 90)));   // the handle
  gfxUnclip();
}

// ---------------------------------------------------------------- the host menu
// The status band's host switch: the saved hosts under the host chip, then Pair.
#define MENU_W 236
#define MENU_ROW 46
#define MENU_Y 32
static int menuX() { return constrain(hostChipX + hostChipW - MENU_W, 4, SCR_W - 4 - MENU_W); }
static int menuH() { return (info.bonds + 1) * MENU_ROW + 8; }
static void markMenu() { mark(menuX() - 6, MENU_Y - 2, MENU_W + 12, menuH() + 18); }
static void drawMenu(uint32_t now) {
  if (mode != M_MENU) return;
  int x = menuX(), h = menuH();
  if (!gfxHits(x - 4, MENU_Y, MENU_W + 8, h + 14)) return;
  gfxClip(0, 0, SCR_W, MENU_Y + (int)((h + 14) * easeOut((now - menu0) / 140.0f)));
  softShadow(x, MENU_Y, MENU_W, h, 220);
  rrFill(x, MENU_Y, MENU_W, h, T->crisp ? 4 : 14, pillFill());
  for (int i = 0; i <= info.bonds; i++) {
    int y = MENU_Y + 4 + i * MENU_ROW;
    if (pressedBtn == 200 + i) rrFill(x + 4, y, MENU_W - 8, MENU_ROW, T->crisp ? 3 : 10, solidFill(mix(CTL, T->light ? T->hair : WHITE, 40)));
    if (i) fillRect(x + 14, y, MENU_W - 28, 1, HAIR, T->hairA);
    if (i < info.bonds) {
      bool up = info.up[i];
      glyph(iconFind("bluetooth", true), true, x + 22, y + 23, 18, up ? GREEN : TXT2);
      text(fBodyB, x + 40, y + 21, ellipsize(fBodyB, info.names[i], MENU_W - 76).c_str(), TXT);
      text(fRead, x + 40, y + 38, up ? "Connected" : "Saved \xc2\xb7 tap to use", up ? GREEN : TXT2);
      if (up) glyph(iconFind("check", true), true, x + MENU_W - 22, y + 23, 18, GREEN);
    } else {
      glyph(iconFind("link", true), true, x + 22, y + 23, 18, CYAN);
      text(fBodyB, x + 40, y + 28, "Pair new host", CYAN);
    }
  }
  gfxUnclip();
}

// ---------------------------------------------------------------- the banner
// A new notification drops in over the status band for a few seconds; a tap opens the shade.
#define BAN_X 8
#define BAN_Y 2
#define BAN_W 464
#define BAN_H 54
static float banProg(uint32_t now) {
  uint32_t t = now - ban0;
  if (t < 180) return easeOut(t / 180.0f);
  if (t < 3800) return 1;
  if (t < 3980) return 1 - easeOut((t - 3800) / 180.0f);
  return 0;
}
static void markBanner() { mark(0, 0, SCR_W, BAN_Y + BAN_H + 16); }
static void drawBanner(uint32_t now) {
  if (!banOn) return;
  float p = banProg(now);
  if (p <= 0 || !gfxHits(BAN_X - 4, 0, BAN_W + 8, BAN_Y + BAN_H + 14)) return;
  gfxClip(0, 0, SCR_W, BAN_Y + (int)((BAN_H + 14) * p));
  softShadow(BAN_X, BAN_Y, BAN_W, BAN_H, 220);
  noteCard(banNote, BAN_X, BAN_Y, BAN_W, BAN_H, T->crisp ? 4 : 18, pillFill());
  gfxUnclip();
}

// ---------------------------------------------------------------- quick bar
static void markBar() { mark(BAR_X, STATUS_H, BAR_W, SCR_H - STATUS_H); }

static bool qbParse(const char *json, QbBtn out[QB_BUTTONS], String &err) {
  JsonDocument d;
  if (deserializeJson(d, json) || !d.is<JsonArray>()) { err = "not a JSON array"; return false; }
  JsonArray a = d.as<JsonArray>();
  if (a.size() != QB_BUTTONS) { err = "want 4 entries, null for an empty button"; return false; }
  QbBtn tmp[QB_BUTTONS] = {};
  for (int i = 0; i < QB_BUTTONS; i++) {
    JsonVariant v = a[i];
    if (v.isNull()) continue;
    String at = "button " + String(i + 1) + " ";
    if (!v.is<JsonObject>()) { err = at + "is not an object or null"; return false; }
    int prof = v["profile"] | 0, page = v["page"] | 0;
    const char *icon = v["icon"] | (const char *)nullptr, *label = v["label"] | (const char *)nullptr;
    if (!v["profile"].is<int>() || prof < 1 || prof > NUM_PROFILES) { err = at + "profile (1-16)"; return false; }
    if (!v["page"].is<int>() || page < 1 || page > MAX_PAGES) { err = at + "page (1-16)"; return false; }
    if (!icon || strlen(icon) >= sizeof tmp[i].icon) { err = at + "icon (a key icon name)"; return false; }
    if (!label || strlen(label) >= sizeof tmp[i].label) { err = at + "label (12 characters at most)"; return false; }
    tmp[i].prof = prof;
    tmp[i].page = page;
    strlcpy(tmp[i].icon, icon, sizeof tmp[i].icon);
    strlcpy(tmp[i].label, label, sizeof tmp[i].label);
  }
  memcpy(out, tmp, sizeof tmp);
  return true;
}

static String qbJson() {
  JsonDocument d;
  JsonArray a = d.to<JsonArray>();
  for (const QbBtn &b : qb) {
    if (!b.prof) { a.add(nullptr); continue; }
    JsonObject o = a.add<JsonObject>();
    o["profile"] = b.prof;
    o["page"] = b.page;
    o["icon"] = b.icon;
    o["label"] = b.label;
  }
  String s;
  serializeJson(d, s);
  return s;
}

// A button works when its profile file reads and has its page (a file read each: never in a render).
static void qbCheck() {
  for (QbBtn &b : qb) {
    char name[24];
    int pages = 0;
    uint8_t col[3];
    b.ok = b.prof && profileMeta(b.prof, name, sizeof name, &pages, col) && b.page <= pages;
  }
}

static void drawBar(uint32_t now) {
  if (!gfxHits(BAR_X, STATUS_H, BAR_W, SCR_H - STATUS_H)) return;
  fillRect(BAR_X, STATUS_H, BAR_W, SCR_H - STATUS_H, BARC);
  fillRect(BAR_X, STATUS_H, T->crisp ? 2 : 1, SCR_H - STATUS_H, HAIR, T->hairA);
  fillRect(BAR_X + 8, QB_Y0 - 1, BAR_W - 16, 1, HAIR, T->hairA);
  const int cx = BAR_X + BAR_W / 2;
  if (backTo.prof) {   // the way back to the profile the suggestion left
    if (const IconDef *ic = iconFind("undo-2", false)) glyph(ic, false, cx, SUG_Y + 21, 20, TXT);
    text(fLabelS, cx, SUG_Y + 45, ellipsize(fLabelS, backTo.name, BAR_W - 6).c_str(), TXT2, 255, AL_C);
  } else if (sug.slot && sug.slot != currentProfile) {   // the suggestion: its name on a pill ringed in its colour
    C3 lc = lineOf(sug.col);
    float r = T->crisp ? 4 : 12;
    rrFill(BAR_X + 5, SUG_Y + 4, BAR_W - 10, SUG_H - 8, r, pillFill());
    rrRing(BAR_X + 5.5f, SUG_Y + 4.5f, BAR_W - 11, SUG_H - 9, r - 0.5f, 2, lc);
    circle(cx, SUG_Y + 21, 5, lc);
    text(fLabelS, cx, SUG_Y + 43, ellipsize(fLabelS, sug.name, BAR_W - 14).c_str(), TXT, 255, AL_C);
  }
  // Rows 0-2: entries 2-4 (entry 1 is the swipe-up page); row 3: Settings, always there.
  for (int row = 0; row < QB_BUTTONS; row++) {
    int top = QB_Y0 + row * QB_H;
    bool settings = row == QB_BUTTONS - 1;
    const QbBtn &b = qb[settings ? 0 : row + 1];
    if (!settings && (!b.prof || !b.ok)) continue;
    bool lit = !settings && panel.btn == row + 2;   // the open panel's button: like the sheet's current tab
    bool inked = T->crisp && T->light;   // Retro: an ink fill
    C3 ink = lit ? (inked ? T->g1 : ACCENT) : TXT;
    if (lit) rrFill(BAR_X + 4, top + 2, BAR_W - 8, QB_H - 4, T->crisp ? 4 : 12, solidFill(inked ? TXT : mix(BARC, ACCENT, T->light ? 34 : 41)));
    const IconDef *ic = settings ? iconFind("settings", true) : iconFind(b.icon, false);
    if (ic) glyph(ic, settings, cx, top + 22, 22, ink);
    text(fLabelS, cx, top + 46, settings ? "Settings" : ellipsize(fLabelS, b.label, BAR_W - 4).c_str(), lit ? ink : TXT2, 255, AL_C);
  }
}

bool uiQuickbarSet(const char *json, String &err) {
  if (!qbParse(json, qb, err)) return false;
  Preferences p;
  p.begin("kp", false);
  p.putString("qbar", qbJson());
  p.end();
  qbCheck();
  markBar();
  return true;
}

void uiQuickbarPrint() { Con.printf("quickbar %s\n", qbJson().c_str()); }

void uiProfilesChanged(int id) {
  qbCheck();
  markBar();
  if (sug.slot == id) uiSuggest(id);   // re-reads it; gone: no suggestion (a tap must never make a default)
  if (backTo.prof == id && !LittleFS.exists("/profile" + String(id) + ".json")) backTo.prof = 0;
  for (Layer *L : { &panel, &media }) {   // Studio saved the profile behind an open layer: show it
    if (!L->btn || L->prof != id) continue;
    slideEnd();
    char name[24];
    int pages = 0;
    uint8_t col[3];
    if (!profileMeta(id, name, sizeof name, &pages, col) || L->page >= pages || !loadPageInto(id, L->page, L->doc)) { layerClose(*L); continue; }
    L->pages = min(pages, MAX_PAGES);
    memcpy(L->col, col, 3);
    startWave();
  }
}

// ---------------------------------------------------------------- frame
static void renderChunk(uint32_t now) {
  if (mode == M_CAL) { gfxFill(CAL_BG); drawCal(); return; }
  gfxGround();
  drawStatus();
  int top = sheetTop(now), bot = shadeBot(now);
  bool sheetCovers = mode == M_SHEET && top <= STATUS_H;
  if (mode == M_PAIR) drawPair();
  else if (!sheetCovers) {
    gfxClip(0, bot > STATUS_H ? bot - 18 : 0, SCR_W, min(SCR_H, top + 18));   // nothing under the opaque sheet or shade (corners are 16 px)
    float sx = mode == M_SHEET ? sheetRise.x : 0, back = max(sx, media.btn ? mediaRise.x : 0.0f);
    int mtop = mediaTop(), cl[4];
    gfxClipGet(cl);
    viewForce = mtop < SCR_H ? (panel.btn ? 2 : 0) : -1;   // with Media up: the layer under it, above its edge
    if (mtop < SCR_H) gfxClipAnd(0, 0, KEYS_W, mtop);
    sinkK = 1 - 0.05f * back;
    drawGrid(now);
    sinkK = 1;
    viewForce = -1;
    if (back > 0) gfxDarken(0, STATUS_H, KEYS_W, SCR_H - STATUS_H, (int)(115 * back));   // dimmed under a sheet
    gfxClipSet(cl);
    if (mtop < SCR_H) {
      gfxClipAnd(0, mtop, KEYS_W, SCR_H);
      drawMediaSheet(now, mtop);
      if (sx > 0) gfxDarken(0, mtop, KEYS_W, SCR_H - mtop, (int)(115 * sx));   // Settings over Media dims it too
      gfxClipSet(cl);
    }
    drawBar(now);
    if (sx > 0) gfxDarken(BAR_X, STATUS_H, BAR_W, SCR_H - STATUS_H, (int)(115 * sx));   // Settings covers the bar: it dims too
    gfxUnclip();
  }
  drawSheet(top);
  drawShade(bot);
  drawMenu(now);
  drawBanner(now);
  drawToast(now);
  drawHud(now);
}

// The frame on both cores: the damage is cut into chunks; core 1 (this loop) and a helper task on core 0
// (under Bluetooth's priority, so it only takes idle time) each claim the next one and draw it into its
// buffer, and core 1 sends them to the panel by DMA in order. Three buffers: two being drawn while one goes
// out. A chunk's buffer is free once the DMA of the chunk three before it is done. `render 1` draws on core
// 1 alone (the old way) if two ever misbehave.
#define CHUNK_PX (96 * 45)   // pixels a DMA chunk holds; a cell (84 x 90) is two of them (three whole cells won't fit in RAM)
#define NBUF 3   // two being drawn while one goes out; a fourth cost 8.6 KB of heap for ~1 fps
static uint16_t chunkBuf[NBUF][CHUNK_PX];   // contiguous: rbench draws a 96 x 90 chunk across the first two
#define MAX_CHUNKS 96
static struct { int16_t x, y, w, h; } chunks[MAX_CHUNKS];
static volatile int chunkN, nextChunk, dmaDone;
static volatile uint8_t chunkReady[MAX_CHUNKS];
static uint32_t frameNow;
static TaskHandle_t helper;
static SemaphoreHandle_t helperGo, helperIdle;
static bool twoCores = true;

static bool bufFree(int i) { return i - NBUF <= dmaDone; }
static bool claimChunk(int &i) {   // the next chunk, if its buffer is free
  i = nextChunk;
  return i < chunkN && bufFree(i) && __atomic_compare_exchange_n(&nextChunk, &i, i + 1, false, __ATOMIC_ACQ_REL, __ATOMIC_ACQUIRE);
}
static uint32_t chunksBy[2], chunkUs[2];   // `render`: chunks drawn on each core, and their time
static void drawChunk(int i) {
  uint32_t t0 = micros();
  gfxChunk(chunkBuf[i % NBUF], chunks[i].x, chunks[i].y, chunks[i].w, chunks[i].h);
  renderChunk(frameNow);
  int core = xPortGetCoreID() & 1;
  chunksBy[core]++;
  chunkUs[core] += micros() - t0;
  __atomic_store_n(&chunkReady[i], 1, __ATOMIC_RELEASE);
}

static void helperLoop(void *) {
  for (;;) {
    xSemaphoreTake(helperGo, portMAX_DELAY);
    int i;
    while (nextChunk < chunkN) {
      if (claimChunk(i)) drawChunk(i);
      else taskYIELD();   // its buffer is still going out
    }
    xSemaphoreGive(helperIdle);
  }
}

static void renderBatch() {   // chunks[0, chunkN) drawn and sent
  nextChunk = 0;
  dmaDone = -1;
  for (int i = 0; i < chunkN; i++) chunkReady[i] = 0;
  bool two = twoCores && helper && chunkN > 1;
  if (two) xSemaphoreGive(helperGo);
  for (int p = 0; p < chunkN; p++) {
    int i;
    while (!__atomic_load_n(&chunkReady[p], __ATOMIC_ACQUIRE))
      if (claimChunk(i)) drawChunk(i);   // draw while waiting; a chunk the helper holds will be ready soon
    lcd.waitDMA();
    dmaDone = p - 1;
    lcd.pushImageDMA(chunks[p].x, chunks[p].y, chunks[p].w, chunks[p].h, (const lgfx::swap565_t *)chunkBuf[p % NBUF]);
  }
  lcd.waitDMA();
  dmaDone = chunkN - 1;
  if (two) xSemaphoreTake(helperIdle, portMAX_DELAY);   // the helper is done before anything it reads changes
  chunkN = 0;
}

static void renderDamage(uint32_t now) {
  frameNow = now;
  chunkN = 0;
  lcd.startWrite();
  for (int i = 0; i < dmgN; i++) {
    Rect r = dmg[i];
    int rows = max(1, CHUNK_PX / r.w);
    for (int y = r.y; y < r.y + r.h; y += rows) {
      if (chunkN == MAX_CHUNKS) renderBatch();
      chunks[chunkN] = { r.x, (int16_t)y, r.w, (int16_t)min(rows, r.y + r.h - y) };
      chunkN++;
    }
  }
  if (chunkN) renderBatch();
  lcd.endWrite();
  dmgN = 0;
}

void uiRenderCores(int n) {
  if (n == 1 || n == 2) twoCores = n == 2;
  Con.printf("render %d core0:%u/%ums core1:%u/%ums stack:%u\n", twoCores ? 2 : 1, (unsigned)chunksBy[0], (unsigned)(chunkUs[0] / 1000),
             (unsigned)chunksBy[1], (unsigned)(chunkUs[1] / 1000), helper ? (unsigned)uxTaskGetStackHighWaterMark(helper) : 0);
  if (n == 0) chunksBy[0] = chunksBy[1] = chunkUs[0] = chunkUs[1] = 0;   // `render 0`: the counts start again
}

// Marks what moves this frame; true when something animates every frame.
static bool animate(uint32_t now) {
  bool live = false, playing = false;
  bool home = mode == M_HOME || mode == M_SHADE || mode == M_MENU;   // the page still runs under the shade and the menu
  uint16_t iconDue = 0;   // keys whose next icon frame waits for the frame budget, at the end
  int8_t iconDueFrame[NUM_CELLS];
  if (!home || playerPage()) stopIcons();   // icons play on the key grid only
  for (auto &a : ca) playing |= a.sig0 != 0;
  if (!playing && !waveOn) iconAnimReleaseAll();   // nothing should be left; make sure
  if (slide.on) {   // the page slide: the spring once a finger lets go
    if (!slide.drag && slide.s.on && springStep(slide.s, min(0.05f, (now - slide.last) / 1000.0f), 0.5f / KEYS_W)) slideEnd();
    slide.last = now;
    if (slide.on) {
      int off = slideOff();
      if (off != slide.drawn) { slideMark(); slide.drawn = off; }
      live = true;
    }
  }
  if (home && !playerPage() && !slide.on) {
    if (mode == M_HOME) idleTurn(now);
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
      int fi = k.isNull() || dimState == 2 ? -1 : frameIndex(k, now);   // a dark screen doesn't play GIFs
      if (fi >= 0 && fi != ca[c].frame) m = true;   // redraw on a new frame only: each one is a tile read
      int f = -1;   // an icon frame due on this key
      if (ca[c].sig0) {
        int g = iconFrame(c, now);
        if (g < 0) stopIcon(c);   // over: repainted at rest
        else if (g != ca[c].sig) f = g;
        live = true;
      }
      if (!k.isNull() && !strcmp(k["anim"] | "", "rec") && (k["toggle"] | false) && toggled(c)) {
        static uint32_t lastPhase = 0;
        if (now / 600 != lastPhase) { m = true; lastPhase = now / 600; }
      }
      bool hidden = mode == M_SHADE && cellY(c) + CELL_H <= shadeBot(now);   // under the shade: waits for it to lift
      if (m && !hidden) { markCellRect(c); if (f >= 0) ca[c].sig = f; }
      else if (f >= 0 && !hidden) { iconDue |= 1 << c; iconDueFrame[c] = f; }
      if (m) live = true;
    }
  }
  if (home && playerPage() && !slide.on) {
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
  {   // Media and Settings rising or falling: the springs, once a finger lets go
    float dt = min(0.05f, (now - riseLast) / 1000.0f), eps = 0.5f / (SCR_H - STATUS_H);
    riseLast = now;
    if (media.btn && (mediaRise.on || mediaDrag)) {
      if (!mediaDrag && springStep(mediaRise, dt, eps) && mediaRise.x == 0) { layerClear(media); markBar(); }   // landed: gone
      riseMark(false);
      live = true;
    }
    if (mode == M_SHEET && (sheetRise.on || sheetDrag)) {
      if (!sheetDrag && springStep(sheetRise, dt, eps) && sheetClosing) { sheetClosing = false; mode = M_HOME; emitMode(); }
      riseMark(true);
      live = true;
    }
  }
  if (mode == M_SHADE) {
    if (!shade0) shade0 = now | 1;
    int bot = shadeBot(now);
    if (shadeClosing && (int32_t)(now - shade0) > 220) { shadeClosing = false; mode = M_HOME; emitMode(); bot = STATUS_H; }
    if (bot != shadeBotDrawn) {
      int a = min(bot, shadeBotDrawn), b = max(bot, shadeBotDrawn);
      mark(0, a, SCR_W, b - a + 14);   // the rows the edge crossed, and the shadow under it
      if (!shadeClosing && bot == shadeHeight()) mark(0, bot - 18, SCR_W, 18);   // settled: its rounded corners
      shadeBotDrawn = bot;
      live = true;
    }
  }
  if (mode == M_MENU && now - menu0 < 160) { markMenu(); live = true; }
  if (banOn) {
    uint32_t t = now - ban0;
    if (t < 200 || (t > 3790 && t < 4000)) { markBanner(); live = true; }
    if (t >= 4000) { banOn = false; markBanner(); }
  }
  if (mode == M_PAIR) {
    static uint32_t lastSec = 0;
    if (now / 1000 != lastSec) { lastSec = now / 1000; mark(140, 200, 300, 24); }
  }
  if (toastOn) {
    int x, y, w, h;
    toastRect(&x, &y, &w, &h);
    uint32_t t = now - toast0;
    if (agState <= AG_BUSY) {
      if (t < 180) mark(x - 6, y, w + 12, h + 16);   // the pill slides in
      else mark(x + 8, y + 10, 22, 22);               // then only the breathing dot
      live = true;
      // No answer: Studio isn't running (4 s), or Claude never finished (3 min).
      if (now - agAt > (agState == AG_ASK ? 4000UL : 180000UL))
        uiAutogen(AG_FAIL, agState == AG_ASK ? "Open Macropad Studio to generate" : "Claude took too long");
    } else {
      if (t < 180 || (t > 1950 && t < 2140)) { mark(x - 6, y, w + 12, h + 16); live = true; }
      if (t >= 2140) { toastOn = false; mark(x - 6, y, w + 12, h + 16); }
    }
  }
  if (hudOn) {
    uint32_t t = now - hud0;
    if (t < 140 || (t > 1410 && t < 1600)) { mark(HUD_X - 6, HUD_Y - 4, HUD_W + 12, HUD_H + 22); live = true; }
    if (t >= 1600) { hudOn = false; mark(HUD_X - 6, HUD_Y - 4, HUD_W + 12, HUD_H + 22); }
  }
  // Icon frames go last, while the frame stays within its pixel budget; the rest show theirs a
  // tick later (taking turns, so none is starved).
  static uint8_t iconFirst;
  for (int i = 0; i < NUM_CELLS && iconDue; i++) {
    int c = (iconFirst + i) % NUM_CELLS;
    if (!(iconDue >> c & 1)) continue;
    if (dmgPx() + CELL_W * CELL_H > FRAME_PX) break;
    markCellRect(c);
    ca[c].sig = iconDueFrame[c];
  }
  iconFirst++;
  if (timeEpoch && mode != M_CAL) {
    time_t tt = timeEpoch + tzMin * 60 + (now - timeBase) / 1000;
    struct tm tm;
    gmtime_r(&tt, &tm);
    if (tm.tm_min != lastMinute) { lastMinute = tm.tm_min; mark(0, 0, 240, STATUS_H); if (mode == M_SHADE && noteN) markShade(); }   // and the ages
  }
  return live;
}

// The JPEG cover: decoded when a player page shows, the 32 KB image freed when none does.
static void artSync() {
  if (!artJpgLen) return;   // a raw cover (or none) is kept as it is
  static bool dropped;   // the tile cache, given up once per player visit: not every loop pass if RAM stays short
  bool want = playerPage() || (media.btn && mediaPlayer());
  if (want && !artOk) {
    if (!art) art = (uint16_t *)malloc(128 * 128 * 2);
    if (!art && !dropped) { dropped = true; uiDropTileCache(); art = (uint16_t *)malloc(128 * 128 * 2); }
    if (!art) return;   // no room: the player shows its placeholder
    uint32_t t = millis();
    artOk = displayDecodeJpg(artJpg, artJpgLen, art, 128, 128);
    artMs = millis() - t;
    mark(0, STATUS_H, 160, 160);
  } else if (!want && art) {
    free(art);
    art = nullptr;
    artOk = false;
  }
  if (!want) dropped = false;
}

void uiTick() {
  artSync();
  static uint32_t lastFrame = 0;
  uint32_t now = millis();
  if (offArmedAt && (int32_t)(now - offArmedAt) > 3000) { offArmedAt = 0; mark(GEN_X, 42, GEN_W, 44); }   // signed: armed is now | 1
  // On USB the screen stays lit at full power. On battery: dim within 20 s (CPU slowed, LED dark),
  // the screen off after a minute (the panel asleep), and deep sleep after the chosen minutes.
  bool usb = powerOnUsb();
  if (!usb && mode != M_PAIR && mode != M_CAL) {
    uint32_t idle = now - lastAct, dimMs = min(dimAfterS ? dimAfterS : 20, 20) * 1000UL;   // setdim under 20 s: tests
    if (dimState == 0 && idle > dimMs) { dimState = 1; displaySetBacklight(litLevel() * DIM_LEVEL_PCT / 100); powerSave(true); }
    else if (dimState == 1 && idle > BAT_OFF_MS) { dimState = 2; displaySetBacklight(0); }
    else if (dimState == 2 && powerSleepMin() && idle > powerSleepMin() * 60000UL && !macroEngine.isRunning()) powerDeepSleep();
  }
  static bool lowWarned = false;   // once per drop under 15 %
  int pct = powerBatteryPct();
  if (!usb && pct > 0 && pct <= 15 && !lowWarned) {   // 0 % is the cutoff's own notice
    char b[40];
    snprintf(b, sizeof b, "%d%% left, plug in USB to charge", pct);
    uiNotify("Keypad", "Battery low", b, "battery-low", "battery");
    lowWarned = true;
  } else if (usb || pct > 20) lowWarned = false;
  if (now - lastFrame < 16) return;
  tileLoads = 0;
  bool live = animate(now);
  if (!dmgN) { lastFrame = now; return; }
  uint32_t px = 0;
  for (int i = 0; i < dmgN; i++) px += dmg[i].w * dmg[i].h;
  uint32_t t0 = micros();
  renderDamage(now);
  uint32_t us = micros() - t0;
  if (live) {
    perfLog[perfLogN++ % 24] = { now, us, px };
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
    Con.printf("rbench %-10s %5u us\n", name, (unsigned)((micros() - t) / 10));
  };
  run("ground", 0, 30, 96, 90, [] {});
  run("glass", 0, 30, 96, 90, [] { rrFill(15, 34, 66, 66, 19, glassFill(HEXC(0x4f8cff))); });
  run("shadow", 0, 30, 96, 90, [] { softShadow(15, 34, 66, 66, 255); });
  run("glyph", 0, 30, 96, 90, [] { glyphLit("copy", false, 48, 67, 36, WHITE, BLACK); });
  run("label", 0, 30, 96, 90, [] { text(fLabel, 48, 117, "Screenshot", LBL, 255, AL_C); });
  run("tag", 0, 30, 96, 90, [] { tag(87, 30, "PC", TAG_BG, true, CYAN, CYAN, 255); });
  run("json", 0, 30, 96, 90, [] { JsonVariant k = keyAt(0); volatile int n = 0; for (int i = 0; i < 10; i++) n += (k["led_color"][0] | 0) + strlen(k["anim"] | "") + strlen(k["name"] | ""); });
  run("cell", 0, 30, 96, 90, [&] { drawCell(0, now); });
  run("sunk", 0, 30, 96, 90, [&] { sinkK = 0.95f; drawCell(0, now); sinkK = 1; });   // a key under a rising sheet
  run("dim", 0, 30, 96, 90, [] { fillRect(0, 30, 96, 90, BLACK, 115); });         // the dim behind it, as a blend
  run("darken", 0, 30, 96, 90, [] { gfxDarken(0, 30, 96, 90, 115); });               // and as the dim draws it
  run("msheet", 0, 120, 96, 90, [] { rrFill(0, 100, KEYS_W, 240, 16, solidFill(PLY)); });   // the Media sheet's fill
  run("pback", 0, 30, 96, 90, [] {   // a Paper key, part by part: the card behind (its two strips)
    int clip[4]; gfxClipGet(clip);
    gfxClipAnd(15 + 66 - 12, 34 + 3 - 1, 15 + 66 + 3 + 1, 34 + 66 - 12); rrFill(18, 37, 66, 66, 12, solidFill(HEXC(0x604030))); gfxClipSet(clip);
    gfxClipAnd(15 + 3 - 1, 34 + 66 - 12, 15 + 66 + 3 + 1, 34 + 66 + 3 + 1); rrFill(18, 37, 66, 66, 12, solidFill(HEXC(0x604030))); gfxClipSet(clip); });
  run("pcard", 0, 30, 96, 90, [] { Fill f = solidFill(HEXC(0xc08060)); f.top = HEXC(0xd09070); rrFill(15, 34, 66, 66, 12, f); });
  {   // sqrtf: what an antialiased corner pixel pays
    volatile float acc = 0;
    uint32_t t0 = micros();
    for (int i = 0; i < 1000; i++) acc += sqrtf(1.0f + i * 0.37f);
    Con.printf("rbench %-10s %5u us\n", "sqrt x1000", (unsigned)(micros() - t0));
  }
  run("pring", 0, 30, 96, 90, [] { rrRing(15.5f, 34.5f, 65, 65, 11.5f, 1.4f, HEXC(0x302010), 200); });
  pressed = 0; press0 = now - 300;
  run("pressed", 0, 30, 96, 90, [&] { drawCell(0, now); });
  pressed = -1;
  ca[1].pop0 = now - 60;
  run("popping", 96, 30, 96, 90, [&] { drawCell(1, now); });
  ca[1].pop0 = 0;
  run("status", 0, 0, 480, 18, [] { drawStatus(); });
  run("sheet", 0, 120, 480, 18, [] { int m = mode; mode = M_SHEET; sheetClosing = false; sheet0 = 0; drawSheet(STATUS_H); mode = (Mode)m; });
  run("player", 0, 200, 480, 18, [&] { drawPlayer(now); });
  // A GIF key's frame change: a tile from flash (cache miss), then the blit.
  File dir = LittleFS.open("/t");
  File f0 = dir.openNextFile();
  String nm = f0 ? String(f0.name()) : String();
  if (f0) f0.close();
  dir.close();
  uint8_t *b = nm.length() ? (uint8_t *)malloc(TILE_PX * TILE_PX * 2) : nullptr;
  if (b) {
    String path = "/t/" + nm;
    t = micros();
    for (int i = 0; i < 10; i++) LittleFS.exists(path);
    Con.printf("rbench %-10s %5u us\n", "t.exists", (unsigned)((micros() - t) / 10));
    t = micros();
    for (int i = 0; i < 10; i++) { File f = LittleFS.open(path, "r"); f.read(b, TILE_PX * TILE_PX * 2); f.close(); }
    Con.printf("rbench %-10s %5u us\n", "t.read", (unsigned)((micros() - t) / 10));
    run("t.blit", 0, 30, 96, 90, [&] { blitImage((const uint16_t *)b, TILE_PX, TILE_PX, 15, 34, 66, 66, KEY_R, 255); });
    free(b);
  }
}

void uiPerfLog() {   // `perf log`: each recent animated frame: ms since the first, render us, dirty px
  int n = min((int)perfLogN, 24), first = perfLogN - n;
  for (int i = first; i < (int)perfLogN; i++) {
    auto &e = perfLog[i % 24];
    Con.printf("%lu %lu %lu\n", (unsigned long)(e.at - perfLog[first % 24].at), (unsigned long)e.us, (unsigned long)e.px);
  }
}
void uiPerf(bool reset) {
  if (reset) { memset(&perf, 0, sizeof perf); perfLogN = 0; Con.println("perf reset"); return; }
  float avgGap = perf.gaps ? perf.sumGap / (float)perf.gaps : 0;
  Con.printf("perf frames:%u avg_ms:%.2f max_ms:%.2f fps:%.1f\n", (unsigned)perf.frames,
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
  tileMux = xSemaphoreCreateMutex();
  helperGo = xSemaphoreCreateBinary();
  helperIdle = xSemaphoreCreateBinary();
  xTaskCreatePinnedToCore(helperLoop, "render", 4096, nullptr, 1, &helper, 0);   // it uses ~2.4 KB (`render` stack:)
  Preferences p;
  p.begin("kp", true);
  brightness = p.getUChar("bright", 200);
  dimAfterS = p.getUShort("dim", DIM_DEFAULT_S);
  themeIdx = constrain(p.getUChar("theme", THEME_DEFAULT), 0, THEME_COUNT - 1);
  iconMotion = p.getBool("ianim", true);
  String bar = p.getString("qbar", "");
  p.end();
  String err;
  if (bar.length() && !qbParse(bar.c_str(), qb, err)) Con.printf("quick bar: %s\n", err.c_str());
  qbCheck();
  applyTheme(themeIdx);
  fontsBegin();
  lastAct = millis();
  displaySetBacklight(profileBrightness >= 0 ? profileBrightness : brightness);
  markScreen();
  if (!touchCalibrated()) uiCalibrate();
}

void uiMarkAll() { markScreen(); }
void uiMarkCell(int c) { if (c >= 0 && c < NUM_CELLS) { if (playerPage()) mark(0, STATUS_H, SCR_W, LINE_Y - STATUS_H); else markCellRect(c); } }
void uiMarkStatus() {   // BLE state or the battery changed: refresh the cached names, then redraw
  strlcpy(hostName, hidConnected() ? bleHostName(bleConnectedSlot()).c_str() : "", sizeof hostName);
  mark(0, 0, SCR_W, STATUS_H);
  // The host lists repaint only when a host changed (the battery reading changes every few seconds).
  if (mode == M_SHEET && sheetTab == 2 && refreshHosts()) mark(0, STATUS_H, SCR_W, SCR_H - STATUS_H);
  if (mode == M_SHADE && refreshHosts()) markShade();
  if (mode == M_MENU) { markMenu(); if (refreshHosts()) markMenu(); }
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

int uiDim() { return dimAfterS; }
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
  slideEnd();
  applyTheme(i);
  Con.printf("EVT:THEME %s\n", T->id);
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
  stopIcons();
  for (int c = 0; c < NUM_CELLS; c++) ca[c].ring = 0;
  nextTurn = now + order * POP_STEP + POP_MS + TURN_MS;   // idle turns wait for the page's wave
  nextWave = now + WAVE_MIN + esp_random() % WAVE_SPAN;
  mark(0, 0, SCR_W, STATUS_H);
  mark(0, LINE_Y, SCR_W, SCR_H - LINE_Y);
}

// The page kind changes (keys <-> player): wipe the new page down over the old.
static void startWipe() {
  stopIcons();
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

void uiGoPage(int idx, bool push, bool slides) {
  if (idx < 0 || idx >= pageCount) return;
  int from = currentPage;
  bool wasPlayer = playerPage();
  slides = slides && idx != from && !topLayer();   // the page on screen: it slides in, the old one beside it
  slideEnd();
  if (slides) swap(pageDoc, slide.doc);
  if (!loadPage(idx)) {
    if (slides) { swap(pageDoc, slide.doc); slide.doc.clear(); }
    else loadPage(from);
    return;
  }
  if (push && idx != from) {
    if (backDepth == (int)sizeof backStack) memmove(backStack, backStack + 1, --backDepth);
    backStack[backDepth++] = from;
  }
  Con.printf("EVT:PAGE %d\n", idx + 1);
  if (slides) slideFrom(from, from < MAX_PAGES ? toggles[from] : 0);
  else if (wasPlayer != playerPage()) startWipe(); else startWave();
}

void uiBack() { uiGoPage(backDepth ? backStack[--backDepth] : 0, false); }

// ---------------------------------------------------------------- the quick bar's panels
static void panelGo(int idx, bool push) {   // the top layer's page idx
  Layer *L = topLayer();
  if (!L || idx < 0 || idx >= L->pages || idx == L->page) return;
  slideEnd();
  swap(L->doc, slide.doc);   // the old page is drawn beside the new one
  if (!loadPageInto(L->prof, idx, L->doc)) { swap(L->doc, slide.doc); slide.doc.clear(); return; }
  if (push) {
    if (L->depth == (int)sizeof L->back) memmove(L->back, L->back + 1, --L->depth);
    L->back[L->depth++] = L->page;
  }
  int from = L->page;
  uint16_t t = L->toggles;
  L->page = idx;
  L->toggles = 0;
  emitPanel();
  slideFrom(from, t);
}

// A swipe or a station: the page next door in whatever the grid shows.
static void viewGo(int idx) {
  if (topLayer()) panelGo(idx, false);
  else if (idx >= 0 && idx < pageCount) uiGoPage(idx, false);
}

static void layerClose(Layer &L) {
  if (!L.btn) return;
  if (&L == &media) { mediaDrop(); emitPanel(); markBar(); return; }   // it falls; cleared when it lands
  layerClear(L);
  emitPanel();
  startWipe();
  markBar();
}

// 1: Media (entry 1), over whatever is open; 2-4: a bar panel (Media goes); 0: both go.
void uiPanel(int btn) {
  if (btn < 0 || btn > QB_BUTTONS) return;
  slideEnd();
  if (btn == 0) {
    if (!panel.btn && !media.btn) return;
    if (panel.btn) { layerClear(panel); startWipe(); }
    mediaDrop();
    emitPanel();
    markBar();
    return;
  }
  if (btn == 1) {   // Media: it rises over whatever is open
    if (topLayer() == &media) return;
    if (!mediaLoad()) { if (media.btn) { layerClear(media); emitPanel(); } markBar(); return; }
    mediaShow();
    emitPanel();
    markBar();
    return;
  }
  if (media.btn && panel.btn == btn) { layerClose(media); return; }   // its panel is under Media: show it
  Layer &L = btn == 1 ? media : panel;
  QbBtn &b = qb[btn - 1];
  char name[24];
  int pages = 0;
  uint8_t col[3];
  bool was = L.btn;
  b.ok = b.prof && profileMeta(b.prof, name, sizeof name, &pages, col) && b.page <= pages && loadPageInto(b.prof, b.page - 1, L.doc);
  if (!b.ok) {   // gone since it was set: draw it empty, and don't leave a half-loaded layer up
    if (was) layerClose(L); else L.doc.clear();
    markBar();
    return;
  }
  L.btn = btn;
  L.prof = b.prof;
  L.page = L.start = b.page - 1;
  L.pages = min(pages, MAX_PAGES);
  L.depth = 0;
  L.toggles = 0;
  memcpy(L.col, col, 3);
  mediaDrop();   // a bar button with Media up: Media falls away over the panel
  emitPanel();
  startWipe();
  markBar();
}

int uiPanelOpen() { Layer *L = topLayer(); return L ? L->btn : 0; }

void uiKeyGoPage(int idx) {
  if (topLayer()) panelGo(idx, true);
  else uiGoPage(idx, true);
}

void uiKeyBack() {
  Layer *L = topLayer();
  if (!L) { uiBack(); return; }
  if (L->depth) panelGo(L->back[--L->depth], false);
  else if (L->page != L->start) panelGo(L->start, false);   // reached by a swipe or a station: its first page
  else layerClose(*L);   // back on the page the entry opens: that layer goes
}

void uiKeyProfile(int n) { uiSetProfile(n, "touch"); }

#define QB_SETTINGS 5
static int barHit(int x, int y) {   // -1 off the bar, 0 the suggestion slot, 2-4 entries 2-4 (rows 0-2), QB_SETTINGS row 3
  if (x < BAR_X || x >= SCR_W || y < STATUS_H || y >= SCR_H) return -1;
  if (y < QB_Y0) return 0;
  int row = (y - QB_Y0) / QB_H;
  return row < QB_BUTTONS - 1 ? row + 2 : row == QB_BUTTONS - 1 ? QB_SETTINGS : -1;
}

static void barTap(int i) {
  if (i == 0) {   // the suggestion slot: the way back first, else the suggestion
    if (backTo.prof) {
      int p = backTo.prof, pg = backTo.page;
      feedbackClick();
      uiSetProfile(p, "back");
      if (pg > 0 && pg < pageCount) uiGoPage(pg, false);
    } else if (sug.slot && sug.slot != currentProfile) {
      feedbackClick();
      uiSetProfile(sug.slot, "suggest");
    }
    return;
  }
  if (i == QB_SETTINGS) { feedbackClick(); uiOpenSheet(); return; }
  if (i < 2 || i > QB_BUTTONS || !qb[i - 1].prof || !qb[i - 1].ok) return;   // an empty button does nothing
  feedbackClick();
  uiPanel(panel.btn == i && !media.btn ? 0 : i);   // with Media up, the panel's own button shows the panel
}

void uiToast(const char *t) {
  int x, y, w, h;
  if (toastOn) { toastRect(&x, &y, &w, &h); mark(x - 6, y, w + 12, h + 16); }
  agState = 0xff;
  strlcpy(toastText, ellipsize(fBodyB, t, 390).c_str(), sizeof toastText);
  toast0 = millis();
  toastOn = true;
}

void uiAutogen(int state, const char *text) {
  uiToast(*text ? text : state == AG_DONE ? "Profile ready" : state == AG_FAIL ? "Could not generate" : "Generating...");
  if (state <= AG_BUSY) { agState = state; agAt = millis(); }
  else uiNotify("Generate", toastText, "", "sparkles", "autogen", false);   // the toast told it; the shade keeps it
}

void uiSetProfile(int n, const char *how) {
  int from = currentProfile, fromPage = currentPage;
  slideAbort();   // a new profile: no slide, and the touch in progress can't start one on it
  if (how) uiPanel(0);   // the owner picked a profile: show it, not a panel over it
  macroEngine.abort();
  backDepth = 0;
  memset(toggles, 0, sizeof toggles);
  loadProfileSafe(n);
  if (!dimState) displaySetBacklight(profileBrightness >= 0 ? profileBrightness : brightness);
  if (mode == M_SHEET) { loadSlots(); mark(0, STATUS_H, SCR_W, SCR_H - STATUS_H); }
  if (mode == M_SHADE) markShade();
  char t[48];
  snprintf(t, sizeof t, "Profile %d \xc2\xb7 %s", currentProfile, profileName);
  uiToast(t);
  if (currentProfile != from) {   // a new profile: the way back exists only right after a suggestion
    backTo.prof = 0;
    if (how && !strcmp(how, "suggest")) {
      int pages;
      if (profileMeta(from, backTo.name, sizeof backTo.name, &pages, backTo.col)) { backTo.prof = from; backTo.page = fromPage; }
    }
  }
  if (how && currentProfile == n) Con.printf("EVT:SWITCH %d %s\n", n, how);
  markBar();
  startWave();   // old keys stay until their turn in the wave replaces them
}

void uiSuggest(int slot) {
  int pages;
  sug.slot = slot >= 1 && slot <= NUM_PROFILES && profileMeta(slot, sug.name, sizeof sug.name, &pages, sug.col) ? slot : 0;
  markBar();
}

int uiSuggested() { return sug.slot; }

void uiFlash(int c, bool ok) {
  if (c < 0 || c >= NUM_CELLS) return;
  ca[c].ring = ok ? 1 : 2;
  ca[c].ring0 = millis();
  if (ok) playIcon(c, ca[c].ring0, true);   // the icon acts out what the key just did
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

uint8_t *uiArtBuffer(size_t size) {   // a raw cover: held as it is, whatever page shows
  if (size != 128 * 128 * 2) return nullptr;
  free(artJpg);
  artJpg = nullptr;
  artJpgLen = 0;
  if (!art) art = (uint16_t *)malloc(size);
  artOk = false;
  return (uint8_t *)art;
}
uint8_t *uiArtJpgBuffer(size_t size) {
  if (!size || size > 16384) return nullptr;
  free(artJpg);
  artJpgLen = 0;
  artJpg = (uint8_t *)malloc(size);
  return artJpg;
}
void uiArtJpgDone(bool ok, size_t len) {
  artJpgLen = ok && artJpg ? len : 0;
  if (!artJpgLen) { free(artJpg); artJpg = nullptr; }
  artOk = false;   // decoded on the next frame if a player shows
  if (playerPage()) mark(0, STATUS_H, 160, 160);
}
void uiArtPrint() { Con.printf("art jpg:%u decoded:%d ms:%u\n", (unsigned)artJpgLen, artJpgLen && artOk ? 1 : 0, (unsigned)artMs); }
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

void uiOpenSheet(int tab) {
  if (tab >= 0 && tab < 5) sheetTab = tab;
  if (mode == M_SHEET && !sheetClosing) { mark(0, STATUS_H, SCR_W, SCR_H - STATUS_H); return; }
  if (mode != M_HOME && mode != M_SHEET) return;
  loadSlots();
  bool was = mode == M_SHEET;   // closing: it turns back
  mode = M_SHEET;
  sheetClosing = false;
  if (!was) sheetRise = { 0, 0, 0, sheetK, sheetZ, false };
  riseGo(sheetRise, 1, was ? sheetRise.v : 0);
  pressed = -1;
  emitMode();
}

void uiCloseSheet() {
  if (mode != M_SHEET || sheetClosing) return;
  sheetClosing = true;
  riseGo(sheetRise, 0, 0);
  dragSlider = -1;
}
bool uiSheetOpen() { return mode == M_SHEET && !sheetClosing; }

void uiNotify(const char *app, const char *title, const char *body, const char *icon, const char *tag, bool banner) {
  int at = noteN < NOTE_MAX ? noteN : NOTE_MAX - 1;   // the slot it takes: a new one, or the oldest's
  if (tag && *tag) for (int i = 0; i < noteN; i++) if (!strcmp(notes[i].tag, tag)) { at = i; break; }   // or the one it updates
  bool reuse = at < noteN;
  if (reuse && at < noteUnread) noteUnread--;
  memmove(&notes[1], &notes[0], at * sizeof(Note));
  if (!reuse) noteN++;
  Note &n = notes[0];
  strlcpy(n.app, app && *app ? app : "PC", sizeof n.app);
  strlcpy(n.title, title ? title : "", sizeof n.title);
  strlcpy(n.body, body ? body : "", sizeof n.body);
  strlcpy(n.icon, icon && *icon ? icon : "bell", sizeof n.icon);
  strlcpy(n.tag, tag ? tag : "", sizeof n.tag);
  n.at = millis();
  if (mode == M_SHADE) { noteUnread = 0; markShade(); }   // on screen: seen
  else if (banner) noteUnread = min(noteUnread + 1, noteN);
  mark(0, 0, SCR_W, STATUS_H);
  if (banner && mode == M_HOME) {
    banNote = n;
    ban0 = banOn ? millis() - 180 : millis();   // one already down: swap the text, no second entrance
    banOn = true;
    markBanner();
    uiWake();
  }
}
static void notifyRemove(int i) {
  if (i < 0 || i >= noteN) return;
  markShade();
  if (i < noteUnread) noteUnread--;
  memmove(&notes[i], &notes[i + 1], (--noteN - i) * sizeof(Note));
  mark(0, 0, SCR_W, STATUS_H);
}
void uiNotifyClear() {
  if (mode == M_SHADE) markShade();
  noteN = noteUnread = 0;
  mark(0, 0, SCR_W, STATUS_H);
}
void uiNotifyList() {
  Con.printf("notify %d unread %d\n", noteN, noteUnread);
  for (int i = 0; i < noteN; i++) Con.printf("%d %s\t%s\t%s\t%s\n", i + 1, notes[i].app, notes[i].title, notes[i].body, notes[i].icon);
}

void uiOpenShade() {
  if (mode != M_HOME) return;
  refreshHosts();   // what the shade shows; nothing slow (all the profiles' details took 1.5 s)
  if (banOn) { banOn = false; markBanner(); }
  mode = M_SHADE;
  shadeClosing = false;
  shade0 = 0;   // the slide's clock starts at its first frame (animate), so a slow moment before it can't make it jump
  shadeBotDrawn = STATUS_H;
  pressed = pressedBtn = dragSlider = -1;
  if (noteUnread) { noteUnread = 0; mark(0, 0, SCR_W, STATUS_H); }   // the shade shows them: the bell's count goes
  emitMode();
}
void uiCloseShade() {   // and the host menu
  if (mode == M_MENU) { markMenu(); mode = M_HOME; emitMode(); return; }
  if (mode != M_SHADE || shadeClosing) return;
  shadeClosing = true;
  shade0 = 0;
  pressedBtn = dragSlider = -1;
}

static void openHostMenu() {
  if (mode != M_HOME) return;
  refreshHosts();   // all the menu shows
  mode = M_MENU;
  menu0 = millis();
  pressed = pressedBtn = -1;
  markMenu();
  emitMode();
}
static void closeMenu() {
  markMenu();
  mode = M_HOME;
  emitMode();
}
static void useHost(int i) {   // from the shade or the host menu
  if (i < 0 || i >= info.bonds || info.up[i]) return;
  char t[48];
  snprintf(t, sizeof t, "Switching to %s", info.names[i]);
  bleUse(i);
  uiToast(t);
}

// ---------------------------------------------------------------- calibration
void uiCalibrate() {
  mode = M_CAL;
  calStep = 0;
  calNote = 0;
  calDotN = 0;
  pressed = -1;
  uiWake();
  Con.println("EVT:CAL start");
  emitMode();
  markScreen();
}

void uiCalibrateCancel() {
  if (mode != M_CAL) return;
  mode = M_HOME;
  calStep = -1;
  Con.println("EVT:CAL cancel");
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
    Con.printf("EVT:CAL point %d %d %d\n", calStep + 1, rx, ry);
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
      if (worst > 30) { Con.printf("EVT:CAL retry fit %d\n", worst); calStep = 0; calNote = 1; }
    }
  } else if (calStep == 4) {
    int sx, sy;
    touchMapWith(calCand, rx, ry, &sx, &sy);
    calErr = (int)hypotf(sx - CAL_VX, sy - CAL_VY);
    if (calErr <= 16) {
      touchSetCal(calCand, true);
      Con.printf("EVT:CAL saved %d\n", calErr);
      calStep = 5;
      calDotN = 0;
    } else {
      Con.printf("EVT:CAL retry verify %d\n", calErr);
      calStep = 0;
      calNote = 2;
    }
  } else {
    if (inRect(x, y, 132, 262, 104, 44)) { calStep = 0; calNote = 0; Con.println("EVT:CAL redo"); }
    else if (inRect(x, y, 248, 262, 100, 44)) {
      mode = M_HOME;
      calStep = -1;
      Con.println("EVT:CAL done");
      emitMode();
    } else if (calDotN < 24) { calDots[calDotN][0] = x; calDots[calDotN][1] = y; calDotN++; }
  }
  markScreen();
}

// ---------------------------------------------------------------- gestures
static void shadeSlider(int x) {
  uiSetBrightness(max(13, (int)(clamp01((x - (SH_SLX + 13)) / (float)(SH_SLW - 26)) * 255)));
  mark(SH_SLX - 4, SH_ROW1 - 2, SH_SLW + 8, 48);
}
static int shadeButtonAt(int x, int y) {   // ids match drawShade's pressedBtn
  if (inRect(x, y, SH_PRV, SH_ROW1, 38, 44)) return 101;
  if (inRect(x, y, SH_NAME, SH_ROW1, SH_NAMEW, 44)) return 102;
  if (inRect(x, y, SH_NXT, SH_ROW1, 38, 44)) return 103;
  for (int i = 0; i < 3; i++)
    if (inRect(x, y, 12 + i * 154, SH_ROW2, 148, 46)) return i < info.bonds ? 110 + i : i == info.bonds ? 120 : -1;
  if (noteN && inRect(x, y, 370, SH_LIST - 28, 106, 28)) return 130;
  for (int k = 0; k < shadeRows(); k++) if (inRect(x, y, 8, SH_LIST + k * SH_ROWH, 464, 42)) return 140 + k;
  return -1;
}
static void stepProfile(int dir) {   // the next saved profile that way, round the ring (a file check each, on the tap)
  char path[24];
  for (int k = 1; k < NUM_PROFILES; k++) {
    int n = (currentProfile - 1 + dir * k + 2 * NUM_PROFILES) % NUM_PROFILES + 1;
    snprintf(path, sizeof path, "/profile%d.json", n);
    if (LittleFS.exists(path)) { uiSetProfile(n, "touch"); return; }
  }
}
static void shadeTap(int x, int y, int b) {
  if (y >= shadeHeight() - 16) { uiCloseShade(); return; }   // the handle, or the page below
  if (b < 0 || shadeButtonAt(x, y) != b) return;
  if (b == 101 || b == 103) stepProfile(b == 101 ? -1 : 1);
  else if (b == 102) { mode = M_HOME; markScreen(); uiOpenSheet(1); }
  else if (b >= 110 && b < 113) { useHost(b - 110); markShade(); }
  else if (b == 120) { mode = M_HOME; emitMode(); markScreen(); blePairOpen(); }
  else if (b == 130) uiNotifyClear();
}
static int menuRowAt(int x, int y) {
  if (!inRect(x, y, menuX(), MENU_Y + 4, MENU_W, (info.bonds + 1) * MENU_ROW)) return -1;
  return 200 + (y - MENU_Y - 4) / MENU_ROW;
}

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
  if (sheetTab == 4 && inRect(x, y, GEN_X, 42, GEN_W, 44)) return 41;
  if (sheetTab == 1 && inRect(x, y, GEN_X, 42, GEN_W, 44)) return 60;
  return -1;
}

static void sheetTap(int x, int y) {
  for (int i = 0; i < 5; i++)
    if (inRect(x, y, 8, 40 + i * 52, 108, 48)) {
      sheetTab = i;
      loadSlots();
      mark(0, STATUS_H, SCR_W, SCR_H - STATUS_H);
      return;
    }
  int b = sheetButtonAt(x, y);
  if (b == 1) { uiCloseSheet(); return; }
  if (b >= 10 && b < 13) { bleUse(b - 10); refreshInfo(); mark(0, STATUS_H, SCR_W, SCR_H - STATUS_H); return; }
  if (b >= 20 && b < 23) { bleForget(b - 20); refreshInfo(); mark(0, STATUS_H, SCR_W, SCR_H - STATUS_H); return; }
  if (b == 30) { mode = M_HOME; blePairOpen(); return; }
  if (b == 40) { uiCalibrate(); return; }
  if (b == 41) {
    if (offArmedAt) { offArmedAt = 0; uiCloseSheet(); powerOff(); }
    else { offArmedAt = millis() | 1; mark(GEN_X, 42, GEN_W, 44); }
    return;
  }
  if (b == 60) {   // Studio takes it from here: current app, usage, Claude, upload, setprofile
    Con.println("EVT:AUTOGEN");
    uiCloseSheet();
    uiAutogen(AG_ASK, "Asking Studio...");
    return;
  }
  switch (sheetTab) {
    case 0:
      if (inRect(x, y, PANE_X - 3, THEME_Y - 3, PANE_W + 6, 2 * THEME_ROW)) {
        int col = constrain((int)((x - PANE_X) / (themeChipW() + THEME_GAP)), 0, THEME_COLS - 1), row = (y - THEME_Y + 3) / THEME_ROW;
        if (row * THEME_COLS + col < THEME_COUNT) uiSetTheme(row * THEME_COLS + col);
      }
      break;
    case 1:
      if (y >= CARD_Y && x >= PANE_X) {
        int col = (x - PANE_X) / (CARD_W + CARD_GAP), row = (y - CARD_Y) / (CARD_H + CARD_GAP);
        int n = row * 4 + col + 1;
        if (col < 4 && row < 4 && n <= NUM_PROFILES && slots[n - 1].ok) uiSetProfile(n, "touch");
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
    if (Layer *L = topLayer()) L->toggles ^= 1 << c;
    else if (currentPage < MAX_PAGES) toggles[currentPage] ^= 1 << c;
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
    if (kind == G_DOWN) rn = 0;
    if (kind == G_DOWN && sheetRise.on) { sheetRise.x = sheetRise.to; sheetRise.v = 0; sheetRise.on = false; riseMark(true); }   // lands at once
    if (kind == G_MOVE && dragSlider < 0) {   // a drag down: the sheet follows
      int dx = x1 - x0, dy = y1 - y0;
      if (!sheetDrag && dy > LOCK_PX && dy > abs(dx)) {
        sheetDrag = true;
        sheetRise.on = false;
        if (pressedBtn >= 0) { pressedBtn = -1; mark(0, STATUS_H, SCR_W, SCR_H - STATUS_H); }
      }
      if (sheetDrag) { riseSample(y1, now); sheetRise.x = constrain(1 - dy / (float)(SCR_H - STATUS_H), 0.0f, 1.0f); }
      return;
    }
    if (sheetDrag && (kind == G_TAP || (kind >= G_SWIPE_L && kind <= G_SWIPE_D))) {   // let go: closes, or springs back
      sheetDrag = false;
      if (rn && ry[rn - 1] != y1) { riseSample(y1, now); sheetRise.x = constrain(1 - (y1 - y0) / (float)(SCR_H - STATUS_H), 0.0f, 1.0f); }
      float v = riseVelocity();
      if (flickTarget(sheetRise.x, v, 0, 1) == 0) { sheetClosing = true; dragSlider = -1; riseGo(sheetRise, 0, v); }
      else riseGo(sheetRise, 1, v);
      return;
    }
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
  if (mode == M_MENU) {
    if (kind == G_DOWN) { pressedBtn = menuRowAt(x0, y0); markMenu(); }
    else if (kind == G_TAP) {
      int b = menuRowAt(x1, y1) == pressedBtn ? pressedBtn : -1;
      pressedBtn = -1;
      closeMenu();
      if (b >= 200 && b - 200 < info.bonds) useHost(b - 200);
      else if (b == 200 + info.bonds) blePairOpen();
    } else if (kind >= G_SWIPE_L && kind <= G_SWIPE_D) { pressedBtn = -1; closeMenu(); }
    return;
  }
  if (mode == M_SHADE) {
    if (shadeClosing) return;
    if (kind == G_DOWN) {
      if (inRect(x0, y0, SH_SLX, SH_ROW1, SH_SLW, 44)) { dragSlider = 2; shadeSlider(x0); }
      else { pressedBtn = shadeButtonAt(x0, y0); if (pressedBtn >= 0) markShade(); }
    } else if (kind == G_MOVE && dragSlider == 2) shadeSlider(x1);
    else if (kind == G_TAP || (kind >= G_SWIPE_L && kind <= G_SWIPE_D)) {
      bool wasDrag = dragSlider >= 0;
      int b = pressedBtn;
      dragSlider = pressedBtn = -1;
      if (b >= 0) markShade();
      if (wasDrag) return;
      if (kind == G_SWIPE_U) uiCloseShade();
      else if ((kind == G_SWIPE_L || kind == G_SWIPE_R) && b >= 140) notifyRemove(b - 140);   // swipe one away
      else if (kind == G_TAP) shadeTap(x1, y1, b);
    }
    return;
  }
  if (mode != M_HOME) return;

  // The banner: a tap opens the shade, a swipe sends it away; keys under it stay untouched.
  if (banOn && banProg(now) > 0.3f && inRect(x0, y0, BAN_X, BAN_Y, BAN_W, BAN_H)) {
    if (kind == G_TAP || (kind >= G_SWIPE_L && kind <= G_SWIPE_D)) { banOn = false; markBanner(); }
    if (kind == G_TAP || kind == G_SWIPE_D) uiOpenShade();
    return;
  }

  if (slideGesture(kind, x0, y0, x1, y1, now)) return;   // a sideways drag: the page under the finger
  if (riseGesture(kind, x0, y0, x1, y1, now)) return;    // up and down: Media follows the finger

  // The quick bar takes taps only; a swipe that starts on it turns pages as anywhere else.
  if ((kind == G_DOWN || kind == G_TAP) && x0 >= BAR_X && y0 >= STATUS_H) {
    if (kind == G_TAP && barHit(x1, y1) == barHit(x0, y0)) barTap(barHit(x0, y0));
    return;
  }

  if (playerPage()) {
    if (kind == G_DOWN) {
      const PBtn *B;
      int nb = playerBtns(B);
      for (int i = 0; i < nb; i++)
        if (hypotf(x0 - B[i].x, y0 - BTN_Y) <= B[i].r + 6) { pressedBtn = i; feedbackClick(); mark(0, BTN_Y - 46, SCR_W, 92); }
    } else if (kind == G_TAP) {
      int b = pressedBtn;
      pressedBtn = -1;
      if (b >= 0) {
        released = 100 + b;
        release0 = now;
        const PBtn *B;
        playerBtns(B);
        if (hypotf(x1 - B[b].x, y1 - BTN_Y) <= B[b].r + 10) {
          if (*B[b].media) { hidSendMedia(mediaNameToCode(B[b].media)); uiMediaKey(B[b].media); }
          else macroEngine.start(keyAt(0), false, 0, "mic_actions");   // the mic: the widget's own actions
        }
        mark(0, BTN_Y - 46, SCR_W, 92);
      } else if (inRect(x1, y1, SEEK_X - 8, 134, SEEK_W + 16, 44) && np.len > 0) {
        int sec = (int)(clamp01((x1 - SEEK_X) / (float)SEEK_W) * np.len);
        Con.printf("EVT:SEEK %d\n", sec);
        np.pos = sec;
        np.at = now;
        mark(SEEK_X - 8, 140, SEEK_W + 16, 56);
      } else if (onBell(x0, y0)) uiOpenShade();
      else if (onHostChip(x0, y0)) openHostMenu();
      else if (onProfChip(x0, y0)) uiOpenSheet(1);
      else if (y0 >= LINE_Y) {
        int total = (viewPages() - 1) * 30, xs = KEYS_W / 2 - total / 2, best = -1, bd = 99;
        for (int i = 0; i < viewPages(); i++) { int d = abs(x0 - (xs + i * 30)); if (d < bd) { bd = d; best = i; } }
        if (best >= 0 && bd <= 16 && best != viewPage()) viewGo(best);
      }
    } else if (kind == G_SWIPE_L) { pressedBtn = -1; viewGo(viewPage() + 1); }
    else if (kind == G_SWIPE_R) { pressedBtn = -1; viewGo(viewPage() - 1); }
    else if (kind == G_SWIPE_U) { pressedBtn = -1; if (!media.btn && qb[0].prof && qb[0].ok) uiPanel(1); }   // entry 1: Media (none set: nothing)
    else if (kind == G_SWIPE_D) { pressedBtn = -1; if (topLayer() == &media) layerClose(media); else uiOpenShade(); }
    return;
  }

  auto hit = [](int x, int y) -> int {
    if (y < STATUS_H || y >= LINE_Y || x < 0 || x >= KEYS_W) return -1;
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
      else if (c < 0 && onBell(x0, y0)) uiOpenShade();
      else if (c < 0 && onHostChip(x0, y0)) openHostMenu();
      else if (c < 0 && onProfChip(x0, y0)) uiOpenSheet(1);
      else if (c < 0 && y0 >= LINE_Y && viewPages() > 1) {
        int total = (viewPages() - 1) * 30, xs = KEYS_W / 2 - total / 2, best = -1, bd = 99;
        for (int i = 0; i < viewPages(); i++) { int d = abs(x0 - (xs + i * 30)); if (d < bd) { bd = d; best = i; } }
        if (best >= 0 && bd <= 16 && best != viewPage()) viewGo(best);
      }
      break;
    }
    case G_SWIPE_L: release(pressed); viewGo(viewPage() + 1); break;
    case G_SWIPE_R: release(pressed); viewGo(viewPage() - 1); break;
    case G_SWIPE_U: release(pressed); if (!media.btn && qb[0].prof && qb[0].ok) uiPanel(1); break;   // entry 1: Media (none set: nothing)
    case G_SWIPE_D: release(pressed); if (topLayer() == &media) layerClose(media); else uiOpenShade(); break;   // Media closes, else the shade comes down
  }
}
