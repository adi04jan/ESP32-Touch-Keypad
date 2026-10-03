"""An animated GIF for every key icon: studio/assets/icon-gifs/<icon>.gif.

    python tools/icons/build_icon_gifs.py

Each GIF is the keypad's own key: the icon's 4-bit mask from firmware/TouchKeypad/icons_gen.h,
moving with the motion firmware/TouchKeypad/ui.cpp gives it (MOTIONS, poseOf: spin, swing,
bounce, rise, slide, pulse, else a float), one full loop at the keypad's pose rate (20 a second),
on a Glass-style key. The keypad plays the same motion live from those masks (`iconanim`), so
the GIF is what the key does. Rendered 4x and scaled down for smooth edges.
"""
import math
import re
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
ICONS_H = ROOT / "firmware" / "TouchKeypad" / "icons_gen.h"
UI_CPP = ROOT / "firmware" / "TouchKeypad" / "ui.cpp"
OUT = ROOT / "studio" / "assets" / "icon-gifs"
SRC, KEY, FRAME_MS, SS = 36, 72, 50, 4          # mask px, GIF px, ms per frame, supersampling
TAU = 2 * math.pi
PERIOD = {"MO_SPIN": 4000, "MO_SPINR": 4000, "MO_SWING": 1800, "MO_BOUNCE": 1400, "MO_RISE": 1400,
          "MO_RIGHT": 1400, "MO_LEFT": 1400, "MO_PULSE": 1600, "MO_FLOAT": 2600}


def masks():
    text = ICONS_H.read_text()
    data_block = text[text.index("ICON_DATA[] PROGMEM = {"):]
    data = bytes(int(x, 16) for x in re.findall(r"0x([0-9a-fA-F]{2})", data_block[:data_block.index("};")]))
    table = text[text.index("static const IconDef ICONS[] = {"):]
    table = table[:table.index("};")]
    for name, off in re.findall(r'\{"([a-z0-9-]+)",\s*(\d+)\}', table):
        off = int(off)
        px = []
        for b in data[off:off + SRC * SRC // 2]:
            px += [(b >> 4) * 17, (b & 15) * 17]
        img = Image.new("L", (SRC, SRC))
        img.putdata(px)
        yield name, img


def motions():
    block = UI_CPP.read_text()
    block = block[block.index("MOTIONS[] = {"):]
    block = block[:block.index("};")]
    return dict(re.findall(r'\{\s*"([a-z0-9-]+)",\s*(MO_[A-Z]+)\s*\}', block))


def pose(m, t):
    """firmware poseOf(): (dx, dy) in mask px, scale, angle in radians."""
    wave = lambda p: math.sin(TAU * (t % p) / p)
    hop = lambda p: abs(math.sin(TAU * (t % p) / (2 * p)))
    if m == "MO_SPIN": return 0, 0, 1, TAU * (t % 4000) / 4000
    if m == "MO_SPINR": return 0, 0, 1, -TAU * (t % 4000) / 4000
    if m == "MO_SWING": return 0, 0, 1, 0.26 * wave(1800)
    if m == "MO_BOUNCE": return 0, round(3 * hop(1400)), 1, 0
    if m == "MO_RISE": return 0, -round(3 * hop(1400)), 1, 0
    if m == "MO_RIGHT": return round(3 * hop(1400)), 0, 1, 0
    if m == "MO_LEFT": return -round(3 * hop(1400)), 0, 1, 0
    if m == "MO_PULSE": return 0, 0, 1 + 0.08 * wave(1600), 0
    return 0, round(1.5 * wave(2600)), 1, 0


def key_base():
    """A Glass key (the default theme's look) on the keypad's ground, at SS x size."""
    n = KEY * SS
    base = Image.new("RGB", (n, n), (14, 22, 32))
    grad = Image.new("RGB", (n, n))
    top, bot = (79, 140, 255), (24, 52, 108)
    for y in range(n):
        f = y / (n - 1)
        ImageDraw.Draw(grad).line([(0, y), (n, y)], fill=tuple(round(a + (b - a) * f) for a, b in zip(top, bot)))
    m = Image.new("L", (n, n), 0)
    ImageDraw.Draw(m).rounded_rectangle([3 * SS, 3 * SS, n - 3 * SS, n - 3 * SS], radius=19 * SS, fill=255)
    base.paste(grad, (0, 0), m)
    return base


def frame(base, mask, p):
    dx, dy, scale, angle = p
    size = round(SRC * SS * scale)
    g = mask.resize((size, size), Image.BICUBIC).rotate(-math.degrees(angle), Image.BICUBIC, expand=True)
    img = base.copy()
    cx, cy = KEY * SS // 2 + dx * SS, KEY * SS // 2 + dy * SS
    img.paste(Image.new("RGB", g.size, (10, 20, 45)), (cx - g.width // 2, cy - g.height // 2 + SS), g.point(lambda v: v * 110 // 255))
    img.paste(Image.new("RGB", g.size, (255, 255, 255)), (cx - g.width // 2, cy - g.height // 2), g)
    return img.resize((KEY, KEY), Image.LANCZOS)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    table, base = motions(), key_base()
    count, total = 0, 0
    for name, mask in masks():
        m = table.get(name, "MO_FLOAT")
        frames = [frame(base, mask, pose(m, t)) for t in range(0, PERIOD[m], FRAME_MS)]
        path = OUT / f"{name}.gif"
        frames[0].save(path, save_all=True, append_images=frames[1:], duration=FRAME_MS, loop=0, optimize=True)
        count += 1
        total += path.stat().st_size
    print(f"{count} GIFs -> {OUT} ({total // 1024} KB)")


if __name__ == "__main__":
    main()
