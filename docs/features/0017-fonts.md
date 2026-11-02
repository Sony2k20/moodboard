# 0017 — Fonts: upload and live rendering

> Status: accepted
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
