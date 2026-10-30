# 0005 — Overview: grid, facet filters and search

> Status: draft
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
- **Facet counts in the response.** For every facet value, how many assets the result would have
  if that value were added — computed with the facet's own selection removed, so selecting
  `editorial` does not hide `swiss`. Values with a count of 0 are shown disabled, not hidden.
  Same for authors. Without counts, every second filter click ends in an empty grid.
- **`GET /api/vocabulary`** — facets and values with their `jsonb` labels, ordered by
  `sort_order`. The filter UI renders from it; it is the shape `list_vocabulary` will return.
- **Grid:** the overview becomes the start page. The drop zone shrinks to a bar above the grid;
  paste anywhere keeps working. Tiles in a CSS grid with `grid-auto-rows` and a row span computed
  from the original's aspect ratio (`asset_file.width/height`) — a masonry look, but filled in
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

## Open questions

None that block the start. Decided here, so they are not re-opened during implementation:

1. **Query string, not a POST body.** Filters are short, and only a URL can be bookmarked or
   pasted.
2. **The overview replaces the start page**, rather than living at `/browse` next to it. One
   place to drop and to find; the upload list from `0004` goes away.
3. **Detail as a route, not a modal.** A modal cannot be linked, and the detail page is the one
   a reviewer will want to send around in `0006`.

## Verification

1. Start page shows all non-deleted, non-failed assets as a grid, newest first; a fresh upload
   appears at the top as pending and fills in once classified.
2. Select `style:minimal`: only minimal assets remain, and the other `style` values keep their
   counts. Add `style:organic`: the result grows. Add `theme:dark`: it shrinks. Every count shown
   before a click equals the number of tiles after it.
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
