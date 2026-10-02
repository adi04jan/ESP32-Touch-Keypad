"""Hardware tests for the Touch Keypad firmware over USB serial (KP_TEST build).

    python -m pytest tools/tests -v          # board on the first CH340, or KP_PORT=COMx

HID runs dry (reports logged as EVT:HID, nothing reaches a host). The tests use
profile slot 8 and switch back to profile 1 at the end.
"""
import json
import sys
import time
import zlib
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import kp  # noqa: E402

SLOT = 8
TILE_W = 72


def cell_xy(cell):
    """Centre of 1-based cell (5x3 grid under the 30 px status strip)."""
    i = cell - 1
    return (i % 5) * 96 + 48, 30 + (i // 5) * 90 + 40


def key(i, name, actions, **kw):
    return {"id": i, "name": name, "led_color": [194, 65, 43], "actions": actions, **kw}


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
    p1[0] = key(1, "Copy", [{"type": "keycombo", "keys": ["LEFT_CTRL", "C"]}])
    p1[1] = key(2, "Type", [{"type": "text", "value": "hi!"}])
    p1[2] = key(3, "Folder", [{"type": "page", "value": 2}])
    p1[3] = key(4, "Host", [{"type": "host", "cmd": "open notepad", "slot": 5}])
    p1[4] = key(5, "Hold", [{"type": "key", "value": "A"}], hold_actions=[{"type": "key", "value": "B"}])
    p1[5] = key(6, "Mute", [{"type": "media", "value": "MUTE"}])
    p1[6] = key(7, "Tile", [{"type": "key", "value": "F13"}], tile=TILE_CRC)
    p2 = [None] * 15
    p2[0] = key(1, "Back", [{"type": "back"}])
    p2[2] = {"id": 3, "name": "Now Playing", "widget": "now_playing", "span": [3, 2],
             "actions": [{"type": "media", "value": "PLAY_PAUSE"}]}
    p3 = [None] * 15
    p3[14] = key(15, "Last", [{"type": "key", "value": "Z"}])
    return {"schema_version": 2, "profile_name": "Test", "default_delay": 5,
            "pages": [{"name": "One", "keys": p1}, {"name": "Two", "keys": p2}, {"name": "Three", "keys": p3}]}


PROFILE = make_profile()


@pytest.fixture(scope="session")
def dev():
    d = kp.Device()
    d.ready()
    d.ok("setdim 0")
    d.ok("hid dry on")
    r = d.upload_bin(f"/t/{TILE_CRC}.565", TILE)
    assert any(l.startswith("SAVED") for l in r), r
    r = d.upload_text(f"profile{SLOT}.json", json.dumps(PROFILE))
    assert any(l.startswith("SAVED") for l in r), r
    d.ok(f"setprofile {SLOT}")
    yield d
    d.cmd("setprofile 1")
    d.cmd("setdim 120")
    d.close()


@pytest.fixture
def d(dev):
    """Each test starts on page 1 with no sheet or overlay and a clean event list."""
    if dev.cmd("status")[0].find("page:1 ") < 0:
        dev.ok("page 1")
    dev.cmd("ble cancel")
    time.sleep(0.3)
    dev.listen(0.2)
    dev.clear_events()
    return dev


def tap(d, cell, ms=80):
    d.touch(*cell_xy(cell), ms)


def hid_reports(d, rid, n, timeout=3):
    """Wait for n EVT:HID reports of report id `rid`; return their hex payloads."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        got = [l.split()[2] for _, l in d.events if l.startswith(f"EVT:HID {rid} ")]
        if len(got) >= n:
            return got
        d._pump()
    raise AssertionError(f"wanted {n} HID {rid} reports, saw {[l for _, l in d.events]}")


def close(px, rgb, tol=12):
    return all(abs(a - b) <= tol for a, b in zip(px, rgb))


# ---------------------------------------------------------------- protocol
def test_status_identifies_touch_keypad(dev):
    st = dev.cmd("status")[0]
    assert "model:touch" in st and "ver:3." in st and f"Profile:{SLOT}" in st and "pages:3" in st


def test_profile_round_trip(dev):
    r = dev.cmd(f"cat /profile{SLOT}.json")
    assert json.loads("\n".join(r)) == PROFILE


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
    lines = dev.wait_prompt(8)
    assert any("timed out" in l for l in lines), lines


def test_ram_preview_commands(d):
    assert d.cmd('setkey 15 [{"type":"key","value":"Y"}]') == ["Key 15 updated in RAM"]
    assert d.cmd("title 15 Preview") == ["title 15"]
    assert d.cmd(f"setface 15 {TILE_CRC} 1 2 3") == ["face 15 ok"]
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
    assert [h[4:6] for h in reports if h[4:6] != "00"] == ["0b", "0c", "1e"]   # h i !
    assert any(h.startswith("02") and h[4:6] == "1e" for h in reports)        # ! is shift+1


def test_host_action_sends_reserved_combo(d):
    tap(d, 4)
    assert hid_reports(d, 1, 1)[0] == "07006d0000000000"   # Ctrl+Alt+Shift+F18 = slot 5


def test_media_key(d):
    tap(d, 6)
    assert hid_reports(d, 2, 2)[:2] == ["e200", "0000"]


def test_hold_runs_hold_actions_not_tap(d):
    d.hold(*cell_xy(5), 900)
    d.wait_event(r"^EVT:KEY 1 5 H$")
    time.sleep(0.3)
    assert [h[4:6] for h in hid_reports(d, 1, 1) if h[4:6] != "00"] == ["05"]   # B only, no A


def test_short_press_on_hold_key_runs_tap(d):
    tap(d, 5)
    time.sleep(0.3)
    assert [h[4:6] for h in hid_reports(d, 1, 1) if h[4:6] != "00"] == ["04"]


def test_empty_cell_does_nothing(d):
    tap(d, 12)
    time.sleep(0.3)
    d._pump()
    assert not d.events


def test_folder_and_back(d):
    tap(d, 3)
    d.wait_event(r"^EVT:PAGE 2$")
    tap(d, 1)
    d.wait_event(r"^EVT:PAGE 1$")


def test_swipes_change_page(d):
    d.swipe(400, 160, 100, 160)
    d.wait_event(r"^EVT:PAGE 2$")
    d.swipe(400, 160, 100, 160)
    d.wait_event(r"^EVT:PAGE 3$")
    n = len(d.events)
    d.swipe(400, 160, 100, 160)   # last page: stays
    time.sleep(0.3)
    d._pump()
    assert not any("EVT:PAGE" in l for _, l in d.events[n:])
    d.swipe(100, 160, 400, 160)
    d.wait_event(r"^EVT:PAGE 2$", since=n)


def test_page_dot_tap(d):
    d.touch(250, 310)   # dots: [pill 1][dot 2][dot 3] centred; dot 2 sits right of centre
    d.wait_event(r"^EVT:PAGE 2$")


# ---------------------------------------------------------------- screen
def test_screen_layout(d):
    time.sleep(0.5)
    img = d.shot()
    assert img.size == (480, 320)
    assert close(img.getpixel((240, 4)), (244, 244, 239))       # paper status strip
    assert close(img.getpixel((5, 250)), (36, 52, 92))          # night ground
    x, y = 96 + 12, 120 + 2                                      # cell 7 tile origin
    assert close(img.getpixel((x + 10, y + 30)), (255, 0, 0))   # tile file, left half
    assert close(img.getpixel((x + 60, y + 30)), (0, 255, 0))   # right half


def test_widget_and_sheet_render(d):
    d.ok("page 2")
    d.ok('widget now_playing {"title":"Paper Moon","artist":"Band","app":"Spotify","pos":10,"len":200,"playing":false}')
    time.sleep(0.8)
    img = d.shot()
    assert close(img.getpixel((2 * 96 + 140, 30 + 30)), (47, 107, 115))   # teal card
    d.swipe(240, 280, 240, 100)
    time.sleep(0.6)
    assert close(d.shot().getpixel((240, 290)), (244, 244, 239))   # settings sheet paper
    d.touch(420, 58)                                                # Close
    time.sleep(0.8)
    assert close(d.shot().getpixel((240, 290)), (36, 52, 92))


def test_pairing_ticket(d):
    d.ok("ble pair")
    m = d.wait_event(r"^EVT:PASSKEY (\d{6})$")
    time.sleep(0.6)
    assert close(d.shot().getpixel((110, 70)), (226, 176, 74))   # gold ticket
    d.touch(20, 300)                                              # outside the ticket cancels
    d.wait_event(r"^EVT:BLE pair closed$")
    assert m.group(1)


# ---------------------------------------------------------------- robustness
def test_heap_stable_over_200_taps(d):
    def free():
        return int(d.cmd("heap")[0].split()[1].split(":")[1])
    before = free()
    for _ in range(200):
        tap(d, 6, ms=30)
    time.sleep(0.5)
    after = free()
    assert after >= before - 2048, (before, after)


def test_profile_survives_reboot(dev):
    dev.write_line("reboot")
    time.sleep(1.5)
    dev.reopen()
    dev.ready(20)
    assert f"Profile:{SLOT}" in dev.cmd("status")[0]
    dev.ok("setdim 0")
    dev.ok("hid dry on")
