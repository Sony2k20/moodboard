# 0005 — Overview: grid, facet filters and search

> Status: done — deployed in v0.3.0 (2026-10-30)
> Phase: 1
> Created: 2026-10-30

---

## Problem

Assets go in and come out classified (`0004`), but the only way to see them is a list of the 30
latest uploads. Nobody can ask the question the metadata exists to answer — *show me dark,
editorial heroes* — so the structured metadata is written and never read. With every upload it
gets harder to find something by scrolling, and the classification quality cannot be judged
across the corpus either: nobody sees that `mood` comes out as `calm` for half the assets.

The same question is the one Claude Code will ask through `search_assets` (§10). If the web
overview and the MCP tool answer it with two different queries, they will drift, and the agent
will find something different from what a human sees for the same filter.

## Scope

The **read side** of the overview: finding and looking. Editing is `0006`.

- **One search query, shared by web and MCP.** `AssetQuerySchema` (Zod, `libs/shared`) and an
  `AssetSearchService` in the api. `GET /api/assets` parses the query string into that schema;
  the MCP tool `search_assets` will take the same schema as its input. Parameters:
  - `facet` — repeatable, `<facet key>:<value>`, e.g. `facet=style:editorial&facet=theme:dark`
  - `q` — full-text, see below
  - `tag` — repeatable, exact tag name, case-insensitive
  - `author` — user id
  - `cursor`, `limit` (default 60, max 100)
- **Filter semantics:** values within one facet are **OR**, facets with each other are **AND**,
  tags and author are **AND** with everything else. `style:editorial + style:swiss + theme:dark`
  means *(editorial or swiss) and dark*. This is the only combination that works for multi-value
  facets in practice: AND within a facet empties the result after the second click.
- **Full-text search:** `websearch_to_tsquery('english', q)` against `asset_search.tsv` (title
  and description), **or** an exact, case-insensitive match of `q` on a tag name — tags stay out
  of the vector by decision (§13.4).
- **Order: newest first, always.** Keyset pagination on `(created_at, id)`, so appending new
  uploads never shifts or duplicates a page while someone scrolls.
- **Facet counts in the response.** For every facet value, how many matching assets carry it —
  computed with the facet's own selection removed, so selecting `editorial` does not drop `swiss`
  to zero. For a facet without a selection that is exactly the result after the click; within a
  facet that has one, it is how many assets the value adds at most (OR). Values with a count of 0
  are shown disabled, not hidden. Same for authors. Without counts, every second filter click
  ends in an empty grid.
- **`GET /api/vocabulary`** — facets and values with their `jsonb` labels, ordered by
  `sort_order`. The filter UI renders from it; it is the shape `list_vocabulary` will return.
- **Grid:** the overview becomes the start page. The drop zone shrinks to a bar above the grid;
  paste anywhere keeps working. Tiles in a CSS grid with `grid-auto-rows` and a row span computed
  from the thumbnail's aspect ratio (`asset_file.width/height`) — a masonry look, but filled in
  reading order left to right, and appended pages extend it instead of reshuffling it. Tiles use
  `thumb-md`. Infinite scroll by cursor.
- **Filter state lives in the URL** (`?facet=…&q=…`). Back, reload and a copied link all show the
  same result.
- **Pending and unclassified assets are in the grid**, marked as such. Hiding them would make a
  fresh upload look lost. `failed` assets are hidden from the grid; they will surface in the
  trash and error view later.
- **Read-only detail page** at `/assets/:id`, backed by `GET /api/assets/:id`: `thumb-lg` (the
  original on click), description, facets grouped by facet with their origin marked, tags,
  colour palette, author, date, classification run (model, prompt version, date). This is the
  shape `get_asset` will return. A grid without a detail view cannot be judged, and `0006` turns
  this page editable rather than building a second one.

### Not in scope

- **Editing, multi-select and bulk tagging** — `0006`. They write `origin = 'human'` and need the
  audit trail; that is a different risk from reading, and it is better reviewed on its own.
- **Delete and trash** — `0006`, together with the hard-delete question `0004` raised.
- **Colour search** ("everything close to this orange") — `asset_color` stores Lab values for
  it, but the overview item in §11 does not ask for it. Additive later.
- **Relevance ranking** — see known limits.
- **The MCP server itself.** This feature defines the query and result shapes it will use.
- **Saved searches, smart boards** — phase 3 (§5.4).
- Admin maintenance of the vocabulary.

## Data model impact

**Additive only.** No new columns, nothing provenance-related. One index for the keyset order:
`asset (created_at desc, id desc) where deleted_at is null`. At a few hundred assets it is
barely measurable; it is there so the query plan does not change character as the corpus grows.

## Vocabulary impact

None. The filters read the vocabulary; they do not change it. No re-analysis.

## i18n impact

- New UI strings for the filter panel, search field, empty states, the detail page and the
  status markers — in `en.json` and `de.json`.
- Facet and value labels come from the `jsonb` labels in the database, picked by the active
  language; a missing language falls back to `en`.
- Facet keys and values in the **URL stay machine keys** (`style:editorial`), never labels — a
  link copied in German has to work in English.
- Full-text search is English-stemmed (§13.4). A German query matches only where the words are
  the same; see known limits.

## MCP impact

This feature fixes two shapes the MCP server will expose unchanged:

- `search_assets` input = `AssetQuerySchema`; output = the grid's page, `{ items, nextCursor,
  counts }`. Each item carries id, title, type, status, author, created date, thumbnail URL, its
  facet values as `{ facet, value }` keys and its tags. Facet counts are what lets an agent
  narrow down instead of guessing: they show which combinations have results.
- `get_asset` output = the detail page's response.
- Labels are not part of either shape. An agent works with keys; `list_vocabulary` supplies
  labels and descriptions where it needs them.

Nothing new has to be guessed by an agent: filter values come from `list_vocabulary`, the
combination rule (OR within a facet, AND across) goes into the tool description.

## Known limits

- **No relevance ranking.** A full-text hit in the title and one in the last sentence of the
  description sort the same: newest first. At a few hundred assets the whole result is
  scrollable. `ts_rank` ordering is additive, but needs offset or rank-aware cursors — not worth
  it before search proves too coarse.
- **German search terms mostly miss.** Descriptions are English; `"Preistabelle"` finds nothing,
  `"pricing"` does. Facets are the language-independent way in.
- **Tags match exactly.** `dark-mode` does not find `darkmode`. That is the price of keeping tags
  out of the English stemmer.
- **An unclassified asset is findable only by title and author**, until its classification
  arrives. For screenshots the title is often a file name like `Screenshot 2026-10-30`.
- **Counts are computed per request**, one grouped query per facet. Cheap at this volume; at tens
  of thousands of assets it would need a cache.
- **Counts only see classified assets.** A pending or unclassified asset has no facet values, so
  the counts of a facet can add up to less than the total.
- **The web bundle now carries Zod** (lazy chunk, about 80 kB over the wire), because the overview
  parses its URL with the same `AssetQuerySchema` as the api. The price of one schema.

## Open questions

None that block the start. Decided here, so they are not re-opened during implementation:

1. **Query string, not a POST body.** Filters are short, and only a URL can be bookmarked or
   pasted.
2. **The overview replaces the start page**, rather than living at `/browse` next to it. One
   place to drop and to find; the upload list from `0004` goes away.
3. **Detail as a route, not a modal.** A modal cannot be linked, and the detail page is the one
   a reviewer will want to send around in `0006`.

## Decided during implementation

1. **The cursor is the creation time in microseconds plus the id**, not an ISO timestamp.
   Postgres keeps microseconds, a JavaScript `Date` only milliseconds; a cursor rounded to
   milliseconds skips or repeats assets created within the same one.
2. **The search is tested against a real Postgres, in process: PGlite** (`@electric-sql/pglite`,
   dev dependency). The semantics of this feature live in SQL — OR/AND, counts, stemming,
   keyset order — and a mocked database would only test the mock. The tests run the real
   migrations, so they cover the triggers as well. PGlite needs Jest's
   `--experimental-vm-modules`; `apps/api/jest.config.cts` sets it for the workers.
3. **The paste handler checks that its target is an element** before calling `closest`. Found in
   the `0004` verification; a real paste always targets one, a synthetic event may not.
4. **The dev proxy forwards `/files` too**, so thumbnails load with `nx serve web`.

## Verification

1. Start page shows all non-deleted, non-failed assets as a grid, newest first; a fresh upload
   appears at the top as pending and fills in once classified.
2. Select `style:minimal`: only minimal assets remain, as many as its count said, and the other
   `style` values keep their counts. Add `style:organic`: the result grows by organic's count
   (less any asset that is both). Add `theme:dark`: it shrinks to dark's count.
3. Reload, then press back: the same filters and the same result each time. Copy the URL into a
   second browser session in the other language: same result, labels translated.
4. Search for a word that appears only in one description: that asset is found. Search for one
   of its tags with different capitalisation: found as well.
5. With more than 60 matching assets, scroll to the end: the next page appends without
   duplicates or gaps, also if a new upload happens in between.
6. Open a tile: the detail page shows description, facets with `ai`/`human` marked, tags,
   palette and the classification run. The page URL works when opened directly.
7. `GET /api/assets?facet=nonsense:value`: `400` with the reason, not an empty result —
   otherwise an agent cannot tell a bad filter from an empty one.
8. `GET /api/assets` and `/api/vocabulary` without a session: `401`.

**Result (2026-10-30, v0.3.0):** the production corpus holds one classified asset, which is enough
for the shapes and the edges but not for paging or for OR over many values. Those were covered
before the release instead: by the PGlite integration tests against the real migrations, and by
clicking through the UI locally against 75 fixture assets.

- In production: the start page shows the grid and ten facets with counts; `mood:calm` finds the
  asset, `mood:calm` + `theme:dark` finds none, `mood:calm` + `mood:playful` finds it (OR).
  `q=nature` and `q=landing pages` find it through the stemmed description. The detail endpoint
  returns 17 facets, 6 colours and the run. `facet=nonsense:value` answers `400` with the reason;
  `/api/assets`, `/api/assets/<id>` and `/api/vocabulary` answer `401` without a session.
- Locally, against fixtures: counts before a click matched the result after it (9 → 9, +6 → 15,
  dark 5 → 5); scrolling appended the second page without duplicates; the detail page linked
  back to the same search; switching to German translated facet labels while the URL kept the
  keys.
- Found on the way, fixed before the release: the grid loaded the second page right away,
  because the end-of-grid flag was still set from the empty grid.
- Found in production, fixed after it: the count read "1 assets". Ships with the next release.
