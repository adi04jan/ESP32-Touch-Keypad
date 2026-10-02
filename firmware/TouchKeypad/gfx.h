/* Raster core for the screen: a chunk canvas (the rectangle being redrawn,
   in swapped RGB565 for the SPI DMA), antialiased signed-distance shapes,
   tinted 4-bit glyph masks with bilinear scaling, and VLW text blended per
   pixel over whatever is underneath (LovyanGFX blends text against a flat
   colour, which fringes on gradients). Everything takes screen coordinates. */
#pragma once
#include <Arduino.h>
struct IconDef;   // icons_gen.h: the mask data lives only in gfx.cpp

struct C3 { uint8_t r, g, b; };
#define HEXC(v) C3{ (uint8_t)(((v) >> 16) & 255), (uint8_t)(((v) >> 8) & 255), (uint8_t)((v) & 255) }

static inline uint16_t pk(C3 c) {   // RGB565, bytes swapped as the panel wants them
  uint16_t v = ((c.r & 0xF8) << 8) | ((c.g & 0xFC) << 3) | (c.b >> 3);
  return (v >> 8) | (v << 8);
}
static inline C3 upk(uint16_t s) {
  uint16_t v = (s >> 8) | (s << 8);
  uint8_t r = (v >> 11) & 31, g = (v >> 5) & 63, b = v & 31;
  return { (uint8_t)(r << 3 | r >> 2), (uint8_t)(g << 2 | g >> 4), (uint8_t)(b << 3 | b >> 2) };
}
static inline C3 mix(C3 a, C3 b, int t) {   // t 0..255; multiply-shift, no divides (hot path)
  if (t <= 0) return a;
  if (t >= 255) return b;
  t += t >> 7;   // 255 -> 256
  return { (uint8_t)(a.r + (((b.r - a.r) * t) >> 8)), (uint8_t)(a.g + (((b.g - a.g) * t) >> 8)), (uint8_t)(a.b + (((b.b - a.b) * t) >> 8)) };
}

// ---- canvas
// Ground gradient table: three stops, plus a row texture (0 none, 1 laid paper, 2 LCD rows).
void gfxBegin(const C3 &top, const C3 &mid, const C3 &bottom, uint8_t texture = 0);
C3 gfxGroundAt(int y);                              // the ground colour of row y
void gfxSetCrisp(bool on);                          // no antialiasing: every blend snaps to 0 or 255 (pixel theme)
void gfxSetShadow(const C3 &c, int strength);       // drop colour and strength (255 = full) for softShadow
void gfxChunk(uint16_t *buf, int x, int y, int w, int h);
void gfxClip(int x0, int y0, int x1, int y1);       // narrow the clip inside the chunk (x1, y1 exclusive)
void gfxUnclip();
bool gfxHits(int x, int y, int w, int h);           // rectangle meets the clip
void gfxGround();                                   // the screen's vertical gradient
void gfxFill(const C3 &c);                          // whole clip, one colour
void fillRect(int x, int y, int w, int h, C3 c, int alpha = 255);
void groundBlend(int x, int y, int w, int h, int alpha);   // fade a region back toward the ground

// ---- shapes (antialiased)
struct Fill {
  C3 top, bot;        // vertical gradient
  float gloss;        // white added to the upper 48%, 0..1
  C3 edge; int edgeA; // one-pixel band inside the outline
  C3 hi; int hiA;     // that band on the upper 40% (the lit edge)
  int whiteEdge;      // pressed: a brighter inner edge, 0..255
};
void rrFill(float x, float y, float w, float h, float r, const Fill &f, int alpha = 255);
void rrRing(float x, float y, float w, float h, float r, float width, C3 c, int alpha = 255, float progress = 2);
void circle(float cx, float cy, float r, C3 c, int alpha = 255);
void ringC(float cx, float cy, float r, float width, C3 c, int alpha = 255);
void seg(float ax, float ay, float bx, float by, float width, C3 c, int alpha = 255);
void softShadow(float x, float y, float w, float h, int alpha);   // dark pool under a key's bottom edge
Fill solidFill(C3 c);
Fill glassFill(C3 tint, int bright = 0);   // a key in its tint; bright 0..255 lifts it toward white

// ---- glyphs
const IconDef *iconFind(const char *name, bool ui);
void glyph(const IconDef *ic, bool ui, float cx, float cy, float size, C3 c, int alpha = 255);
void glyphLit(const char *name, bool ui, float cx, float cy, float size, C3 c, C3 shadow, int alpha = 255);
void blitImage(const uint16_t *img, int iw, int ih, float x, float y, float w, float h, float r, int alpha = 255);

// ---- text
struct VGlyph { uint16_t u; uint8_t w, h, adv; int8_t dy, dx; uint32_t off; };
struct Font { const uint8_t *d; uint16_t n; int16_t asc, desc; VGlyph *g; };
extern Font fLabel, fBody, fBodyB, fTitle, fHead, fRead, fDigits;
void fontsBegin();
enum : uint8_t { AL_L, AL_C, AL_R };
int textW(const Font &f, const char *s);
void text(const Font &f, int x, int baseline, const char *s, C3 c, int alpha = 255, uint8_t align = AL_L);
String ellipsize(const Font &f, const char *s, int maxW);
