"""Each theme's key, from the keypad itself: tools/icons/keys/<theme>.png (72 x 72).

    python tools/icons/capture_keys.py        (the keypad on USB; Studio closed)

build_icon_gifs.py draws the icon animations on these, so a theme's GIFs show its real key: glass,
cut paper, frosted tile, aurora pane, OP-1 key, Game Boy box. The key is blank and in the demo
tint (#4f8cff) on scratch slot 16, top-left cell; the keypad's profile, theme and slot 16 are put
back after.
"""
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))
from kp import Device  # noqa: E402

OUT = Path(__file__).parent / "keys"
THEMES = ["glass", "paper", "daylight", "aurora", "synth", "retro"]
SLOT, TINT = 16, [79, 140, 255]
CROP = (12, 31, 84, 103)   # 72 x 72 around cell 1's key (66 px at 15, 34)


def main():
    OUT.mkdir(exist_ok=True)
    d = Device()
    try:
        st = d.cmd("status")[0]
        profile = st.split("Profile:")[1].split()[0]
        theme = st.split("theme:")[1].split()[0]
        old = d.cmd(f"cat /profile{SLOT}.json")
        old = None if not old or old[0].startswith("ERR") else "\n".join(old)
        keys = [None] * 15
        keys[0] = {"id": 1, "name": " ", "icon": "", "led_color": TINT, "actions": [{"type": "keycombo", "keys": ["F13"]}]}
        prof = {"schema_version": 2, "profile_name": "Key capture", "color": TINT, "default_delay": 5, "pages": [{"name": "One", "keys": keys}]}
        assert any(l.startswith("SAVED") for l in d.upload_text(f"profile{SLOT}.json", json.dumps(prof)))
        d.cmd(f"setprofile {SLOT}")
        try:
            for th in THEMES:
                d.cmd(f"theme {th}")
                time.sleep(1.2)   # the theme wipe, then the page wave
                d.shot().crop(CROP).save(OUT / f"{th}.png")
                print("captured", th)
        finally:
            d.cmd(f"theme {theme}")
            d.cmd(f"setprofile {profile}")
            if old:
                d.upload_text(f"profile{SLOT}.json", old)
            else:
                d.cmd(f"rm /profile{SLOT}.json")
    finally:
        d.close()


if __name__ == "__main__":
    main()
