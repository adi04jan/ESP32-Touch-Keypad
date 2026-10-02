"""The three profiles the keypad ships with (schema v2), written once here.

    python tools/gen_defaults.py
      -> firmware/TouchKeypad/defaults_gen.h   (profiles 1-3, restored when missing or unreadable)
      -> docs/device/profiles.js               (the screen mock renders the same keys)

Fields beyond PLAN.md §7: profile "color" (its line colour; pages are stations
on it), key "anim" (eq | pulse | rec), key "toggle" (keeps an on/off state and
shows it), widget "media" (the full-page player, span 5x3).
Host actions carry a starting slot; Studio reassigns slots when it saves.
"""
import json
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

TINT = {
    "cobalt": [79, 140, 255], "cyan": [63, 198, 224], "teal": [47, 191, 154], "green": [82, 214, 143],
    "lime": [168, 214, 74], "amber": [242, 183, 70], "orange": [255, 138, 61], "red": [255, 95, 87],
    "pink": [255, 111, 174], "magenta": [216, 108, 232], "violet": [155, 123, 255], "slate": [138, 152, 171],
}
_slot = iter(range(48))


def combo(*keys): return {"type": "keycombo", "keys": list(keys)}
def media(v): return {"type": "media", "value": v}
def lines(s): return {"type": "multiline", "value": s}
def key(v): return {"type": "key", "value": v}
def tel(v): return {"type": "telephony", "value": v}
def page(n): return {"type": "page", "value": n}
def back(): return {"type": "back"}
def host(cmd): return {"type": "host", "cmd": cmd, "slot": next(_slot)}


def k(name, icon, tint, *actions, **extra):
    d = {"name": name, "icon": icon, "led_color": TINT[tint], "actions": list(actions)}
    d.update(extra)
    return d


def grid(*keys):
    keys = list(keys) + [None] * (15 - len(keys))
    for i, kd in enumerate(keys):
        if kd:
            kd["id"] = i + 1
    return keys


def media_page():
    keys = [None] * 15
    keys[0] = {"id": 1, "name": "Now Playing", "widget": "media", "span": [5, 3], "actions": [media("PLAY_PAUSE")]}
    return {"name": "Media", "keys": keys}


def profile(name, color, pages):
    return {"schema_version": 2, "profile_name": name, "color": TINT[color], "default_delay": 20, "pages": pages}


DAILY = profile("Daily", "cobalt", [
    {"name": "Main", "keys": grid(
        k("Mic mute", "mic", "green", tel("MIC_MUTE"), toggle=True),
        k("Play", "play", "cyan", media("PLAY_PAUSE"), anim="eq", hold_actions=[media("STOP")]),
        k("Vol down", "volume-1", "slate", media("VOLUME_DOWN")),
        k("Vol up", "volume-2", "slate", media("VOLUME_UP")),
        k("Lock", "lock", "red", combo("LEFT_GUI", "L")),
        k("Copy", "copy", "cobalt", combo("LEFT_CTRL", "C")),
        k("Paste", "clipboard-paste", "cobalt", combo("LEFT_CTRL", "V")),
        k("Screenshot", "scan", "violet", combo("LEFT_GUI", "LEFT_SHIFT", "S")),
        k("Undo", "undo-2", "amber", combo("LEFT_CTRL", "Z")),
        k("Redo", "redo-2", "amber", combo("LEFT_CTRL", "Y")),
        k("Spotify", "spotify", "green", host("open spotify:")),
        k("GitHub", "github", "slate", host("open https://github.com")),
        k("Notepad", "file-text", "teal", host("run notepad")),
        k("Media", "music", "pink", page(2)),
        k("Apps", "layout-grid", "orange", page(3)))},
    media_page(),
    {"name": "Apps", "keys": grid(
        k("Chrome", "googlechrome", "amber", host("open https://www.google.com")),
        k("Discord", "discord", "violet", host("open discord:")),
        k("Steam", "steam", "slate", host("open steam:")),
        k("Explorer", "folder-open", "amber", combo("LEFT_GUI", "E")),
        k("Settings", "settings", "slate", combo("LEFT_GUI", "I")),
        k("Task Mgr", "cpu", "cyan", combo("LEFT_CTRL", "LEFT_SHIFT", "ESC")),
        k("Desktop", "monitor", "cobalt", combo("LEFT_GUI", "D")),
        k("Task view", "layout-grid", "cobalt", combo("LEFT_GUI", "TAB")),
        k("Clipboard", "clipboard", "teal", combo("LEFT_GUI", "V")),
        k("Run", "square-terminal", "slate", combo("LEFT_GUI", "R")),
        k("Emoji", "sparkles", "pink", combo("LEFT_GUI", ".")),
        k("Mail", "mail", "cobalt", host("open mailto:")),
        k("Calendar", "calendar", "red", host("open outlookcal:")),
        k("YouTube", "youtube", "red", host("open https://www.youtube.com")),
        k("Back", "arrow-left", "slate", back()))},
])

CODE = profile("Code", "violet", [
    {"name": "Edit", "keys": grid(
        k("Save", "save", "cobalt", combo("LEFT_CTRL", "S")),
        k("Find", "search", "cyan", combo("LEFT_CTRL", "F")),
        k("Format", "wand-sparkles", "magenta", combo("LEFT_SHIFT", "LEFT_ALT", "F")),
        k("Comment", "code", "violet", combo("LEFT_CTRL", "/")),
        k("Terminal", "square-terminal", "slate", combo("LEFT_CTRL", "`")),
        k("Run", "play", "green", key("F5")),
        k("Step over", "chevron-right", "teal", key("F10")),
        k("Step into", "arrow-down", "teal", key("F11")),
        k("Stop", "square", "red", combo("LEFT_SHIFT", "F5")),
        k("Breakpoint", "circle-dot", "red", key("F9")),
        k("Git status", "git-branch", "orange", lines("git status\n")),
        k("Pull", "download", "cobalt", lines("git pull\n")),
        k("Push", "upload", "green", lines("git push\n")),
        k("Palette", "sliders-horizontal", "slate", combo("LEFT_CTRL", "LEFT_SHIFT", "P")),
        k("Git", "git-merge", "orange", page(2)))},
    {"name": "Git & build", "keys": grid(
        k("Log", "list", "orange", lines("git log --oneline -15\n")),
        k("Diff", "git-pull-request", "orange", lines("git diff\n")),
        k("Branches", "git-branch", "orange", lines("git branch -a\n")),
        k("Stash", "layers", "amber", lines("git stash\n")),
        k("Unstash", "layers", "amber", lines("git stash pop\n")),
        k("npm test", "check", "green", lines("npm test\n")),
        k("npm start", "rocket", "cyan", lines("npm start\n")),
        k("Build", "hammer", "slate", lines("npm run build\n")),
        k("Docker", "docker", "cobalt", lines("docker ps\n")),
        k("Python", "python", "amber", lines("python\n")),
        k("Go to file", "file-code", "violet", combo("LEFT_CTRL", "P")),
        k("Rename", "pen-line", "violet", key("F2")),
        k("Dup line", "copy", "violet", combo("LEFT_SHIFT", "LEFT_ALT", "DOWN_ARROW")),
        k("Windows", "app-window", "cobalt", page(3)),
        k("Back", "arrow-left", "slate", back()))},
    {"name": "Windows", "keys": grid(
        k("Snap left", "chevrons-left", "cobalt", combo("LEFT_GUI", "LEFT_ARROW")),
        k("Snap right", "chevrons-right", "cobalt", combo("LEFT_GUI", "RIGHT_ARROW")),
        k("Maximize", "maximize", "cobalt", combo("LEFT_GUI", "UP_ARROW")),
        k("Minimize", "minimize", "cobalt", combo("LEFT_GUI", "DOWN_ARROW")),
        k("Task view", "layout-grid", "cyan", combo("LEFT_GUI", "TAB")),
        k("Desk prev", "arrow-left", "teal", combo("LEFT_CTRL", "LEFT_GUI", "LEFT_ARROW")),
        k("Desk next", "arrow-right", "teal", combo("LEFT_CTRL", "LEFT_GUI", "RIGHT_ARROW")),
        k("Zoom in", "plus", "slate", combo("LEFT_CTRL", "=")),
        k("Zoom out", "minus", "slate", combo("LEFT_CTRL", "-")),
        k("Zoom reset", "search", "slate", combo("LEFT_CTRL", "0")),
        k("New window", "app-window", "violet", combo("LEFT_CTRL", "N")),
        k("Close tab", "x", "red", combo("LEFT_CTRL", "W")),
        k("Reopen tab", "rotate-ccw", "amber", combo("LEFT_CTRL", "LEFT_SHIFT", "T")),
        k("Lock", "lock", "red", combo("LEFT_GUI", "L")),
        k("Back", "arrow-left", "slate", back()))},
])

SOUNDS = [("Applause", "heart", "pink"), ("Laugh", "sparkles", "amber"), ("Drumroll", "timer", "orange"),
          ("Airhorn", "zap", "red"), ("Sad horn", "droplet", "cobalt"), ("Cheer", "trophy", "amber"),
          ("Bell", "bell", "teal"), ("Whoosh", "wind", "cyan"), ("Ding", "check", "green"),
          ("Countdown", "hourglass", "violet"), ("Intro", "film", "magenta"), ("Outro", "clapperboard", "magenta")]

STREAM = profile("Stream", "orange", [
    {"name": "Live", "keys": grid(
        k("Live scene", "radio-tower", "red", host("obs.scene Live")),
        k("Camera", "video", "cobalt", host("obs.scene Camera")),
        k("Screen", "monitor", "cobalt", host("obs.scene Screen")),
        k("Be right back", "coffee", "amber", host("obs.scene BRB")),
        k("Record", "circle-dot", "red", combo("LEFT_CTRL", "LEFT_ALT", "R"), toggle=True, anim="rec"),
        k("Mic", "mic", "green", tel("MIC_MUTE"), toggle=True, anim="pulse"),
        k("Cam off", "video-off", "slate", combo("LEFT_CTRL", "LEFT_ALT", "C"), toggle=True),
        k("Chat", "message-square", "violet", host("open https://www.twitch.tv/popout/chat")),
        k("Twitch", "twitch", "violet", host("open https://www.twitch.tv")),
        k("OBS", "obsstudio", "slate", host("open obs:")),
        k("Clip", "scissors", "magenta", combo("LEFT_CTRL", "LEFT_ALT", "K")),
        k("Marker", "flag", "orange", combo("LEFT_CTRL", "LEFT_ALT", "M")),
        k("Sounds", "music-2", "pink", page(3)),
        k("Media", "music", "pink", page(2)),
        k("Discord", "discord", "violet", host("open discord:")))},
    media_page(),
    {"name": "Sounds", "keys": grid(
        *[k(n, ic, t, combo("LEFT_CTRL", "LEFT_SHIFT", f"F{13 + i}")) for i, (n, ic, t) in enumerate(SOUNDS)],
        k("Stop all", "square", "red", combo("LEFT_CTRL", "LEFT_SHIFT", "F24")),
        k("Live", "radio-tower", "red", page(1)),
        k("Back", "arrow-left", "slate", back()))},
])

PROFILES = [DAILY, CODE, STREAM]


def main():
    out = ["// Generated by tools/gen_defaults.py. Do not edit.\n#pragma once\n#include <Arduino.h>\n"]
    for i, p in enumerate(PROFILES, 1):
        out.append(f'static const char DEFAULT_PROFILE{i}[] PROGMEM = R"JSON({json.dumps(p, separators=(",", ":"))})JSON";\n')
    out.append("static const char *const DEFAULT_PROFILES[] = { DEFAULT_PROFILE1, DEFAULT_PROFILE2, DEFAULT_PROFILE3 };\n")
    out.append(f"#define DEFAULT_PROFILE_COUNT {len(PROFILES)}\n")
    blob = "".join(json.dumps(p, separators=(",", ":")) for p in PROFILES).encode()
    out.append(f"#define DEFAULTS_VERSION 0x{zlib.crc32(blob):08x}u   // changes whenever a default changes\n")
    (ROOT / "firmware/TouchKeypad/defaults_gen.h").write_text("\n".join(out), encoding="utf-8")
    (ROOT / "docs/device").mkdir(parents=True, exist_ok=True)
    (ROOT / "docs/device/profiles.js").write_text(
        "/* Generated by tools/gen_defaults.py: the profiles the keypad ships with. */\n"
        f"window.DEFAULT_PROFILES = {json.dumps(PROFILES)};\n", encoding="utf-8")
    for p in PROFILES:
        n = sum(1 for pg in p["pages"] for kd in pg["keys"] if kd)
        print(f'{p["profile_name"]:7} {len(p["pages"])} pages, {n} keys, {len(json.dumps(p))} B')


if __name__ == "__main__":
    main()
