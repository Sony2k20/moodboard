# 0012 — Browse and review: the overview with an inspector

> Status: accepted — release 1 in v0.10.0, release 2 (review mode, phase 1 since 2026-10-31) in
> v0.11.0; both deployed 2026-10-31, see "Rollout"
> Phase: 1
> Created: 2026-10-31

---

## Problem

The overview (`0005`) is good at finding references, but it says nothing about how good their
metadata is. A tile looks the same whether every facet was confirmed by a person or all of them
are model guesses. To check or correct an asset, people have to leave the grid for the detail
page, edit there, and come back. Nobody does that for forty assets in a row. The result is that
`origin = 'human'` stays rare, even though it is what makes the data trustworthy (§1, §5.6).

There is also no way to find the assets that need a look. "Show me everything where a facet is
still only a model guess" cannot be asked today, so curation happens by chance, not by intent.

## Scope

Two views built on the existing read (`0005`) and write (`0006`) APIs. The design was chosen from
five concepts and two rounds of variants. The visual direction is the "quiet gallery": light, image
first, filters as pills. The working parts come from the "inspector" concept.

**Release 1 — Browse**

- **The overview gets a docked inspector.** Selecting a tile opens a panel on the right, and the
  grid narrows from five to four columns. The selection is in the URL (`?asset=<id>`), so a
  reload or a shared link reopens it. `/assets/:id` stays as the full-page view for direct links.
- **The inspector covers the open phase 1 item "Detail view: editable metadata, colours, capture
  technique"** (§11):
  - preview, link to the original or full-page capture, source URL, author, date
  - title, editable inline (`PATCH /api/assets/:id`)
  - the colour palette from `asset_color`
  - every facet as a row of chips:
    - **solid** = `human`
    - **dashed** = `ai` in a facet that has no decision yet
  - clicking a row opens the facet's whole vocabulary inline, with the current values preselected.
    "Save" writes the selection through `PUT /api/assets/:id/facets/:facet`, which makes all of
    them `human` and records the decision (`0006`)
  - "N AI guesses left · Confirm all", which saves every undecided facet with its current values
  - "Copy prompt for Claude" (`0008`) as the primary action
  - the analysis run: prompt version, model, date
- **Tiles show what is unconfirmed.** A small counter shows the number of undecided facets that
  hold `ai` values, plus the existing states: pending, capturing, failed with the reason and
  "Retry" (`0011`).
- **Filter pills** replace the sidebar: one pill per facet that opens a value list with counts,
  with the selected count on the pill and active values as removable chips. The behaviour is the
  same as `0005`: values within a facet are OR, facets with each other are AND.
- **"Images | Facets" switch.** "Facets" shows each tile's facet chips under the image, in the same
  solid and dashed styles. The choice is a per-viewer setting in `localStorage`.
- **Phone width:** two columns, the filter pills scroll sideways, and the inspector becomes a
  bottom sheet with "Confirm N guesses" and "Copy prompt".

**Release 2 — Review**

- **A review mode** reached from a "Review N" button in the header. Its queue is the current
  filter plus "has at least one undecided `ai` facet", oldest first, so it can be worked through
  front to back.
- **One asset at a time:** a large preview (viewport or full-page capture for websites) and the
  facets panel. The current facet shows its full vocabulary:
  - `1`–`9` toggle values
  - `⏎` confirms the facet and moves to the next undecided one
  - `⇧⏎` confirms all facets of the asset
  - `S` skips the asset
  - `←` / `→` move between assets
- **Confirmed facets collapse** into one line ("7 facets already confirmed").
- **A filmstrip** shows the queue with done, skipped, current and open.
- **Skipping is only in the session.** A skipped asset stays in the queue and comes back the next
  time.

### Not in scope

- **The Command palette (⌘K) and token search.** That is phase 2 (§11). It was explored and set
  aside in favour of the filter pills.
- **Re-analysis from the UI.** The inspector shows the run but offers no "Re-analyse": that is the
  batch re-analysis UI of phase 2, as `0006` decided. The mockup's button is dropped.
- **Colour search.** The palette is shown, not searchable.
- **Confirming single values.** A facet is confirmed as a whole, see open questions.
- **Bulk confirm in the grid.** Multi-select (`0006`) keeps its action bar unchanged. "Confirm
  facets" for a selection is a later addition once review mode has been used.
- **The scroll video** in the inspector — `0011` release 3 owns it.
- **A dark theme.** The review mode uses a dark stage around the image, but the application theme
  stays light.

## Data model impact

**Additive only. No migration.**

Confirming is the existing facet write from `0006`: `PUT /api/assets/:id/facets/:facet` with
the values the facet already holds. It writes every value as `human` and adds the
`asset_facet_decision` row, so a confirmation survives every re-analysis by the mechanisms that
already exist. No new provenance column, no new table.

"Undecided `ai` facet" is derived, not stored: a facet of an asset that has at least one
`asset_facet_value` row with `origin = 'ai'` and no `asset_facet_decision` row. At a few hundred
assets the count is a cheap aggregate in the existing search query. An index on
`asset_facet_value (asset_id) where origin = 'ai'` is the fallback if it ever is not.

## Vocabulary impact

None. No re-analysis. The inline editor and the review panel offer exactly the vocabulary's
values, and single-value facets accept one value, as in `0006`.

## i18n impact

- New UI strings for the inspector, the counter, the "Images | Facets" switch, the review mode,
  its keyboard hints and empty state ("Nothing left to review"), in `en.json` and `de.json`.
- Facet values in chips and editors show the label in the user's language. Requests carry the
  `value` key.
- Keyboard hints name keys, not words, so they need no translation.

## MCP impact

- **`search_assets`** shares `AssetCard` with the overview (`0005`). The card gains
  `unconfirmedFacets: number`, which is additive. The tool description says that `0` means every
  facet a model filled has been confirmed by a person, so an agent can prefer those references.
- **The review filter is not exposed to MCP.** It is a curation tool for people. An agent has no
  use for "assets that need a human".
- `get_asset` is unchanged: it already returns `origin` per facet value.

## Known limits

- **A model's silence is not reviewable.** A facet the model left empty has no `ai` values, so it
  never counts as unconfirmed and never enters the queue. A person can still fill it in the
  inspector, but nothing points them there.
- **Confirming is per facet, not per value.** Someone who agrees with `calm` but is unsure about
  `warm` has to decide the whole `mood` facet: remove `warm` or keep it. This follows `0006`'s
  rule that a facet edit owns the whole facet.
- **The last save wins**, as in `0006`. Two people reviewing the same queue can confirm the same
  facet twice. That is harmless, because both writes say the same thing. If one changes a value
  while the other confirms the old one, the later save wins.
- **A narrow desktop window** (below about 1100 px) has no room for four columns plus the panel.
  The inspector then becomes an overlay over the grid instead of docking beside it.
- **Keyboard review needs a keyboard.** On a phone, review mode works by tapping chips and buttons
  and is slower. It is built for a desk.

## Open questions

1. **Review mode in phase 1 — decided 2026-10-31: yes, as release 2.** It adds no table and no
   endpoint beyond one query parameter, and it is the most direct lever on the north star: more
   `human` facets, faster. It goes ahead of `0011` release 3 (the scroll video), which helps
   people look at a capture but adds nothing to the metadata. §11 lists it.
2. **Is the counter the right metric?** It counts undecided facets that have `ai` values, not
   values. An alternative is a share ("5 of 8 confirmed"), which also counts facets that are empty
   and undecided. Decide once the first real numbers are visible in the grid.
3. **Does the review queue sort oldest first or by lowest confidence?** `confidence` exists on
   `ai` rows. Oldest first is predictable. Lowest confidence puts the likely mistakes first.
   Start with oldest first and revisit after a few review sessions.

## Verification

1. **Browse:**
   1. Open the overview and click a tile. The inspector opens beside a four-column grid, and the
      URL carries `?asset=…`. A reload reopens it.
   2. An asset with model guesses shows dashed chips and a counter on its tile.
   3. Click its `mood` row, keep the preselected values and save. The chips turn solid, and the
      counter on the tile drops by one.
   4. Re-classify that asset by SQL, as in the `0004` verification. `mood` is unchanged, and the
      other facets are refreshed.
2. **Confirm all:** on an asset with three undecided facets, "Confirm all" leaves it with no
   dashed chip and no counter. `asset_facet_decision` holds three new rows. `audit_log` holds three
   facet writes.
3. **Phone:** at 390 px wide the grid has two columns and selecting a tile opens the bottom sheet.
   "Copy prompt" puts the prompt on the clipboard.
4. **Review:**
   1. Filter by `mood: calm`. "Review N" shows the number of matching assets with undecided facets.
   2. In review mode, `2` toggles the second value of the current facet, and `⏎` confirms and
      moves to the next undecided facet.
   3. After the last facet, `→` opens the next asset. The filmstrip marks the first one done.
   4. `S` skips an asset. Leaving and re-entering review mode brings it back.
   5. When the queue is empty, the empty state shows and links back to the gallery.
5. **MCP:** `search_assets` returns `unconfirmedFacets` per card. After "Confirm all" the asset
   from step 2 reports `0`.

## Decided during implementation (release 1)

1. **The card carries `origin` per facet value and `unconfirmedFacets`**, both additive. The
   "Facets" view needs the origin to draw dashed chips without loading every detail.
2. **"Undecided `ai` facet" has one definition**, `unconfirmedFacetKeys` in `@moodboard/shared`:
   the facet holds an `ai` value, no `human` value and no decision row. The `human` value check
   matches the guard from migration `0006`, which treats a human value as a decision too. The api
   uses it for the cards, the web for an asset it has just edited, so the tile counter and the
   inspector never disagree.
3. **An edit in the inspector patches its tile in place** (`OverviewStore.patch`) from the
   `AssetDetail` the write returns. The grid is not reloaded, so pages scrolled in stay. The facet
   counts on the pills catch up with the next refresh.
4. **"Confirm all" is one `PUT` per facet, one after the other.** Each is the ordinary facet edit
   with its own decision row and audit entry. A failure part-way keeps what was saved, and the
   panel shows that state.
5. **`?asset=` is read by the overview, not by the search schema.** `AssetQuerySchema` stays strict
   and shared with MCP. Changing only `asset` neither reloads the grid nor loses the scroll
   position. A filter change keeps the inspector open.
6. **The masonry measures tiles instead of computing them from the image ratio.** In the
   "Facets" view a tile has chips under its image, and only the browser knows how they wrap. The
   image box keeps its aspect ratio before the thumbnail loads, so nothing jumps.
7. **The column count follows the grid's own width** (a container query: 5 above 1100 px, then 4,
   3, 2). Beside the docked 380 px panel a 1440 px window gets four columns. Below 1100 px the
   panel floats over the grid, and at phone width (≤ 720 px) it becomes a bottom sheet.
8. **A pill opens its values under the pill row**, not as a popover, so the row can scroll
   sideways on a phone without clipping what it opens. Escape or a click outside closes it.
9. **The detail page `/assets/:id` is unchanged.** Tags, description, visual details and the
   measured technique stay there. The inspector links to it ("Open page").

### Verified (release 1)

- **Against a stub api in Chromium** (1440 × 900, 1000 × 800, 390 × 844): five columns, four
  with the inspector open, two on a phone, no horizontal scroll. Selecting a tile puts
  `?asset=` into the URL, and a reload reopens it. Saving `mood` unchanged drops the tile
  counter by one, and "Confirm all" removes it and every dashed chip. A filter pill sets
  `facet=` and keeps `asset=`. Escape closes the values first, then the inspector. Below 1100 px
  the panel floats, on a phone it is a bottom sheet with "Confirm guesses (N)" and "Copy prompt".
  No console errors.
- **Api** (`asset-search.integration.spec.ts`, PGlite): cards carry `origin` and
  `unconfirmedFacets`, and a decision row lowers the count.
- **Web** (`overview.store.spec.ts`): a filter change keeps `asset`, and a patched tile gets the
  new counter. **Shared**: `unconfirmedFacetKeys`.
- `nx run-many -t lint,test,build`: green, except the worker's capture integration test, which
  cannot launch the browser in the development container (Playwright version mismatch, worker
  code unchanged).

Not verified: Verification 1.4 (re-classification by SQL), 2 (`audit_log` rows), 3's clipboard on
a real phone and 5 (`search_assets` over MCP) need the deployed instance.

## Decided during implementation (release 2)

1. **The queue is `GET /api/assets?review=1`**, a flag on the shared `AssetQuerySchema`. The
   search's own `facet`, `q`, `tag` and `author` apply unchanged, the order turns to oldest first
   and the cursor runs the other way. `search_assets` declares its own input and has no such
   field, so the flag stays out of MCP, as decided above.
2. **The SQL condition mirrors `unconfirmedFacetKeys`**: an `ai` value in a facet with no `human`
   value and no decision row. Its tables are aliased, because the facet counts run it inside a
   query that joins the same tables.
3. **"Review N" counts with a second request** (`review=1&limit=1`, only its `total`) on every
   load and refresh of the overview. It shows only when N is above zero. A count inside the main
   search would have changed `AssetSearchResult`, which MCP shares.
4. **Review mode is its own route, `/review`**, with the overview's filter parameters. "Back",
   the end screen and `Esc` return to the gallery with the same filter. A reload starts the queue
   afresh: confirmed assets have left it, skipped ones are back.
5. **The current facet is the first undecided one in vocabulary order**; clicking another
   undecided row makes it current. `1`–`9` cover the first nine values; the rest are a click.
   `⇧⏎` saves the current facet with the chosen values and every other undecided facet with what
   it holds. After the last facet the asset is marked done and stays on screen; `→` moves on.
6. **A website shows its poster (the viewport) with a switch to the full page**, which scrolls
   inside the stage. Uploads show `thumb_lg`.
7. **On a phone** the stage shrinks to a third of the height and the key hints disappear, so the
   current facet is in view without scrolling.

### Verified (release 2)

- **Api** (`asset-search.integration.spec.ts`, PGlite): the queue is oldest first, respects the
  filter and pages forward by cursor; an asset leaves it once every guessed facet is decided or
  holds a `human` value. The guard from migration `0006` refused the test's attempt to turn a
  `human` value back into `ai`.
- **Web** (`overview.store.spec.ts`): the overview asks for the queue size with the current filter.
  **Shared**: the flag parses, refuses anything but `1`/`true` and round-trips.
- **Against a stateful stub api in Chromium** (1440 × 900, 390 × 844): `mood: calm` shows
  "Review 3". In review mode `2` adds a value, `⏎` saves the facet and makes the next one current,
  `⇧⏎` saves the rest, and the stub received four `PUT …/facets/:facet` with the chosen values. `→`
  moves on, and the filmstrip marks the first asset done. The full-page switch scrolls inside the
  stage. `S` twice reaches the end screen ("1 confirmed, 2 skipped"); a reload brings back the two
  skipped assets, and once they are confirmed it shows "Nothing left to review". `Esc` returns to
  `/?facet=mood:calm`, where the button is gone. On a phone, tapping a value and "Confirm" saves
  it. No horizontal scroll, no console errors.
- `nx run-many -t lint,test,build`: green for all projects.

Not verified: Verification 4 against real data, which needs the deployed instance.

## Rollout

v0.11.0 deployed 2026-10-31 (gitops `3e3bdcd`): ArgoCD synced and healthy, api, web and worker
on the `0.11.0` images, no errors in the api or worker logs.

- **Verification 4 (review):** done by the user on the three live assets. Every facet of all three
  is now `human`; the queue is empty.
- **Verification 2 (`audit_log`):** the review left 34 `asset.facet_set` entries, one per saved
  facet, and `asset_facet_decision` holds the matching rows.
- **Not verified:** 1.4 (re-classification of a confirmed asset) needs a write to `analysis_run`
  in SQL, which was not permitted this time, as in `0006`. 3 (clipboard on a phone) and 5
  (`search_assets` over MCP) were not run.

### Finding: the confidence is per run, not per facet

The user's first review had to go through every facet of every asset, and asked whether review
should only cover what the model is unsure about. It cannot today: the classification returns
**one** `confidence` for the whole run (`libs/classify/src/lib/prompt.ts`), and the classify step
writes that number onto every `ai` value of the asset. Production holds three distinct values
(0.72, 0.80, 0.90) across 94 `ai` rows. Sorting or filtering the queue by `confidence` (open
question 3) would sort assets, not facets, and the per-facet `confidence` column carries no
information of its own. A queue that skips confident guesses needs a confidence per facet from
the model first — a prompt change, so a new prompt version and a re-analysis.

