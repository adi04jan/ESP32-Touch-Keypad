"""Screenshots of the key area at rest in every theme, to prove a renderer change draws the same keys.

    python tools/tests/key_goldens.py save DIR     # before the change
    python tools/tests/key_goldens.py check DIR    # after: the bytes that differ, per theme (0: identical)

The board on KP_PORT (or the first CH340). Like the device tests it borrows profile slot 16 for a page of
15 icon keys (test_device.full_profile) and puts slot 16, the profile, the theme, icon motion and HID
dry-run back as they were."""
import json
import re
import sys
import time
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import kp  # noqa: E402
import test_device as td  # noqa: E402  (full_profile, SLOT, THEMES)

KEYS = (0, 30, 420, 300)   # the key area: x 0-420, y 30-300


def main(mode, out):
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    d = kp.Device()
    d.ready(timeout=40)
    st = d.cmd("status")[0]
    theme0, prof0 = re.search(r"theme:(\w+)", st).group(1), re.search(r"Profile:(\d+)", st).group(1)
    dry0, ianim0 = re.search(r"dry:(\d)", st).group(1), d.cmd("iconanim")[0]
    old = d.cmd(f"cat /profile{td.SLOT}.json")
    old = None if not old or old[0].startswith("ERR") else "\n".join(old)
    diffs = {}
    try:
        d.cmd("iconanim off")
        d.cmd("hid dry on")
        d.upload_text(f"profile{td.SLOT}.json", json.dumps(td.full_profile()))
        d.ok(f"setprofile {td.SLOT}")
        for name in td.THEMES:
            d.ok(f"theme {name}")
            time.sleep(1.2)   # the theme wipe, then still
            img = d.shot().crop(KEYS)
            f = out / f"{name}.png"
            if mode == "save":
                img.save(f)
            else:
                ref = Image.open(f).convert(img.mode)
                diffs[name] = sum(a != b for a, b in zip(img.tobytes(), ref.tobytes()))
    finally:
        d.cmd(f"theme {theme0}")
        if old:
            d.upload_text(f"profile{td.SLOT}.json", old)
        else:
            d.cmd(f"rm /profile{td.SLOT}.json")
        d.cmd(f"setprofile {prof0}")
        d.cmd("iconanim on" if ianim0.endswith("on") else "iconanim off")
        d.cmd(f"hid dry {'on' if dry0 == '1' else 'off'}")
        d.close()
    if mode == "save":
        print(f"saved {len(td.THEMES)} themes to {out}")
        return 0
    for name, n in diffs.items():
        print(f"{name:14} {n} bytes differ")
    return 0 if not any(diffs.values()) else 1


if __name__ == "__main__":
    if len(sys.argv) != 3 or sys.argv[1] not in ("save", "check"):
        sys.exit(__doc__)
    sys.exit(main(sys.argv[1], sys.argv[2]))
