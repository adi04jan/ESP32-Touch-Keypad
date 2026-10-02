"""End to end over real Bluetooth: pair the keypad with this PC, type into a
test window, check the text, then run a host action through Studio, unpair.

    python tools/e2e/run_e2e.py          # board on USB (KP_TEST build), BLE on this PC

Keystrokes only ever go to KpHelper's own topmost window, which keeps focus
while the test runs. The one media key (Play/Pause from the player page) is
pressed only while KpHelper's own silent media session is the one Windows
routes media keys to, and pressed twice so it ends playing. The host action is a reserved
Ctrl+Alt+Shift+F18 combo that Studio's global shortcut consumes. The keypad's
bonds are cleared before and after (it is a test device); this PC's pairing
with it is removed at the end.

When this PC is already paired and connected (a keypad in daily use), the run
reuses that pairing and leaves it in place; --fresh-pairing clears it and pairs
again (the pairing test). Either way the keypad's profile, theme, LED,
brightness, click and dry-run state are saved first and put back after
(keypad_state.py), and this PC's real name goes back on the host.
"""
import json
import os
import queue
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))
sys.path.insert(0, str(ROOT / "tools" / "e2e"))
import kp  # noqa: E402
import keypad_state  # noqa: E402

STATE = ROOT / "build" / "e2e-keypad-before.json"

HELPER = ROOT / "tools" / "e2e" / "bin" / "KpHelper.exe"
OUT = ROOT / "build" / "e2e-keys.txt"
NAME = "Touch Keypad"
SLOT = 6
TEXT = "kp-e2e: Hello, Paper Theatre 123!"
# 120 characters in one go: a dropped or merged HID report shows up as a missing letter
LONG = " Sphinx of black quartz, judge my vow. The quick brown fox jumps over the lazy dog! 0123456789 Pack my box, end."
EXPECT = TEXT + "K\r\nsecond lin[on][off]" + LONG   # text, Shift+K, multiline, one backspace, toggle on then off, the long line
PLAY_XY = (274, 248)                           # the player page's Play/Pause button
HOST_OK = ROOT / "build" / "e2e-host-ok.txt"
HOST_SLOT = 5                                  # Ctrl+Alt+Shift+F18
HOST_CMD = f"run echo host-ok> {HOST_OK}"


def profile():
    keys = [None] * 15
    keys[0] = {"id": 1, "name": "Text", "led_color": [47, 107, 115], "actions": [{"type": "text", "value": TEXT}]}
    keys[1] = {"id": 2, "name": "Shift K", "led_color": [194, 65, 43], "actions": [{"type": "keycombo", "keys": ["LEFT_SHIFT", "K"]}]}
    keys[2] = {"id": 3, "name": "Lines", "led_color": [226, 176, 74], "actions": [{"type": "multiline", "value": "\nsecond line"}]}
    keys[3] = {"id": 4, "name": "Bksp", "led_color": [122, 31, 43], "actions": [{"type": "key", "value": "BACKSPACE"}]}
    keys[4] = {"id": 5, "name": "Probe", "led_color": [47, 107, 79], "actions": [{"type": "text", "value": "."}]}
    keys[5] = {"id": 6, "name": "Host", "led_color": [100, 80, 160], "actions": [{"type": "host", "cmd": HOST_CMD, "slot": HOST_SLOT}]}
    keys[7] = {"id": 8, "name": "Long", "icon": "type", "led_color": [79, 140, 255], "actions": [{"type": "text", "value": LONG}]}
    keys[9] = {"id": 10, "name": "Vol up", "icon": "volume-2", "led_color": [138, 152, 171], "actions": [{"type": "media", "value": "VOLUME_UP"}]}
    keys[10] = {"id": 11, "name": "Vol down", "icon": "volume-1", "led_color": [138, 152, 171], "actions": [{"type": "media", "value": "VOLUME_DOWN"}]}
    keys[6] = {"id": 7, "name": "Toggle", "icon": "power", "led_color": [82, 214, 143], "toggle": True,
               "actions": [{"type": "text", "value": "[on]"}], "off_actions": [{"type": "text", "value": "[off]"}]}
    player = [None] * 15
    player[0] = {"id": 1, "name": "Now Playing", "widget": "media", "span": [5, 3], "actions": [{"type": "media", "value": "PLAY_PAUSE"}]}
    return {"schema_version": 2, "profile_name": "E2E", "default_delay": 20,
            "pages": [{"name": "BLE", "keys": keys}, {"name": "Media", "keys": player}]}


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
            if l and not l.startswith("POS "):
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


def start_studio():
    """Studio with only the host bridge active: no serial (kp.py owns the port), no feeds."""
    data = ROOT / "build" / "e2e-studio"
    (data / "data").mkdir(parents=True, exist_ok=True)
    (data / "data" / "settings.json").write_text(json.dumps({
        "auto_connect": False, "nowplaying_enabled": False, "auto_switch_enabled": False,
        "host_slots": {str(HOST_SLOT): HOST_CMD}}))
    exe = ROOT / "studio" / "node_modules" / "electron" / "dist" / "electron.exe"
    return subprocess.Popen([str(exe), str(ROOT / "studio")], env={**os.environ, "STUDIO_DATA_DIR": str(data)},
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


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


def pc_locked():
    """The lock screen (LogonUI) takes every keystroke, shortcut and media key."""
    out = subprocess.run(["tasklist", "/FI", "IMAGENAME eq LogonUI.exe"], capture_output=True, text=True).stdout
    return "LogonUI.exe" in out


def hid_media_check(d):
    """Media keys read straight from Windows' HID stack (KpHelper hidread): the Bluetooth HID
    path end to end, with no focus needed, so it runs on a locked PC too. Vol up then Vol down."""
    h = Helper("hidread", "VID&02303A_PID&80C6", "10")
    try:
        h.wait_for("OPEN col02", 15)
        d.touch(*cell_xy(15))              # an empty cell: wakes a dimmed screen, sends nothing
        time.sleep(0.6)
        for cell in (10, 11):
            d.touch(*cell_xy(cell))
            time.sleep(0.7)
        got = []
        while (l := h.next(12)) and not l.startswith("OK"):
            got.append(l)
    finally:
        h.stop()
    want = ["REPORT col02 02e900", "REPORT col02 020000", "REPORT col02 02ea00", "REPORT col02 020000"]
    ok = [l for l in got if l.startswith("REPORT col02")] == want
    log("PASS: Vol up and Vol down reached Windows' HID stack over BLE" if ok else f"FAIL: HID reports {got!r}")
    return ok


def main():
    OUT.parent.mkdir(exist_ok=True)
    keypad_state.save(STATE, SLOT)          # also frees slot 6 (or stops if it holds a real profile)
    d = kp.Device()
    d.ready()
    window = studio = None
    ok = False
    reuse = "ble:1" in d.cmd("status")[0] and "--fresh-pairing" not in sys.argv \
        and "paired=True" in helper_run("list", NAME, timeout=40)
    try:
        d.ok("setdim 0")
        d.ok("hid dry off")
        r = d.upload_text(f"profile{SLOT}.json", json.dumps(profile()))
        assert any(l.startswith("SAVED") for l in r), r
        d.ok(f"setprofile {SLOT}")

        if reuse:
            log("this PC is already paired and connected: reusing that pairing")
        else:
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
        names = d.cmd("hostname E2E-PC") + d.cmd("ble list")
        named = any(l.endswith(" connected E2E-PC") for l in names)
        log("PASS: the connected host carries Studio's name" if named else f"FAIL: host name not set: {names}")
        d.cmd(f"hostname {socket.gethostname()}")   # this PC's real name back
        hid_ok = hid_media_check(d)
        if pc_locked():
            log("SKIP: this PC is locked, and the lock screen takes keystrokes: typing, the host action and Play/Pause need it unlocked")
            ok = hid_ok
            return 0 if ok else 1
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
        for cell, pause in ((1, 2.5), (2, 1.0), (3, 1.5), (4, 1.0), (7, 1.2), (7, 1.2), (8, 7.0)):
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
        ok = got == EXPECT and hid_ok
        log(f"typed {got!r}")
        log("PASS: keystrokes over BLE match" if ok else f"FAIL: expected {EXPECT!r}")

        log("host action: starting Studio's host bridge")
        HOST_OK.unlink(missing_ok=True)
        studio = start_studio()
        time.sleep(8)   # Electron starts and registers the reserved combos
        before = typed()
        log("tap cell 6 (host action, slot 5)")
        d.touch(*cell_xy(6))
        deadline = time.time() + 8
        while not HOST_OK.exists() and time.time() < deadline:
            time.sleep(0.3)
        time.sleep(0.5)
        host_ok = HOST_OK.exists() and HOST_OK.read_text().startswith("host-ok")
        quiet = typed() == before
        log("PASS: Studio ran the host command" if host_ok else "FAIL: host command did not run")
        log("PASS: the combo never reached the window" if quiet else f"FAIL: window got {typed()[len(before):]!r}")
        ok = ok and host_ok and quiet and named

        log("media key: Play/Pause from the player page into KpHelper's silent session")
        media = Helper("media", "60", "KP E2E Media")
        try:
            cur = media.wait_for("CURRENT", 15) or ""
            if "KpHelper" not in cur:
                log(f"SKIP: Windows routes media keys to {cur!r}, not the test session")
            else:
                d.ok("page 2")
                time.sleep(0.8)
                d.touch(*PLAY_XY)
                paused = media.wait_for("STATE Paused", 6)
                d.touch(*PLAY_XY)
                resumed = media.wait_for("STATE Playing", 6)
                both = bool(paused and resumed)
                log("PASS: Play/Pause over BLE paused and resumed the session" if both else f"FAIL: media key: paused={paused!r} resumed={resumed!r}")
                ok = ok and both
                d.ok("page 1")
        finally:
            media.stop()
    finally:
        if studio:
            subprocess.run(["taskkill", "/PID", str(studio.pid), "/T", "/F"], capture_output=True)
        if window:
            window.stop()
        log("cleaning up")
        try:
            if not reuse:
                helper_run("unpair", NAME)
                forget_device_bonds(d)
            d.cmd("setdim 120")
        finally:
            d.close()
        keypad_state.restore(STATE)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
