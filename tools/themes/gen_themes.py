"""The handoff's new themes, from one source: tools/themes/theme_tokens.json.

    python tools/themes/gen_themes.py    ->  firmware/TouchKeypad/themes_gen.h   (Theme entries)
                                              studio/renderer/themes_gen.css     (the preview's mirror)

Only the themes in NEW are generated: the six that ship already (glass, paper, daylight, aurora,
synth, retro) stay hand-tuned in themes.h and styles.css, because the token file restyles them and
they are in daily use. Firmware roles the tokens do not name are derived here, the same way for both
outputs, so the keypad and Studio show the same colours:

    ctlTop / ctlBot   control lifted / lowered (light: 45% to white, 4.5% to black; dark: 3% / 10%: on a
                      mid-tone control a bigger lift outshines the text)
    knob, knobBot     white on light themes, text.primary on dark ones; knobBot 12% darker
    onAccent          ink on a cyan or green fill: white when the accent is dark, else bar 30% darker
    shadow, shadowA   ground[2] 60% darker; 100 on light themes, 150 on dark (short and restrained)
    tagBg, card       bar, panel;  seg, swOff, segOff: control, track, well;  calBg, dimRet: ground[1], track
    hair              hairline at full strength (hairA 255): the token is an opaque hairline colour
    ink, lbl          text.primary;  art: accents.primary
    accent            accents.primary, unless it sits within dE76 25 of a state word (cyan, green, amber, red):
                      then accents.magenta, as in the six. Selection must not read as a state.
    txt2              text.secondary if it reads 4.5:1 on every text surface and sits 1.3:1 under text.primary;
                      else text.primary moved toward ground[1], as far as 4.6:1 everywhere allows (at most 1.5:1)
    txt3              text.primary moved toward ground[1] to 3:1 on it (disabled: dimmer than txt2, not 4.5:1)
    crisp             the pixel key style only (Retro's square controls and 2 px rules); the token's flag is not read

The generator fails loudly when a theme breaks the State Word Rule (accent) or the text hierarchy.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TOKENS = ROOT / "tools" / "themes" / "theme_tokens.json"
OUT_H = ROOT / "firmware" / "TouchKeypad" / "themes_gen.h"
OUT_CSS = ROOT / "studio" / "renderer" / "themes_gen.css"
NEW = ["nordic_calm", "focus_slate", "forest_field", "ember_atelier"]   # appended in this order: NVS stores the index
KS = {"glass": "KS_GLASS", "paper": "KS_PAPER", "frost": "KS_FROST", "pane": "KS_PANE", "flat": "KS_FLAT", "pixel": "KS_PIXEL"}
TEXTURE = {"none": 0, "laid_paper": 1, "lcd_rows_subtle": 2}


def rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def hexs(c):
    return "#%02x%02x%02x" % c


def mix(a, b, t):   # t: 0 = a, 1 = b
    return tuple(round(x + (y - x) * t) for x, y in zip(a, b))


def luma(c):
    return (c[0] * 77 + c[1] * 150 + c[2] * 29) >> 8


WHITE, BLACK = (255, 255, 255), (0, 0, 0)
STATE_WORDS = ("cyan", "green", "amber", "red")
TEXT_ON = ("g0", "g1", "g2", "ply", "ply2", "card", "ctl", "ctlTop", "ctlBot", "bar")   # every surface text is set on


def lum(c):   # WCAG relative luminance, as ui.cpp's relLum()
    f = lambda v: v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    r, g, b = (f(x / 255) for x in c)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(a, b):
    x, y = lum(a), lum(b)
    return (max(x, y) + 0.05) / (min(x, y) + 0.05)


def de(a, b):   # CIE76 dE between two sRGB colours (D65)
    def lab(c):
        f = lambda v: v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
        r, g, b = (f(x / 255) for x in c)
        xyz = ((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047, 0.2126 * r + 0.7152 * g + 0.0722 * b, (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883)
        X, Y, Z = (v ** (1 / 3) if v > 0.008856 else 7.787 * v + 16 / 116 for v in xyz)
        return 116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)
    return sum((p - q) ** 2 for p, q in zip(lab(a), lab(b))) ** .5


def worst(r, role):   # (lowest contrast of a text role over the surfaces it sits on, that surface)
    return min((contrast(r[role], r["g"][int(s[1])] if s in ("g0", "g1", "g2") else r[s]), s) for s in TEXT_ON)


def accent_of(a):
    for k in ("primary", "magenta"):
        if min(de(a[k], a[s]) for s in STATE_WORDS) >= 25:
            return a[k]
    return a["magenta"]   # check() names the clash


def roles(t):
    light = t["light"]
    g = [rgb(x) for x in t["ground"]]
    ctl, bar, well, track, hair = (rgb(t[k]) for k in ("control", "bar", "well", "track", "hairline"))
    tp, ts = rgb(t["text"]["primary"]), rgb(t["text"]["secondary"])
    a = {k: rgb(v) for k, v in t["accents"].items()}
    knob = WHITE if light else tp
    r = {
        "g": g, "ply": rgb(t["sheet"]), "ply2": rgb(t["shade"]), "well": well, "wellEdge": hair,
        "ctl": ctl, "ctlTop": mix(ctl, WHITE, .45 if light else .03), "ctlBot": mix(ctl, BLACK, .045 if light else .10),
        "track": track, "hair": hair, "hairA": 255, "txt": tp, "txt2": ts, "txt3": tp, "lbl": tp,
        "cyan": a["cyan"], "mag": a["magenta"], "green": a["green"], "amber": a["amber"], "red": a["red"], "slate": a["slate"],
        "onAccent": WHITE if luma(a["cyan"]) < 150 else mix(bar, BLACK, .30),
        "tagBg": bar, "card": rgb(t["panel"]), "seg": ctl, "swOff": track, "segOff": well, "knob": knob, "knobBot": mix(knob, BLACK, .12),
        "calBg": g[1], "dimRet": track, "shadow": mix(g[2], BLACK, .60), "shadowA": 100 if light else 150,
        "ink": tp, "art": a["primary"], "keyR": t["key_radius"], "accent": accent_of(a), "bar": bar,
        "crisp": t["key_style"] == "pixel",
    }
    if worst(r, "txt2")[0] < 4.5 or contrast(tp, ts) < 1.3:   # the token's secondary is too faint or too close to primary
        for s in range(1, 101):
            m = mix(tp, g[1], s / 100)
            if worst(dict(r, txt2=m), "txt2")[0] < 4.6 or contrast(tp, m) > 1.5:
                break
            r["txt2"] = m
    for s in range(1, 101):
        r["txt3"] = mix(tp, g[1], s / 100)
        if contrast(r["txt3"], g[1]) <= 3.0:
            break
    return r


def check(t, r):
    """The rules the four must keep (firmware/DESIGN.md: the State Word Rule, the text hierarchy). Returns its table."""
    errs, rows = [], []
    for s in STATE_WORDS:
        d = de(r["accent"], r[s])
        rows.append((f"accent {hexs(r['accent'])} vs {s} {hexs(r[s])}", d, "dE"))
        if d < 25: errs.append(f"accent {hexs(r['accent'])} is dE {d:.1f} from {s} {hexs(r[s])}: selection would read as a state word")
    for role in ("txt", "txt2", "lbl"):
        c, s = worst(r, role)
        rows.append((f"{role} {hexs(r[role])} on {s} (worst of {len(TEXT_ON)})", c, ":1"))
        if c < 4.5: errs.append(f"{role} {hexs(r[role])} reads {c:.2f}:1 on {s}, under 4.5:1")
    tt = contrast(r["txt"], r["txt2"])
    rows.append(("txt / txt2", tt, ":1 (aim 1.3)"))
    if r["txt2"] == r["txt"]: errs.append("txt2 equals txt: no hierarchy")
    c2, c3 = contrast(r["txt2"], r["g"][1]), contrast(r["txt3"], r["g"][1])
    rows.append((f"txt3 {hexs(r['txt3'])} on g1 (txt2 {c2:.2f})", c3, ":1"))
    if c3 >= c2: errs.append(f"txt3 {hexs(r['txt3'])} is not dimmer than txt2 on g1 ({c3:.2f} vs {c2:.2f})")
    if errs:
        sys.exit(f"gen_themes: {t['id']} breaks the theme rules:\n  " + "\n  ".join(errs))
    return rows


def c_entry(t, r):
    H = lambda c: "HEXC(0x%02x%02x%02x)" % c
    j = lambda *cs: ", ".join(H(c) for c in cs)
    return (f'  // {t["name"]}: {t["description"]}\n'
            f'  {{ "{t["id"]}", "{t["name"]}", {KS[t["key_style"]]}, {str(t["light"]).lower()}, {str(r["crisp"]).lower()}, {TEXTURE[t["texture"]]},\n'
            f'    {j(*r["g"])},\n    {j(r["ply"], r["ply2"])},\n    {j(r["well"], r["wellEdge"])},\n'
            f'    {j(r["ctl"], r["ctlTop"], r["ctlBot"])},\n    {j(r["track"], r["hair"])}, {r["hairA"]},\n'
            f'    {j(r["txt"], r["txt2"], r["txt3"], r["lbl"])},\n'
            f'    {j(r["cyan"], r["mag"], r["green"], r["amber"], r["red"], r["slate"])},\n    {j(r["onAccent"])},\n'
            f'    {j(r["tagBg"], r["card"], r["seg"], r["swOff"], r["segOff"], r["knob"], r["knobBot"])},\n'
            f'    {j(r["calBg"], r["dimRet"])},\n    {j(r["shadow"])}, {r["shadowA"]},\n'
            f'    {j(r["ink"], r["art"])}, {r["keyR"]},\n    {j(r["accent"], r["bar"])}, false }},\n')


def on_tag_ink(r):   # ui.cpp onTagInk(): the ON tag's word on its green
    if contrast(r["onAccent"], r["green"]) >= 4.5:
        return r["onAccent"]
    dark = (0x06, 0x20, 0x12)
    return WHITE if contrast(WHITE, r["green"]) >= contrast(dark, r["green"]) else dark


def css_entry(t, r):
    s, x, R = f'.dev[data-theme="{t["id"]}"]', hexs, r["keyR"]
    sh = "rgba(%d, %d, %d, %s)" % (*r["shadow"], ".45" if t["light"] else ".6")
    keys = f'{s} .key, {s} .art, {s} .ctl span'
    out = [f'/* {t["name"]}: {t["description"]} */',
           f'{s} {{ --ks: {t["key_style"]}; --light: {int(t["light"])};',
           f'  --dg0: {x(r["g"][0])}; --dg1: {x(r["g"][1])}; --dg2: {x(r["g"][2])}; --txt: {x(r["txt"])}; --txt-2: {x(r["txt2"])}; --lbl: {x(r["lbl"])};',
           f'  --cyan: {x(r["cyan"])}; --mag: {x(r["mag"])}; --green: {x(r["green"])}; --amber: {x(r["amber"])}; --hair: {x(r["hair"])}; --hair-2: {x(r["hair"])};',
           f'  --well: {x(r["well"])}; --track: {x(r["track"])}; --tag-bg: {x(r["tagBg"])}; --gear-top: {x(r["ctlTop"])}; --gear-bot: {x(r["ctlBot"])};',
           f'  --knob: {x(r["knob"])}; --ink: {x(r["ink"])}; --art: {x(r["art"])}; --accent: {x(r["accent"])}; --bar: {x(r["bar"])};',
           f'  background: linear-gradient(180deg, var(--dg0), var(--dg1) 50%, var(--dg2)); }}',
           f'{s} .tag.on {{ color: {x(on_tag_ink(r))}; }}']
    ks = t["key_style"]
    if ks == "frost":
        out += [f'{keys} {{ border-radius: {R}px; background: linear-gradient(180deg, {x(r["ctlTop"])}, {x(r["ctlBot"])}); color: color-mix(in oklab, var(--t) 70%, #000);',
                f'  box-shadow: inset 0 0 0 1px {x(r["hair"])}, 0 10px 14px -12px {sh}; }}',
                f'{s} .cell.on .key, {s} .ctl .play {{ background: linear-gradient(180deg, color-mix(in oklab, var(--t) 40%, #fff), var(--t)); color: #fff; }}',
                f'{s} .well {{ border-radius: {R}px; box-shadow: inset 0 1px 2px {sh}, inset 0 0 0 1px {x(r["hair"])}; }}',
                f'{s} .key::before {{ display: none; }}']
    elif ks == "pane":
        out += [f'{keys} {{ border-radius: {R}px; background: linear-gradient(180deg, rgba(255, 255, 255, .22), rgba(255, 255, 255, .1)); color: color-mix(in oklab, var(--t) 49%, #fff);',
                f'  box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--t) 60%, #fff), 0 8px 12px -10px {sh}; }}',
                f'{s} .cell.on .key, {s} .ctl .play {{ background: linear-gradient(180deg, color-mix(in oklab, var(--t) 78%, transparent), color-mix(in oklab, var(--t) 59%, transparent)); color: #fff; }}',
                f'{s} .well {{ border-radius: {R}px; background: rgba(255, 255, 255, .06); box-shadow: inset 0 0 0 1px {x(r["hair"])}; }}',
                f'{s} .key::before {{ background: linear-gradient(180deg, rgba(255, 255, 255, .12), transparent); }}']
    elif ks == "flat":
        edge, side = mix(r["ctlBot"], BLACK, 87 / 255), mix(r["ctlBot"], BLACK, 77 / 255)
        out += [f'{keys} {{ border-radius: {R}px; background: linear-gradient(180deg, {x(r["ctlTop"])}, {x(r["ctlBot"])}); color: var(--ink);',
                f'  box-shadow: inset 0 0 0 1px {x(edge)}, 0 3px 0 0 {x(side)}; }}',
                f'{s} .ctl span {{ border-radius: 50%; }}', f'{s} .ctl .play {{ color: var(--accent); }}',
                f'{s} .key::before, {s} .art::before {{ content: ""; display: block; position: absolute; inset: auto; left: 10px; top: 10px; width: 7px; height: 7px; border-radius: 50%; background: var(--t); }}',
                f'{s} .art {{ --t: var(--art); }}',
                f'{s} .well {{ border-radius: {R}px; box-shadow: inset 0 1px 2px {sh}, inset 0 0 0 1px {x(r["hair"])}; }}']
    elif ks == "paper":
        out += [f'{keys} {{ border-radius: {R}px; --card: color-mix(in oklab, var(--t) 82%, {x(r["g"][1])});',
                f'  background: linear-gradient(180deg, color-mix(in oklab, var(--card) 88%, #fff), var(--card));',
                f'  box-shadow: inset 0 0 0 1.4px color-mix(in oklab, var(--t) 40%, #000), 3px 3px 0 0 color-mix(in oklab, var(--t) 51%, #000); }}',
                f'{s} .ctl span {{ border-radius: 50%; color: var(--ink); }}', f'{s} .art {{ --t: var(--art); color: var(--ink); }}',
                f'{s} .well {{ border-radius: {R}px; box-shadow: inset 0 1px 2px {sh}, inset 0 0 0 1px {x(r["hair"])}; }}',
                f'{s} .key::before {{ display: none; }}']
    out += [f'{s} .key > svg {{ filter: none; }}', f'{s}.chip .key {{ --kr: {R}; }}', ""]
    return "\n".join(out)


def main():
    tok = json.loads(TOKENS.read_text(encoding="utf-8"))
    by_id = {t["id"]: t for t in tok["themes"]}
    head = "Generated by tools/themes/gen_themes.py from tools/themes/theme_tokens.json. Do not edit."
    h = [f"// {head}\n// Included inside THEMES[] in themes.h, after the six hand-tuned themes (NVS stores the index).\n"]
    css = [f"/* {head} The keypad's mirror: firmware/TouchKeypad/themes_gen.h */\n"]
    for tid in NEW:
        t = by_id[tid]
        r = roles(t)
        rows = check(t, r)
        print(f"{t['name']}: crisp {str(r['crisp']).lower()}"
              + ("" if r["accent"] == rgb(t["accents"]["primary"]) else f"; accent magenta: primary {t['accents']['primary']} reads as a state word"))
        for name, v, unit in rows:
            print(f"  {name:<44} {v:6.2f} {unit}")
        h.append(c_entry(t, r))
        css.append(css_entry(t, r))
    OUT_H.write_text("".join(h), encoding="utf-8", newline="\n")
    OUT_CSS.write_text("\n".join(css), encoding="utf-8", newline="\n")
    print(f"{len(NEW)} themes -> {OUT_H.name}, {OUT_CSS.name}")


if __name__ == "__main__":
    main()
