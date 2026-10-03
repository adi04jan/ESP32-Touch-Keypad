"""Hardware tests for the Touch Keypad firmware (3.3) over USB serial.

    python -m pytest tools/tests -v          # board on the first CH340, or KP_PORT=COMx

HID runs dry (reports logged as EVT:HID, nothing reaches a host). The tests use
profile slot 16 and put the active profile, the touch calibration, the theme
and the HID dry-run state back exactly as they found them, so the suite can
run on a keypad that is in use.
"""
import json
import re
import socket
import sys
import time
import zlib
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import kp  # noqa: E402

SLOT = 16                         # the last slot: 1-13 hold the owner's profiles
TILE_W = 72
G_LINE = 310                      # page stations
FPS_FLOOR = 50                    # every animation, measured by the firmware's `perf`


def cell_xy(cell):
    """Centre of 1-based cell (5x3 grid of 96x90 under the 30 px status band)."""
    i = cell - 1
    return (i % 5) * 96 + 48, 30 + (i // 5) * 90 + 40


def key_box(cell):
    """Top-left of the 66 px glass key inside a cell."""
    i = cell - 1
    return (i % 5) * 96 + 15, 30 + (i // 5) * 90 + 4


def key(i, name, actions, **kw):
    return {"id": i, "name": name, "icon": kw.pop("icon", "star"), "led_color": [194, 65, 43], "actions": actions, **kw}


def make_tile():
    """Left half red, right half green, big-endian RGB565 (Studio's byte order)."""
    px = bytearray()
    for _y in range(TILE_W):
        for x in range(TILE_W):
            px += (0xF800 if x < TILE_W // 2 else 0x07E0).to_bytes(2, "big")
    return bytes(px)


TILE = make_tile()
TILE_CRC = f"{zlib.crc32(TILE):08x}"


def make_profile():
    p1 = [None] * 15
    p1[0] = key(1, "Copy", [{"type": "keycombo", "keys": ["LEFT_CTRL", "C"]}], icon="copy")
    p1[1] = key(2, "Type", [{"type": "text", "value": "hi!"}], icon="type")
    p1[2] = key(3, "Folder", [{"type": "page", "value": 2}], icon="folder")
    p1[3] = key(4, "Host", [{"type": "host", "cmd": "open notepad", "slot": 5}], icon="file-text")
    p1[4] = key(5, "Hold", [{"type": "key", "value": "A"}], hold_actions=[{"type": "key", "value": "B"}], icon="play")
    p1[5] = key(6, "Mute", [{"type": "media", "value": "MUTE"}], icon="volume-x")
    tile_key = key(7, "Tile", [{"type": "key", "value": "F13"}], tile=TILE_CRC)
    del tile_key["icon"]
    p1[6] = tile_key
    p1[7] = key(8, "Toggle", [{"type": "key", "value": "T"}], toggle=True, icon="mic")
    p2 = [None] * 15
    p2[0] = {"id": 1, "name": "Now Playing", "widget": "media", "span": [5, 3], "actions": [{"type": "media", "value": "PLAY_PAUSE"}]}
    p3 = [None] * 15
    p3[0] = key(1, "Back", [{"type": "back"}], icon="arrow-left")
    p3[14] = key(15, "Last", [{"type": "key", "value": "Z"}], icon="flag")
    return {"schema_version": 2, "profile_name": "Test", "color": [242, 183, 70], "default_delay": 5,
            "pages": [{"name": "One", "keys": p1}, {"name": "Two", "keys": p2}, {"name": "Three", "keys": p3}]}


PROFILE = make_profile()


@pytest.fixture(scope="session")
def dev():
    d = kp.Device()
    d.ready()
    d.cmd("calibrate cancel")
    cal = d.cmd("touchcal")[0]
    st0 = d.cmd("status")[0]
    theme = re.search(r"theme:(\w+)", st0)
    profile = re.search(r"Profile:(\d+)", st0)
    dry = re.search(r"dry:(\d)", st0)
    led = re.match(r"led (\w+) color (\d+ \d+ \d+) brightness (\d+)", d.cmd("led")[0])
    old = d.cmd(f"cat /profile{SLOT}.json")   # someone's slot 16, put back at the end
    old = None if not old or old[0].startswith("ERR") else "\n".join(old)
    d.ok("setdim 0")
    d.ok("hid dry on")
    ianim = d.cmd("iconanim")[0]                  # pixel tests want still icons; put the owner's choice back after
    d.ok("iconanim off")
    r = d.upload_bin(f"/t/{TILE_CRC}.565", TILE)
    assert any(l.startswith("SAVED") for l in r), r
    r = d.upload_text(f"profile{SLOT}.json", json.dumps(PROFILE))
    assert any(l.startswith("SAVED") for l in r), r
    d.ok(f"setprofile {SLOT}")
    yield d
    d.cmd("calibrate cancel")
    m = re.match(r"cal:(\d) (.*)", cal)
    d.cmd(f"touchcal set {m.group(2)}" if m and m.group(1) == "1" else "touchcal clear")
    d.cmd(f"led {led.group(1)} {led.group(2)}" if led else "led rainbow")
    if led:
        d.cmd(f"ledbright {led.group(3)}")
    d.cmd(f"theme {theme.group(1) if theme else 'daylight'}")
    d.cmd(f"setprofile {profile.group(1) if profile else 1}")
    if old: d.upload_text(f"profile{SLOT}.json", old)
    else: d.cmd(f"rm /profile{SLOT}.json")   # and its tile goes with it
    d.cmd(f"hid dry {'on' if dry and dry.group(1) == '1' else 'off'}")
    d.cmd("power sim off")
    d.cmd("setdim 120")
    d.cmd("iconanim on" if ianim.endswith("on") else "iconanim off")
    d.close()


@pytest.fixture
def d(dev):
    """Each test starts on page 1 of the test profile, home screen, clean events."""
    st = dev.cmd("status")[0]
    if f"Profile:{SLOT} " not in st:
        dev.ok(f"setprofile {SLOT}")
    if "ui:home" not in st:
        dev.cmd("ble cancel")
        dev.cmd("calibrate cancel")
        dev.cmd("sheet close")
    if "theme:glass" not in st:   # pixel checks below are written against Glass
        dev.cmd("theme glass")
        time.sleep(0.4)
    if "page:1 " not in dev.cmd("status")[0]:
        dev.ok("page 1")
    time.sleep(0.5)
    dev.listen(0.2)
    dev.clear_events()
    return dev


def tap(d, cell, ms=80):
    d.touch(*cell_xy(cell), ms)


def hid_reports(d, rid, n, timeout=3):
    deadline = time.time() + timeout
    while time.time() < deadline:
        got = [l.split()[2] for _, l in d.events if l.startswith(f"EVT:HID {rid} ")]
        if len(got) >= n:
            return got
        d._pump()
    raise AssertionError(f"wanted {n} HID {rid} reports, saw {[l for _, l in d.events]}")


def close(px, rgb, tol=14):
    return all(abs(a - b) <= tol for a, b in zip(px, rgb))


def fps(d, action, wait=0.8):
    d.cmd("perf reset")
    action()
    time.sleep(wait)
    m = re.search(r"frames:(\d+) avg_ms:([\d.]+) max_ms:([\d.]+) fps:([\d.]+)", d.cmd("perf")[0])
    return int(m.group(1)), float(m.group(4)), float(m.group(3))


# ---------------------------------------------------------------- protocol
def test_status_identifies_touch_keypad(d):
    st = d.cmd("status")[0]
    assert "model:touch" in st and "ver:3." in st and "theme:" in st and "pages:3" in st and "ui:home" in st and re.search(r"cal:[01]", st)


def test_default_profiles_are_installed(dev):
    for n, name in [(1, "Daily"), (2, "Code"), (3, "Stream")]:
        p = json.loads("\n".join(dev.cmd(f"cat /profile{n}.json")))
        assert p["profile_name"] == name and len(p["pages"]) == 3
        assert all(len(pg["keys"]) == 15 for pg in p["pages"])


def test_profile_round_trip(dev):
    assert json.loads("\n".join(dev.cmd(f"cat /profile{SLOT}.json"))) == PROFILE


def test_bad_json_is_rejected_and_old_profile_kept(dev):
    r = dev.upload_text(f"profile{SLOT}.json", '{"schema_version": 2, "pages": [')
    assert any("Upload rejected" in l for l in r), r
    assert json.loads("\n".join(dev.cmd(f"cat /profile{SLOT}.json"))) == PROFILE


def test_bad_shape_is_rejected(dev):
    r = dev.upload_text(f"profile{SLOT}.json", '{"schema_version": 2, "pages": []}')
    assert any("Upload rejected" in l and "pages" in l for l in r), r


def test_tile_crc_mismatch_is_rejected(dev):
    r = dev.upload_bin("/t/00000000.565", TILE, crc=0x12345678)
    assert any("crc mismatch" in l for l in r), r
    assert not any("00000000.565" in l for l in dev.cmd("ls /t"))


def test_upload_stall_times_out(dev):
    dev.drain()
    dev.write_line("###BEGIN### stall.json")
    dev._expect_recv()
    assert any("timed out" in l for l in dev.wait_prompt(8))


def test_rm_removes_a_file(dev):
    assert any(l.startswith("SAVED") for l in dev.upload_text("scratch.json", '{"a": 1}'))
    assert dev.cmd("rm scratch.json") == ["removed /scratch.json"]
    assert not any("scratch.json" in l for l in dev.cmd("ls"))


def test_ram_preview_commands(d):
    assert d.cmd('setkey 15 [{"type":"key","value":"Y"}]') == ["Key 15 updated in RAM"]
    assert d.cmd("title 15 Preview") == ["title 15"]
    tap(d, 15)
    assert hid_reports(d, 1, 1)[0] == "00001c0000000000"   # Y
    d.ok(f"setprofile {SLOT}")                              # previews are RAM only


# ---------------------------------------------------------------- keys and gestures
def test_tap_runs_keycombo(d):
    tap(d, 1)
    d.wait_event(r"^EVT:KEY 1 1 1$")
    d.wait_event(r"^EVT:KEY 1 1 0$")
    assert hid_reports(d, 1, 2)[:2] == ["0100060000000000", "0000000000000000"]


def test_text_types_each_character(d):
    tap(d, 2)
    time.sleep(0.6)
    reports = hid_reports(d, 1, 6)
    assert [h[4:6] for h in reports if h[4:6] != "00"] == ["0b", "0c", "1e"]
    assert any(h.startswith("02") and h[4:6] == "1e" for h in reports)


def test_host_action_sends_reserved_combo(d):
    tap(d, 4)
    assert hid_reports(d, 1, 1)[0] == "07006d0000000000"


def test_media_key(d):
    tap(d, 6)
    assert hid_reports(d, 2, 2)[:2] == ["e200", "0000"]


def test_hold_runs_hold_actions_not_tap(d):
    d.hold(*cell_xy(5), 900)
    d.wait_event(r"^EVT:KEY 1 5 H$")
    time.sleep(0.3)
    assert [h[4:6] for h in hid_reports(d, 1, 1) if h[4:6] != "00"] == ["05"]


def test_short_press_on_hold_key_runs_tap(d):
    tap(d, 5)
    time.sleep(0.3)
    assert [h[4:6] for h in hid_reports(d, 1, 1) if h[4:6] != "00"] == ["04"]


def test_toggle_key_shows_its_state(d):
    x, y = key_box(8)
    def green():   # the ON tag (green fill) on the key's top-right corner
        tag = d.shot().crop((x + 36, y - 4, x + 74, y + 14))
        return sum(1 for p in tag.get_flattened_data() if p[1] > 170 and p[1] > p[0] + 60)
    assert green() < 20
    tap(d, 8)
    time.sleep(0.5)
    assert green() > 150
    assert hid_reports(d, 1, 1)[0][4:6] == "17"       # T
    tap(d, 8)
    time.sleep(0.5)
    assert green() < 20


def test_empty_cell_does_nothing(d):
    tap(d, 12)
    time.sleep(0.3)
    d._pump()
    assert not d.events


def test_folder_and_back(d):
    tap(d, 3)
    d.wait_event(r"^EVT:PAGE 2$")
    d.ok("page 3")
    tap(d, 1)
    d.wait_event(r"^EVT:PAGE 1$")


def test_swipes_change_page(d):
    d.swipe(400, 160, 100, 160)
    d.wait_event(r"^EVT:PAGE 2$")
    d.swipe(400, 160, 100, 160)
    d.wait_event(r"^EVT:PAGE 3$")
    n = len(d.events)
    d.swipe(400, 160, 100, 160)
    time.sleep(0.3)
    d._pump()
    assert not any("EVT:PAGE" in l for _, l in d.events[n:])
    d.swipe(100, 160, 400, 160)
    d.wait_event(r"^EVT:PAGE 2$", since=n)


def test_station_tap_changes_page(d):
    d.touch(240, G_LINE)   # three stations at 210, 240, 270
    d.wait_event(r"^EVT:PAGE 2$")


# ---------------------------------------------------------------- screen
def test_screen_layout(d):
    img = d.shot()
    assert img.size == (480, 320)
    g = img.getpixel((5, 250))
    assert sum(g) < 90 and g[2] > g[0] + 8, g                   # deep navy ground, lifted off black for the TFT
    x, y = key_box(1)
    glass = img.getpixel((x + 33, y + 12))
    assert glass[0] > glass[1] + 40 and glass[0] > glass[2] + 40     # red-tinted glass key
    x, y = key_box(7)                                              # tile image drawn into the key
    assert close(img.getpixel((x + 10, y + 33)), (255, 0, 0), 40)
    assert close(img.getpixel((x + 56, y + 33)), (0, 255, 0), 40)


def test_media_player_page(d):
    d.ok('widget now_playing {"title":"Paper Moon","album":"Test","artist":"Band","app":"Spotify","pos":10,"len":200,"playing":false}')
    d.ok("page 2")
    time.sleep(0.6)
    img = d.shot()
    play = img.getpixel((274, 248 - 30))                           # upper part of the cyan play key
    assert play[2] > play[0] + 30, play
    d.clear_events()
    d.touch(160 + 152, 156)                                        # middle of the seek bar
    m = d.wait_event(r"^EVT:SEEK (\d+)$")
    assert 90 <= int(m.group(1)) <= 110


def test_album_art_upload_shows_on_the_player(d):
    art = (0xF81F).to_bytes(2, "big") * (128 * 128)                # magenta
    r = d.upload_bin("ram:art", art)
    assert "SAVED ram:art" in r, r
    d.ok("page 2")
    time.sleep(0.6)
    assert close(d.shot().getpixel((80, 108)), (255, 0, 255), 30)


def test_sheet_tabs_and_close(d):
    d.ok("sheet")
    d.wait_event(r"^EVT:UI sheet$")
    time.sleep(0.5)
    shots = []
    for i in range(5):
        d.touch(60, 64 + i * 52)
        time.sleep(0.4)
        shots.append(d.shot().crop((128, 90, 466, 300)).tobytes())
    assert len(set(shots)) == 5                                    # every tab draws its own pane
    d.touch(428, 64)                                               # Done
    d.wait_event(r"^EVT:UI home$")


def test_pairing_screen(d):
    d.ok("ble pair")
    m = d.wait_event(r"^EVT:PASSKEY (\d{6})$")
    d.wait_event(r"^EVT:UI pair$")
    time.sleep(0.5)
    digits = d.shot().crop((120, 150, 360, 192))
    assert sum(1 for p in digits.get_flattened_data() if p[0] > 200 and p[1] > 200 and p[2] > 200) > 400
    d.touch(240, 284)                                              # Cancel
    d.wait_event(r"^EVT:BLE pair closed$")
    assert m.group(1)


def test_volume_panel(d):
    base = d.shot().getpixel((250, 152))
    d.ok('widget volume {"level":50,"muted":false}')
    for _ in range(5):                                   # the panel slides in; a busy frame can lag a shot
        time.sleep(0.3)
        if d.shot().getpixel((250, 152)) != base:
            return
    raise AssertionError(f"no volume panel over {base}")


# ---------------------------------------------------------------- calibration
def test_calibration_fits_any_orientation(d):
    raw = lambda x, y: (int(3900 - y * 11), int(300 + x * 7.4))   # rotated and mirrored panel
    d.ok("calibrate")
    d.wait_event(r"^EVT:CAL start$")
    for x, y in [(36, 36), (444, 36), (444, 284), (36, 284)]:
        d.cmd("traw %d %d 150" % raw(x, y))
        time.sleep(0.1)
    d.cmd("traw %d %d 150" % raw(240, 236))
    m = d.wait_event(r"^EVT:CAL saved (\d+)$")
    assert int(m.group(1)) <= 2
    c = [float(v) for v in d.cmd("touchcal")[0].split()[1:]]
    sx, sy = c[0] * raw(100, 200)[0] + c[1] * raw(100, 200)[1] + c[2], c[3] * raw(100, 200)[0] + c[4] * raw(100, 200)[1] + c[5]
    assert abs(sx - 100) < 2 and abs(sy - 200) < 2
    d.touch(298, 284)                                              # Done on the test pad
    d.wait_event(r"^EVT:CAL done$")


def test_calibration_rejects_inconsistent_taps(d):
    d.ok("calibrate")
    for rx, ry in [(1000, 1000), (1010, 1005), (3000, 3000), (2990, 3010)]:
        d.cmd(f"traw {rx} {ry} 150")
        time.sleep(0.1)
    d.wait_event(r"^EVT:CAL retry fit \d+$")
    d.ok("calibrate cancel")


# ---------------------------------------------------------------- 60 fps
def test_press_animation_frame_rate(d):
    frames, rate, _ = fps(d, lambda: d.touch(*cell_xy(5), 700))
    assert frames > 30 and rate >= FPS_FLOOR, (frames, rate)


def test_page_wave_frame_rate(d):
    d.ok("page 3")
    time.sleep(0.6)
    frames, rate, _ = fps(d, lambda: d.swipe(100, 160, 400, 160))   # back to page 2: grid -> player
    assert rate >= FPS_FLOOR, (frames, rate)
    d.ok("page 1")
    time.sleep(0.6)
    frames, rate, _ = fps(d, lambda: d.ok("page 3"))                 # grid -> grid wave
    assert rate >= FPS_FLOOR, (frames, rate)


def test_sheet_frame_rate(d):
    frames, rate, _ = fps(d, lambda: d.ok("sheet"))
    assert rate >= FPS_FLOOR, (frames, rate)
    d.ok("sheet close")


def test_volume_panel_frame_rate(d):
    frames, rate, _ = fps(d, lambda: d.ok('widget volume {"level":30,"muted":false}'))
    assert rate >= FPS_FLOOR, (frames, rate)


# ---------------------------------------------------------------- LED and feedback
def test_led_patterns(dev):
    r = dev.cmd("led solid 255 0 0")[0]
    time.sleep(0.1)
    assert "led solid" in r and "showing 255 0 0" in dev.cmd("led")[0]
    dev.cmd("led off")
    time.sleep(0.1)
    assert "showing 0 0 0" in dev.cmd("led")[0]
    dev.cmd("led rainbow")
    a = dev.cmd("led")[0]
    time.sleep(1.0)
    b = dev.cmd("led")[0]
    assert "led rainbow" in a and a != b                           # the hue moves


def test_click_and_hostname_commands(dev):
    assert dev.cmd("click off") == ["click off"]
    assert dev.cmd("click on") == ["click on"]
    assert dev.cmd("hostname TEST-PC")[0] in ("hostname set", "ERR no host connected")
    dev.cmd(f"hostname {socket.gethostname()}")                    # the PC's real name back


# ---------------------------------------------------------------- robustness
def test_heap_stable_over_200_taps(d):
    def free():
        return int(d.cmd("heap")[0].split()[1].split(":")[1])
    before = free()
    for _ in range(200):
        tap(d, 6, ms=30)
    time.sleep(0.5)
    assert free() >= before - 2048


def test_profile_and_theme_survive_reboot(dev):
    dev.ok("theme aurora")
    dev.write_line("reboot")
    time.sleep(1.5)
    dev.reopen()
    dev.ready(20)
    dev.cmd("calibrate cancel")
    st = dev.cmd("status")[0]
    assert f"Profile:{SLOT}" in st and "theme:aurora" in st, st
    dev.ok("theme glass")
    dev.ok("setdim 0")
    dev.ok("hid dry on")


# ---------------------------------------------------------------- themes
THEMES = ["glass", "paper", "daylight", "aurora", "synth", "retro"]
# The bottom stop of each theme's ground (themes.h): the corner below the grid shows it.
GROUND_BOTTOM = {"glass": (10, 17, 25), "paper": (229, 214, 182), "daylight": (233, 240, 248),
                 "aurora": (12, 91, 98), "synth": (207, 204, 196), "retro": (147, 180, 14)}


def luma(px):
    return (px[0] * 77 + px[1] * 150 + px[2] * 29) >> 8


def test_theme_command_lists_switches_and_reports(d):
    assert d.cmd("theme") == ["theme glass"]
    assert d.cmd("theme nope") == ["theme " + " ".join(THEMES)]
    since = len(d.events)
    assert d.cmd("theme Aurora") == ["theme aurora"]     # titles work too
    d.wait_event(r"^EVT:THEME aurora$", 3, since)
    assert "theme:aurora" in d.cmd("status")[0]
    assert d.cmd("theme 5") == ["theme synth"]          # and 1-based numbers


def test_theme_default_is_daylight(d):
    since = len(d.events)
    assert d.cmd("theme default") == ["theme daylight"]   # forgets the saved choice
    d.wait_event(r"^EVT:THEME daylight$", 3, since)
    assert "theme:daylight" in d.cmd("status")[0]


@pytest.mark.parametrize("name", THEMES)
def test_each_theme_paints_its_ground_and_keys(d, name):
    d.ok(f"theme {name}")
    time.sleep(0.6)                                      # the wipe takes 320 ms
    img = d.shot()
    g = img.getpixel((6, 316))
    assert close(g, GROUND_BOTTOM[name], 16), (name, g)
    kx, ky = key_box(2)
    face = img.getpixel((kx + 7, ky + 40))               # inside the key, clear of the glyph
    lum = luma(face)
    if name == "daylight":
        assert lum > 225, face                           # a white tile
    elif name == "synth":
        assert 215 < lum < 245 and max(face) - min(face) < 16, face   # matte warm grey
    elif name == "retro":
        assert close(face, (139, 172, 15), 8), face     # the second-lightest DMG green, exact
    elif name == "paper":
        assert face != g and 90 < lum < 235 and face[0] > face[2], face   # a card in the key's warm tint
    elif name == "aurora":
        assert lum > luma(img.getpixel((kx - 6, ky + 40))) + 18, face     # a pane lighter than the sky
    else:
        assert face[0] > face[2] + 30, face             # glass lit in the key's red tint


@pytest.mark.parametrize("name", THEMES)
def test_each_theme_animates_at_60fps(d, name):
    d.ok(f"theme {name}")
    time.sleep(0.6)
    frames, rate, _ = fps(d, lambda: d.ok("page 3"))     # grid -> grid wave
    assert frames >= 12 and rate >= FPS_FLOOR, (name, frames, rate)
    d.ok("page 1")
    time.sleep(0.6)
    frames, rate, _ = fps(d, lambda: d.touch(*cell_xy(2), 700))
    assert frames >= 20 and rate >= FPS_FLOOR, (name, frames, rate)


def test_theme_wipe_runs_at_60fps(d):
    frames, rate, _ = fps(d, lambda: d.ok("theme daylight"), wait=0.6)
    assert frames >= 14 and rate >= FPS_FLOOR, (frames, rate)


def test_sheet_theme_chip_switches_the_theme(d):
    d.ok("sheet")
    d.wait_event(r"^EVT:UI sheet$")
    time.sleep(0.5)
    d.touch(60, 64)                                      # Display tab
    time.sleep(0.3)
    w = (338 - 5 * 6) / 6
    since = len(d.events)
    d.touch(int(128 + 4 * (w + 6) + w / 2), 272)          # the Synth chip
    d.wait_event(r"^EVT:THEME synth$", 3, since)
    time.sleep(0.6)
    img = d.shot()
    assert "theme:synth" in d.cmd("status")[0]
    assert luma(img.getpixel((300, 40))) > 200            # the sheet is now the light grey ply
    d.ok("sheet close")


# ---------------------------------------------------------------- power
def test_power_readout_and_battery_policy(d):
    p = d.cmd("power")[0]
    assert re.match(r"power usb:1 mv:\d+ pct:-?\d+ charging:[01] sleep:\d+ sim:-1 .*cpu:240 screen:lit$", p), p
    try:
        d.ok("setdim 2")                                   # on battery the dim time is min(setdim, 20 s)
        d.ok("power sim battery")
        assert re.search(r"pwr:bat bat:\d+$", d.cmd("status")[0])
        time.sleep(3)
        assert d.cmd("theme") == ["theme glass"]           # a readout leaves the screen dark
        assert "screen:dim" in d.cmd("power")[0]
        d.ok("theme glass")                                # an edit from Studio lights it
        assert "screen:lit" in d.cmd("power")[0]
    finally:
        d.cmd("power sim off")
        d.ok("setdim 0")
    assert "pwr:usb" in d.cmd("status")[0]


def test_power_sleep_minutes(d):
    old = re.search(r"sleep:(\d+)", d.cmd("power")[0]).group(1)
    assert " sleep:7 " in d.cmd("power sleep 7")[0]
    assert " sleep:0 " in d.cmd("power sleep 0")[0]        # never
    assert " sleep:120 " in d.cmd("power sleep 500")[0]    # clamped
    d.cmd(f"power sleep {old}")


# ---------------------------------------------------------------- quick switch and autogenerate
TOAST_PX = (240, 56)                                     # inside the toast pill, over key 3


def test_profile_chip_opens_profiles_and_a_card_switches(d):
    since = len(d.events)
    d.touch(30, 14)                                      # the profile chip (and the clock beside it)
    d.wait_event(r"^EVT:UI sheet$", 3, since)
    time.sleep(0.5)
    since = len(d.events)
    d.touch(128 + 40, 96 + 23)                           # card 1 of the 4 x 4 grid
    d.wait_event(r"^EVT:PROFILE 1$", 3, since)
    d.ok("sheet close")
    time.sleep(0.4)
    d.ok(f"setprofile {SLOT}")


def test_sixteen_profile_slots(d):
    assert d.cmd("setprofile 17") == ["invalid"]
    assert f"profile {SLOT} " in d.cmd(f"setprofile {SLOT}")[0]


def test_generate_asks_studio_and_holds_progress_until_done(d):
    time.sleep(2.4)                                      # any earlier toast has gone
    base = d.shot().getpixel(TOAST_PX)
    d.ok("sheet profiles")
    d.wait_event(r"^EVT:UI sheet$")
    time.sleep(0.5)
    since = len(d.events)
    d.touch(248 + 66, 64)                                # Generate, left of Done
    d.wait_event(r"^EVT:AUTOGEN$", 3, since)
    assert d.cmd("autogen busy Asking Claude for Test...") == ["autogen busy"]
    time.sleep(3.0)                                      # a plain toast is gone by 2.1 s; this one holds
    assert d.shot().getpixel(TOAST_PX) != base
    assert d.cmd("autogen done Test ready: profile 16") == ["autogen done"]
    time.sleep(2.6)
    assert d.shot().getpixel(TOAST_PX) == base


def test_generate_without_studio_says_so(d):
    time.sleep(2.4)
    base = d.shot().getpixel(TOAST_PX)
    d.ok("sheet profiles")
    d.wait_event(r"^EVT:UI sheet$")
    time.sleep(0.5)
    d.touch(248 + 66, 64)
    time.sleep(3.0)
    assert d.shot().getpixel(TOAST_PX) != base           # "Asking Studio..." waits for an answer
    time.sleep(4.0)                                      # 4 s without one: "Open Macropad Studio", then it fades
    assert d.shot().getpixel(TOAST_PX) == base
    assert d.cmd("autogen nope") == ["autogen busy|done|fail <text>"]


def test_folder_key_is_drawn_as_a_stack(d):
    img = d.shot()
    fx, fy = key_box(3)                                  # "Folder": its only action opens page 2
    nx, ny = key_box(1)                                  # "Copy": a plain key
    card = img.getpixel((fx + 69, fy + 30))              # just right of the key: the next card of the stack
    ground = img.getpixel((nx + 69, ny + 30))            # the same spot beside a plain key: the ground
    assert sum(abs(a - b) for a, b in zip(card, ground)) > 30, (card, ground)


def solid_tile(rgb565):
    return rgb565.to_bytes(2, "big") * (TILE_W * TILE_W)


def test_gif_key_plays_its_frames(dev):
    """A key with frames (a GIF from Studio) cycles its tiles on the keypad's clock."""
    red, blue = solid_tile(0xF800), solid_tile(0x001F)
    names = [f"{zlib.crc32(t):08x}" for t in (red, blue)]
    for n, t in zip(names, (red, blue)):
        assert any(l.startswith("SAVED") for l in dev.upload_bin(f"/t/{n}.565", t))
    keys = [None] * 15
    keys[0] = key(1, "GIF", [{"type": "key", "value": "F13"}], frames=names, frame_ms=250)
    prof = {"schema_version": 2, "profile_name": "GIF", "color": [79, 140, 255], "default_delay": 5, "pages": [{"name": "One", "keys": keys}]}
    assert any(l.startswith("SAVED") for l in dev.upload_text("profile15.json", json.dumps(prof, indent=1)))
    try:
        dev.ok("setprofile 15")
        time.sleep(0.8)
        x, y = key_box(1)
        seen = set()
        for _ in range(8):                               # 2 frames x 250 ms: both show within a second or two
            r, g, b = dev.shot().getpixel((x + 33, y + 33))
            seen.add("red" if r > 150 and b < 100 else "blue" if b > 150 and r < 100 else "other")
            time.sleep(0.2)
        assert {"red", "blue"} <= seen, seen
    finally:
        dev.ok(f"setprofile {SLOT}")
        dev.cmd("rm /profile15.json")
        for n in names:
            dev.cmd(f"rm /t/{n}.565")


def test_living_icons_move_and_hold_the_frame_rate(d):
    """Every key's icon moves (spin, swing, bounce, pulse, float) while idle; off, the screen is still."""
    try:
        assert d.cmd("iconanim on") == ["iconanim on"]
        time.sleep(0.5)
        frames, rate, worst = fps(d, lambda: None, wait=1.5)
        assert frames >= 20 and worst <= 20, (frames, rate, worst)          # idle, the icons keep moving; each redraw fits a frame
        frames, rate, _ = fps(d, lambda: d.touch(*cell_xy(2), 700))
        assert rate >= FPS_FLOOR, rate                                      # and a press still runs at full speed
    finally:
        assert d.cmd("iconanim off") == ["iconanim off"]
    time.sleep(0.3)
    frames, _, _ = fps(d, lambda: None, wait=1.0)
    assert frames <= 2, frames                                              # off: nothing to redraw

