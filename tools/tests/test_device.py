"""Hardware tests for the Touch Keypad firmware (3.3) over USB serial.

    python -m pytest tools/tests -v          # board on the first CH340, or KP_PORT=COMx

HID runs dry (reports logged as EVT:HID, nothing reaches a host). The tests use
profile slot 16 and put the active profile, the touch calibration, the theme
and the HID dry-run state back exactly as they found them, so the suite can
run on a keypad that is in use.
"""
import json
import os
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
THEMES = ["glass", "paper", "daylight", "aurora", "synth", "retro", "nordic_calm", "focus_slate", "forest_field", "ember_atelier"]
FPS_FLOOR = 50                    # every animation, measured by the firmware's `perf`
SLIDE_FLOOR = 25                  # a page slide (redrawn in software every frame); the goal is 30
RISE_FLOOR = 22                   # Media or Settings rising: ~24-27 fps, the owner kept the look over a faster rise (2026-11-05)


def cell_xy(cell):
    """Centre of 1-based cell (5x3 grid of 84x90 under the 30 px status band, left of the 60 px quick bar)."""
    i = cell - 1
    return (i % 5) * 84 + 42, 30 + (i // 5) * 90 + 40


def key_box(cell):
    """Top-left of the 66 px glass key inside a cell."""
    i = cell - 1
    return (i % 5) * 84 + 9, 30 + (i // 5) * 90 + 4


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
    p3[1] = key(2, "Prof", [{"type": "profile", "value": SLOT}], icon="layers")
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
    qb0 = d.cmd("quickbar")[0]                # the owner's quick bar, put back at the end
    old = None if not old or old[0].startswith("ERR") else "\n".join(old)
    owned0 = owner_profiles(d)                # slots 1-15: checked untouched at the end
    ianim = d.cmd("iconanim")[0]              # pixel tests want still icons; put the owner's choice back after
    dim = d.cmd("setdim")[0].split()[-1]
    click = d.cmd("click")[0].split()[-1]
    motion = re.search(r"page k:(\S+) z:(\S+) sheet k:(\S+) z:(\S+)", d.cmd("motion")[0])
    sleep = re.search(r" sleep:(\d+)", next(l for l in d.cmd("power") if l.startswith("power")))
    m = re.match(r"cal:(\d) (.*)", cal)
    put_back = [                              # each runs whatever the others did: one failure can't strand the rest
        lambda: d.cmd("calibrate cancel"),
        lambda: d.cmd(f"touchcal set {m.group(2)}" if m and m.group(1) == "1" else "touchcal clear"),
        lambda: d.cmd(f"led {led.group(1)} {led.group(2)}" if led else "led rainbow"),
        lambda: led and d.cmd(f"ledbright {led.group(3)}"),
        lambda: d.cmd(f"theme {theme.group(1) if theme else 'daylight'}"),
        lambda: d.cmd(f"setprofile {profile.group(1) if profile else 1}"),
        lambda: d.upload_text(f"profile{SLOT}.json", old) if old else d.cmd(f"rm /profile{SLOT}.json"),
        lambda: d.cmd(f"hid dry {'on' if dry and dry.group(1) == '1' else 'off'}"),
        lambda: d.cmd("power sim off"),
        lambda: sleep and d.cmd(f"power sleep {sleep.group(1)}"),
        lambda: d.cmd(f"setdim {dim}"),
        lambda: d.cmd(f"click {click}"),
        lambda: motion and d.cmd("motion page {} {}".format(*motion.group(1, 2))),
        lambda: motion and d.cmd("motion sheet {} {}".format(*motion.group(3, 4))),
        lambda: d.cmd("iconanim on" if ianim.endswith("on") else "iconanim off"),
        lambda: qb0.startswith("quickbar ") and d.cmd("quickbar set " + qb0.split(" ", 1)[1]),
    ]
    failed = []
    try:
        d.ok("setdim 0")
        d.ok("hid dry on")
        d.ok("iconanim off")
        r = d.upload_bin(f"/t/{TILE_CRC}.565", TILE)
        assert any(l.startswith("SAVED") for l in r), r
        r = d.upload_text(f"profile{SLOT}.json", json.dumps(PROFILE))
        assert any(l.startswith("SAVED") for l in r), r
        d.ok(f"setprofile {SLOT}")
        yield d
    finally:
        for step in put_back:
            try:
                step()
            except Exception as e:   # noqa: BLE001 - reported below, after every other step ran
                failed.append(repr(e))
        owned = owner_profiles(d)
        d.close()
    assert not failed, f"putting the owner's keypad back: {failed}"
    assert owned == owned0, f"a test changed the owner's profiles: {owned0} -> {owned}"


def owner_profiles(d):
    """Slots 1-15 belong to the keypad's owner: name -> size from `ls`.
    ponytail: sizes, not contents; a same-size overwrite slips by (add a crc command if one ever does)."""
    return {n: s for n, s in (l.split("\t") for l in d.cmd("ls") if "\t" in l)
            if re.fullmatch(r"profile([1-9]|1[0-5])\.json", n)}


@pytest.fixture
def d(dev):
    """Each test starts on page 1 of the test profile, home screen, clean events."""
    st = dev.cmd("status")[0]
    if " dry:0 " in st:                           # a reboot test on release firmware: keys would reach the PC
        dev.ok("hid dry on")
    if f"Profile:{SLOT} " not in st:
        dev.ok(f"setprofile {SLOT}")
    if "ui:home" not in st:
        dev.cmd("ble cancel")
        dev.cmd("calibrate cancel")
        dev.cmd("sheet close")
        dev.cmd("shade close")
    if " sug:" in st and " sug:0 " not in st:     # a suggestion left in the bar
        dev.cmd("suggest 0")
    if "panel:" in st and " panel:0" not in st:   # a quick-bar panel left open
        dev.cmd("panel 0")
    if "theme:glass" not in st:   # pixel checks below are written against Glass
        dev.cmd("theme glass")
        time.sleep(0.4)
    if "page:1 " not in dev.cmd("status")[0]:
        dev.ok("page 1")
    time.sleep(0.5)
    for _ in range(20):                           # a page change slides (about 0.6 s): let it land
        st = dev.cmd("status")[0]
        if " slide:" not in st or " slide:0 " in st:
            break
        time.sleep(0.05)
    dev.listen(0.2)
    dev.clear_events()
    return dev


def put_back_profile(d):
    """PROFILE in slot 16 again, with its tile: a profile that does not use the tile lets the keypad delete
    the file (unreferenced tiles are collected on upload), and the Tile key would then try to open a missing
    file on every redraw."""
    d.upload_bin(f"/t/{TILE_CRC}.565", TILE)
    d.upload_text(f"profile{SLOT}.json", json.dumps(PROFILE))


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
    d.touch(210, G_LINE)   # three stations at 180, 210, 240 (centred on the 420 px key area)
    d.wait_event(r"^EVT:PAGE 2$")


def test_bar_column_presses_no_key(d):
    since = len(d.events)
    d.touch(450, 75)                       # the bar, beside key 5 (its free top slot: Media)
    time.sleep(0.3)
    assert not [l for _, l in d.events[since:] if l.startswith("EVT:KEY")]
    d.ok("panel 0"); time.sleep(0.6)
    tap(d, 5)                              # key 5 still answers at its new place
    d.wait_event(r"^EVT:KEY 1 5 1$", 2, since)


def test_player_controls_fit_left_of_the_bar(d):
    d.ok("page 2")                         # the test profile's player page
    time.sleep(0.5)
    d.touch(382, 248)                      # volume up, the rightmost control
    assert any(r.startswith("e9") for r in hid_reports(d, 2, 1))   # consumer usage 0x00E9, little-endian
    d.ok("page 1")


# ---------------------------------------------------------------- quick bar
QB_TEST = [{"profile": SLOT, "page": 1, "icon": "music", "label": "Media"},          # entry 1: the swipe-up page
           {"profile": SLOT, "page": 1, "icon": "folder-open", "label": "Panel"},    # entries 2-4: the bar's rows 0-2
           {"profile": SLOT, "page": 3, "icon": "git-branch", "label": "Git"}, None]
QB_FULL = QB_TEST[:3] + [{"profile": SLOT, "page": 1, "icon": "square-terminal", "label": "Cmds"}]


def set_qb(d, qb=QB_TEST):
    d.ok("quickbar set " + json.dumps(qb, separators=(",", ":")))


def test_quickbar_round_trips(d):
    set_qb(d)
    assert json.loads(d.cmd("quickbar")[0].split(" ", 1)[1]) == QB_TEST


def test_quickbar_rejects_bad_config(d):
    for bad in ['[1,2]', '[{"profile":0,"page":1,"icon":"x","label":"x"},null,null,null]',
                '[{"profile":1,"page":17,"icon":"x","label":"x"},null,null,null]', 'nope']:
        assert d.cmd("quickbar set " + bad)[0].startswith("ERR quickbar:"), bad


def test_bar_draws_a_set_button_and_leaves_an_empty_one_blank(d):
    set_qb(d)
    time.sleep(0.3)
    img = d.shot()
    assert any(img.getpixel((450, y)) != img.getpixel((432, y)) for y in range(96, 140))   # row 0 (entry 2): icon and label
    assert all(img.getpixel((450, y)) == img.getpixel((432, y)) for y in range(210, 255))  # row 2 (entry 4): blank


BAR = {2: (450, 118), 3: (450, 175), 4: (450, 232), "settings": (450, 289)}   # rows 0-3 under the suggestion slot


def swipe_up(d, ms=250): d.swipe(210, 270, 210, 90, ms)
def swipe_down(d, ms=250): d.swipe(210, 90, 210, 270, ms)


def evts(d, since, pre):
    return [l for _, l in d.events[since:] if l.startswith(pre)]


def test_bar_rows_are_entries_2_to_4_then_settings(d):
    set_qb(d, QB_FULL); since = len(d.events)
    for n, page in ((2, 1), (3, 3), (4, 1)):
        d.touch(*BAR[n]); d.wait_event(rf"^EVT:PANEL {n} {SLOT} {page}$", 2, since)
    d.ok("panel 0"); time.sleep(0.4)
    d.touch(*BAR["settings"]); d.wait_event(r"^EVT:UI sheet$", 2, since)


def test_swipe_up_opens_entry_1_and_swipe_down_closes_it(d):
    set_qb(d); since = len(d.events)
    swipe_up(d); d.wait_event(rf"^EVT:PANEL 1 {SLOT} 1$", 2, since)
    assert not evts(d, since, "EVT:UI sheet")
    swipe_down(d); d.wait_event(r"^EVT:PANEL 0$", 2, since)
    assert not evts(d, since, "EVT:UI shade")


def test_swipe_up_with_no_entry_1_does_nothing(d):
    set_qb(d, [None] + QB_TEST[1:]); since = len(d.events)
    swipe_up(d); time.sleep(0.6)
    assert not evts(d, since, "EVT:PANEL") and not evts(d, since, "EVT:UI")


def test_swipe_up_with_media_open_does_nothing(d):
    set_qb(d); swipe_up(d); time.sleep(0.6); since = len(d.events)
    swipe_up(d); time.sleep(0.6)
    assert not evts(d, since, "EVT:") and "panel:1" in d.cmd("status")[0]


def test_status_band_has_no_settings_button(d):
    since = len(d.events)
    d.touch(466, 14); time.sleep(0.5)                      # where the gear was
    assert not evts(d, since, "EVT:UI")


def test_media_opens_over_a_panel_and_closing_returns_to_it(d):
    set_qb(d); d.touch(*BAR[3]); d.wait_event(rf"^EVT:PANEL 3 {SLOT} 3$", 2)
    since = len(d.events)
    swipe_up(d); d.wait_event(rf"^EVT:PANEL 1 {SLOT} 1$", 2, since)
    assert "panel:1" in d.cmd("status")[0]
    swipe_down(d); d.wait_event(rf"^EVT:PANEL 3 {SLOT} 3$", 2, since)
    assert "panel:3" in d.cmd("status")[0]


def test_bar_tap_with_media_open_swaps_to_that_panel(d):
    set_qb(d); swipe_up(d); time.sleep(0.6); since = len(d.events)
    d.touch(*BAR[3]); d.wait_event(rf"^EVT:PANEL 3 {SLOT} 3$", 2, since)
    swipe_down(d); d.wait_event(r"^EVT:PANEL 0$", 2, since)           # a swipe down closes the panel
    time.sleep(0.6); assert "panel:0" in d.cmd("status")[0]           # and Media was closed, not hidden under it


def test_settings_from_media_comes_back_to_media(d):
    set_qb(d); swipe_up(d); time.sleep(0.6); since = len(d.events)
    d.touch(*BAR["settings"]); d.wait_event(r"^EVT:UI sheet$", 2, since)
    d.ok("sheet close"); d.wait_event(r"^EVT:UI home$", 2, since)
    assert "panel:1" in d.cmd("status")[0]


def test_media_keys_report_as_panel_keys(d):
    set_qb(d); swipe_up(d); time.sleep(0.6); since = len(d.events)
    tap(d, 1); d.wait_event(rf"^EVT:PKEY {SLOT} 1 1 1$", 2, since)


def test_bar_tap_opens_and_closes_a_panel(d):
    set_qb(d); since = len(d.events)
    d.touch(*BAR[3])
    d.wait_event(rf"^EVT:PANEL 3 {SLOT} 3$", 2, since)
    st = d.cmd("status")[0]
    assert f"Profile:{SLOT} " in st and "page:1 " in st and "panel:3" in st
    d.touch(*BAR[3]); d.wait_event(r"^EVT:PANEL 0$", 2, since)


def test_panel_key_fires_from_the_panel_profile(d):
    set_qb(d); d.touch(*BAR[3]); time.sleep(0.4); since = len(d.events)
    tap(d, 15)                                             # "Last" on page 3 types Z
    d.wait_event(rf"^EVT:PKEY {SLOT} 3 15 1$", 2, since)
    assert not evts(d, since, "EVT:KEY")
    hid_reports(d, 1, 1)
    assert "page:1 " in d.cmd("status")[0]


def test_panel_folder_back_and_swipe_stay_in_the_panel(d):
    set_qb(d); d.touch(*BAR[2]); time.sleep(0.4); since = len(d.events)
    tap(d, 3)                                              # Folder -> page 2 of the panel (the player)
    d.wait_event(rf"^EVT:PANEL 2 {SLOT} 2$", 2, since)
    d.swipe(100, 160, 400, 160)                            # back to the panel's page 1
    d.wait_event(rf"^EVT:PANEL 2 {SLOT} 1$", 2, since)
    assert "page:1 " in d.cmd("status")[0]


def test_back_on_the_panels_first_page_closes_it(d):
    set_qb(d); d.touch(*BAR[3]); time.sleep(0.4); since = len(d.events)
    tap(d, 1)                                              # Back, on the page the button opens
    d.wait_event(r"^EVT:PANEL 0$", 2, since)


def test_profile_key_in_a_panel_closes_it(d):
    set_qb(d); d.touch(*BAR[3]); time.sleep(0.4); since = len(d.events)
    tap(d, 2)
    d.wait_event(r"^EVT:PANEL 0$", 2, since); d.wait_event(rf"^EVT:PROFILE {SLOT}$", 2, since)


def test_host_setprofile_keeps_the_panel(d):
    set_qb(d); d.touch(*BAR[3]); time.sleep(0.4)
    d.ok(f"setprofile {SLOT}")
    assert "panel:3" in d.cmd("status")[0]


def test_upload_of_active_profile_keeps_the_panel(d):            # Review Focus 1
    set_qb(d); d.ok("page 3"); d.touch(*BAR[2]); time.sleep(0.4)
    d.upload_text(f"profile{SLOT}.json", json.dumps(PROFILE))
    st = d.cmd("status")[0]
    assert "panel:2" in st and "page:3 " in st


def test_saving_the_panels_profile_reloads_the_panel(d):
    set_qb(d); d.touch(*BAR[3]); time.sleep(0.4)
    p = json.loads(json.dumps(PROFILE)); p["pages"][2]["keys"][14]["actions"] = [{"type": "key", "value": "Y"}]
    d.upload_text(f"profile{SLOT}.json", json.dumps(p)); time.sleep(0.4); since = len(d.events)
    tap(d, 15)
    d.wait_event(rf"^EVT:PKEY {SLOT} 3 15 1$", 2, since)
    assert hid_reports(d, 1, 1)[0][4:6] == "1c"                   # Y (0x1C), not the old Z (0x1D)
    d.upload_text(f"profile{SLOT}.json", json.dumps(PROFILE))


def test_button_to_a_missing_page_does_nothing(d):               # Review Focus 2
    set_qb(d, [None, {"profile": SLOT, "page": 9, "icon": "music", "label": "Gone"}, None, None]); since = len(d.events)
    d.touch(*BAR[2]); time.sleep(0.4)
    assert not evts(d, since, "EVT:PANEL")


def test_theme_change_keeps_the_panel(d):                        # Review Focus 3
    set_qb(d); d.touch(*BAR[3]); time.sleep(0.4)
    d.ok("theme daylight"); time.sleep(0.5)
    assert "panel:3" in d.cmd("status")[0]


def test_back_after_a_swipe_in_a_panel_returns_to_its_first_page(d):
    set_qb(d); d.touch(*BAR[2]); time.sleep(0.4); since = len(d.events)
    d.swipe(400, 160, 100, 160); d.wait_event(rf"^EVT:PANEL 2 {SLOT} 2$", 2, since)
    d.swipe(400, 160, 100, 160); d.wait_event(rf"^EVT:PANEL 2 {SLOT} 3$", 2, since)
    time.sleep(0.4); mark = len(d.events)
    tap(d, 1)                                              # Back, on a page reached by swiping
    d.wait_event(rf"^EVT:PANEL 2 {SLOT} 1$", 2, mark)      # the page the button opens, not closed
    assert "EVT:PANEL 0" not in evts(d, mark, "EVT:PANEL")


def test_tapping_an_empty_button_leaves_the_panel_open(d):
    set_qb(d); d.touch(*BAR[3]); time.sleep(0.4); since = len(d.events)
    d.touch(*BAR[4])                                       # entry 4: empty in QB_TEST
    time.sleep(0.4)
    assert not evts(d, since, "EVT:PANEL") and "panel:3" in d.cmd("status")[0]


def test_panel_costs_little_heap_and_keeps_50_fps(d):
    free = lambda: int(re.search(r"free:(\d+)", d.cmd("heap")[0]).group(1))
    set_qb(d); before = free()
    d.touch(*BAR[3]); time.sleep(0.4)
    assert before - free() < 12000
    frames, rate, _ = fps(d, lambda: tap(d, 15, 700))
    assert rate >= FPS_FLOOR
    d.cmd("panel 0"); time.sleep(0.4)
    assert abs(free() - before) < 1024


SUG = (450, 30 + 29)                                         # the bar's suggestion slot


def test_manual_switch_says_how(d):
    since = len(d.events)
    d.touch(30, 14); d.wait_event(r"^EVT:UI sheet$", 3, since); time.sleep(0.5)
    d.touch(128 + 40, 96 + 23)                              # card 1
    d.wait_event(r"^EVT:SWITCH 1 touch$", 3, since)
    d.ok("sheet close"); mark = len(d.events); d.ok(f"setprofile {SLOT}")
    assert not evts(d, mark, "EVT:SWITCH")                  # the host's switch says nothing


def test_suggestion_tap_switches_and_go_back_returns(d):
    d.ok("page 3"); d.ok("suggest 1"); since = len(d.events)
    d.touch(*SUG)
    d.wait_event(r"^EVT:PROFILE 1$", 3, since); d.wait_event(r"^EVT:SWITCH 1 suggest$", 3, since)
    d.touch(*SUG)                                           # now the way back to Test
    d.wait_event(rf"^EVT:SWITCH {SLOT} back$", 3, since)
    assert "page:3 " in d.cmd("status")[0]


def test_other_switch_clears_go_back_and_slot_hides_the_active_profile(d):
    d.ok("suggest 1"); d.touch(*SUG); time.sleep(0.5)
    d.ok(f"setprofile {SLOT}"); since = len(d.events)
    d.touch(*SUG)                                           # go-back gone: the slot suggests 1 again
    d.wait_event(r"^EVT:SWITCH 1 suggest$", 3, since)
    d.ok(f"setprofile {SLOT}"); d.ok(f"suggest {SLOT}"); since = len(d.events)
    d.touch(*SUG); time.sleep(0.4)                          # the suggestion is the active profile: nothing
    assert not evts(d, since, "EVT:SWITCH")


def test_suggestion_tap_closes_a_panel(d):
    set_qb(d); d.touch(*BAR[3]); time.sleep(0.4); d.ok("suggest 1"); since = len(d.events)
    d.touch(*SUG)
    d.wait_event(r"^EVT:PANEL 0$", 3, since); d.wait_event(r"^EVT:SWITCH 1 suggest$", 3, since)



# ---------------------------------------------------------------- streamed uploads, the JPEG cover
def heap_free(d):
    return int(re.search(r"free:(\d+)", d.cmd("heap")[0]).group(1))


def big_profile():
    p = json.loads(json.dumps(PROFILE))
    for i in range(13):
        keys = [None] * 15
        keys[0] = key(1, f"Big {i}", [{"type": "text", "value": "x" * 3000}])
        p["pages"].append({"name": f"Big {i}", "keys": keys})
    return p


def test_identical_upload_writes_nothing(d):
    d.upload_text(f"profile{SLOT}.json", json.dumps(PROFILE))
    r = d.upload_text(f"profile{SLOT}.json", json.dumps(PROFILE))      # the same bytes again
    assert any(l.startswith("SAVED") and l.endswith("unchanged") for l in r), r


def test_big_upload_streams_with_a_cover_loaded(d):
    assert "SAVED ram:art" in d.upload_bin("ram:art", (0x07E0).to_bytes(2, "big") * (128 * 128))   # holds 32 KB
    big = json.dumps(big_profile(), indent=1)
    assert len(big) > 40000
    try:
        r = d.upload_text(f"profile{SLOT}.json", big, timeout=30)
        assert any(l.startswith("SAVED") and not l.endswith("unchanged") for l in r), r
        assert json.loads("\n".join(d.cmd(f"cat /profile{SLOT}.json", 15))) == big_profile()
    finally:
        d.upload_text(f"profile{SLOT}.json", json.dumps(PROFILE))
        d.upload_bin("ram:artj", make_jpg())   # a raw cover is held for good: a JPEG one frees it off the player


def make_jpg(rgb=(255, 0, 255)):
    import io
    from PIL import Image
    b = io.BytesIO()
    Image.new("RGB", (128, 128), rgb).save(b, "JPEG", quality=85)
    return b.getvalue()


def art_state(d):
    return dict(kv.split(":", 1) for kv in d.cmd("art")[0].split()[1:])


def test_cached_tiles_give_way_to_the_cover_and_an_upload(d):
    """Four custom tiles kept decoded hold 41 KB for good: opening the player, then an upload while it shows,
    must still get their RAM (the tile cache is a cache: dropped, and read from flash again)."""
    tiles = [c.to_bytes(2, "big") * (TILE_W * TILE_W) for c in (0x001F, 0xFFE0, 0x07FF, 0xF81F)]
    crcs = [f"{zlib.crc32(t):08x}" for t in tiles]
    p = json.loads(json.dumps(PROFILE))
    for i, crc in enumerate(crcs):
        k = key(i + 1, f"T{i}", [{"type": "key", "value": "F14"}], tile=crc)
        del k["icon"]
        p["pages"][0]["keys"][i] = k
    try:
        for crc, t in zip(crcs, tiles):
            d.upload_bin(f"/t/{crc}.565", t)
        d.upload_text(f"profile{SLOT}.json", json.dumps(p))
        time.sleep(1.0)                                          # page 1 draws the four tiles: the cache is full
        d.upload_bin("ram:artj", make_jpg())
        d.ok("page 2"); time.sleep(0.6)
        assert art_state(d)["decoded"] == "1", (art_state(d), d.cmd("heap"))
        r = d.upload_text(f"profile{SLOT}.json", json.dumps(big_profile(), indent=1), timeout=30)
        assert any(l.startswith("SAVED") for l in r), r
    finally:
        d.ok("page 1")
        d.upload_text(f"profile{SLOT}.json", json.dumps(PROFILE))
        for crc in crcs:
            d.cmd(f"rm /t/{crc}.565")


def test_jpeg_cover_decodes_when_the_player_opens_and_frees_after(d):
    jpg = make_jpg()
    r = d.upload_bin("ram:artj", jpg)
    assert any(l.startswith("SAVED ram:artj") for l in r), r
    time.sleep(0.3)
    assert art_state(d)["decoded"] == "0"                    # page 1 is keys: no 32 KB image held
    free0 = heap_free(d)
    d.ok("page 2"); time.sleep(0.6)
    st = art_state(d)
    assert st["decoded"] == "1" and int(st["ms"]) < 100, st
    assert close(d.shot().getpixel((16 + 64, 44 + 64)), (255, 0, 255), 40)
    assert free0 - heap_free(d) > 30000
    d.ok("page 1"); time.sleep(0.4)
    assert art_state(d)["decoded"] == "0" and heap_free(d) >= free0 - 1024


def test_a_new_track_frees_the_decoded_cover(d):                   # final review: the 32 KB image stayed held
    np = lambda t: d.ok('widget now_playing {"title":"%s","album":"A","artist":"B","app":"Spotify","pos":1,"len":200,"playing":false}' % t)
    try:
        np("One"); d.upload_bin("ram:artj", make_jpg()); d.ok("page 2"); time.sleep(0.6)
        assert art_state(d)["decoded"] == "1"
        held = heap_free(d)
        np("Two"); d.ok("page 1"); time.sleep(0.5)
        assert heap_free(d) >= held + 30000                           # the old cover's 32 KB is back
    finally:
        d.ok("page 1")


def test_a_new_track_drops_the_old_cover(d):                       # review 2026-11-11: it decoded again
    np = lambda t: d.ok('widget now_playing {"title":"%s","album":"A","artist":"B","app":"Spotify","pos":1,"len":200,"playing":false}' % t)
    np("One"); d.upload_bin("ram:artj", make_jpg()); time.sleep(0.3)
    assert art_state(d)["jpg"] != "0"
    np("Two"); time.sleep(0.3)
    assert art_state(d)["jpg"] == "0"                             # Studio sends Two's cover when it has one


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


def test_stay_active_pill_jumps_the_pointer_and_back_until_tapped_off(d):
    """Media's Stay active pill (under the art) latches on with a tap and off with the next. While on, the pointer
    jumps at once, then every interval, and back the next time (no drift), so Slack and Teams never see the PC idle."""
    s8 = lambda h: (lambda v: v - 256 if v > 127 else v)(int(h, 16))
    try:
        d.ok("jiggle off")
        d.ok("page 2"); time.sleep(0.6)
        off = d.shot().getpixel((22, 193))                           # the pill's fill, left of its label
        d.clear_events()
        d.touch(80, 193)
        assert d.ok("jiggle")[0].startswith("jiggle on"), d.ok("jiggle")
        time.sleep(0.4)
        assert not close(d.shot().getpixel((22, 193)), off, 30)       # lit while on
        jump = hid_reports(d, 3, 1)[0]                               # mouse: buttons, x, y, wheel
        d.ok("jiggle on 2")                                          # 2 s steps for the test
        back = hid_reports(d, 3, 2, timeout=6)[1]
        dx, dy, bx, by = s8(jump[2:4]), s8(jump[4:6]), s8(back[2:4]), s8(back[4:6])
        assert abs(dx) >= 40 and abs(dy) >= 30 and (bx, by) == (-dx, -dy), (jump, back)
        d.touch(80, 193)
        assert d.ok("jiggle")[0].startswith("jiggle off")
        d.clear_events(); time.sleep(3); d._pump()
        assert not [l for _, l in d.events if l.startswith("EVT:HID 3 ")], d.events   # off: still
    finally:
        d.ok("jiggle off")
        d.ok("page 1")


def test_media_player_page(d):
    d.ok('widget now_playing {"title":"Paper Moon","album":"Test","artist":"Band","app":"Spotify","pos":10,"len":200,"playing":false}')
    d.ok("page 2")
    time.sleep(0.6)
    img = d.shot()
    play = img.getpixel((240, 248 - 30))                           # upper part of the cyan play key
    assert play[2] > play[0] + 30, play
    d.clear_events()
    d.touch(160 + 122, 156)                                        # middle of the seek bar
    m = d.wait_event(r"^EVT:SEEK (\d+)$")
    assert 90 <= int(m.group(1)) <= 110


def test_player_mic_button_runs_the_widgets_mic_actions(d):
    """A player whose widget has mic_actions gets a seventh control, the mic, at the right end, play in the middle:
    a tap runs them (on the owner's keypad, the host's `mic toggle`); the other controls still work."""
    p = json.loads(json.dumps(PROFILE))
    p["pages"][1]["keys"][0]["mic_actions"] = [{"type": "key", "value": "A"}]
    try:
        d.upload_text(f"profile{SLOT}.json", json.dumps(p))
        d.ok("page 2"); time.sleep(0.6)
        d.clear_events()
        d.touch(387, 248)                                        # the mic, where volume up sits on a 6-control player
        assert hid_reports(d, 1, 2)[:2] == ["0000040000000000", "0000000000000000"]   # A down, up
        assert not [l for _, l in d.events if l.startswith("EVT:HID 2 ")], d.events    # and no media key
        d.clear_events()
        d.touch(33, 248)                                         # mute, still at the left end
        assert hid_reports(d, 2, 1)[0].startswith("e2")           # consumer usage 0x00E2
    finally:
        d.ok("page 1")
        d.upload_text(f"profile{SLOT}.json", json.dumps(PROFILE))


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
    for _ in range(5):   # a shot blocks ~5 s and the panel shows 1.6 s: send it again each try (it holds while shown)
        d.ok('widget volume {"level":50,"muted":false}')
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


def test_page_slide_frame_rate(d):
    d.ok("page 3")
    time.sleep(0.8)
    frames, rate, _ = fps(d, lambda: d.swipe(100, 160, 400, 160))   # back to page 2: grid -> player
    assert rate >= SLIDE_FLOOR, (frames, rate)
    d.ok("page 1")
    time.sleep(0.8)
    frames, rate, _ = fps(d, lambda: d.ok("page 3"))                 # grid -> grid
    assert rate >= SLIDE_FLOOR, (frames, rate)


def test_sheet_frame_rate(d):
    frames, rate, _ = fps(d, lambda: d.ok("sheet"), wait=1.0)
    assert rate >= RISE_FLOOR, (frames, rate)
    d.ok("sheet close")


def test_volume_panel_frame_rate(d):
    frames, rate, _ = fps(d, lambda: d.ok('widget volume {"level":30,"muted":false}'))
    assert rate >= FPS_FLOOR, (frames, rate)



# ---------------------------------------------------------------- the page slide (motion plan, Task 3)
def field(d, name):
    return int(re.search(rf" {name}:(-?\d+)", d.cmd("status")[0]).group(1))


def swipe_held(d, x1, y1, x2, y2, ms):
    """A swipe that returns at once, the finger still down: d.swipe waits for the keypad's prompt, which
    comes when the finger lifts, so state read during a drag needs this. The prompt it leaves is drained
    by the next d.cmd."""
    d.drain()
    d.write_line(f"swipe {x1} {y1} {x2} {y2} {ms}")


def full_profile():   # 2 pages x 15 icon keys, every 4th a host key (its PC tag): the owner's kind of page
    icons = ["copy", "type", "folder", "file-text", "play", "volume-x", "mic", "arrow-left", "layers", "flag"]
    acts = lambda i: [{"type": "host", "cmd": "open notepad", "slot": 5}] if i % 4 == 0 else [{"type": "key", "value": "A"}]
    page = lambda n: {"name": n, "keys": [key(i + 1, f"{n} {i + 1}", acts(i), icon=icons[i % 10]) for i in range(15)]}
    return {"schema_version": 2, "profile_name": "Full", "color": [80, 140, 255], "default_delay": 5, "pages": [page("One"), page("Two")]}


def test_page_follows_the_finger(d):
    swipe_held(d, 400, 160, 100, 160, 1500); time.sleep(0.75)
    off = field(d, "slide")
    assert 80 <= off <= 200 and "page:1 " in d.cmd("status")[0], off   # mid-drag: moved, not committed
    d.wait_event(r"^EVT:PAGE 2$", 3); time.sleep(0.8)
    assert field(d, "slide") == 0


def test_a_flick_turns_the_page(d):
    # 90 px in 80 ms: touch is read between frames (~28 ms while a slide draws), so a 60 ms flick gets two
    # samples and lands at the half-page line; this one lands at about 0.7 of a page.
    d.swipe(300, 160, 210, 160, 80); d.wait_event(r"^EVT:PAGE 2$", 1.5)


def swipe_bent(d, a, b, c, ms1, ms2):
    """A swipe that turns at b: a to b over ms1, then b to c over ms2, the finger down throughout. The first
    leg is sent twice as long and cut halfway by the second (a `swipe` while one runs carries the touch on)."""
    far = (2 * b[0] - a[0], 2 * b[1] - a[1])
    swipe_held(d, *a, *far, 2 * ms1); time.sleep(ms1 / 1000)
    d.write_line(f"swipe {b[0]} {b[1]} {c[0]} {c[1]} {ms2}")   # not d.swipe: its drain waits for a quiet line


# A quick swipe counts wherever the spring would land (the owner flicks; frames run ~35 ms, so a flick
# gives the drag one or two samples): 3.13's swipe (44 px up/down, 86 px sideways) inside QUICK_MS.
def test_a_quick_short_swipe_up_opens_media_and_down_closes_it(d):
    set_qb(d); since = len(d.events)
    d.swipe(210, 290, 210, 240, 250); d.wait_event(rf"^EVT:PANEL 1 {SLOT} 1$", 1.5, since)   # 50 px in 250 ms
    time.sleep(0.8); d.swipe(210, 100, 210, 150, 250); d.wait_event(r"^EVT:PANEL 0$", 1.5, since)
    time.sleep(0.8); assert field(d, "rise") == 0


def test_a_quick_short_swipe_turns_the_page(d):
    d.swipe(300, 160, 210, 160, 250); d.wait_event(r"^EVT:PAGE 2$", 1.5)   # 90 px in 250 ms


def test_a_quick_short_swipe_down_closes_settings(d):
    since = len(d.events)
    d.touch(*BAR["settings"]); d.wait_event(r"^EVT:UI sheet$", 1, since); time.sleep(0.8)
    d.swipe(60, 120, 60, 170, 250); d.wait_event(r"^EVT:UI home$", 1.5, since)


def test_a_quick_swipe_up_that_sets_off_sideways_opens_media(d):
    set_qb(d); since = len(d.events)
    swipe_bent(d, (200, 280), (220, 276), (225, 176), 120, 100)        # locks sideways at 14 px, then goes up
    d.wait_event(rf"^EVT:PANEL 1 {SLOT} 1$", 1.5, since)
    assert not evts(d, since, "EVT:PAGE")


def test_a_quick_swipe_sideways_that_sets_off_up_turns_the_page(d):
    set_qb(d); since = len(d.events)
    swipe_bent(d, (300, 200), (298, 180), (178, 176), 120, 100)        # locks upward at 14 px, then goes left
    d.wait_event(r"^EVT:PAGE 2$", 1.5, since); time.sleep(0.8)
    assert not evts(d, since, "EVT:PANEL") and field(d, "rise") == 0


def test_hold_to_fire_needs_the_hold(d):                           # review 2026-11-11: a secret typed on a slip
    p = json.loads(json.dumps(PROFILE))
    p["pages"][0]["keys"][0]["hold_to_fire"] = True                   # Copy
    try:
        d.upload_text(f"profile{SLOT}.json", json.dumps(p)); d.ok(f"setprofile {SLOT}"); time.sleep(0.6)
        d.listen(0.3); d.clear_events()
        tap(d, 1); d.listen(0.8)
        assert not [l for _, l in d.events if l.startswith("EVT:HID")]
        d.hold(*cell_xy(1), 800)
        assert hid_reports(d, 1, 1)
    finally:
        put_back_profile(d); d.ok(f"setprofile {SLOT}")


@pytest.mark.skipif(os.environ.get("KP_ALLOW_UNPAIR") != "1", reason="if Forget regressed, this would unpair the owner's PC")
def test_forget_asks_first(d):                                     # review 2026-11-11: one tap, 8 px from Use
    hosts = lambda: [l.split()[1] for l in d.cmd("ble list") if re.match(r"\d+ ", l)]
    before = hosts()
    if not before:
        pytest.skip("no saved host to try it on")
    try:
        d.ok("sheet"); time.sleep(0.8)
        d.touch(60, 168); time.sleep(0.4)                             # Bluetooth
        d.touch(420, 118); time.sleep(0.4)                            # Forget on the first host, once
        assert hosts() == before
    finally:
        time.sleep(3.3)                                               # it disarms by itself
        d.cmd("sheet close")


def backlight(d):
    return int(re.search(r"\bbl:(\d+)", next(l for l in d.cmd("power") if l.startswith("power"))).group(1))


def test_a_profile_cannot_put_the_screen_out(d):                   # review 2026-11-11: 0 slept the panel for good
    try:
        d.upload_text(f"profile{SLOT}.json", json.dumps({**PROFILE, "brightness": 0}))
        d.ok(f"setprofile {SLOT}"); time.sleep(0.3)
        assert backlight(d) >= 8
    finally:
        put_back_profile(d); d.ok(f"setprofile {SLOT}")


# A host command can land mid-drag (Studio's auto-switch, a sheet closed from the PC): what the finger was
# dragging still lands, and the next touch is a touch (review 2026-11-11).
def test_a_profile_switch_mid_drag_lets_media_land(d):
    set_qb(d)
    swipe_held(d, 210, 280, 210, 140, 900); time.sleep(0.45)            # Media part way up, on the finger
    d.write_line(f"setprofile {SLOT}"); time.sleep(1.5)                  # the finger lifts at 900 ms
    d.drain(); assert field(d, "rise") in (0, 290)
    d.ok("panel 0"); time.sleep(0.6); since = len(d.events)
    tap(d, 1); d.wait_event(r"^EVT:KEY 1 1 1$", 1, since)


def test_a_sheet_closed_by_the_host_mid_drag_frees_the_touch(d):
    since = len(d.events)
    d.touch(*BAR["settings"]); d.wait_event(r"^EVT:UI sheet$", 1, since); time.sleep(0.8)
    swipe_held(d, 60, 100, 60, 220, 900); time.sleep(0.45)              # Settings coming down on the finger
    d.write_line("sheet close"); time.sleep(1.5)
    d.drain(); assert "ui:home" in d.cmd("status")[0]
    since = len(d.events); tap(d, 1); d.wait_event(r"^EVT:KEY 1 1 1$", 1, since)


def test_a_shade_opened_by_the_host_mid_slide_frees_the_touch(d):  # final review: the page froze under it
    swipe_held(d, 330, 160, 130, 160, 900); time.sleep(0.45)            # the page sliding on the finger
    d.write_line("shade"); time.sleep(1.5)
    d.drain(); assert field(d, "slide") == 0
    d.ok("shade close"); time.sleep(0.8); since = len(d.events)
    tap(d, 1); d.wait_event(r"^EVT:KEY 1 1 1$", 1, since)


def test_a_swipe_down_closes_a_player_panel(d):                     # final review: the player page pulled the shade
    set_qb(d, [QB_TEST[0], {"profile": SLOT, "page": 2, "icon": "music", "label": "Player"}, QB_TEST[2], None])
    d.ok("panel 2"); time.sleep(0.8); since = len(d.events)
    d.swipe(210, 90, 210, 230, 250); d.wait_event(r"^EVT:PANEL 0$", 1.5, since)
    assert "ui:home" in d.cmd("status")[0]


# Where am I, and how do I leave (review 2026-11-11): the chip names the layer and closes it, a swipe down
# closes it, and Media has a way in besides the swipe.
def test_a_swipe_down_closes_an_open_panel(d):
    set_qb(d); d.ok("panel 2"); time.sleep(0.8); since = len(d.events)
    d.swipe(210, 90, 210, 230, 250); d.wait_event(r"^EVT:PANEL 0$", 1.5, since)
    assert "ui:home" in d.cmd("status")[0]                             # not the shade over the panel


def test_the_status_chip_closes_an_open_panel(d):
    set_qb(d); d.ok("panel 2"); time.sleep(0.8); since = len(d.events)
    d.touch(30, 14); d.wait_event(r"^EVT:PANEL 0$", 1.5, since)
    assert "ui:home" in d.cmd("status")[0]                             # not Profiles


def test_the_free_suggestion_slot_opens_media(d):
    set_qb(d); since = len(d.events)
    d.touch(BAR["settings"][0], 58); d.wait_event(rf"^EVT:PANEL 1 {SLOT} 1$", 1.5, since)


def test_the_shade_follows_a_drag_down_and_springs(d):              # review 2026-11-11: it only played on release
    swipe_held(d, 210, 60, 210, 200, 1400); time.sleep(0.7)
    assert "ui:shade" in d.cmd("status")[0]                             # on the finger before it lets go
    time.sleep(1.4); assert "ui:shade" in d.cmd("status")[0]           # let go far down: it stays open
    swipe_held(d, 210, 200, 210, 100, 1200); time.sleep(2.0)           # a slow drag back up past half: it goes
    assert "ui:home" in d.cmd("status")[0]


def test_a_slow_short_drag_springs_back(d):
    since = len(d.events)
    d.swipe(300, 160, 220, 160, 800); time.sleep(1.6)
    assert not evts(d, since, "EVT:PAGE") and field(d, "slide") == 0


def test_both_ends_of_the_row_give_and_spring_back(d):               # motion plan, Review Focus 5
    since = len(d.events)
    swipe_held(d, 100, 160, 400, 160, 1200); time.sleep(0.6)
    assert field(d, "slide") < -20                                        # page 1 gives to the right
    time.sleep(1.4); d.ok("page 3"); time.sleep(0.8); since = len(d.events)
    d.swipe(400, 160, 100, 160, 600); time.sleep(1.4)
    assert not evts(d, since, "EVT:PAGE") and field(d, "slide") == 0


def test_a_wobbly_tap_fires_and_a_drag_does_not(d):
    x, y = cell_xy(1)
    d.swipe(x, y, x + 6, y, 90); assert hid_reports(d, 1, 1)             # Copy: a 6 px wobble is a tap
    d.listen(0.5); d.clear_events(); d.swipe(x, y, x + 60, y, 400); time.sleep(0.8)   # the tap's release report read first
    assert not [l for _, l in d.events if l.startswith("EVT:HID")]


def test_stations_keys_and_host_page_slide(d):
    d.touch(210, G_LINE); d.wait_event(r"^EVT:PAGE 2$", 1); time.sleep(0.1)
    assert field(d, "slide") != 0
    time.sleep(1.0); d.ok("page 3"); time.sleep(0.1)
    assert field(d, "slide") != 0 and "page:3 " in d.cmd("status")[0]   # committed at once


def test_a_touch_mid_spring_lands_on_the_settled_page(d):            # motion plan, Review Focus 4
    d.ok("page 3"); since = len(d.events)
    tap(d, 15); d.wait_event(r"^EVT:KEY 3 15 1$", 1, since)              # Last, on page 3


def test_slide_keeps_the_status_band_and_line_still(d):
    before = d.shot()
    swipe_held(d, 400, 160, 100, 160, 7000); time.sleep(1.5)
    mid = d.shot()
    band = lambda im: im.crop((150, 0, 440, 30)).tobytes()              # past the clock, short of the battery (live)
    line = lambda im: im.crop((0, 300, 480, 320)).tobytes()
    assert band(mid) == band(before) and line(mid) == line(before)
    assert mid.crop((0, 30, 420, 300)).tobytes() != before.crop((0, 30, 420, 300)).tobytes()
    time.sleep(6)


def test_profile_change_mid_drag_ends_the_slide(d):                   # motion plan, Review Focus 1
    swipe_held(d, 400, 160, 100, 160, 2000); time.sleep(0.6)
    d.ok(f"setprofile {SLOT}"); time.sleep(2.0)
    assert field(d, "slide") == 0 and "page:1 " in d.cmd("status")[0]
    since = len(d.events); tap(d, 2); d.wait_event(r"^EVT:KEY 1 2 1$", 1, since)


def test_drag_from_the_bar_or_a_player_button_slides_and_fires_nothing(d):   # motion plan, Review Focus 2
    since = len(d.events)
    d.swipe(450, 200, 150, 200); d.wait_event(r"^EVT:PAGE 2$", 1.5, since)   # from the bar: page 2, the player
    time.sleep(0.8); since = len(d.events)
    d.swipe(210, 248, 400, 248); d.wait_event(r"^EVT:PAGE 1$", 1.5, since)   # from play/pause
    assert not [l for _, l in d.events[since:] if l.startswith("EVT:HID 2")]


def test_pages_slide_inside_a_panel_and_in_media(d):
    set_qb(d); d.touch(*BAR[2]); time.sleep(0.4); since = len(d.events)
    d.swipe(400, 160, 100, 160); d.wait_event(rf"^EVT:PANEL 2 {SLOT} 2$", 1.5, since)
    d.ok("panel 0"); time.sleep(0.4); swipe_up(d); time.sleep(0.6); since = len(d.events)
    d.swipe(400, 160, 100, 160); d.wait_event(rf"^EVT:PANEL 1 {SLOT} 2$", 1.5, since)


def test_motion_command_tunes_the_springs(d):
    assert d.cmd("motion")[0] == "motion page k:230 z:0.78 sheet k:240 z:0.80"
    d.cmd("motion page 300 0.9"); assert "page k:300 z:0.90" in d.cmd("motion")[0]
    d.cmd("motion page 230 0.78")


def test_a_slide_reads_no_tiles_from_flash(d):
    """Six custom tiles on the incoming page, the cache holds four: a slide draws the ones it has and plain
    faces for the rest (they come in once it lands), rather than reading flash (~31 ms a tile) every frame."""
    tiles = [c.to_bytes(2, "big") * (TILE_W * TILE_W) for c in (0x001F, 0xFFE0, 0x07FF, 0xF81F, 0x07E0, 0xF800)]
    crcs = [f"{zlib.crc32(t):08x}" for t in tiles]
    p = json.loads(json.dumps(PROFILE))
    for i, crc in enumerate(crcs):
        k = key(i + 1, f"T{i}", [{"type": "key", "value": "F14"}], tile=crc)
        del k["icon"]
        p["pages"][0]["keys"][i] = k
    try:
        for crc, t in zip(crcs, tiles):
            d.upload_bin(f"/t/{crc}.565", t)
        d.upload_text(f"profile{SLOT}.json", json.dumps(p)); d.ok("page 3"); time.sleep(1.0)
        frames, rate, worst = fps(d, lambda: d.ok("page 1"), wait=1.0)   # page 3 -> page 1, six tiles coming in
        slow = [l for l in d.cmd("perf log") if len(l.split()) == 3 and int(l.split()[1]) > 60000]   # a frame and a flash read (~31 ms)
        print(f"tile slide: {frames} frames {rate:.1f} fps worst {worst:.1f} ms, {len(slow)} over 60 ms")
        assert frames >= 8 and rate >= SLIDE_FLOOR and len(slow) <= 1, (frames, rate, slow)   # one: the landing reads the rest
    finally:
        d.ok("page 1")
        d.upload_text(f"profile{SLOT}.json", json.dumps(PROFILE))
        for crc in crcs:
            d.cmd(f"rm /t/{crc}.565")

@pytest.mark.parametrize("name", THEMES)
def test_slide_holds_its_floor_on_a_full_page(d, name):
    try:
        d.ok(f"theme {name}")
        d.upload_text(f"profile{SLOT}.json", json.dumps(full_profile())); d.ok(f"setprofile {SLOT}"); time.sleep(0.8)
        frames, rate, _ = fps(d, lambda: d.swipe(400, 160, 100, 160, 500), wait=1.4)
        print(f"slide fps {name} {rate:.1f} over {frames} frames")
        assert frames >= 12 and rate >= SLIDE_FLOOR, (name, frames, rate)
    finally:
        put_back_profile(d); d.ok(f"setprofile {SLOT}")



# ---------------------------------------------------------------- Media and Settings rise (motion plan, Task 4)
def test_media_follows_a_drag_up(d):
    set_qb(d); since = len(d.events)
    swipe_held(d, 210, 290, 210, 110, 1500); time.sleep(0.75)
    r = field(d, "rise")
    assert 40 <= r <= 150 and "panel:0" in d.cmd("status")[0], r     # following, not committed
    d.wait_event(rf"^EVT:PANEL 1 {SLOT} 1$", 3, since); time.sleep(0.8)
    assert field(d, "rise") == 290


def test_a_short_slow_drag_up_falls_back(d):
    set_qb(d); since = len(d.events)
    d.swipe(210, 290, 210, 230, 800); time.sleep(1.0)
    assert not evts(d, since, "EVT:PANEL") and field(d, "rise") == 0


def test_a_flick_up_opens_media_and_a_drag_down_closes_it(d):
    set_qb(d); since = len(d.events)
    d.swipe(210, 290, 210, 200, 80); d.wait_event(rf"^EVT:PANEL 1 {SLOT} 1$", 1.5, since)   # 90 px in 80 ms
    time.sleep(0.8); d.swipe(210, 60, 210, 250, 300); d.wait_event(r"^EVT:PANEL 0$", 1.5, since)
    time.sleep(0.8); assert field(d, "rise") == 0


def test_settings_rises_from_the_bar_and_a_drag_down_closes_it(d):
    since = len(d.events)
    d.touch(*BAR["settings"]); d.wait_event(r"^EVT:UI sheet$", 1, since); time.sleep(0.8)
    assert field(d, "rise") == 290
    d.swipe(60, 120, 60, 300, 300); d.wait_event(r"^EVT:UI home$", 1.5, since)


@pytest.mark.parametrize("name", ["glass", "paper"])
def test_rises_hold_their_floor(d, name):
    d.ok(f"theme {name}"); time.sleep(0.6)
    set_qb(d)
    frames, rate, _ = fps(d, lambda: d.ok("panel 1"), wait=1.0); d.ok("panel 0"); time.sleep(0.8)
    print(f"media rise {name} {rate:.1f}")
    assert rate >= RISE_FLOOR, ("media", frames, rate)
    frames, rate, _ = fps(d, lambda: d.ok("sheet"), wait=1.0); d.ok("sheet close"); time.sleep(0.8)
    print(f"settings rise {name} {rate:.1f}")
    assert rate >= RISE_FLOOR, ("settings", frames, rate)


def test_media_drag_over_a_panel_with_a_cover_keeps_the_heap(d):  # motion plan, Review Focus 3
    set_qb(d); d.upload_bin("ram:artj", make_jpg()); time.sleep(0.3)
    before = heap_free(d)
    d.touch(*BAR[3]); time.sleep(0.4)
    swipe_held(d, 210, 290, 210, 110, 1500); time.sleep(0.75)
    assert heap_free(d) > 20000 and not [l for _, l in d.events if "no RAM" in l]
    time.sleep(1.2); d.ok("panel 0"); time.sleep(0.8)
    assert abs(heap_free(d) - before) < 1024


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


def theme_chip(i):
    """Settings › Display: four chips across, 44 px rows (4 px apart) from y 176; firmware theme order."""
    w = (338 - 3 * 6) / 4
    return int(128 + (i % 4) * (w + 6) + w / 2), 176 + (i // 4) * 48 + 22


def test_second_row_chip_picks_a_new_theme(d):
    d.ok("sheet"); d.wait_event(r"^EVT:UI sheet$"); time.sleep(0.5)
    d.touch(60, 64); time.sleep(0.3)                     # Display tab
    since = len(d.events)
    d.touch(*theme_chip(THEMES.index("focus_slate")))       # row 2, column 4
    d.wait_event(r"^EVT:THEME focus_slate$", 3, since)
    d.ok("sheet close")


def token_ground(tid, y):
    import json as _j
    t = {x["id"]: x for x in _j.load(open(Path(__file__).resolve().parents[1] / "themes" / "theme_tokens.json", encoding="utf-8"))["themes"]}[tid]
    g = [tuple(int(h[i:i + 2], 16) for i in (1, 3, 5)) for h in t["ground"]]
    k = int(y * 255 / 319)
    a, b, f = (g[0], g[1], k * 2) if k < 128 else (g[1], g[2], (k - 128) * 2)
    return tuple(round(p + (q - p) * f / 255) for p, q in zip(a, b))


def test_the_handoff_themes_load_and_paint_their_tokens(d):
    for tid in ("nordic_calm", "focus_slate", "forest_field", "ember_atelier"):
        assert d.cmd(f"theme {tid}") == [f"theme {tid}"]
        time.sleep(0.6)
        assert f"theme:{tid}" in d.cmd("status")[0]
        px = d.shot().getpixel((5, 250))                  # the ground beside key 11
        assert close(px, token_ground(tid, 250), 16), (tid, px, token_ground(tid, 250))


def test_theme_default_is_daylight(d):
    since = len(d.events)
    assert d.cmd("theme default") == ["theme daylight"]   # forgets the saved choice
    d.wait_event(r"^EVT:THEME daylight$", 3, since)
    assert "theme:daylight" in d.cmd("status")[0]


@pytest.mark.parametrize("name", THEMES[:6])   # the hand-tuned six; the handoff four: test_the_handoff_themes_load_and_paint_their_tokens
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
    frames, rate, _ = fps(d, lambda: d.ok("page 3"))     # grid -> grid slide
    assert frames >= 8 and rate >= SLIDE_FLOOR, (name, frames, rate)
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
    since = len(d.events)
    d.touch(*theme_chip(THEMES.index("synth")))          # the Synth chip: row 2, column 1
    d.wait_event(r"^EVT:THEME synth$", 3, since)
    time.sleep(0.6)
    img = d.shot()
    assert "theme:synth" in d.cmd("status")[0]
    assert luma(img.getpixel((300, 40))) > 200            # the sheet is now the light grey ply
    d.ok("sheet close")


# ---------------------------------------------------------------- power
def test_power_readout_and_battery_policy(d):
    p = d.cmd("power")[0]
    assert re.match(r"power usb:1 mv:\d+ pct:-?\d+ charging:[01] sleep:\d+ sim:-1 .*cpu:240 screen:lit bl:\d+$", p), p
    try:
        d.ok("setdim 2")                                   # on battery the dim time is min(setdim, 20 s)
        time.sleep(3)
        assert re.search(r"cpu:240 screen:lit bl:\d+$", d.cmd("power")[0])   # on USB the screen stays lit
        d.ok("power sim battery")
        assert re.search(r"pwr:bat bat:\d+$", d.cmd("status")[0])
        time.sleep(3)
        assert d.cmd("theme") == ["theme glass"]           # a readout leaves the screen dark
        assert re.search(r"cpu:80 screen:dim bl:\d+$", d.cmd("power")[0])   # dim on battery: the CPU slows
        d.ok("theme glass")                                # an edit from Studio lights it
        assert re.search(r"cpu:240 screen:lit bl:\d+$", d.cmd("power")[0])
    finally:
        d.cmd("power sim off")
        d.ok("setdim 0")
    assert d.cmd("setdim") == ["dim 0"]                    # a bare setdim only reports
    assert "pwr:usb" in d.cmd("status")[0]


def test_dark_screen_wakes_drawing(d):
    """On battery the screen goes off after a minute and the panel sleeps with it: a wake brings it back."""
    try:
        d.ok("power sim battery")
        d.ok("theme glass")
        t = time.time()
        while "screen:off" not in d.cmd("power")[0]:
            assert time.time() - t < 75, "the screen never went off"
            time.sleep(2)
        d.ok("theme glass")
        assert re.search(r"cpu:240 screen:lit bl:\d+$", d.cmd("power")[0])
        assert len(d.shot().getcolors(1 << 20)) > 50
    finally:
        d.cmd("power sim off")


def test_power_sleep_minutes(d):
    old = re.search(r"sleep:(\d+)", d.cmd("power")[0]).group(1)
    assert " sleep:7 " in d.cmd("power sleep 7")[0]
    assert " sleep:0 " in d.cmd("power sleep 0")[0]        # never
    assert " sleep:120 " in d.cmd("power sleep 500")[0]    # clamped
    d.cmd(f"power sleep {old}")


def test_battery_gauge_only_falls_on_battery(d):
    try:
        assert " pct:52 " in d.cmd("power sim battery 3800")[0]
        assert " pct:52 " in d.cmd("power sim battery 3900")[0]   # a dark screen's rebound is not charge
        assert " pct:42 " in d.cmd("power sim battery 3750")[0]
        d.cmd("power sim usb")
        assert " pct:65 " in d.cmd("power sim battery 3900")[0]   # off USB again: a fresh reading
    finally:
        d.cmd("power sim off")


def test_battery_cutoff_warns_then_sleeps(d):
    try:
        since = len(d.events)
        d.cmd("power sim battery 3250")
        d.wait_event(r"POWER empty", 3, since)
        assert any("Battery empty" in l for l in d.cmd("notify list"))
        d.wait_event(r"POWER sleep", 8, since)
    finally:
        d.reset()                                             # only a touch wakes it; RTS stands in
    assert "pwr:usb" in d.cmd("status")[0]


def test_nap_wakes_with_a_working_screen(d):
    since = len(d.events)
    d.write_line("power nap 2")
    d.wait_event(r"POWER sleep", 3, since)
    d.wait_event(r"POWER wake timer", 15, since)              # held pins were released, or the LCD stays deaf
    d.ready()
    assert len(d.shot().getcolors(1 << 20)) > 50              # the screen came back and draws


def test_turn_off_takes_two_taps_and_sleeps_until_reset(d):
    try:
        d.ok("sheet")
        d.wait_event(r"^EVT:UI sheet$")
        time.sleep(0.5)
        d.touch(62, 272)                                      # the Device tab
        time.sleep(0.3)
        since = len(d.events)
        d.touch(248 + 66, 64)                                 # Turn off, left of Done: one tap only arms it
        time.sleep(1.0)
        assert not any("POWER sleep" in l for _, l in d.events[since:])
        d.touch(248 + 66, 64)
        tapped = time.time()
        assert any("Turned off" in l for l in d.cmd("notify list"))
        d.wait_event(r"POWER sleep", 5, since)
        assert next(t for t, l in d.events[since:] if "POWER sleep" in l) - tapped > 1.5   # the banner had its 2 s
        time.sleep(3)
        assert not any("POWER wake" in l for _, l in d.events[since:])   # no timer (a real touch can't be injected while it sleeps)
    finally:
        d.reset()                                             # RESET, as the owner would press it
    assert "pwr:usb" in d.cmd("status")[0]


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


def test_profiles_tab_reads_a_saved_profile_again(d):
    """The Profiles tab keeps its 16 slots between opens and reads them again once a profile is
    saved: slot 16's colour bar follows the uploaded colour."""
    theme = re.search(r"theme:(\w+)", d.cmd("status")[0]).group(1)
    d.ok("theme daylight")                               # Retro draws the bars in ink
    bar = (128 + 3 * 86 + 17, 96 + 3 * 52 + 9)           # slot 16: the last card of the 4 x 4 grid
    try:
        for rgb in ([255, 0, 0], [0, 0, 255]):
            r = d.upload_text(f"profile{SLOT}.json", json.dumps({**PROFILE, "color": rgb}))
            assert any(l.startswith("SAVED") for l in r), r
            time.sleep(0.6)
            d.ok("sheet profiles")
            time.sleep(0.5)
            px = d.shot().getpixel(bar)
            d.ok("sheet close")
            time.sleep(0.4)
            want, other = (0, 2) if rgb[0] else (2, 0)
            assert px[want] > 200 and px[other] < 60, (rgb, px)
    finally:
        d.upload_text(f"profile{SLOT}.json", json.dumps(PROFILE))
        d.ok(f"theme {theme}")
        d.ok(f"setprofile {SLOT}")


# ---------------------------------------------------------------- notifications, the shade, the host menu
NOTE = '{"app":"Slack","title":"Sam","body":"Lunch at one?","icon":"message-square"}'


def test_notification_rings_the_bell_and_drops_a_banner(d):
    """A notification counts on the bell and drops a banner over the status band; a tap on the
    banner pulls the shade down, which marks it read; a swipe up puts the shade away."""
    d.ok("notify clear")
    try:
        time.sleep(0.4)
        base = d.shot().getpixel((240, 40))
        assert d.cmd(f"notify {NOTE}") == ["notify"]
        assert d.cmd("notify list") == ["notify 1 unread 1", "1 Slack\tSam\tLunch at one?\tmessage-square"]
        time.sleep(0.4)
        assert d.shot().getpixel((240, 40)) != base                        # the banner is down
        time.sleep(1.5)                                                    # and gone (4 s)
        assert d.cmd("notify " + NOTE.replace("Sam", "Ana").replace('"}', '","tag":"lunch"}')) == ["notify"]
        assert d.cmd("notify " + NOTE.replace("Sam", "Ana B").replace('"}', '","tag":"lunch"}')) == ["notify"]
        assert d.cmd("notify list")[:2] == ["notify 2 unread 2", "1 Slack\tAna B\tLunch at one?\tmessage-square"]   # a tag updates its own
        time.sleep(0.3)
        since = len(d.events)
        d.touch(240, 30)                                                   # tap the banner: the shade
        d.wait_event(r"^EVT:UI shade$", 3, since)
        assert d.cmd("notify list")[0] == "notify 2 unread 0"
        since = len(d.events)
        d.swipe(240, 260, 240, 60)
        d.wait_event(r"^EVT:UI home$", 3, since)
    finally:
        d.cmd("notify clear")


def test_shade_brightness_profile_and_clear(d):
    """Swipe down from the keys: the shade, at full speed. Its slider sets brightness, its arrows
    step through the saved profiles, Clear all empties it, and a tap below closes it."""
    old = d.cmd("setbrightness")[0]
    d.ok("notify clear")
    d.ok('notify {"app":"Mail","title":"Standup","body":"10:30","icon":"mail","banner":false}')
    try:
        since = len(d.events)
        frames, rate, worst = fps(d, lambda: d.swipe(240, 70, 240, 270), wait=0.6)
        d.wait_event(r"^EVT:UI shade$", 3, since)
        assert rate >= FPS_FLOOR and worst <= 20, (frames, rate, worst, d.cmd("perf log")[-8:])   # the slow frames: at, us, px
        time.sleep(0.3)
        d.touch(30 + 13 + 4, 60)                                           # the slider's left end: dimmest
        assert d.cmd("setbrightness")[0] == "brightness 13"
        d.touch(30 + 256 - 13 - 2, 60)                                     # its right end: brightest
        assert int(d.cmd("setbrightness")[0].split()[1]) >= 245
        since = len(d.events)
        d.touch(432 + 19, 38 + 22)                                         # the next saved profile, round the ring
        m = d.wait_event(r"^EVT:PROFILE (\d+)$", 3, since)
        assert m.group(1) != str(SLOT), m.group(0)
        d.touch(430, 150)                                                  # Clear all
        assert d.cmd("notify list") == ["notify 0 unread 0"]
        time.sleep(0.4)
        since = len(d.events)
        d.touch(240, 285)                                                  # below the shade
        d.wait_event(r"^EVT:UI home$", 3, since)
    finally:
        d.cmd("shade close")
        d.cmd(f"setbrightness {old.split()[1]}")
        d.cmd("notify clear")
        d.ok(f"setprofile {SLOT}")


def test_host_chip_lists_the_hosts(d):
    """The status band's host chip drops the host list; a tap outside puts it away."""
    since = len(d.events)
    d.touch(405, 14)
    d.wait_event(r"^EVT:UI menu$", 3, since)
    assert "ui:menu" in d.cmd("status")[0]
    since = len(d.events)
    d.touch(100, 250)
    d.wait_event(r"^EVT:UI home$", 3, since)


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
    assert any(l.startswith("SAVED") for l in dev.upload_text(f"profile{SLOT}.json", json.dumps(prof, indent=1)))
    try:
        dev.ok(f"setprofile {SLOT}")
        time.sleep(0.8)
        x, y = key_box(1)
        seen = set()
        for _ in range(8):                               # 2 frames x 250 ms: both show within a second or two
            r, g, b = dev.shot().getpixel((x + 33, y + 33))
            seen.add("red" if r > 150 and b < 100 else "blue" if b > 150 and r < 100 else "other")
            time.sleep(0.2)
        assert {"red", "blue"} <= seen, seen
    finally:
        put_back_profile(dev)   # slots 1-15 are the owner's: never written
        dev.ok(f"setprofile {SLOT}")
        for n in names:
            dev.cmd(f"rm /t/{n}.565")


def after_ring_frames(d, cell):
    """Frames redrawn 0.8-1.4 s after a key fires: its ring is gone (700 ms), so only its icon's animation is left."""
    d.touch(*cell_xy(cell), 60)
    time.sleep(0.8)
    d.cmd("perf reset")
    time.sleep(0.6)
    return int(re.search(r"frames:(\d+)", d.cmd("perf")[0]).group(1))


def test_icon_animations_play_on_fire_and_take_turns(d):
    """A fired key's icon acts out its key (copy pulls a second sheet out of the first); idle keys play
    a few at a time, and a wave runs across the page; each redraw fits a frame, the inflated frames
    are freed after; off, icons stay still."""
    heap = lambda: int(re.search(r"free:(\d+)", d.cmd("heap")[0]).group(1))
    time.sleep(0.8)
    rest = heap()
    assert after_ring_frames(d, 1) == 0                                     # off: the ring ends and the key is still
    try:
        assert d.cmd("iconanim on") == ["iconanim on"]
        assert after_ring_frames(d, 1) >= 4                                 # on: copy's sheets are still moving
        frames, rate, worst = fps(d, lambda: None, wait=3.5)
        assert frames >= 40 and worst <= 20, (frames, rate, worst)          # a few idle keys at a time; each redraw fits a frame
        assert d.cmd("iconanim wave") == ["iconanim on"]
        frames, rate, worst = fps(d, lambda: None, wait=3.0)
        assert frames >= 60 and worst <= 20, (frames, rate, worst)          # a wave across the page, still inside each frame
        frames, rate, _ = fps(d, lambda: d.touch(*cell_xy(2), 700))
        assert rate >= FPS_FLOOR, rate                                      # and a press still runs at full speed
    finally:
        assert d.cmd("iconanim off") == ["iconanim off"]
    time.sleep(1.8)
    frames, _, _ = fps(d, lambda: None, wait=1.0)
    assert frames <= 2, frames                                              # off: nothing to redraw
    assert heap() >= rest - 2048, (heap(), rest)                            # the inflated animations were freed

