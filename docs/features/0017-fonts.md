# 0017 — Fonts: upload and live rendering

> Status: accepted — implemented, deployed in v0.17.1 (2026-11-02)
> Phase: 2
> Created: 2026-11-02

---

## Problem

`font` is one of the five values of `type` (§6), but nothing in the application can hold one. A
typeface someone wants to remember ends up as a screenshot of a specimen: the model guesses
"sans, geometric" from pixels, nobody can set their own text in it, and the facts that are
written *in the file* — family, styles, weights, variable axes, designer, licence — are lost.
For the primary consumer that is the worst case: an agent asked for "the font from the Acme
board" gets a picture, not a name it can put into `font-family`.

## Scope

- **Upload a font** the same ways as an image (drop, paste of a file, file picker, `POST
  /api/assets`): **WOFF2, WOFF, TrueType, OpenType**, up to 10 MB. Recognised by the file's
  signature and then parsed, so a file that is not a usable font is refused with `415` at once.
- **The file states the facts.** At upload the api reads the name and OS/2 tables and stores
  them in `asset_font`: family, subfamily, full name, PostScript name, version, designer,
  manufacturer, licence text and URL, weight class, italic, monospaced, glyph count, variable
  axes (tag, name, min, default, max) and the OpenType feature tags. The full name becomes the
  title as a fact, not a guess — the model never renames a font.
- **`type: font` is set as the person's decision**, as for a website (0011): they uploaded a
  font file, so what the asset is is not the model's to guess.
- **A specimen as the asset's picture.** A new first pipeline step, `specimen`, draws the family
  name, a pangram, the alphabet in both cases and the figures from the font's own glyph outlines
  into a 1600 × 1000 image, stored as `poster`. Thumbnails, colours and classification work from
  it exactly as for a website's poster; the font file stays the `original`.
- **The model gets the file's facts as text** next to the specimen, so `typography`, `style` and
  `mood` describe the typeface rather than "an image of black letters".
- **Live rendering on the detail page.** The browser loads the uploaded file with the
  `FontFace` API. Anyone can type their own sample text, change the size, see a waterfall of
  sizes, switch on OpenType features the font has, and move every variable axis with a slider.
  The metadata from the file is listed next to it.
- **`get_asset` returns the font's facts** in a `font` field; `search_assets` finds fonts by
  `type:font` and by `typography`.

### Not in scope

- **Font collections (`.ttc`) and several files per family.** One file is one asset; a family
  with eight static styles is eight uploads. Grouping them is a board's job (phase 3).
- **Fonts found on captured websites.** `capture_tech.fonts` already names them; downloading the
  files would copy licensed fonts out of someone else's site.
- **Licence enforcement.** The licence text is shown as the file states it; whether the team may
  use the font is a person's call.
- **Glyph tables and character maps.** The specimen and the free text field cover what a
  reference needs.
- **Subsetting or converting the file.** It is served as uploaded.

## Data model impact

**Additive.** One new table, `asset_font`, one row per font asset, filled from the file at
upload — a fact about the file, so it carries no `origin`: nobody corrects a font's family name,
and a re-analysis never touches it. No change to an existing column. `asset.type` already
accepts any facet value; the storage layout gains `original.{woff2,woff,ttf,otf}`.

## Vocabulary impact

None. `type: font` and the `typography` values exist since the approved vocabulary (§6). No
re-analysis: no existing asset is a font.

The model's per-asset text gains a font section, present only for fonts. The system prompt and
the vocabulary it renders are unchanged, so `PROMPT_VERSION` stays: every existing asset would
get a byte-identical prompt, and bumping the version would mark the whole corpus outdated for
nothing (0015).

## i18n impact

New UI strings for the specimen controls, the metadata labels and the upload hint, in `en.json`
and `de.json`. The sample text is the person's own and is not translated; the default pangram
follows the interface language. Font names, axis tags and feature tags are shown as they are
(§13.3).

## MCP impact

- `get_asset` gains `font: { family, subfamily, fullName, postscriptName, version, designer,
  manufacturer, license, licenseUrl, weight, italic, monospace, glyphCount, axes, features } |
  null`, `null` for every other asset.
- The original's URL is the font file itself, so an agent can download it and use it — and is
  told the licence in the same answer.
- `add_asset` stays as it is (images and URLs).

## Known limits

- **The specimen shows Latin.** A font without Latin glyphs draws `.notdef` boxes; the live
  rendering on the detail page shows whatever text someone types.
- **Variable fonts are drawn at their default instance** in the specimen. The axes are listed,
  and the detail page renders every instance.
- **Colour fonts (COLR, SVG, sbitmap glyphs) are drawn as their outlines**, black, in the
  specimen. The browser renders them in colour on the detail page.
- **The name table is what the foundry wrote.** A badly built font may say "Regular" for a bold
  or carry no designer; the application shows it as written.
- **Parsing is the font library's.** A file it cannot read is refused, even if a browser would
  have rendered it.

## Open questions

None.

## Verification

1. Drop a `.woff2` on the overview. The tile shows a specimen within seconds; the title is the
   font's full name, `type` is `font` as a person's value.
2. The detail page renders the pangram in the font; typing changes the text, the size slider and
   the waterfall work. A variable font shows a slider per axis, and moving `wght` changes the
   rendering live. Features listed in the file can be switched on.
3. The metadata lists family, style, weight, glyphs, axes, designer and licence from the file.
4. After classification, `typography` and `style` are filled; the title is still the font's
   name.
5. A `.txt` renamed to `.ttf` is refused with `415`; a 12 MB font with `413`.
6. MCP: `get_asset` on the font returns the `font` block; `search_assets` with `type:font` lists
   it.

## Decided during implementation

1. **The specimen is drawn from glyph outlines, not in Chromium.** fontkit lays out each line
   (kerning, ligatures) and the outlines become SVG paths, which sharp rasterises. No browser, no
   installed font, no capture queue: the step runs next to the image steps. Only path commands
   and numbers from the file reach the SVG.
2. **The api parses the font at upload**, with the same library. It is the check that the file
   is a font, and it fills `asset_font` in the same transaction as the asset, so the detail page
   has the facts before the worker has run.
3. **The title is the file's full name, as `human`.** It is a fact the file states, and the
   title guard keeps the model from renaming it — the model's own title would describe the look,
   which `description` already does.
4. **`colors` stays in the font pipeline.** It marks the asset `ready`; the palette of a specimen
   is ink and paper, harmless, and not worth a second way to finish a pipeline.
5. **The specimen's family name on the detail page is private** (`mb-specimen-N`): two uploads of
   the same family never share a `FontFace`, and the application's own type is never touched. A
   variable font is declared over its whole `wght` range, so the slider is not clamped.
6. **Copying the image for a prompt copies the specimen**, never the font file.

### Verified (before release)

- **Api** (`font-reader.spec.ts`, `font-ingest.integration.spec.ts`, PGlite): Inter's variable
  WOFF2 yields family, full name, weight 400, the `wght` axis 100–900 and sorted features; a file
  with a font signature that is not a font, and a truncated font, are refused before anything is
  stored. An ingest stores the original as `font/woff2`, the facts, `type: font` as `human` and
  decided, the full name as a `human` title, and starts the `font` pipeline.
- **Worker** (`specimen.spec.ts`): the specimen is paths only, shrinks a line that does not fit,
  and renders to 1600 × 1000 with near-black ink on white. Rendered once by hand and looked at:
  name, pangram, both alphabets and figures, correctly kerned.
- **Shared** (`font.spec.ts`): the four signatures, collections refused, the font pipeline's
  order.
- **Against a stub api in Chromium** (1280 × 900, 390 × 844): the detail page loads the file
  through `FontFace` (`loaded`, weight range `100 900`); the weight slider sets
  `font-variation-settings: "wght" 850`, the `frac` switch `font-feature-settings: "frac"`, own
  text replaces the pangram; the facts and *Download font* are shown. The 72 px waterfall line
  first pushed into the metadata column — fixed with `min-width: 0` on the specimen's grid items.
  No horizontal scroll on a phone.
- `nx run-many -t lint,test,build`: green; `fontkit` is in both generated runtime manifests.

Not verified before release: a real upload through the worker and the model's classification of
a specimen — that needs the cluster.

## Rollout

**v0.17.0 was never deployed.** The CI image check started the pruned api bundle and it failed
with `Cannot find module 'fontkit'`: the image's dependencies come from `apps/api/package.json`
and `apps/worker/package.json`, not from the imports, and the font library was only declared at
the root. Declared in both (`e15381b`) and released as v0.17.1.

v0.17.1 deployed 2026-11-02 (gitops `91a450a`): ArgoCD synced and healthy, api, web and worker
on the `0.17.1` images without restarts, so migration `0014_asset_font` ran. An upload without a
session answers `401`.

**Not verified:** 1–6 with a real font in a signed-in session, and the model's classification
of a specimen.
