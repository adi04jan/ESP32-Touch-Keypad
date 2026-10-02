// Pixel loops: the core builds with -Os, which leaves these 2-3x slower.
#pragma GCC optimize("O2")
#include "gfx.h"
#include "board.h"
#include "fonts_gen.h"
#include "icons_gen.h"

static uint16_t *K;               // chunk pixels
static int KX, KY, KW, KH;        // chunk rectangle
static int CX0, CY0, CX1, CY1;    // clip, inside the chunk
static uint16_t ground[SCR_H], groundB[SCR_H];   // the two checkerboard values of each row
static C3 groundC[SCR_H];

static const C3 WHITE = { 255, 255, 255 };
static bool crisp = false;
static C3 shadowC = { 0, 0, 0 };
static int shadowK = 255;

// Two swapped-RGB565 values whose checkerboard averages c to half a 565 step.
// Gentle gradients (a white tile, a night sky) otherwise band, and on near
// whites red and blue drop a step on different rows from green, which tints
// the band pink. The pixel theme keeps its exact palette.
static inline int div255(int x) { return (x + 1 + (x >> 8)) >> 8; }   // x / 255 for x < 65535, no divide
static inline void dith(C3 c, uint16_t &a, uint16_t &b) {
  if (crisp) { a = b = pk(c); return; }
  int r2 = div255(c.r * 62 + 127), g2 = div255(c.g * 126 + 127), b2 = div255(c.b * 62 + 127);
  uint16_t va = (r2 >> 1) << 11 | (g2 >> 1) << 5 | (b2 >> 1);
  uint16_t vb = ((r2 + 1) >> 1) << 11 | ((g2 + 1) >> 1) << 5 | ((b2 + 1) >> 1);
  a = __builtin_bswap16(va);
  b = __builtin_bswap16(vb);
}

void gfxBegin(const C3 &top, const C3 &mid, const C3 &bottom, uint8_t texture) {
  const int half = (SCR_H - 1) / 2;
  for (int y = 0; y < SCR_H; y++) {
    C3 c = y <= half ? mix(top, mid, y * 255 / half) : mix(mid, bottom, (y - half) * 255 / (SCR_H - 1 - half));
    if (texture == 1) {   // laid paper: faint uneven rows
      uint32_t h = (uint32_t)y * 2654435761u;
      int d = (int)((h >> 28) & 7) - 3;
      c = d >= 0 ? mix(c, WHITE, d * 3) : mix(c, C3{ 60, 40, 20 }, -d * 4);
    } else if (texture == 2 && y % 3 == 2) {   // LCD: a darker gap every third row
      c = mix(c, C3{ 15, 56, 15 }, 22);
    }
    groundC[y] = c;
    if (texture == 2) ground[y] = groundB[y] = pk(c);
    else dith(c, ground[y], groundB[y]);
  }
}
C3 gfxGroundAt(int y) { return groundC[y < 0 ? 0 : y >= SCR_H ? SCR_H - 1 : y]; }
void gfxSetCrisp(bool on) { crisp = on; }
void gfxSetShadow(const C3 &c, int strength) { shadowC = c; shadowK = strength; }

// One dithered span of row y, two pixels per 32-bit store (a per-pixel parity test
// made every filled shape ~2x slower).
static inline void ditherSpan(uint16_t *row, int x0, int x1, int y, uint16_t va, uint16_t vb) {
  int n = x1 - x0;
  if (n <= 0) return;
  uint16_t *p = row + x0;
  bool odd = (x0 + y) & 1;
  uint16_t v0 = odd ? vb : va, v1 = odd ? va : vb;
  if ((uintptr_t)p & 2) { *p++ = v0; uint16_t t = v0; v0 = v1; v1 = t; n--; }
  uint32_t vv = v0 | (uint32_t)v1 << 16, *q = (uint32_t *)p;
  for (int i = n >> 1; i; i--) *q++ = vv;
  if (n & 1) *(uint16_t *)q = v0;
}

void gfxChunk(uint16_t *buf, int x, int y, int w, int h) {
  K = buf; KX = x; KY = y; KW = w; KH = h;
  gfxUnclip();
}
void gfxUnclip() { CX0 = KX; CY0 = KY; CX1 = KX + KW; CY1 = KY + KH; }
void gfxClipAnd(int x0, int y0, int x1, int y1) { CX0 = max(CX0, x0); CY0 = max(CY0, y0); CX1 = min(CX1, x1); CY1 = min(CY1, y1); }
void gfxClipGet(int c[4]) { c[0] = CX0; c[1] = CY0; c[2] = CX1; c[3] = CY1; }
void gfxClipSet(const int c[4]) { CX0 = c[0]; CY0 = c[1]; CX1 = c[2]; CY1 = c[3]; }
void gfxClip(int x0, int y0, int x1, int y1) {
  CX0 = max(KX, x0); CY0 = max(KY, y0); CX1 = min(KX + KW, x1); CY1 = min(KY + KH, y1);
}
bool gfxHits(int x, int y, int w, int h) { return x < CX1 && y < CY1 && x + w > CX0 && y + h > CY0; }

static inline bool clipBox(int &x0, int &y0, int &x1, int &y1) {
  if (x0 < CX0) x0 = CX0;
  if (y0 < CY0) y0 = CY0;
  if (x1 > CX1) x1 = CX1;
  if (y1 > CY1) y1 = CY1;
  return x0 < x1 && y0 < y1;
}
static inline uint16_t &P(int x, int y) { return K[(y - KY) * KW + (x - KX)]; }

// Blend in RGB565 with the green lane spread out of the way (0x07E0F81F):
// one multiply for all three channels. `fg` is plain (unswapped) RGB565.
static inline uint16_t to565(C3 c) { return ((c.r & 0xF8) << 8) | ((c.g & 0xFC) << 3) | (c.b >> 3); }
static inline void blendP(uint16_t &d, uint16_t fg, int a) {
  if (crisp) a = a >= 128 ? 255 : 0;
  if (a <= 0) return;
  if (a >= 255) { d = __builtin_bswap16(fg); return; }
  uint32_t bg = __builtin_bswap16(d), a5 = (a + 4) >> 3;
  uint32_t x = (bg | bg << 16) & 0x07E0F81F, y = (fg | (uint32_t)fg << 16) & 0x07E0F81F;
  x = (x + (((y - x) * a5) >> 5)) & 0x07E0F81F;
  d = __builtin_bswap16((uint16_t)(x | x >> 16));
}
static inline void blend(int x, int y, C3 c, int a) { blendP(P(x, y), to565(c), a); }

IRAM_ATTR void gfxGround() {
  for (int y = CY0; y < CY1; y++) {
    uint16_t *p = &P(CX0, y);
    int x = CX0, n = CX1 - CX0;
    if (((uintptr_t)p & 2) && n) { *p++ = ((x + y) & 1) ? groundB[y] : ground[y]; x++; n--; }
    uint16_t v0 = ((x + y) & 1) ? groundB[y] : ground[y], v1 = ((x + y) & 1) ? ground[y] : groundB[y];
    uint32_t vv = v0 | (uint32_t)v1 << 16, *q = (uint32_t *)p;   // little endian: the low half is the left pixel
    for (int i = 0; i < n / 2; i++) *q++ = vv;
    if (n & 1) *(uint16_t *)q = v0;
  }
}

void gfxFill(const C3 &c) {
  uint16_t v = pk(c);
  for (int y = CY0; y < CY1; y++) {
    uint16_t *p = &P(CX0, y);
    for (int x = CX0; x < CX1; x++) *p++ = v;
  }
}

IRAM_ATTR void fillRect(int x, int y, int w, int h, C3 c, int alpha) {
  int x0 = x, y0 = y, x1 = x + w, y1 = y + h;
  if (alpha <= 0 || !clipBox(x0, y0, x1, y1)) return;
  if (alpha >= 255) {
    uint16_t v = pk(c);
    for (int py = y0; py < y1; py++) for (int px = x0; px < x1; px++) P(px, py) = v;
    return;
  }
  for (int py = y0; py < y1; py++) for (int px = x0; px < x1; px++) blend(px, py, c, alpha);
}

void groundBlend(int x, int y, int w, int h, int alpha) {
  int x0 = x, y0 = y, x1 = x + w, y1 = y + h;
  if (alpha <= 0 || !clipBox(x0, y0, x1, y1)) return;
  for (int py = y0; py < y1; py++) for (int px = x0; px < x1; px++) blend(px, py, groundC[py], alpha);
}

// ---------------------------------------------------------------- shapes
// Signed distance from a point to a rounded rectangle (negative inside).
static inline float sdRR(float px, float py, float cx, float cy, float hw, float hh, float r) {
  float qx = fabsf(px - cx) - hw + r, qy = fabsf(py - cy) - hh + r;
  float ox = qx > 0 ? qx : 0, oy = qy > 0 ? qy : 0;
  float out = (ox > 0 && oy > 0) ? sqrtf(ox * ox + oy * oy) : ox + oy;
  float in = qx > qy ? qx : qy;
  return out + (in < 0 ? in : 0) - r;
}

// Half-width of the part of row `dy` (distance from centre) that lies deeper
// than `m` inside a rounded rect; -1 when the row has no such part.
static inline float innerHalf(float dy, float hw, float hh, float r, float m) {
  if (dy > hh - m) return -1;
  float ry = dy - (hh - r);
  if (ry <= 0) return hw - m;
  float rr = r - m;
  if (rr <= 0 || ry >= rr) return -1;   // m < 0 asks for an extent outside the outline
  return hw - r + sqrtf(rr * rr - ry * ry);
}

IRAM_ATTR void rrFill(float x, float y, float w, float h, float r, const Fill &f, int alpha) {
  int x0 = (int)floorf(x) - 1, y0 = (int)floorf(y) - 1, x1 = (int)ceilf(x + w) + 1, y1 = (int)ceilf(y + h) + 1;
  if (alpha <= 0 || !clipBox(x0, y0, x1, y1)) return;
  float cx = x + w * 0.5f, cy = y + h * 0.5f, hw = w * 0.5f, hh = h * 0.5f;
  if (r > hw) r = hw;
  if (r > hh) r = hh;
  float margin = f.whiteEdge ? 3.0f : 2.0f;
  for (int py = y0; py < y1; py++) {
    float t = (py + 0.5f - y) / h;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    C3 base = mix(f.top, f.bot, (int)(t * 255));
    if (f.gloss > 0 && t < 0.48f) base = mix(base, WHITE, (int)(f.gloss * (1 - t / 0.48f) * 255));
    bool upper = py + 0.5f < y + h * 0.4f;
    // Deep interior: one colour per row, no distance maths.
    float ih = innerHalf(fabsf(py + 0.5f - cy), hw, hh, r, margin);
    int ix0 = x1, ix1 = x1;
    if (ih > 0) {
      ix0 = max(x0, (int)ceilf(cx - ih - 0.5f));
      ix1 = min(x1, (int)floorf(cx + ih - 0.5f) + 1);
      if (ix0 < ix1) {
        uint16_t *row = &P(0, py);
        if (alpha >= 255) {
          uint16_t va, vb;
          dith(base, va, vb);
          ditherSpan(row, ix0, ix1, py, va, vb);
        }
        else { uint16_t fg = to565(base); for (int px = ix0; px < ix1; px++) blendP(row[px], fg, alpha); }
      } else ix0 = ix1 = x1;
    }
    float oh = innerHalf(fabsf(py + 0.5f - cy), hw, hh, r, -0.6f);   // the row's outer extent
    if (oh < 0) continue;
    int ox0 = max(x0, (int)floorf(cx - oh - 1)), ox1 = min(x1, (int)ceilf(cx + oh + 1));
    for (int px = ox0; px < ox1; px++) {
      if (px == ix0) { px = ix1 - 1; continue; }
      float d = sdRR(px + 0.5f, py + 0.5f, cx, cy, hw, hh, r);
      if (d >= 0.5f) continue;
      C3 c = base;
      if (d > -2.0f) {   // the one-pixel band just inside the outline
        float e = 1 - fabsf(d + 1.0f);
        if (e > 0) {
          if (upper && f.hiA) c = mix(c, f.hi, (int)(e * f.hiA));
          else if (f.edgeA) c = mix(c, f.edge, (int)(e * f.edgeA));
        }
      }
      if (f.whiteEdge && d > -3.0f && d < -0.5f) {
        float e = 1 - fabsf(d + 1.75f) / 1.25f;
        if (e > 0) c = mix(c, WHITE, (int)(e * f.whiteEdge));
      }
      blend(px, py, c, d < -0.5f ? alpha : (int)((0.5f - d) * alpha));
    }
  }
}

IRAM_ATTR void rrRing(float x, float y, float w, float h, float r, float width, C3 c, int alpha, float progress) {
  float pad = width + 1;
  int x0 = (int)floorf(x - pad), y0 = (int)floorf(y - pad), x1 = (int)ceilf(x + w + pad), y1 = (int)ceilf(y + h + pad);
  if (alpha <= 0 || !clipBox(x0, y0, x1, y1)) return;
  float cx = x + w * 0.5f, cy = y + h * 0.5f, hw = w * 0.5f, hh = h * 0.5f, half = width * 0.5f;
  for (int py = y0; py < y1; py++) {
    float ih = innerHalf(fabsf(py + 0.5f - cy), hw, hh, r, half + 1.0f);   // skip the ring's hollow middle
    int ix0 = x1, ix1 = x1;
    if (ih > 0) { ix0 = max(x0, (int)ceilf(cx - ih)); ix1 = min(x1, (int)floorf(cx + ih)); if (ix0 >= ix1) ix0 = ix1 = x1; }
    float oh = innerHalf(fabsf(py + 0.5f - cy), hw, hh, r, -(half + 0.6f));
    if (oh < 0) continue;
    int ox0 = max(x0, (int)floorf(cx - oh - 1)), ox1 = min(x1, (int)ceilf(cx + oh + 1));
    for (int px = ox0; px < ox1; px++) {
      if (px == ix0) { px = ix1 - 1; continue; }
      float d = sdRR(px + 0.5f, py + 0.5f, cx, cy, hw, hh, r);
      float a = half + 0.5f - fabsf(d);
      if (a <= 0) continue;
      if (progress < 1) {   // an arc from 12 o'clock, clockwise (diamond angle: monotonic, no atan2)
        float ax = px + 0.5f - cx, ay = cy - (py + 0.5f), dd = ax / (fabsf(ax) + fabsf(ay) + 1e-6f);
        float frac = ay >= 0 ? (dd >= 0 ? dd * 0.25f : 1 + dd * 0.25f) : 0.5f - dd * 0.25f;
        if (frac > progress) continue;
      }
      blend(px, py, c, (int)((a > 1 ? 1 : a) * alpha));
    }
  }
}

Fill solidFill(C3 c) { return { c, c, 0, c, 0, c, 0, 0 }; }

Fill glassFill(C3 t, int bright) {
  static const C3 G0 = HEXC(0x10161d), G1 = HEXC(0x070a0e);
  Fill f;
  f.top = mix(mix(G0, t, 189), WHITE, bright);         // tint 74% over the ground
  f.bot = mix(mix(G1, t, 92), WHITE, bright / 2);      // tint 36%
  f.gloss = 0.22f;
  f.edge = mix(f.bot, t, 200);
  f.edgeA = 200;
  f.hi = mix(t, WHITE, 180);
  f.hiA = 230;
  f.whiteEdge = 0;
  return f;
}

void circle(float cx, float cy, float r, C3 c, int alpha) { rrFill(cx - r, cy - r, 2 * r, 2 * r, r, solidFill(c), alpha); }
void ringC(float cx, float cy, float r, float width, C3 c, int alpha) { rrRing(cx - r, cy - r, 2 * r, 2 * r, r, width, c, alpha); }

IRAM_ATTR void seg(float ax, float ay, float bx, float by, float width, C3 c, int alpha) {
  float pad = width + 1;
  int x0 = (int)floorf(min(ax, bx) - pad), y0 = (int)floorf(min(ay, by) - pad);
  int x1 = (int)ceilf(max(ax, bx) + pad), y1 = (int)ceilf(max(ay, by) + pad);
  if (!clipBox(x0, y0, x1, y1)) return;
  float dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy, half = width * 0.5f;
  for (int py = y0; py < y1; py++)
    for (int px = x0; px < x1; px++) {
      float qx = px + 0.5f - ax, qy = py + 0.5f - ay;
      float t = len2 > 0 ? (qx * dx + qy * dy) / len2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      float ex = qx - t * dx, ey = qy - t * dy;
      float a = half + 0.5f - sqrtf(ex * ex + ey * ey);
      if (a > 0) blend(px, py, c, (int)((a > 1 ? 1 : a) * alpha));
    }
}

IRAM_ATTR void softShadow(float x, float y, float w, float h, int alpha) {
  if (crisp) return;   // the pixel theme draws hard shadows itself
  alpha = alpha * shadowK / 255;
  for (int i = 0; i < 12; i++) {
    float k = 1 - i / 12.0f;
    int a = (int)(alpha * 0.6f * k * k);
    float inset = 7 + i * 0.7f;
    int py = (int)(y + h) - 5 + i;
    int x0 = (int)(x + inset), x1 = (int)(x + w - inset), y0 = py, y1 = py + 1;
    if (!clipBox(x0, y0, x1, y1)) continue;
    float l = x + inset, rr = x + w - inset;
    for (int px = x0; px < x1; px++) {
      float edge = min(px + 0.5f - l, rr - px - 0.5f) * (1 / 6.0f);
      blend(px, py, shadowC, edge >= 1 ? a : (int)(a * edge));
    }
  }
}

// ---------------------------------------------------------------- glyphs
const IconDef *iconFind(const char *name, bool ui) {
  if (!name || !*name) return nullptr;
  const IconDef *t = ui ? UI_ICONS : ICONS;
  int lo = 0, hi = (ui ? UI_ICON_COUNT : ICON_COUNT) - 1;
  while (lo <= hi) {
    int m = (lo + hi) / 2, c = strcmp(name, t[m].name);
    if (!c) return &t[m];
    if (c < 0) hi = m - 1; else lo = m + 1;
  }
  return nullptr;
}

static inline int nib(const uint8_t *d, int src, int sx, int sy) {
  if (sx < 0 || sy < 0 || sx >= src || sy >= src) return 0;
  int i = sy * src + sx;
  uint8_t b = d[i >> 1];
  return (i & 1) ? (b & 15) : (b >> 4);
}

IRAM_ATTR void glyph(const IconDef *ic, bool ui, float cx, float cy, float size, C3 c, int alpha) {
  if (!ic || alpha <= 0) return;
  int src = ui ? UI_ICON_PX : ICON_PX;
  const uint8_t *d = (ui ? UI_ICON_DATA : ICON_DATA) + ic->off;
  float fx = cx - size * 0.5f, fy = cy - size * 0.5f;
  int x0 = (int)floorf(fx), y0 = (int)floorf(fy), x1 = (int)ceilf(fx + size), y1 = (int)ceilf(fy + size);
  if (!clipBox(x0, y0, x1, y1)) return;
  int ox = lroundf(fx), oy = lroundf(fy);
  bool exact = fabsf(size - src) < 0.01f && fabsf(fx - ox) < 0.01f && fabsf(fy - oy) < 0.01f;
  uint16_t fg = to565(c);
  if (exact) {   // native size: walk the mask a row at a time, skip transparent bytes
    for (int py = y0; py < y1; py++) {
      int sy = py - oy;
      uint16_t *row = &P(0, py);   // row[px] is pixel (px, py)
      const uint8_t *m = d + sy * src / 2;
      for (int px = x0; px < x1; px++) {
        int sx = px - ox;
        uint8_t b = m[sx >> 1];
        if (!b) { if (!(sx & 1)) px++; continue; }
        int v = (sx & 1) ? (b & 15) : (b >> 4);
        if (v) blendP(row[px], fg, v * 17 * alpha / 255);
      }
    }
    return;
  }
  float k = src / size;
  for (int py = y0; py < y1; py++)
    for (int px = x0; px < x1; px++) {
      int v;
      if (exact) v = nib(d, src, px - ox, py - oy) * 17;
      else {
        float u = (px + 0.5f - fx) * k - 0.5f, w = (py + 0.5f - fy) * k - 0.5f;
        int iu = (int)floorf(u), iw = (int)floorf(w);
        float fu = u - iu, fw = w - iw;
        float a = nib(d, src, iu, iw) * (1 - fu) * (1 - fw) + nib(d, src, iu + 1, iw) * fu * (1 - fw) +
                  nib(d, src, iu, iw + 1) * (1 - fu) * fw + nib(d, src, iu + 1, iw + 1) * fu * fw;
        v = (int)(a * 17);
      }
      if (v) blend(px, py, c, v * alpha / 255);
    }
}

void glyphLit(const char *name, bool ui, float cx, float cy, float size, C3 c, C3 shadow, int alpha) {
  const IconDef *ic = iconFind(name, ui);
  glyph(ic, ui, cx, cy + 1, size, shadow, alpha * 110 / 255);
  glyph(ic, ui, cx, cy, size, c, alpha);
}

// Big-endian RGB565 image scaled into a rounded box (album art, custom tiles).
IRAM_ATTR void blitImage(const uint16_t *img, int iw, int ih, float x, float y, float w, float h, float r, int alpha) {
  int x0 = (int)floorf(x), y0 = (int)floorf(y), x1 = (int)ceilf(x + w), y1 = (int)ceilf(y + h);
  if (!img || !clipBox(x0, y0, x1, y1)) return;
  float cx = x + w * 0.5f, cy = y + h * 0.5f;
  for (int py = y0; py < y1; py++) {
    int sy = (int)((py + 0.5f - y) * ih / h);
    if (sy < 0 || sy >= ih) continue;
    for (int px = x0; px < x1; px++) {
      int sx = (int)((px + 0.5f - x) * iw / w);
      if (sx < 0 || sx >= iw) continue;
      float d = sdRR(px + 0.5f, py + 0.5f, cx, cy, w * 0.5f, h * 0.5f, r);
      if (d >= 0.5f) continue;
      int a = d < -0.5f ? alpha : (int)((0.5f - d) * alpha);
      blend(px, py, upk(img[sy * iw + sx]), a);
    }
  }
}

// ---------------------------------------------------------------- text
Font fLabel, fBody, fBodyB, fTitle, fHead, fRead, fDigits;

static uint32_t be32(const uint8_t *p) { return (uint32_t)p[0] << 24 | (uint32_t)p[1] << 16 | (uint32_t)p[2] << 8 | p[3]; }

static void fontLoad(Font &f, const uint8_t *d) {
  f.d = d;
  f.n = be32(d);
  f.asc = (int16_t)be32(d + 16);
  f.desc = (int16_t)be32(d + 20);
  f.g = (VGlyph *)malloc(sizeof(VGlyph) * f.n);
  uint32_t off = 24 + f.n * 28;
  for (int i = 0; i < f.n; i++) {
    const uint8_t *e = d + 24 + i * 28;
    VGlyph &g = f.g[i];
    g.u = be32(e);
    g.h = be32(e + 4);
    g.w = be32(e + 8);
    g.adv = be32(e + 12);
    g.dy = (int8_t)(int32_t)be32(e + 16);
    g.dx = (int8_t)(int32_t)be32(e + 20);
    g.off = off;
    off += (uint32_t)g.w * g.h;
  }
}

void fontsBegin() {
  fontLoad(fLabel, FONT_LABEL);
  fontLoad(fBody, FONT_BODY);
  fontLoad(fBodyB, FONT_BODY_B);
  fontLoad(fTitle, FONT_TITLE);
  fontLoad(fHead, FONT_HEAD);
  fontLoad(fRead, FONT_READOUT);
  fontLoad(fDigits, FONT_DIGITS);
}

static const VGlyph *findG(const Font &f, uint16_t u) {
  int lo = 0, hi = f.n - 1;
  while (lo <= hi) {
    int m = (lo + hi) / 2;
    if (f.g[m].u == u) return &f.g[m];
    if (f.g[m].u < u) lo = m + 1; else hi = m - 1;
  }
  return nullptr;
}

static uint16_t nextCp(const char *&s) {
  uint8_t c = *s++;
  if (c < 0x80) return c;
  if ((c & 0xE0) == 0xC0 && *s) return ((c & 0x1F) << 6) | (*s++ & 0x3F);
  if ((c & 0xF0) == 0xE0 && s[0] && s[1]) { uint16_t v = ((c & 0x0F) << 12) | ((s[0] & 0x3F) << 6) | (s[1] & 0x3F); s += 2; return v; }
  return '?';
}

int textW(const Font &f, const char *s) {
  int w = 0;
  while (*s) {
    const VGlyph *g = findG(f, nextCp(s));
    w += g ? g->adv : f.asc / 2;
  }
  return w;
}

IRAM_ATTR void text(const Font &f, int x, int base, const char *s, C3 c, int alpha, uint8_t align) {
  if (align == AL_C) x -= textW(f, s) / 2;
  else if (align == AL_R) x -= textW(f, s);
  if (!gfxHits(x - 2, base - f.asc - 4, 480, f.asc + f.desc + 8)) return;
  while (*s) {
    const VGlyph *g = findG(f, nextCp(s));
    if (!g) { x += f.asc / 2; continue; }
    int gx = x + g->dx, gy = base - g->dy;
    int x0 = gx, y0 = gy, x1 = gx + g->w, y1 = gy + g->h;
    if (g->w && clipBox(x0, y0, x1, y1)) {
      const uint8_t *bm = f.d + g->off;
      uint16_t fg = to565(c);
      for (int py = y0; py < y1; py++) {
        uint16_t *row = &P(0, py);   // row[px] is pixel (px, py)
        const uint8_t *m = bm + (py - gy) * g->w - gx;
        for (int px = x0; px < x1; px++) {
          int a = m[px];
          if (a) blendP(row[px], fg, alpha >= 255 ? a : a * alpha / 255);
        }
      }
    }
    x += g->adv;
  }
}

String ellipsize(const Font &f, const char *s, int maxW) {
  if (textW(f, s) <= maxW) return s;
  String t = s;
  while (t.length()) {
    do t.remove(t.length() - 1); while (t.length() && (t[t.length() - 1] & 0xC0) == 0x80);   // whole UTF-8 codepoints
    while (t.endsWith(" ")) t.remove(t.length() - 1);
    String e = t + "…";
    if (textW(f, e.c_str()) <= maxW) return e;
  }
  return "…";
}
