"""Save and put back what a test run may change on a keypad that is in use.

    python tools/e2e/keypad_state.py save <file> [--free-slot N]
    python tools/e2e/keypad_state.py restore <file>

save records the active profile, theme, LED pattern, colour and brightness,
screen brightness and key click. --free-slot N makes slot N available for the
run: an untouched blank (the file the keypad writes when an empty slot is
visited) is removed; a real profile there stops the run instead of being
overwritten. restore puts every recorded value back and removes slot N again.
Talks over USB with tools/kp.py, so it works whatever state Studio is in.
"""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import kp  # noqa: E402


def blank(text, n):
    try:
        p = json.loads(text)
    except ValueError:
        return False
    return p.get("profile_name") == f"Profile {n}" and all(k is None for pg in p.get("pages", []) for k in pg.get("keys", []))


def save(path, free):
    d = kp.Device()
    d.ready(10)
    st = d.cmd("status")[0]
    led = re.match(r"led (\w+) color (\d+ \d+ \d+) brightness (\d+)", d.cmd("led")[0])
    state = {
        "profile": int(re.search(r"Profile:(\d+)", st).group(1)),
        "theme": re.search(r"theme:(\w+)", st).group(1),
        "led": led.group(1), "led_color": led.group(2), "led_bright": int(led.group(3)),
        "bright": int(re.search(r"brightness (\d+)", d.cmd("setbrightness")[0]).group(1)),
        "click": d.cmd("click")[0].endswith("on"),
        "free_slot": free, "status": st,
    }
    if free:
        if state["profile"] == free:
            raise SystemExit(f"slot {free} is the active profile; pick another free slot")
        text = "\n".join(d.cmd(f"cat /profile{free}.json"))
        if not text.startswith("ERR"):
            if not blank(text, free):
                raise SystemExit(f"slot {free} holds a real profile; not touching it")
            d.cmd(f"rm /profile{free}.json")
    d.close()
    Path(path).write_text(json.dumps(state, indent=1))
    print(json.dumps(state))


def restore(path):
    s = json.loads(Path(path).read_text())
    d = kp.Device()
    d.ready(20)
    if s.get("free_slot"):
        d.cmd(f"rm /profile{s['free_slot']}.json")
    for c in (f"setprofile {s['profile']}", f"theme {s['theme']}", f"led {s['led']} {s['led_color']}",
              f"ledbright {s['led_bright']}", f"setbrightness {s['bright']}", f"click {'on' if s['click'] else 'off'}"):
        d.cmd(c)
    print(d.cmd("status")[0])
    d.close()


if __name__ == "__main__":
    op, path = sys.argv[1], sys.argv[2]
    free = int(sys.argv[sys.argv.index("--free-slot") + 1]) if "--free-slot" in sys.argv else None
    save(path, free) if op == "save" else restore(path)
