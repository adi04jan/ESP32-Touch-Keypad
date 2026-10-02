---
version: 1
slug: "docs-device-index-html"
primary_target: "docs/device/index.html"
related_targets: []
---

# Device screen (480x320 on-device UI)

Scope: the keypad's own screen, mocked pixel-exact in docs/device/index.html and ported to firmware (LovyanGFX, 16-bit, 80 MHz SPI). Mode: Operate. Replaces the papercraft device look (user: "too funky"); the user pinned "glass / smartwatch". The viewer and Studio chrome are out of scope.

Audience and job: a maker, streamer or developer glancing at a 4" panel beside a monitor, in a dim room, from 50-70 cm; tap a key, see it took, change page, run media, change a setting. Constraints: no runtime blur; at 60 fps an animation touches at most ~25% of the screen per frame; text >= 12 px; keys >= 72 px, sheet controls >= 44 px; colour never the only state signal.

## Direction contract
THESIS: An instrument, not a toy: watch-glass keys run by an avionics multi-function-display discipline, where every colour is a state word. It refuses the category default of neon-glow dark tiles and an app-store icon grid.
OWN-WORLD: Graphite-black ground with a faint blue cast; glass keys tinted by the user's key colour, gradient-lit from the top with a one-pixel highlight and a glyph glow in the key's tint; system colour is semantic only: cyan selectable, magenta current, green engaged or ok, amber caution, red fault, white label, slate secondary. B612 and B612 Mono, the cockpit face, for every word and number.
STORY: The user sees what each key does, what is live, and whether the host is there, before touching; every touch answers within one frame.
FIRST VIEWPORT: Status band 28 px (clock, profile line pill with page, host link readout, gear soft key); 5x3 glass keys 72 px with labels under them; the profile's line with page stations at the bottom.
FORM: Avionics glass cockpit MFD fused with watch glass, candidate 7 of 7, seed 4a6f784b. Raises: acetate manual -> strict ply order (ground, keys, HUD, sheet), one edge treatment per ply; variable-font specimen -> live press response, key glow tracks touch pressure; transit diagram -> each profile owns a line colour, pages are its stations; j-card -> exact running times, tabular, right-aligned; Japanese density -> the status band packs real readouts; labanotation -> hold keys draw their 500 ms hold as a filling arc.
SIGNATURE INTERACTION: press-pressure glow plus a staggered diagonal key pop-in on page change, both at 60 fps inside per-cell redraws.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
