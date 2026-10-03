"""Per-app keypad profiles built from each app's documented default Windows shortcuts.

    python tools/profiles/app_profiles.py            # writes profiles/apps/<app>.json
    python tools/profiles/app_profiles.py install    # also loads them on the keypad (USB) and maps
                                                     # each app in Studio for auto-switching

Sources (2026-10-02): VS Code keyboard reference, Google Chrome Help "Chrome keyboard
shortcuts", Slack help (Ctrl+/ list), Microsoft Learn "Windows Terminal" panes and
actions, Signal support "Signal Desktop Keyboard Shortcuts", the Claude desktop app's
Ctrl+/ panel, Windows 11 File Explorer shortcuts, Notepad++ Shortcut Mapper defaults,
Bruno docs "Keybindings". Studio must be closed for `install` (it holds the USB port).
"""
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "profiles" / "apps"
STUDIO_DATA = Path(os.environ.get("APPDATA", "")) / "Macropad Studio (Touch Keypad)" / "data"

MOD = {"CTRL": "LEFT_CTRL", "SHIFT": "LEFT_SHIFT", "ALT": "LEFT_ALT", "WIN": "LEFT_GUI"}
KEY = {"`": "TILDE", "/": "SLASH", "\\": "BACKSLASH", ",": "COMMA", "=": "EQUAL", "-": "MINUS", "[": "LEFT_BRACE",
       "]": "RIGHT_BRACE", ";": "SEMICOLON", "UP": "UP_ARROW", "DOWN": "DOWN_ARROW", "LEFT": "LEFT_ARROW",
       "RIGHT": "RIGHT_ARROW", "PGUP": "PAGEUP", "PGDN": "PAGEDOWN", "DEL": "DELETE", "BKSP": "BACKSPACE"}
LED = [[79, 140, 255], [82, 214, 143], [63, 198, 224], [242, 183, 70], [155, 123, 255], [255, 111, 174], [138, 152, 171]]


def chord(s):
    """'CTRL+SHIFT+P' -> keycombo; 'F2' -> key; 'CTRL+K Z' -> keycombo then key (a chord sequence)."""
    acts = []
    for part in s.split(" "):
        names = [MOD.get(t, KEY.get(t, t)) for t in part.split("+")]
        acts.append({"type": "keycombo", "keys": names} if len(names) > 1 else {"type": "key", "value": names[0]})
    return acts


def palette(command):
    """VS Code's Command Palette: open it, type the command's name, run the top match."""
    return [{"type": "keycombo", "keys": ["LEFT_CTRL", "LEFT_SHIFT", "P"]}, {"type": "delay", "ms": 350},
            {"type": "text", "value": command}, {"type": "delay", "ms": 250}, {"type": "key", "value": "ENTER"}]


def folder(n):   # a key that opens page n (1-based): the keypad draws it as a stack
    return [{"type": "page", "value": n}]


BACK = [{"type": "back"}]


def page(name, keys, back=False):
    """keys: (label, icon, chord string or action list); back=True puts Back in the last cell."""
    cells = [None] * 15
    for i, (label, icon, keys_) in enumerate(keys):
        assert len(label) <= 14, label
        cells[i] = {"id": i + 1, "name": label, "icon": icon, "led_color": LED[i % len(LED)],
                    "actions": keys_ if isinstance(keys_, list) else chord(keys_)}
    if back:
        cells[14] = {"id": 15, "name": "Back", "icon": "arrow-left", "led_color": [138, 152, 171], "actions": BACK}
    return {"name": name, "keys": cells}


def profile(name, color, *pages):
    return {"schema_version": 2, "profile_name": name, "color": color, "default_delay": 20, "pages": list(pages)}


APPS = {   # context key (Studio auto-switch): (slot, profile)
    "vscode": (5, profile("VS Code", [63, 150, 255],
        page("Edit", [("Commands", "search", "CTRL+SHIFT+P"), ("Go to file", "file", "CTRL+P"), ("Find", "search", "CTRL+F"),
                      ("Find in files", "files", "CTRL+SHIFT+F"), ("Git", "git-branch", folder(3)), ("Replace", "repeat", "CTRL+H"),
                      ("Comment", "code", "CTRL+/"), ("Format", "wand-sparkles", "SHIFT+ALT+F"), ("Rename", "pen-line", "F2"),
                      ("Go to def", "arrow-right", "F12"), ("Go back", "arrow-left", "ALT+LEFT"), ("Next match", "plus", "CTRL+D"),
                      ("Line up", "arrow-up", "ALT+UP"), ("Line down", "arrow-down", "ALT+DOWN"), ("Terminal", "square-terminal", "CTRL+`")]),
        page("View", [("Sidebar", "layout-grid", "CTRL+B"), ("Explorer", "folder", "CTRL+SHIFT+E"), ("Extensions", "sliders-horizontal", "CTRL+SHIFT+X"),
                      ("Split", "app-window", "CTRL+\\"), ("Debug", "bug", folder(4)), ("Close tab", "x", "CTRL+W"),
                      ("Reopen tab", "undo-2", "CTRL+SHIFT+T"), ("Zen mode", "maximize", "CTRL+K Z"), ("Settings", "settings", "CTRL+,"),
                      ("Save all", "save", "CTRL+K S"), ("All matches", "layers", "CTRL+SHIFT+L"), ("Dup line", "copy", "SHIFT+ALT+DOWN"),
                      ("Problems", "list-checks", "CTRL+SHIFT+M"), ("Zoom in", "plus", "CTRL+="), ("Zoom out", "minus", "CTRL+-")]),
        # The Git folder: VS Code's own Git commands, by name through the Command Palette.
        page("Git", [("Changes", "git-pull-request", "CTRL+SHIFT+G"), ("Pull", "download", palette("Git: Pull")),
                     ("Push", "upload", palette("Git: Push")), ("Sync", "refresh-cw", palette("Git: Sync")),
                     ("Fetch", "cloud", palette("Git: Fetch")), ("Stage all", "list-checks", palette("Git: Stage All Changes")),
                     ("Commit", "git-commit-horizontal", palette("Git: Commit")), ("Stash", "layers", palette("Git: Stash")),
                     ("Pop stash", "undo-2", palette("Git: Pop Latest Stash")), ("Checkout", "git-branch", palette("Git: Checkout to...")),
                     ("New branch", "plus", palette("Git: Create Branch...")), ("Merge", "git-merge", palette("Git: Merge Branch...")),
                     ("Open changes", "files", palette("Git: Open Changes")), ("Git output", "terminal", palette("Git: Show Git Output"))], back=True),
        page("Debug", [("Start", "play", "F5"), ("Run", "rocket", "CTRL+F5"), ("Stop", "square", "SHIFT+F5"),
                       ("Restart", "rotate-ccw", "CTRL+SHIFT+F5"), ("Breakpoint", "circle-dot", "F9"), ("Step over", "arrow-right", "F10"),
                       ("Step into", "arrow-down", "F11"), ("Step out", "arrow-up", "SHIFT+F11"), ("Debug view", "bug", "CTRL+SHIFT+D"),
                       ("Debug console", "terminal", "CTRL+SHIFT+Y")], back=True))),
    "chrome": (6, profile("Chrome", [242, 183, 70],
        page("Tabs", [("New tab", "plus", "CTRL+T"), ("Close tab", "x", "CTRL+W"), ("Reopen tab", "undo-2", "CTRL+SHIFT+T"),
                      ("Next tab", "chevron-right", "CTRL+TAB"), ("Prev tab", "chevron-left", "CTRL+SHIFT+TAB"), ("Address bar", "globe", "CTRL+L"),
                      ("Find", "search", "CTRL+F"), ("Back", "arrow-left", "ALT+LEFT"), ("Forward", "arrow-right", "ALT+RIGHT"),
                      ("Reload", "refresh-cw", "CTRL+R"), ("Hard reload", "rotate-ccw", "CTRL+F5"), ("Bookmark", "bookmark", "CTRL+D"),
                      ("Incognito", "eye-off", "CTRL+SHIFT+N"), ("New window", "app-window", "CTRL+N"), ("DevTools", "code", "F12")]),
        page("More", [("History", "clock", "CTRL+H"), ("Downloads", "download", "CTRL+J"), ("Bookmark bar", "list", "CTRL+SHIFT+B"),
                      ("Zoom in", "plus", "CTRL+="), ("Zoom out", "minus", "CTRL+-"), ("Zoom reset", "search", "CTRL+0"),
                      ("Full screen", "maximize", "F11"), ("First tab", "chevrons-left", "CTRL+1"), ("Last tab", "chevrons-right", "CTRL+9"),
                      ("Print", "printer", "CTRL+P"), ("Save page", "save", "CTRL+S"), ("View source", "code-xml", "CTRL+U"),
                      ("Task manager", "cpu", "SHIFT+ESC"), ("Clear data", "trash-2", "CTRL+SHIFT+DEL")]))),
    "slack": (7, profile("Slack", [155, 123, 255],
        page("Slack", [("Jump to", "search", "CTRL+K"), ("DMs", "message-circle", "CTRL+SHIFT+K"), ("Channels", "list", "CTRL+SHIFT+L"),
                       ("Threads", "message-square", "CTRL+SHIFT+T"), ("Mentions", "at-sign", "CTRL+SHIFT+M"), ("Next unread", "arrow-down", "ALT+SHIFT+DOWN"),
                       ("Prev unread", "arrow-up", "ALT+SHIFT+UP"), ("Find here", "search", "CTRL+F"), ("Mark read", "check", "ESC"),
                       ("Saved", "bookmark", "CTRL+SHIFT+S"), ("Set status", "user", "CTRL+SHIFT+Y"), ("Channel info", "info", "CTRL+SHIFT+I"),
                       ("Emoji", "sparkles", "CTRL+SHIFT+\\"), ("Huddle", "headphones", "CTRL+SHIFT+H"), ("Shortcuts", "keyboard", "CTRL+/")]),
        page("Format", [("Bold", "bold", "CTRL+B"), ("Italic", "italic", "CTRL+I"), ("Strike", "minus", "CTRL+SHIFT+X"),
                        ("Quote", "message-square", "CTRL+SHIFT+9"), ("Bullets", "list", "CTRL+SHIFT+8"), ("Code", "code", "CTRL+SHIFT+C"),
                        ("Code block", "braces", "CTRL+ALT+SHIFT+C"), ("Link", "link", "CTRL+SHIFT+U"), ("Upload", "upload", "CTRL+U"),
                        ("People", "users", "CTRL+SHIFT+E"), ("Preferences", "settings", "CTRL+,")]))),
    "terminal": (8, profile("Terminal", [82, 214, 143],
        page("Panes", [("New tab", "plus", "CTRL+SHIFT+T"), ("Split right", "app-window", "ALT+SHIFT+="), ("Split down", "layout-grid", "ALT+SHIFT+-"),
                       ("Split auto", "layers", "ALT+SHIFT+D"), ("Focus left", "arrow-left", "ALT+LEFT"), ("Focus right", "arrow-right", "ALT+RIGHT"),
                       ("Focus up", "arrow-up", "ALT+UP"), ("Focus down", "arrow-down", "ALT+DOWN"), ("Next tab", "chevron-right", "CTRL+TAB"),
                       ("Prev tab", "chevron-left", "CTRL+SHIFT+TAB"), ("Find", "search", "CTRL+SHIFT+F"), ("Copy", "copy", "CTRL+SHIFT+C"),
                       ("Paste", "clipboard-paste", "CTRL+SHIFT+V"), ("Commands", "terminal", "CTRL+SHIFT+P"), ("Interrupt", "square", "CTRL+C")]),
        page("More", [("Close pane", "x", "CTRL+SHIFT+W"), ("Duplicate tab", "copy", "CTRL+SHIFT+D"), ("New window", "app-window", "CTRL+SHIFT+N"),
                      ("Tab 1", "chevrons-left", "CTRL+ALT+1"), ("Tab 2", "chevron-right", "CTRL+ALT+2"), ("Settings", "settings", "CTRL+,"),
                      ("Zoom in", "plus", "CTRL+="), ("Zoom out", "minus", "CTRL+-"), ("Zoom reset", "search", "CTRL+0"),
                      ("Scroll up", "chevrons-left", "CTRL+SHIFT+UP"), ("Scroll down", "chevrons-right", "CTRL+SHIFT+DOWN"), ("Full screen", "maximize", "F11")]))),
    "signal": (9, profile("Signal", [63, 120, 255],
        page("Signal", [("Search", "search", "CTRL+F"), ("Next chat", "arrow-down", "ALT+DOWN"), ("Prev chat", "arrow-up", "ALT+UP"),
                        ("Next unread", "chevrons-right", "ALT+SHIFT+DOWN"), ("Prev unread", "chevrons-left", "ALT+SHIFT+UP"), ("Latest", "check", "CTRL+J"),
                        ("Attach", "upload", "CTRL+U"), ("Big composer", "maximize", "CTRL+SHIFT+K"), ("Edit last", "pen-line", "UP"),
                        ("React", "heart", "CTRL+SHIFT+E"), ("Bold", "bold", "CTRL+B"), ("Italic", "italic", "CTRL+I"),
                        ("Monospace", "code", "CTRL+E"), ("Mute call", "mic-off", "SHIFT+M"), ("Preferences", "settings", "CTRL+,")]),
        page("More", [("Chat 1", "message-circle", "CTRL+1"), ("Chat 2", "message-circle", "CTRL+2"), ("Chat 3", "message-circle", "CTRL+3"),
                      ("Sections", "layout-grid", "CTRL+T"), ("Save file", "download", "CTRL+S"), ("Forward", "send", "CTRL+SHIFT+S"),
                      ("Strike", "minus", "CTRL+SHIFT+X"), ("Spoiler", "eye-off", "CTRL+SHIFT+B"), ("New line", "type", "SHIFT+ENTER"),
                      ("Zoom in", "plus", "CTRL+="), ("Zoom out", "minus", "CTRL+-")]))),
    "claude": (10, profile("Claude", [217, 119, 87],
        page("Claude", [("New session", "plus", "CTRL+N"), ("Close", "x", "CTRL+W"), ("Next", "chevron-right", "CTRL+TAB"),
                        ("Previous", "chevron-left", "CTRL+SHIFT+TAB"), ("Stop", "square", "ESC"), ("Shortcuts", "keyboard", "CTRL+/"),
                        ("Diff pane", "files", "CTRL+SHIFT+D"), ("Browser pane", "globe", "CTRL+SHIFT+B"), ("Terminal pane", "square-terminal", "CTRL+`"),
                        ("Side chat", "message-square", "CTRL+;"), ("Model", "cpu", "CTRL+SHIFT+I"), ("Effort", "sliders-horizontal", "CTRL+SHIFT+E"),
                        ("Permissions", "shield", "CTRL+SHIFT+M"), ("View mode", "eye", "CTRL+O"), ("Close pane", "minimize", "CTRL+\\")]))),
    "explorer": (11, profile("Explorer", [242, 200, 70],
        page("Files", [("New window", "app-window", "CTRL+N"), ("New folder", "folder", "CTRL+SHIFT+N"), ("Rename", "pen-line", "F2"),
                       ("Address bar", "link", "ALT+D"), ("Search", "search", "CTRL+E"), ("Up", "arrow-up", "ALT+UP"),
                       ("Back", "arrow-left", "ALT+LEFT"), ("Forward", "arrow-right", "ALT+RIGHT"), ("Copy", "copy", "CTRL+C"),
                       ("Cut", "scissors", "CTRL+X"), ("Paste", "clipboard-paste", "CTRL+V"), ("Select all", "list-checks", "CTRL+A"),
                       ("Properties", "info", "ALT+ENTER"), ("Preview", "eye", "ALT+P"), ("Details pane", "layout-grid", "ALT+SHIFT+P")]),
        page("View", [("New tab", "plus", "CTRL+T"), ("Close tab", "x", "CTRL+W"), ("Next tab", "chevron-right", "CTRL+TAB"),
                      ("Prev tab", "chevron-left", "CTRL+SHIFT+TAB"), ("Details", "list", "CTRL+SHIFT+6"), ("Large icons", "image", "CTRL+SHIFT+2"),
                      ("List", "list-checks", "CTRL+SHIFT+5"), ("Refresh", "refresh-cw", "F5"), ("Open Explorer", "folder-open", "WIN+E"),
                      ("Undo", "undo-2", "CTRL+Z"), ("Copy path", "clipboard", "CTRL+SHIFT+C"), ("To bin", "trash-2", "DEL")]))),
    "notepadpp": (12, profile("Notepad++", [130, 200, 90],
        page("Main", [("New", "file", "CTRL+N"), ("Open", "folder-open", "CTRL+O"), ("Save", "save", "CTRL+S"),
                      ("Save all", "files", "CTRL+SHIFT+S"), ("Reopen tab", "undo-2", "CTRL+SHIFT+T"), ("Find", "search", "CTRL+F"),
                      ("Replace", "repeat", "CTRL+H"), ("Find in files", "files", "CTRL+SHIFT+F"), ("Go to line", "arrow-right", "CTRL+G"),
                      ("Dup line", "copy", "CTRL+D"), ("Comment", "code", "CTRL+Q"), ("Prev tab", "chevron-left", "CTRL+PGUP"),
                      ("Next tab", "chevron-right", "CTRL+PGDN"), ("Undo", "undo-2", "CTRL+Z"), ("Redo", "redo-2", "CTRL+Y")]),
        page("Edit", [("Line up", "arrow-up", "CTRL+SHIFT+UP"), ("Line down", "arrow-down", "CTRL+SHIFT+DOWN"), ("UPPERCASE", "type", "CTRL+SHIFT+U"),
                      ("lowercase", "type", "CTRL+U"), ("Bookmark", "bookmark", "CTRL+F2"), ("Next mark", "chevron-right", "F2"),
                      ("Prev mark", "chevron-left", "SHIFT+F2"), ("Find next", "arrow-down", "F3"), ("Find prev", "arrow-up", "SHIFT+F3"),
                      ("Match brace", "braces", "CTRL+B"), ("Record macro", "circle-dot", "CTRL+SHIFT+R"), ("Play macro", "play", "CTRL+SHIFT+P"),
                      ("Full screen", "maximize", "F11"), ("Close tab", "x", "CTRL+W"), ("Delete line", "trash-2", "CTRL+SHIFT+L")]))),
    "bruno": (13, profile("Bruno", [240, 160, 60],
        page("Bruno", [("Send", "send", "CTRL+ENTER"), ("New request", "plus", "CTRL+N"), ("Save", "save", "CTRL+S"),
                       ("Save all", "files", "CTRL+SHIFT+S"), ("Environment", "settings", "CTRL+E"), ("Search", "search", "CTRL+K"),
                       ("Find sidebar", "list", "CTRL+F"), ("Clone", "copy", "CTRL+D"), ("Rename", "pen-line", "CTRL+R"),
                       ("Close tab", "x", "CTRL+W"), ("Reopen tab", "undo-2", "CTRL+SHIFT+T"), ("Prev tab", "chevron-left", "CTRL+SHIFT+["),
                       ("Next tab", "chevron-right", "CTRL+SHIFT+]"), ("Sidebar", "layout-grid", "CTRL+\\"), ("Layout", "app-window", "CTRL+J")]),
        page("More", [("Import", "download", "CTRL+O"), ("Terminal", "square-terminal", "CTRL+T"), ("Preferences", "sliders-horizontal", "CTRL+,"),
                      ("Zoom in", "plus", "CTRL+="), ("Zoom out", "minus", "CTRL+-"), ("Zoom reset", "search", "CTRL+0"),
                      ("First tab", "chevrons-left", "CTRL+1"), ("Last tab", "chevrons-right", "CTRL+9"), ("Tab left", "arrow-left", "CTRL+["),
                      ("Tab right", "arrow-right", "CTRL+]"), ("Close all", "x", "CTRL+SHIFT+W")]))),
}


def write():
    OUT.mkdir(parents=True, exist_ok=True)
    for key, (slot, p) in APPS.items():
        (OUT / f"{key}.json").write_text(json.dumps(p, indent=1) + "\n", encoding="utf-8")
    print(f"{len(APPS)} profiles -> {OUT}")


def install():
    sys.path.insert(0, str(ROOT / "tools"))
    import kp
    d = kp.Device()
    d.ready(10)
    for key, (slot, p) in APPS.items():
        r = d.upload_text(f"profile{slot}.json", json.dumps(p, indent=1))   # short lines, like Studio: a CLI line holds 8 KB
        assert any(l.startswith("SAVED") for l in r), (key, r)
        print(f"profile {slot}: {p['profile_name']}")
    d.close()
    # Studio: map each app for auto-switching, and keep a copy so Generate restores a cleared slot.
    sf = STUDIO_DATA / "settings.json"
    s = json.loads(sf.read_text(encoding="utf-8"))
    s.setdefault("context_profiles", {}).update({key: slot for key, (slot, _) in APPS.items()})
    sf.write_text(json.dumps(s, indent=2), encoding="utf-8")
    cache = STUDIO_DATA / "autogen"
    cache.mkdir(exist_ok=True)
    for key, (slot, p) in APPS.items():
        (cache / f"{key}.json").write_text(json.dumps(p, indent=1), encoding="utf-8")
    print("Studio: context_profiles", s["context_profiles"])


if __name__ == "__main__":
    write()
    if sys.argv[1:] == ["install"]:
        install()
