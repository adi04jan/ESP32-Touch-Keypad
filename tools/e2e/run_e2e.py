"""End to end over real Bluetooth: pair the keypad with this PC, type into a
test window, check the text, unpair.

    python tools/e2e/run_e2e.py          # board on USB (KP_TEST build), BLE on this PC

Keystrokes only ever go to KpHelper's own topmost window, which keeps focus
while the test runs. No media keys. The keypad's bonds are cleared before and
after (it is a test device); this PC's pairing with it is removed at the end.
"""
import json
import queue
import subprocess
import sys
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))
import kp  # noqa: E402

HELPER = ROOT / "tools" / "e2e" / "bin" / "KpHelper.exe"
OUT = ROOT / "build" / "e2e-keys.txt"
NAME = "Touch Keypad"
SLOT = 6
TEXT = "kp-e2e: Hello, Paper Theatre 123!"
EXPECT = TEXT + "K\r\nsecond lin"   # text, Shift+K, multiline, then one backspace


def profile():
    keys = [None] * 15
    keys[0] = {"id": 1, "name": "Text", "led_color": [47, 107, 115], "actions": [{"type": "text", "value": TEXT}]}
    keys[1] = {"id": 2, "name": "Shift K", "led_color": [194, 65, 43], "actions": [{"type": "keycombo", "keys": ["LEFT_SHIFT", "K"]}]}
    keys[2] = {"id": 3, "name": "Lines", "led_color": [226, 176, 74], "actions": [{"type": "multiline", "value": "\nsecond line"}]}
    keys[3] = {"id": 4, "name": "Bksp", "led_color": [122, 31, 43], "actions": [{"type": "key", "value": "BACKSPACE"}]}
    keys[4] = {"id": 5, "name": "Probe", "led_color": [47, 107, 79], "actions": [{"type": "text", "value": "."}]}
    return {"schema_version": 2, "profile_name": "E2E", "default_delay": 20, "pages": [{"name": "BLE", "keys": keys}]}


def cell_xy(cell):
    i = cell - 1
    return (i % 5) * 96 + 48, 30 + (i // 5) * 90 + 40


def typed():
    return OUT.read_bytes().decode("utf-8", "replace") if OUT.exists() else ""   # keep \r\n as typed


def log(msg):
    print(f"[e2e {time.strftime('%H:%M:%S')}] {msg}", flush=True)


class Helper:
    """KpHelper child process with its stdout read on a thread."""

    def __init__(self, *args):
        if not HELPER.exists():
            subprocess.run(["dotnet", "build", str(HELPER.parents[1] / "KpHelper"), "-c", "Release", "-o", str(HELPER.parent)], check=True)
        self.p = subprocess.Popen([str(HELPER), *args], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                  text=True, bufsize=1)
        self.lines = queue.Queue()
        threading.Thread(target=self._read, daemon=True).start()

    def _read(self):
        for line in self.p.stdout:
            self.lines.put(line.rstrip())
        self.lines.put(None)

    def next(self, timeout):
        try:
            return self.lines.get(timeout=timeout)
        except queue.Empty:
            return ""

    def send(self, text):
        self.p.stdin.write(text + "\n")
        self.p.stdin.flush()

    def wait_for(self, prefix, timeout):
        deadline = time.time() + timeout
        while time.time() < deadline:
            l = self.next(0.2)
            if l is None:
                break
            if l:
                log(f"helper: {l}")
            if l and l.startswith(prefix):
                return l
        raise RuntimeError(f"helper never printed {prefix!r}")

    def stop(self):
        if self.p.poll() is None:
            self.p.kill()


def helper_run(*args, timeout=60):
    r = subprocess.run([str(HELPER), *args], capture_output=True, text=True, timeout=timeout)
    for l in r.stdout.splitlines():
        log(f"helper: {l}")
    return r.stdout


def forget_device_bonds(d):
    bonds = [int(l.split()[0]) for l in d.cmd("ble list") if l[:1].isdigit()]
    for n in sorted(bonds, reverse=True):
        d.cmd(f"ble forget {n}")
    return len(bonds)


def pair(d):
    since = len(d.events)
    d.ok("ble pair")   # the ticket shows the passkey; Windows asks for it below
    h = Helper("pair", NAME, "60")
    try:
        deadline = time.time() + 75
        while time.time() < deadline:
            d._pump()
            l = h.next(0.1)
            if l is None:
                raise RuntimeError("helper exited before pairing finished")
            if not l:
                continue
            log(f"helper: {l}")
            if l == "NEED_PIN":
                time.sleep(0.5)   # the keypad posts its passkey as Windows asks for it
                d._pump()
                keys = [e for _, e in d.events[since:] if e.startswith("EVT:PASSKEY ")]
                if not keys:
                    keys = [d.wait_event(r"^EVT:PASSKEY \d{6}$", 10, since).group(0)]
                pin = keys[-1].split()[1]
                log(f"entering passkey {pin} from the keypad screen")
                h.send(pin)
            elif l.startswith("OK"):
                return True
            elif l.startswith("ERR"):
                raise RuntimeError(f"pairing failed: {l}")
        raise RuntimeError("pairing timed out")
    finally:
        h.stop()


def main():
    OUT.parent.mkdir(exist_ok=True)
    d = kp.Device()
    d.ready()
    window = None
    ok = False
    try:
        d.ok("setdim 0")
        d.ok("hid dry off")
        r = d.upload_text(f"profile{SLOT}.json", json.dumps(profile()))
        assert any(l.startswith("SAVED") for l in r), r
        d.ok(f"setprofile {SLOT}")

        log("clearing old pairings")
        helper_run("unpair", NAME)
        log(f"keypad forgot {forget_device_bonds(d)} bond(s)")

        log("pairing")
        pair(d)
        d.wait_event(r"^EVT:BLE \d+ up$", 20)
        deadline = time.time() + 20
        while "ble:1" not in d.cmd("status")[0]:
            if time.time() > deadline:
                raise RuntimeError("host never connected")
            time.sleep(0.5)
        window = Helper("window", str(OUT), "150")
        window.wait_for("OK window", 15)
        log("host connected; probing until Windows delivers keystrokes to the window")
        deadline = time.time() + 45
        while not typed():
            if time.time() > deadline:
                raise RuntimeError("no keystrokes reached the test window")
            d.touch(*cell_xy(5))
            time.sleep(1.5)
        time.sleep(1.5)
        prefix = typed()
        log(f"keyboard ready (probe typed {prefix!r})")
        for cell, pause in ((1, 2.5), (2, 1.0), (3, 1.5), (4, 1.0)):
            log(f"tap cell {cell}")
            d.touch(*cell_xy(cell))
            time.sleep(pause)
        deadline = time.time() + 10
        got = ""
        while time.time() < deadline:
            got = typed()[len(prefix):]
            if got == EXPECT:
                break
            time.sleep(0.3)
        d.shot(str(ROOT / "build" / "e2e-screen.png"))
        ok = got == EXPECT
        log(f"typed {got!r}")
        log("PASS: keystrokes over BLE match" if ok else f"FAIL: expected {EXPECT!r}")
    finally:
        if window:
            window.stop()
        log("cleaning up")
        try:
            helper_run("unpair", NAME)
            forget_device_bonds(d)
            d.cmd("hid dry on")
            d.cmd("setprofile 1")
            d.cmd("setdim 120")
        finally:
            d.close()
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
