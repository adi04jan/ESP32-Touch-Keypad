#!/usr/bin/env python3
"""kp.py: build, flash, drive and inspect the ESP32 Touch Keypad over USB serial.

  python tools/kp.py build [--release]
  python tools/kp.py flash [--no-build] [--release]
  python tools/kp.py cmd "status"
  python tools/kp.py monitor [seconds]
  python tools/kp.py events [seconds]
  python tools/kp.py shot out.png
  python tools/kp.py touch X Y [ms] | hold X Y [ms] | swipe X1 Y1 X2 Y2 [ms]
  python tools/kp.py upload local_file device_path
  python tools/kp.py reset

Port and paths come from KP_PORT (default COM26) and KP_ARDUINO_CLI. The Device
class is importable (tests use it). Windows opens COM ports exclusively, so
concurrent kp.py processes serialize by retrying the open.
"""
import argparse
import array
import base64
import os
import re
import subprocess
import sys
import time
import zlib
from pathlib import Path

import serial

ROOT = Path(__file__).resolve().parents[1]
SKETCH = ROOT / "firmware" / "TouchKeypad"
BUILD = ROOT / "build" / "fw"
BUILD_RELEASE = ROOT / "build" / "fw-release"   # no KP_TEST: what Studio installs and bundles
ARDUINO_CLI = os.environ.get("KP_ARDUINO_CLI", r"C:\Program Files\Arduino CLI\arduino-cli.exe")
FQBN = "esp32:esp32:esp32:FlashSize=4M,UploadSpeed=921600"
APP_MAX = 0x1D0000          # factory partition size in partitions.csv
def find_port():
    """KP_PORT if set, else the first CH340 (VID 1A86, PID 7523); the COM number moves between USB sockets."""
    if os.environ.get("KP_PORT"):
        return os.environ["KP_PORT"]
    from serial.tools import list_ports
    for p in list_ports.comports():
        if p.vid == 0x1A86 and p.pid == 0x7523:
            return p.device
    return "COM26"


PORT = find_port()
BAUD = 921600
PROMPT = b"macropad:$ "
B64_LINE = re.compile(r"^[A-Za-z0-9+/]+={0,2}$")


class DeviceError(Exception):
    pass


class Device:
    """One open serial link. EVT: lines are diverted to self.events."""

    def __init__(self, port=PORT, baud=BAUD, on_event=None, open_wait=30):
        self.port, self.baud, self.on_event = port, baud, on_event
        self.ser = None
        self.buf = b""
        self.events = []          # (time, line) for every EVT: seen
        self.prompted = False     # a prompt went by as the prefix of a later line (async EVT: after it)
        self.open(open_wait)

    # ---- port handling ----
    def open(self, wait=30):
        deadline = time.time() + wait
        while True:
            try:
                s = serial.Serial()
                s.port, s.baudrate, s.timeout = self.port, self.baud, 0.02
                s.dtr = False      # keep EN/IO0 released: opening must not reset the board
                s.rts = False
                s.open()
                self.ser = s
                return
            except serial.SerialException:
                if time.time() > deadline:
                    raise
                time.sleep(0.3)

    def close(self):
        if self.ser:
            self.ser.close()
            self.ser = None

    def reopen(self, wait=30):
        self.close()
        self.buf = b""
        self.open(wait)

    def reset(self, timeout=15):
        """Hardware reset through RTS->EN, then wait for the boot prompt."""
        self.ser.dtr = False
        self.ser.rts = True
        time.sleep(0.12)
        self.ser.rts = False
        self.buf = b""
        return self.wait_prompt(timeout)

    # ---- reading ----
    def _pump(self, timeout=0.02):
        """Read what is available; divert complete EVT: lines. Returns new complete lines."""
        try:
            data = self.ser.read(max(1, self.ser.in_waiting))
        except serial.SerialException:
            self.reopen()
            return []
        if not data:
            return []
        self.buf += data
        out = []
        while b"\n" in self.buf:
            raw, self.buf = self.buf.split(b"\n", 1)
            line = raw.decode("utf-8", "replace").rstrip("\r")
            # A prompt can prefix a line when output follows it directly.
            while line.startswith(PROMPT.decode()):
                line = line[len(PROMPT):]
                self.prompted = True
            if line.startswith("EVT:"):
                self.events.append((time.time(), line))
                if self.on_event:
                    self.on_event(line)
            else:
                out.append(line)
        return out

    def _at_prompt(self):
        return self.buf.endswith(PROMPT)

    def drain(self, quiet=0.05):
        """Swallow pending output until the line is quiet."""
        t = time.time()
        while time.time() - t < quiet:
            if self._pump():
                t = time.time()
        self.buf = b"" if self._at_prompt() else self.buf
        self.prompted = False

    def wait_prompt(self, timeout=10):
        lines, deadline = [], time.time() + timeout
        while time.time() < deadline:
            lines += self._pump()
            if self._at_prompt() or self.prompted:
                if self._at_prompt():
                    self.buf = b""
                self.prompted = False
                return lines
        raise DeviceError(f"no prompt within {timeout}s; got {lines[-5:]!r} buf={self.buf[-80:]!r}")

    def ready(self, timeout=20):
        """Poke with empty lines until a prompt answers (the boot prompt may predate the port opening)."""
        deadline = time.time() + timeout
        while time.time() < deadline:
            self.write_line("")
            try:
                return self.wait_prompt(1)
            except DeviceError:
                pass
        raise DeviceError(f"no prompt within {timeout}s")

    def write_line(self, line):
        self.ser.write(line.encode() + b"\n")

    def cmd(self, line, timeout=5):
        """Send one CLI line, return the reply lines (EVT: lines excluded)."""
        self.drain()
        self.write_line(line)
        return self.wait_prompt(timeout)

    def ok(self, line, timeout=5):
        """cmd() that raises on an ERR reply."""
        r = self.cmd(line, timeout)
        if any(l.startswith("ERR") for l in r):
            raise DeviceError(f"{line!r} -> {r!r}")
        return r

    # ---- events ----
    def clear_events(self):
        self.events = []

    def wait_event(self, pattern, timeout=3, since=0):
        """Wait for an EVT: line matching regex `pattern` (searched in events[since:])."""
        rx = re.compile(pattern)
        deadline = time.time() + timeout
        while True:
            for _, l in self.events[since:]:
                m = rx.search(l)
                if m:
                    return m
            if time.time() > deadline:
                raise DeviceError(f"no event /{pattern}/ in {timeout}s; saw {[l for _, l in self.events[-10:]]}")
            self._pump()

    def listen(self, seconds):
        deadline = time.time() + seconds
        lines = []
        while time.time() < deadline:
            lines += self._pump()
        return lines

    # ---- gestures (the firmware prints the prompt when the gesture ends) ----
    def touch(self, x, y, ms=80):
        return self.cmd(f"touch {x} {y} {ms}", timeout=ms / 1000 + 3)

    def hold(self, x, y, ms=800):
        return self.cmd(f"hold {x} {y} {ms}", timeout=ms / 1000 + 3)

    def swipe(self, x1, y1, x2, y2, ms=250):
        return self.cmd(f"swipe {x1} {y1} {x2} {y2} {ms}", timeout=ms / 1000 + 3)

    # ---- screen ----
    def shot_raw(self, timeout=20):
        """Return (w, h, rgb565 little-endian bytes)."""
        self.drain()
        self.write_line("shot")
        deadline = time.time() + timeout
        w = h = None
        chunks = []
        while time.time() < deadline:
            for l in self._pump():
                if l.startswith("###SHOT###"):
                    _, w, h, fmt = l.split()
                    w, h = int(w), int(h)
                elif l.startswith("###END###"):
                    self.wait_prompt(5)
                    data = b"".join(chunks)
                    if len(data) != w * h * 2:
                        raise DeviceError(f"shot size {len(data)} != {w * h * 2}")
                    return w, h, data
                elif w is not None and B64_LINE.match(l):   # skip interleaved log lines
                    try:
                        chunks.append(base64.b64decode(l))
                    except ValueError as e:   # a damaged line: shot() retries the capture
                        raise DeviceError(f"shot line damaged: {e}")
        raise DeviceError("shot timed out")

    def shot(self, path=None, tries=3):
        """Capture the screen; returns a PIL Image (and saves it when path is given).
        Retries when a line arrives damaged (the PC side can drop bytes while it is busy)."""
        from PIL import Image
        for attempt in range(tries):
            try:
                w, h, data = self.shot_raw()
                break
            except DeviceError:
                if attempt == tries - 1:
                    raise
                self.drain(0.5)
        img = Image.frombytes("RGB", (w, h), rgb565_to_rgb(data))
        if path:
            img.save(path)
        return img

    # ---- uploads ----
    def upload_text(self, devpath, text, timeout=15):
        self.drain()
        self.write_line(f"###BEGIN### {devpath}")
        self._expect_recv()
        payload = text.replace("\r\n", "\n")
        if not payload.endswith("\n"):
            payload += "\n"
        self._send_chunked(payload.encode())
        self.write_line("###END###")
        return self.wait_prompt(timeout)

    def upload_bin(self, devpath, data, timeout=15, crc=None):
        crc = zlib.crc32(data) if crc is None else crc
        self.drain()
        self.write_line(f"###BEGINB### {devpath} {len(data)} crc={crc:08x}")
        self._expect_recv()
        b64 = base64.b64encode(data).decode()
        self._send_chunked("".join(b64[i:i + 76] + "\n" for i in range(0, len(b64), 76)).encode())
        self.write_line("###END###")
        return self.wait_prompt(timeout)

    def _expect_recv(self, timeout=3):
        deadline = time.time() + timeout
        while time.time() < deadline:
            for l in self._pump():
                if l.startswith("RECV"):
                    return
                if l.startswith("ERR"):
                    self.wait_prompt(2)
                    raise DeviceError(l)
        raise DeviceError("no RECV after ###BEGIN###")

    def _send_chunked(self, data, chunk=1024):
        for i in range(0, len(data), chunk):
            self.ser.write(data[i:i + chunk])
            self._pump()    # keep diverting events while we stream


def rgb565_to_rgb(data):
    px = array.array("H")
    px.frombytes(data)
    if sys.byteorder != "little":
        px.byteswap()
    lut5 = bytes((v << 3) | (v >> 2) for v in range(32))
    lut6 = bytes((v << 2) | (v >> 4) for v in range(64))
    out = bytearray(len(px) * 3)
    out[0::3] = bytes(lut5[(v >> 11) & 31] for v in px)
    out[1::3] = bytes(lut6[(v >> 5) & 63] for v in px)
    out[2::3] = bytes(lut5[v & 31] for v in px)
    return bytes(out)


# ---------------------------------------------------------------- toolchain
def build(release=False):
    flags = "" if release else "-DKP_TEST=1"
    cmd = [ARDUINO_CLI, "compile", "--fqbn", FQBN, "--build-path", str(BUILD_RELEASE if release else BUILD),
           "--build-property", f"upload.maximum_size={APP_MAX}",
           "--build-property", f"compiler.cpp.extra_flags={flags}",
           "--warnings", "default", str(SKETCH)]
    print("$", " ".join(cmd), flush=True)
    r = subprocess.run(cmd)
    if r.returncode:
        raise SystemExit(f"build failed ({r.returncode})")


def flash(no_build=False, release=False):
    if not no_build:
        build(release)
    cmd = [ARDUINO_CLI, "upload", "--fqbn", FQBN, "-p", PORT, "--input-dir", str(BUILD_RELEASE if release else BUILD), str(SKETCH)]
    print("$", " ".join(cmd), flush=True)
    for attempt in range(3):
        if subprocess.run(cmd).returncode == 0:
            break
        time.sleep(2)
    else:
        raise SystemExit("upload failed")
    d = Device()
    try:
        d.ready(20)
        print("[kp] device ready:", " ".join(d.cmd("status")))
    finally:
        d.close()


# ---------------------------------------------------------------- CLI
def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="op", required=True)
    b = sub.add_parser("build"); b.add_argument("--release", action="store_true")
    f = sub.add_parser("flash"); f.add_argument("--no-build", action="store_true"); f.add_argument("--release", action="store_true")
    c = sub.add_parser("cmd"); c.add_argument("line"); c.add_argument("--timeout", type=float, default=10)
    m = sub.add_parser("monitor"); m.add_argument("seconds", nargs="?", type=float, default=10)
    e = sub.add_parser("events"); e.add_argument("seconds", nargs="?", type=float, default=10)
    s = sub.add_parser("shot"); s.add_argument("out", nargs="?", default="shot.png")
    t = sub.add_parser("touch"); t.add_argument("x", type=int); t.add_argument("y", type=int); t.add_argument("ms", nargs="?", type=int, default=80)
    h = sub.add_parser("hold"); h.add_argument("x", type=int); h.add_argument("y", type=int); h.add_argument("ms", nargs="?", type=int, default=800)
    w = sub.add_parser("swipe")
    for a in ("x1", "y1", "x2", "y2"):
        w.add_argument(a, type=int)
    w.add_argument("ms", nargs="?", type=int, default=250)
    u = sub.add_parser("upload"); u.add_argument("local"); u.add_argument("devpath")
    sub.add_parser("reset")
    a = ap.parse_args(argv)

    if a.op == "build":
        return build(a.release)
    if a.op == "flash":
        return flash(a.no_build, a.release)

    printer = (lambda l: print(l, flush=True)) if a.op != "monitor" else None
    d = Device(on_event=printer)
    try:
        if a.op == "cmd":
            for l in d.cmd(a.line, a.timeout):
                print(l)
        elif a.op == "monitor":
            deadline = time.time() + a.seconds
            while time.time() < deadline:
                data = d.ser.read(4096)
                if data:
                    sys.stdout.write(data.decode("utf-8", "replace"))
                    sys.stdout.flush()
        elif a.op == "events":
            d.listen(a.seconds)
        elif a.op == "shot":
            t0 = time.time()
            d.shot(a.out)
            print(f"saved {a.out} ({time.time() - t0:.1f}s)")
        elif a.op in ("touch", "hold"):
            for l in getattr(d, a.op)(a.x, a.y, a.ms):
                print(l)
        elif a.op == "swipe":
            for l in d.swipe(a.x1, a.y1, a.x2, a.y2, a.ms):
                print(l)
        elif a.op == "upload":
            data = Path(a.local).read_bytes()
            binary = a.devpath.endswith((".565", ".bin")) or b"\0" in data
            r = d.upload_bin(a.devpath, data) if binary else d.upload_text(a.devpath, data.decode("utf-8"))
            for l in r:
                print(l)
            if not any(l.startswith("SAVED") for l in r):
                return 1
        elif a.op == "reset":
            for l in d.reset()[-15:]:
                print(l)
    finally:
        d.close()


if __name__ == "__main__":
    sys.exit(main())
