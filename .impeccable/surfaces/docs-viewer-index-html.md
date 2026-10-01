---
version: 1
slug: "docs-viewer-index-html"
primary_target: "docs/viewer/index.html"
related_targets: []
---

# Surface brief: design viewer (docs/viewer/index.html)

Scope: the single-page interactive design viewer for ESP32 Touch Keypad. Mode: Read, with an operable device simulator and Studio editor mock.

Audience and job: the maker and collaborators check how the keypad behaves, what Macropad Studio 3 will look like, and what the reference reuse, architecture, protocol, landscape and roadmap say. Content and function stay as they are; only the visual world changes.

Constraints: specs, tables, pin maps and code stay crisp on clean sheets with faint grain; motion stays smooth on a laptop and respects reduced motion; the device's on-screen UI is papercraft too (user choice); works at 390 px.

## Direction contract

THESIS: The viewer is a Pollock's-style toy theatre. Each view is a printed sheet slotted into one proscenium, and the keypad is the player on stage. It refuses the docs-page arrangement of header, tab strip and card grid.

OWN-WORLD: Hand-coloured lithograph card. Oxblood paper curtains, a gilt proscenium with bead moulding, a prussian-teal painted backdrop, ink linework, and gold for highlights. Spec sheets are clean paper white. Wings sit in slotted layers with soft offset shadows; players ride wire sliders; lettering is fat wood-type playbill slab.

STORY: Collaborators watch the keypad perform, then call each scene to read the exact spec. They leave understanding what Macropad v2.1 lends, and trusting the numbers.

FIRST VIEWPORT: One proscenium fills the window: an engraved gilt arch carrying the arched playbill banner, gilt pilasters, a bead-moulded stage opening, swag valance, hatched curtains, three wing depths and a painted backdrop. The keypad stands stage left as a card player on a wire slider, under a hanging title card, with the named lighting cue and host controls below it, all inside the first view at 1440 x 900. The prompt-book trace is pinned stage right inside the proscenium (recorded deviation: the rebuild directive puts every scene inside the one frame, so the trace moved from beside the proscenium to inside it, stage right). Scene names are tickets on the footlights rail, the only navigation.

FORM: Toy Theatre Playbill, position 1 of the ordered list, seed key 92a523b6 (taken as Impeccable's pick). Signature interaction: a scene change slides the new sheet in on its rail from the wing as the old one drops, and the wings shift. Motion grammar: on-rail slides with exponential ease-out.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
