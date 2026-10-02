// Device themes (firmware/DESIGN.md, "Themes"). One table of colour roles per
// theme plus a key style; ui.cpp draws everything through the current one.
// The panel is a TFT: its black glows grey under the backlight, so the dark
// themes sit on deep coloured grounds instead of near-black fields, and the
// light themes carry contrast with ink.
#pragma once
#include "gfx.h"

enum KeyStyle : uint8_t {
  KS_GLASS,   // lit glass in the tint (Apple Watch)
  KS_PAPER,   // a cut card in the tint on a darker card, ink outline (toy theatre)
  KS_FROST,   // a frosted white tile, the glyph in the tint; filled when on (iOS Control Centre)
  KS_PANE,    // a translucent pane over the ground with a luminous tint rim (aurora)
  KS_FLAT,    // a matte grey key with a lip and a colour dot (Teenage Engineering OP-1)
  KS_PIXEL,   // a pixel box with a hard shadow, four greens (Game Boy DMG)
};

struct Theme {
  const char *id, *title;
  KeyStyle ks;
  bool light, crisp;
  uint8_t texture;             // ground rows: 0 plain, 1 laid paper, 2 LCD
  C3 g0, g1, g2;               // ground: top, middle, bottom
  C3 ply, ply2;                // the settings sheet, top to bottom
  C3 well, wellEdge;           // an empty cell
  C3 ctl, ctlTop, ctlBot;      // buttons and the gear
  C3 track, hair;              // slider and seek track; hairline ink
  uint8_t hairA;               // hairline strength (status band rule, outlines)
  C3 txt, txt2, txt3, lbl;     // text, secondary, disabled, key labels
  C3 cyan, mag, green, amber, red, slate;   // the state words
  C3 onAccent;                 // ink on a cyan or green fill
  C3 tagBg, card, seg, swOff, segOff, knob, knobBot;
  C3 calBg, dimRet;            // calibration field, an inactive target
  C3 shadow;                   // drop colour
  uint8_t shadowA;             // drop strength (255 = the glass drop)
  C3 ink;                      // glyph ink on keys where the style does not use white
  C3 art;                      // the placeholder cover's tint
  float keyR;                  // key corner radius at 66 px
};

static const Theme THEMES[] = {
  { "glass", "Glass", KS_GLASS, false, false, 0,
    HEXC(0x121c28), HEXC(0x0e1620), HEXC(0x0a1119),
    HEXC(0x151d27), HEXC(0x0f161e),
    HEXC(0x0b1118), HEXC(0x1c2530),
    HEXC(0x19212a), HEXC(0x242e39), HEXC(0x151c24),
    HEXC(0x1f2832), HEXC(0xd6e4f3), 20,
    HEXC(0xe9eff5), HEXC(0x9aa6b4), HEXC(0x66737f), HEXC(0xc9d3dd),
    HEXC(0x4cc9ea), HEXC(0xe56fd6), HEXC(0x52d68f), HEXC(0xf2b746), HEXC(0xff6359), HEXC(0x8a98ab),
    HEXC(0x062012),
    HEXC(0x0a141a), HEXC(0x19222b), HEXC(0x1a222b), HEXC(0x252e38), HEXC(0x2b3540), HEXC(0xffffff), HEXC(0xd5dde5),
    HEXC(0x0a1018), HEXC(0x2f3a46),
    HEXC(0x000000), 255,
    HEXC(0xffffff), HEXC(0x6b4fd8), 19 },

  { "paper", "Paper", KS_PAPER, true, false, 1,
    HEXC(0xf4ecda), HEXC(0xefe4cc), HEXC(0xe5d6b6),
    HEXC(0xfbf6ea), HEXC(0xf2e9d5),
    HEXC(0xe3d5b6), HEXC(0x8c7a5c),
    HEXC(0xfbf7ee), HEXC(0xfffdf6), HEXC(0xeee4cf),
    HEXC(0xd8c9a8), HEXC(0x1f1a14), 60,
    HEXC(0x1f1a14), HEXC(0x5a4f40), HEXC(0x9c907c), HEXC(0x2a231a),
    HEXC(0x23697a), HEXC(0xa52f3d), HEXC(0x3b7a3f), HEXC(0xb87d14), HEXC(0xb3302a), HEXC(0x7c705d),
    HEXC(0xfbf7ee),
    HEXC(0xfbf7ee), HEXC(0xfbf7ee), HEXC(0xf3ead6), HEXC(0xd8c9a8), HEXC(0xdccfb2), HEXC(0xfffdf6), HEXC(0xe6d9bd),
    HEXC(0xf2ead8), HEXC(0xcdbd9c),
    HEXC(0x3b2c18), 150,
    HEXC(0xfffaf0), HEXC(0x2d5f6e), 11 },

  { "daylight", "Daylight", KS_FROST, true, false, 0,
    HEXC(0xc7daf1), HEXC(0xdbe7f5), HEXC(0xe9f0f8),
    HEXC(0xfafcfe), HEXC(0xeef2f7),
    HEXC(0xdbe4ee), HEXC(0xc4d0dd),
    HEXC(0xffffff), HEXC(0xffffff), HEXC(0xedf1f6),
    HEXC(0xd2dbe5), HEXC(0x26384d), 34,
    HEXC(0x151d27), HEXC(0x4c5866), HEXC(0x8c97a4), HEXC(0x26303c),
    HEXC(0x0a6fd6), HEXC(0xc23a8c), HEXC(0x1c9a55), HEXC(0xc07600), HEXC(0xd5352b), HEXC(0x7b8898),
    HEXC(0xffffff),
    HEXC(0xffffff), HEXC(0xffffff), HEXC(0xedf1f6), HEXC(0xccd6e1), HEXC(0xd3dce6), HEXC(0xffffff), HEXC(0xe1e8ef),
    HEXC(0xeef3f9), HEXC(0xc2cedb),
    HEXC(0x1e3a5c), 120,
    HEXC(0x26303c), HEXC(0x5d7fe0), 19 },

  { "aurora", "Aurora", KS_PANE, false, false, 0,
    HEXC(0x1e1450), HEXC(0x1c2d6e), HEXC(0x0c5b62),
    HEXC(0x26205e), HEXC(0x1b2b60),
    HEXC(0x231f5c), HEXC(0x5e5aa8),
    HEXC(0x34307a), HEXC(0x403c8a), HEXC(0x2a2768),
    HEXC(0x39408a), HEXC(0xd8deff), 40,
    HEXC(0xf3f5ff), HEXC(0xbac3e8), HEXC(0x7f89b6), HEXC(0xe4e9fc),
    HEXC(0x6ae6f8), HEXC(0xff7cd8), HEXC(0x70f0b0), HEXC(0xffd166), HEXC(0xff6b81), HEXC(0xa9b2e0),
    HEXC(0x07323a),
    HEXC(0x1d1d58), HEXC(0x302c72), HEXC(0x2e2a6e), HEXC(0x3a4088), HEXC(0x3a4088), HEXC(0xffffff), HEXC(0xd9defa),
    HEXC(0x1a1348), HEXC(0x45498e),
    HEXC(0x07051c), 220,
    HEXC(0xffffff), HEXC(0xff7cd8), 19 },

  { "synth", "Synth", KS_FLAT, true, false, 0,
    HEXC(0xdedbd5), HEXC(0xd8d5ce), HEXC(0xcfccc4),
    HEXC(0xebe9e4), HEXC(0xe2dfd9),
    HEXC(0xcfcbc3), HEXC(0xb3aea5),
    HEXC(0xf3f2ee), HEXC(0xf8f7f4), HEXC(0xe8e6e1),
    HEXC(0xbfbab1), HEXC(0x1a1a1a), 60,
    HEXC(0x151515), HEXC(0x55524d), HEXC(0x928e86), HEXC(0x232220),
    HEXC(0x2160d0), HEXC(0xff5a1f), HEXC(0x14a150), HEXC(0xdc9e00), HEXC(0xe0342a), HEXC(0x7b776f),
    HEXC(0xffffff),
    HEXC(0xf3f2ee), HEXC(0xf3f2ee), HEXC(0xe9e7e2), HEXC(0xc5c1b9), HEXC(0xc5c1b9), HEXC(0x2a2a2a), HEXC(0x151515),
    HEXC(0xdedbd5), HEXC(0xbab6ae),
    HEXC(0x3a3530), 90,
    HEXC(0x1b1b1b), HEXC(0xff5a1f), 8 },

  { "retro", "Retro", KS_PIXEL, true, true, 2,
    HEXC(0x9fbf12), HEXC(0x9bbc0f), HEXC(0x93b40e),
    HEXC(0x9bbc0f), HEXC(0x9bbc0f),
    HEXC(0x9bbc0f), HEXC(0x8bac0f),
    HEXC(0x9bbc0f), HEXC(0x9bbc0f), HEXC(0x9bbc0f),
    HEXC(0x8bac0f), HEXC(0x0f380f), 255,
    HEXC(0x0f380f), HEXC(0x306230), HEXC(0x6c8c1f), HEXC(0x0f380f),
    HEXC(0x306230), HEXC(0x0f380f), HEXC(0x306230), HEXC(0x306230), HEXC(0x0f380f), HEXC(0x306230),
    HEXC(0x9bbc0f),
    HEXC(0x9bbc0f), HEXC(0x9bbc0f), HEXC(0x9bbc0f), HEXC(0x8bac0f), HEXC(0x8bac0f), HEXC(0x0f380f), HEXC(0x0f380f),
    HEXC(0x9bbc0f), HEXC(0x8bac0f),
    HEXC(0x306230), 255,
    HEXC(0x0f380f), HEXC(0x306230), 4 },
};
static const int THEME_COUNT = sizeof THEMES / sizeof THEMES[0];
static const int THEME_DEFAULT = 2;   // Daylight, out of the box (indices are stored in NVS: append, don't reorder)
