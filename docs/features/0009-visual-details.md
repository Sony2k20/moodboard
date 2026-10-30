# 0009 — Visual details for the build prompt

> Status: implemented — not yet deployed
> Phase: 1
> Created: 2026-10-30

---

## Problem

The first page built from a `0008` prompt alone got structure, palette and mood right and the
rendering wrong. The reference uses photographs of leaves lit in 3D, one card is a forest photo,
the background has a sand-like relief, panels are leaf-shaped and embossed, cards are raised with
soft shadows, the hero splits diagonally, the button is a glossy gradient pill and the icons sit
in white circular badges. The result: flat vector leaves, an illustrated landscape, flat colour
fields, no shadows, a straight split, a flat button, outline icons.

None of it was lost in the prompt — it was never in the metadata. Facets say *what* (hero, card,
organic, nature), the palette *which colours*, and the 2–4 sentence description stays general.
Imagery type, surfaces, depth, shape language and component details have no place, so the prompt
cannot carry them, and "organic, green" falls back to flat illustration.

## Scope

- **Two facets** (multi-value): `imagery` — photography, illustration, 3d-render, icons, pattern,
  none; `finish` — flat, gradient, texture, grain, soft-shadow, layered, outline, glow. Filterable
  like every facet, and in the prompt. `glass` stays in `style: glassmorphism`.
- **`design_notes` from the classification:** short English notes on composition, imagery,
  surfaces, shapes, typography, components and details — how it looks, concretely, not the facet
  values again. Prompt version 3.
- **The prompt uses them:** `Imagery` and `Finish` lines, a "Visual details" block, and rules that
  follow from the facets — photography stays photography, textures and shadows are not flattened.
- **The image goes along:** a "Copy image" button next to "Copy prompt" on the detail page, with
  a download fallback. The page also shows the notes.
- **The vocabulary is seeded on every deploy**, in the migration initContainer under its lock.
  Until now `db:seed` ran by hand; new facets would otherwise never reach production.

### Not in scope

- Editing the notes on the detail page. The provenance column is there from the start, so it can
  come later without guessing who wrote what.
- Notes in the full-text search. Additive, can be backfilled from the column.

## Data model impact

**Not retrofittable: `asset.design_notes jsonb` with `asset.design_notes_origin origin NOT NULL
DEFAULT 'ai'`**, and a guard trigger with the rule of the title's (`0007`): an `ai` write over a
person's notes is discarded. The notes are model output a person may correct; without the origin
the first re-analysis after a correction would erase it.

## Vocabulary impact

**Two new facets — the expensive kind (§6):** prompt space and a re-analysis of the whole corpus.
Approved now because the corpus is one asset; the prompt bump to version 3 makes the reconciler
re-classify it. Every `human` value survives (`0006`).

## i18n impact

Facet and value labels in English and German, in `vocabulary.ts`. New UI strings for the notes
section and the image buttons. The notes are English by decision, like the description (§13.3).

## MCP impact

`list_vocabulary` grows by two facets; `get_asset` returns `designNotes`. The prompt from
`libs/shared` is what `get_asset` can hand an agent later.

## Known limits

- **Notes are the model's reading of one image** — good at materials and shapes, weaker at exact
  sizes and spacing. Attaching the image covers the rest.
- **Copying an image needs a PNG on the clipboard**; the page converts the original, which takes
  a moment for large files. Where the clipboard refuses, the download remains.
- **More output tokens per classification** — roughly 250, about half a cent with the current
  model.

## Open questions

None.

## Verification

1. After the release the leaf reference is re-classified at prompt version 3: `imagery`
   includes photography, `finish` texture and layered/soft-shadow, and the notes name the
   diagonal split, the embossed leaf panels, the glossy pill button and the icon badges.
2. Its prompt carries all of that, plus the photography and depth rules.
3. Copy image, paste into Claude with the prompt, build: compare with the reference again.
4. `GET /api/vocabulary` lists `imagery` and `finish`; filtering by `imagery:photography` finds the
   asset.
