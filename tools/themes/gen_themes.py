"""The handoff's new themes, from one source: tools/themes/theme_tokens.json.

    python tools/themes/gen_themes.py    ->  firmware/TouchKeypad/themes_gen.h   (Theme entries)
                                              studio/renderer/themes_gen.css     (the preview's mirror)

Only the themes in NEW are generated: the six that ship already (glass, paper, daylight, aurora,
synth, retro) stay hand-tuned in themes.h and styles.css, because the token file restyles them and
they are in daily use. Firmware roles the tokens do not name are derived here, the same way for both
outputs, so the keypad and Studio show the same colours:

    ctlTop / ctlBot   control lifted / lowered (light: 45% to white, 4.5% to black; dark: 12% / 10%)
    knob, knobBot     white on light themes, text.primary on dark ones; knobBot 12% darker
    onAccent          ink on a cyan or green fill: white when the accent is dark, else bar 30% darker
    shadow, shadowA   ground[2] 60% darker; 100 on light themes, 150 on dark (short and restrained)
    tagBg, card       bar, panel;  seg, swOff, segOff: control, track, well;  calBg, dimRet: ground[1], track
    hair              hairline at full strength (hairA 255): the token is an opaque hairline colour
    ink, lbl          text.primary;  art: accents.primary
"""
import json
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


def roles(t):
    light = t["light"]
    g = [rgb(x) for x in t["ground"]]
    ctl, bar, well, track, hair = (rgb(t[k]) for k in ("control", "bar", "well", "track", "hairline"))
    tp, ts, tm = (rgb(t["text"][k]) for k in ("primary", "secondary", "muted"))
    a = {k: rgb(v) for k, v in t["accents"].items()}
    knob = WHITE if light else tp
    return {
        "g": g, "ply": rgb(t["sheet"]), "ply2": rgb(t["shade"]), "well": well, "wellEdge": hair,
        "ctl": ctl, "ctlTop": mix(ctl, WHITE, .45 if light else .12), "ctlBot": mix(ctl, BLACK, .045 if light else .10),
        "track": track, "hair": hair, "hairA": 255, "txt": tp, "txt2": ts, "txt3": tm, "lbl": tp,
        "cyan": a["cyan"], "mag": a["magenta"], "green": a["green"], "amber": a["amber"], "red": a["red"], "slate": a["slate"],
        "onAccent": WHITE if luma(a["cyan"]) < 150 else mix(bar, BLACK, .30),
        "tagBg": bar, "card": rgb(t["panel"]), "seg": ctl, "swOff": track, "segOff": well, "knob": knob, "knobBot": mix(knob, BLACK, .12),
        "calBg": g[1], "dimRet": track, "shadow": mix(g[2], BLACK, .60), "shadowA": 100 if light else 150,
        "ink": tp, "art": a["primary"], "keyR": t["key_radius"], "accent": a["primary"], "bar": bar,
    }


def c_entry(t, r):
    H = lambda c: "HEXC(0x%02x%02x%02x)" % c
    j = lambda *cs: ", ".join(H(c) for c in cs)
    return (f'  // {t["name"]}: {t["description"]}\n'
            f'  {{ "{t["id"]}", "{t["name"]}", {KS[t["key_style"]]}, {str(t["light"]).lower()}, {str(t["crisp"]).lower()}, {TEXTURE[t["texture"]]},\n'
            f'    {j(*r["g"])},\n    {j(r["ply"], r["ply2"])},\n    {j(r["well"], r["wellEdge"])},\n'
            f'    {j(r["ctl"], r["ctlTop"], r["ctlBot"])},\n    {j(r["track"], r["hair"])}, {r["hairA"]},\n'
            f'    {j(r["txt"], r["txt2"], r["txt3"], r["lbl"])},\n'
            f'    {j(r["cyan"], r["mag"], r["green"], r["amber"], r["red"], r["slate"])},\n    {j(r["onAccent"])},\n'
            f'    {j(r["tagBg"], r["card"], r["seg"], r["swOff"], r["segOff"], r["knob"], r["knobBot"])},\n'
            f'    {j(r["calBg"], r["dimRet"])},\n    {j(r["shadow"])}, {r["shadowA"]},\n'
            f'    {j(r["ink"], r["art"])}, {r["keyR"]},\n    {j(r["accent"], r["bar"])}, false }},\n')


def css_entry(t, r):
    s, x, R = f'.dev[data-theme="{t["id"]}"]', hexs, r["keyR"]
    sh = "rgba(%d, %d, %d, %s)" % (*r["shadow"], ".45" if t["light"] else ".6")
    keys = f'{s} .key, {s} .art, {s} .ctl span'
    out = [f'/* {t["name"]}: {t["description"]} */',
           f'{s} {{ --dg0: {x(r["g"][0])}; --dg1: {x(r["g"][1])}; --dg2: {x(r["g"][2])}; --txt: {x(r["txt"])}; --txt-2: {x(r["txt2"])}; --lbl: {x(r["lbl"])};',
           f'  --cyan: {x(r["cyan"])}; --mag: {x(r["mag"])}; --green: {x(r["green"])}; --amber: {x(r["amber"])}; --hair: {x(r["hair"])}; --hair-2: {x(r["hair"])};',
           f'  --well: {x(r["well"])}; --track: {x(r["track"])}; --tag-bg: {x(r["tagBg"])}; --gear-top: {x(r["ctlTop"])}; --gear-bot: {x(r["ctlBot"])};',
           f'  --knob: {x(r["knob"])}; --ink: {x(r["ink"])}; --art: {x(r["art"])}; --accent: {x(r["accent"])}; --bar: {x(r["bar"])};',
           f'  background: linear-gradient(180deg, var(--dg0), var(--dg1) 50%, var(--dg2)); }}']
    ks = t["key_style"]
    if ks == "frost":
        out += [f'{keys} {{ border-radius: {R}px; background: linear-gradient(180deg, {x(r["ctlTop"])}, {x(r["ctlBot"])}); color: color-mix(in oklab, var(--t) 70%, #000);',
                f'  box-shadow: inset 0 0 0 1px {x(r["hair"])}, 0 10px 14px -12px {sh}; }}',
                f'{s} .cell.on .key, {s} .ctl .play {{ background: linear-gradient(180deg, color-mix(in oklab, var(--t) 40%, #fff), var(--t)); color: #fff; }}',
                f'{s} .well {{ border-radius: {R}px; box-shadow: inset 0 1px 2px {sh}, inset 0 0 0 1px {x(r["hair"])}; }}',
                f'{s} .key::before {{ display: none; }}', f'{s} .tag.on {{ color: #fff; }}']
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
    out += [f'{s} .key > svg {{ filter: none; }}', f'{s} .qbar {{ background: var(--bar); }}',
            f'{s}.chip .key {{ --kr: {R}; }}', ""]
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
        h.append(c_entry(t, r))
        css.append(css_entry(t, r))
    OUT_H.write_text("".join(h), encoding="utf-8", newline="\n")
    OUT_CSS.write_text("\n".join(css), encoding="utf-8", newline="\n")
    print(f"{len(NEW)} themes -> {OUT_H.name}, {OUT_CSS.name}")


if __name__ == "__main__":
    main()
