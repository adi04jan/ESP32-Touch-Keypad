"""An animated GIF for every key icon in every theme: studio/assets/icon-gifs/<theme>/<icon>.gif.

    python tools/icons/build_icon_gifs.py      (after node tools/icons/build_anims.js)

Each GIF is the keypad's own key playing the icon's signature animation: the frames come from
firmware/TouchKeypad/anims_gen.h, decoded over the icon's mask from icons_gen.h exactly as the
firmware decodes them; the key is the theme's real key (tools/icons/keys/<theme>.png, captured
from the keypad by capture_keys.py, in the demo tint #4f8cff), and the glyph takes the theme's ink
as ui.cpp keyInk() gives it (a one-pixel drop on Glass and Aurora, hard pixels on Retro). The loop
holds the resting icon, then plays the animation at the keypad's frame rate.
"""
import re
import zlib
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
ICONS_H = ROOT / "firmware" / "TouchKeypad" / "icons_gen.h"
ANIMS_H = ROOT / "firmware" / "TouchKeypad" / "anims_gen.h"
KEYS = Path(__file__).parent / "keys"
OUT = ROOT / "studio" / "assets" / "icon-gifs"
SRC, HOLD_MS, AT = 36, 900, 18                  # mask px, rest before each play, glyph corner in the 72 px key
TINT = (79, 140, 255)


# ---------------------------------------------------------------- the firmware's colour rules (gfx.h, ui.cpp)
def mix(a, b, t):
    if t <= 0:
        return a
    if t >= 255:
        return b
    t += t >> 7
    return tuple(x + (((y - x) * t) >> 8) for x, y in zip(a, b))


def luma(c):
    return (c[0] * 77 + c[1] * 150 + c[2] * 29) >> 8


def frost_ink(c):
    for _ in range(6):
        if luma(c) <= 118:
            break
        c = mix(c, (0, 0, 0), 45)
    return c


SHADOW = mix(TINT, (0, 0, 0), 150)
def contrast(a, b):   # WCAG, as ui.cpp contrast()
    def lum(c):
        f = [v / 255 for v in c]
        f = [v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4 for v in f]
        return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2]
    x, y = lum(a), lum(b)
    return (max(x, y) + 0.05) / (min(x, y) + 0.05)


def themes():
    """theme -> (ink, drop shadow under the glyph, hard pixels), read from themes.h and themes_gen.h as ui.cpp
    keyInk(), keyInkDrop() and crisp give them for an unpressed key in TINT."""
    fw = ROOT / "firmware" / "TouchKeypad"
    src = (fw / "themes.h").read_text() + (fw / "themes_gen.h").read_text()
    out = {}
    for tid, ks, light, crisp, body in re.findall(r'\{ "(\w+)", "[^"]*", KS_(\w+), (true|false), (true|false), \d+,(.*?)(?:true|false) \}', src, re.S):
        c = [tuple(int(h[i:i + 2], 16) for i in (0, 2, 4)) for h in re.findall(r"HEXC\(0x([0-9a-fA-F]{6})\)", body)]
        g1, txt, ink = c[1], c[12], c[33]   # Theme's field order: g0 g1 g2 ... txt (13th colour) ... ink (34th)
        if ks == "PAPER":
            card = mix(TINT, g1, 46)
            dark = txt if light == "true" else mix(card, (0, 0, 0), 190)
            ink = dark if contrast(dark, card) >= contrast(ink, card) else ink
        elif ks == "FROST":
            ink = frost_ink(TINT)
        elif ks == "PANE":
            ink = mix(TINT, (255, 255, 255), 130)
        elif ks == "PIXEL":
            ink = txt
        elif ks == "GLASS":
            ink = (255, 255, 255)
        out[tid] = (ink, ks in ("GLASS", "PANE"), crisp == "true")
    return out


# ---------------------------------------------------------------- the frames
def hex_bytes(text, start):
    block = text[text.index(start):]
    return bytes(int(x, 16) for x in re.findall(r"0x([0-9a-fA-F]{2})", block[:block.index("};")]))


def masks():
    text = ICONS_H.read_text()
    data = hex_bytes(text, "ICON_DATA[] PROGMEM = {")
    table = text[text.index("static const IconDef ICONS[] = {"):]
    for name, off in re.findall(r'\{"([a-z0-9-]+)",\s*(\d+)\}', table[:table.index("};")]):
        p, px = int(off), []   # run-length coded as gfx.cpp unpackMask reads it (build_icons.js packMask)
        while len(px) < SRC * SRC:
            t = data[p]
            p += 1
            if t < 0x80:
                px += [0] * (t + 1)
            elif t < 0xC0:
                px += [15] * (t - 0x7F)
            else:
                n = t - 0xBF
                px += [data[p + (k >> 1)] & 15 if k & 1 else data[p + (k >> 1)] >> 4 for k in range(n)]
                p += (n + 1) // 2
        yield name, px[:SRC * SRC]


def anims():
    text = ANIMS_H.read_text()
    frame_ms = int(re.search(r"#define ANIM_FRAME_MS (\d+)", text).group(1))
    data = hex_bytes(text, "ANIM_DATA[] PROGMEM = {")
    table = text[text.index("static const AnimDef ANIMS[] = {"):]
    rows = [(int(o), int(z), int(n)) for o, z, _, n in re.findall(r"\{(\d+), (\d+), (\d+), (\d+)\}", table[:table.index("};")])]
    return frame_ms, data, rows


def frames_of(base, data, off, z, n):
    """firmware glyphFrame(): the icon's runs inflated, each frame the resting mask with its runs written over it."""
    data = zlib.decompress(data[off:off + z], -15) if n else b""
    p, out = 0, []
    for _ in range(n):
        px, pos = list(base), 0
        while True:
            skip, cnt = data[p], data[p + 1]
            p += 2
            if not skip and not cnt:
                break
            pos += skip
            for j in range(cnt):
                b = data[p + (j >> 1)]
                px[pos + j] = b & 15 if j & 1 else b >> 4
            p += (cnt + 1) // 2
            pos += cnt
        out.append(px)
    return out


# ---------------------------------------------------------------- the key
def frame(key, px, ink, drop, crisp):
    """The mask drawn on the key as the firmware draws it: the drop 1 px down at 110/255, then the ink."""
    a = [v * 17 for v in px]
    if crisp:
        a = [255 if v >= 128 else 0 for v in a]   # gfxSetCrisp: every blend snaps to 0 or 255
    m = Image.new("L", (SRC, SRC))
    m.putdata(a)
    img = key.copy()
    if drop:
        img.paste(Image.new("RGB", m.size, SHADOW), (AT, AT + 1), m.point(lambda v: v * 110 // 255))
    img.paste(Image.new("RGB", m.size, ink), (AT, AT), m)
    return img


def main():
    frame_ms, data, rows = anims()
    icons = [(name, px, frames_of(px, data, off, z, n)) for (name, px), (off, z, n) in zip(masks(), rows)]
    for theme, (ink, drop, crisp) in themes().items():
        key = Image.open(KEYS / f"{theme}.png").convert("RGB")
        out = OUT / theme
        out.mkdir(parents=True, exist_ok=True)
        total = 0
        for name, px, fr in icons:
            seq = [frame(key, f, ink, drop, crisp) for f in [px] + fr]
            path = out / f"{name}.gif"
            seq[0].save(path, save_all=True, append_images=seq[1:], duration=[HOLD_MS] + [frame_ms] * len(fr), loop=0, optimize=True)
            total += path.stat().st_size
        print(f"{theme}: {len(icons)} GIFs ({total // 1024} KB)")


if __name__ == "__main__":
    main()
