# 0007 — Titles by the model

> Status: implemented — not yet deployed
> Phase: 1
> Created: 2026-10-30

---

## Problem

The title comes from the file name (`0004`). That works for `Stripe pricing page.png`, but most
references are screenshots and downloads: `Screenshot 2026-10-30 at 10.12.33`, `IMG_4711`,
`download (3)`, a hash. Those end up in the grid as titles, and a pasted image has no title at
all — the one real asset in production shows as untitled. The model looks at every image anyway;
it should name it whenever the person did not.

## Scope

- **The classification returns a `title`**: 3–8 words, English, naming what is shown. Prompt
  version 2.
- **A file name counts as a title only when a person evidently chose it.** The heuristic in
  `titleFromFileName` additionally rejects screenshot names (`Screenshot`, `Screen Shot`,
  `Bildschirmfoto`, `Capture`, `Snipaste` …), camera and messenger names (`IMG_`, `DSC`, `PXL_`,
  `Photo`, `WhatsApp Image`), `download` / `image` / `untitled` with counters, UUIDs and hashes,
  names that are mostly digits, and names with fewer than three letters.
- **Provenance on the title.** A chosen file name and a title typed on the detail page are a
  person's and stay; the model's title fills only where nobody chose one.
- **Clearing a title hands it back to the model** on the next run.
- The detail page shows where the title comes from, like the description.

### Not in scope

- Titles in other languages. English like the description (§13.3).
- Renaming on demand ("suggest a better title").

## Data model impact

**Not retrofittable: `asset.title_origin origin NOT NULL DEFAULT 'ai'`.** Without it a
re-analysis cannot tell a person's title from a model's, and the first run after this feature
would overwrite every title a person typed. Backfill: a non-null title is `human` (a file name or
a `0006` edit — both a person's choice), a null one `ai`. A guard trigger with the rule of
`asset_description_origin_guard` (`0003`): an `ai` write over a `human` title is discarded.

## Vocabulary impact

None. The prompt changes, so `PROMPT_VERSION` goes to 2 and the reconciler re-classifies every
asset below it — today one asset, a few cents. Every `human` value survives (`0006`).

## i18n impact

None in the data: titles are English by decision. The origin marker reuses `detail.origin.*`.

## MCP impact

`get_asset` and `search_assets` get better titles; `get_asset` also returns `titleOrigin`.

## Known limits

- **A meaningful file name in a non-English language stays** — it is a person's choice.
- **The heuristic can misjudge.** A real title that looks like a camera name (`DSC Studio`)
  is dropped; the model's title replaces it, and the person can set it back on the detail page.

## Open questions

None.

## Verification

1. Upload `Screenshot 2026-10-30 at 10.12.33.png`: no title at first, the model's after
   classification, marked `by AI`.
2. Upload `Stripe pricing page.png`: that title stays through classification, marked `by hand`.
3. Edit a title, re-classify: the edit stays. Clear it, re-classify: the model's title returns.
4. After the release the existing asset is re-classified at prompt version 2 and gets a title.

## Decided during implementation

1. **Clearing a title is the one `human` → `ai` change the guard allows, and only with a declared
   actor** — the same mechanism as deleting a person's value in `0006`. Without it the guard
   would keep the cleared title, and "hand it back to the model" could not work. The classify
   step declares no actor, so it still cannot take a title from a person.
2. **The classify step trims a trailing period** and caps the title at 200 characters, like the
   file-name path.
