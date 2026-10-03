"""An animated GIF for every key icon: studio/assets/icon-gifs/<icon>.gif.

    python tools/icons/build_icon_gifs.py      (after node tools/icons/build_anims.js)

Each GIF is the keypad's own key playing the icon's signature animation: the frames come from
firmware/TouchKeypad/anims_gen.h, decoded over the icon's mask from icons_gen.h exactly as the
firmware decodes them, on a Glass-style key. The loop holds the resting icon, then plays the
animation at the keypad's frame rate, so the GIF is what the key does when it fires.
"""
import re
import zlib
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
ICONS_H = ROOT / "firmware" / "TouchKeypad" / "icons_gen.h"
ANIMS_H = ROOT / "firmware" / "TouchKeypad" / "anims_gen.h"
OUT = ROOT / "studio" / "assets" / "icon-gifs"
SRC, KEY, SS, HOLD_MS = 36, 72, 4, 900          # mask px, GIF px, supersampling, rest before each play


def hex_bytes(text, start):
    block = text[text.index(start):]
    return bytes(int(x, 16) for x in re.findall(r"0x([0-9a-fA-F]{2})", block[:block.index("};")]))


def masks():
    text = ICONS_H.read_text()
    data = hex_bytes(text, "ICON_DATA[] PROGMEM = {")
    table = text[text.index("static const IconDef ICONS[] = {"):]
    for name, off in re.findall(r'\{"([a-z0-9-]+)",\s*(\d+)\}', table[:table.index("};")]):
        off = int(off)
        px = []
        for b in data[off:off + SRC * SRC // 2]:
            px += [b >> 4, b & 15]
        yield name, px


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


def frame(base, px):
    """The icon's mask drawn on the key as the firmware draws it: a drop shadow 1 px down, then white."""
    g = Image.new("L", (SRC, SRC))
    g.putdata([v * 17 for v in px])
    g = g.resize((SRC * SS, SRC * SS), Image.NEAREST)
    img = base.copy()
    o = (KEY - SRC) * SS // 2
    img.paste(Image.new("RGB", g.size, (10, 20, 45)), (o, o + SS), g.point(lambda v: v * 110 // 255))
    img.paste(Image.new("RGB", g.size, (255, 255, 255)), (o, o), g)
    return img.resize((KEY, KEY), Image.LANCZOS)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    frame_ms, data, rows = anims()
    base = key_base()
    count, total = 0, 0
    for (name, px), (off, z, n) in zip(masks(), rows):
        seq = [frame(base, px)] + [frame(base, f) for f in frames_of(px, data, off, z, n)]
        path = OUT / f"{name}.gif"
        seq[0].save(path, save_all=True, append_images=seq[1:], duration=[HOLD_MS] + [frame_ms] * n, loop=0, optimize=True)
        count += 1
        total += path.stat().st_size
    print(f"{count} GIFs -> {OUT} ({total // 1024} KB)")


if __name__ == "__main__":
    main()
