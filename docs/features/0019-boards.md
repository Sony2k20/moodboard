# 0019 — Boards: the briefing package

> Status: accepted — implemented, deployed in v0.19.0 (2026-11-02)
> Phase: 3
> Created: 2026-11-02

---

## Problem

Facets and tags say what an asset *is*. Nothing says what a set of assets is *for*. When Claude
Code is asked to build something "in the direction we collected", it gets either one reference
(`get_asset`) or a search result (`search_assets`) — a list without intent. Hand a model seven
references without saying which aspect of each one is meant and it blends seven directions
(§5.4). A person curating a direction has nowhere to say "this one for the palette, that one for
the layout, and explicitly not like this third one", and an agent has no package to work from.

## Scope

All of phase 3 (§11) in one release:

- **Tables** `board`, `board_item`, `board_filter` (§5.4) as migration `0016_board`.
- **Boards page** `/boards`: every board with title, kind, item count, author and the first
  pictures. Create a manual board; open one.
- **Board page** `/boards/:id`: title and **briefing** editable in place; the items in order,
  each with its picture, **role** (`color`, `layout`, `typography`, `motion`, `imagery`, `copy`,
  `overall`), **weight** (`primary`, `secondary`, `avoid`) and a **note**; reorder by drag and
  drop and with move-up/move-down buttons (the keyboard path); remove an item.
- **Adding assets**: from the overview's multi-select ("Add to board", role `overall`, weight
  `primary`, appended) and from the detail page ("Add to board" with a role). The same asset may
  appear in one board once per role — a site can give a board its palette *and* its layout.
- **Smart boards**: "Save as smart board" in the filter bar stores the current filter. Its items
  are the filter's result, newest first, at most 60 — always current, every item `overall` and
  `primary`. A smart board's filter is shown as chips and opens in the overview.
- **Derived, computed server-side** (§10.1), shown on the board page and returned by
  `get_board`: `palette`, `typePairings`, `motionSummary`, `commonFacets`, `conflicts`.
- **Tokens** from the derived values in four formats: plain JSON, W3C design tokens, CSS custom
  properties, a Tailwind v4 `@theme` fragment. Copyable on the board page.
- **A briefing prompt** assembled from the board, like the build prompt of one asset (0008):
  copyable on the board page, returned by `get_board`.
- **MCP**: `list_boards`, `get_board`, `get_design_tokens` (§10).
- **Deleting a board**: its creator or an admin; hard delete, the content goes to the audit log.
  The assets stay.
- Command palette: "Boards" as a page.

### Derivation rules

Deterministic, no model involved. "Active" items are those with weight `primary` or `secondary`;
`avoid` items feed only `avoid` lists and `conflicts`.

- **`palette`**: colours of active items with role `color` — or, when the board has none, of
  active `overall` items (`palette.source` says which). Each asset's colours count by their share
  of the picture, times 1 for `primary` and 0.5 for `secondary`; colours closer than ΔE 12 (CIE76,
  Lab) are merged into the heavier one. At most eight, by weight. `palette.avoid` holds the
  colours of `avoid` items with role `color` or `overall`, merged the same way.
- **`typePairings`**: one per active item with role `typography` (or `overall`, when there is no
  typography item): the heading and body family where the capture measured them (`h1`, `body`),
  the family of a font asset, and the item's `typography` facet values.
- **`motionSummary`**: across active items with role `motion` (or `overall`, when there is none):
  `motion` facet values with how many items carry them, detected libraries, the most common
  measured transitions and the keyframe names.
- **`commonFacets`**: facet values every `primary` item carries — the actual direction. With a
  single primary item that is its values. `type`, `project` and `industry` are left out; they say
  what a reference is, not what it looks like.
- **`conflicts`**, named, never averaged:
  - `split` — `primary` items disagree on a single-value facet (`theme:light` vs `theme:dark`,
    `density:airy` vs `density:dense`).
  - `avoided` — a value a `primary` item carries is carried by an `avoid` item as well, so the
    board both wants and rejects it.

### Tokens

Built from `palette` (as `color.palette-1…n` by weight), the first type pairing (`font.heading`,
`font.body`), and, from active items with a capture, the most common radii, shadows and font
sizes and the durations and easings of their transitions. A value missing from every item is left
out, never invented.

### Not in scope

- **Per-item roles on smart boards.** A smart board is a saved filter; curating its items means
  making a manual board from them.
- **Agents writing boards.** No `create_board` or `add_to_board` over MCP. Boards are a person's
  curation; an agent reads them.
- **Public board links** — "Later / Open" in §11.
- **Board-level permissions.** Everyone sees and edits every board, as with metadata (§9).
- **Image collages or exports** (PDF, PNG) of a board.
- **A board's own trash.** Deleting a board is final; the audit log holds what was in it.

## Data model impact

**Additive** — three new tables with foreign keys onto `asset` and `user` (§5.4 says so too):

```
board          id, title, briefing, kind (manual|smart), created_by, created_at,
               updated_by, updated_at
board_item     id, board_id, asset_id, position, role, weight, note, added_by, added_at
               unique (board_id, asset_id, role)
board_filter   board_id, filter jsonb             -- kind = smart only
```

- `role` and `weight` are Postgres enums from `@moodboard/shared`, like the existing ones.
- No `origin`: every board row is a person's curation; no model writes here. Every change goes to
  `audit_log` with entity `board`.
- `board_item.asset_id` cascades on the purge (0006): an asset gone for good leaves its boards. A
  **trashed** asset is hidden from the board but its item stays, so restoring it restores its
  place.
- `board_filter.filter` stores the query in its URL form (`assetQueryParams`), parsed with
  `AssetQuerySchema` on read — the same contract as the overview's URL.

## Vocabulary impact

None. Roles and weights are a board's own fixed keys, not a facet; no re-analysis, no prompt
change.

## i18n impact

New strings for the boards and board pages, the add-to-board controls, roles, weights, derived
sections, conflicts and tokens, in `en.json` and `de.json`. Role and weight **keys** (`color`,
`avoid`) are machine-readable and never translated (§13.3); their labels are. Title, briefing and
notes are a person's free text, stored as written. The briefing prompt and the tokens are English
in either UI language — they are input for a model and for code.

## MCP impact

- **`list_boards`** (new; not in §10's table, but `get_board` is unusable without a way to find
  an id): id, title, kind, item count, briefing excerpt, updated at.
- **`get_board`**: the shape of §10.1 — title, briefing, items with role, weight, note and the
  asset's facets, colours, description, image URL, capture URL and technique — plus `derived`,
  `tokens` and the briefing prompt, and the pictures of up to twelve items as images, each
  introduced by its position, role and weight.
- **`get_design_tokens`**: for a board or a single asset, in one of the four formats or all.
- The server instructions say that a board is the package to work from, that `avoid` items are
  counter-examples, and that `conflicts` must be resolved with the person, not averaged.

## Known limits

- **Derived values are only as good as the metadata.** A board of unclassified assets has an
  empty `commonFacets` and no conflicts; a palette needs the `colors` step to have run.
- **Typography comes from captures and font assets only.** An uploaded screenshot contributes its
  `typography` facet values, not a family name.
- **Colour merging is perceptual but naive** (CIE76 ΔE, fixed threshold). Two close blues stay
  two colours if they are ΔE 13 apart.
- **A smart board shows at most 60 items** — the newest of the filter. A filter wider than that
  is a search, not a briefing.
- **A board holds at most 100 items.** Beyond that it no longer briefs anyone.
- **`get_board` sends at most twelve pictures**, `primary` first, then `avoid`, then `secondary`;
  the rest are listed with their image URLs.
- **Tailwind output is v4's `@theme`.** A v3 project has to move the values into
  `theme.extend` itself.

## Open questions

None.

## Verification

1. Create a board "Pricing relaunch" with a briefing. From the overview, select three assets and
   add them to it; on a fourth asset's detail page add it with role `color`.
2. On the board page set roles and weights: one `layout` primary, one `typography` primary, one
   `overall` avoid. Reorder by drag and drop and with the buttons; add a note. Reload: everything
   is as left.
3. The derived panel shows the palette from the `color` item, the type pairing of a captured
   site, the common facets of the primaries, and a conflict when two primaries disagree on
   `theme`.
4. Copy the CSS custom properties: they hold the palette colours and the font families.
5. In the overview filter by `style:editorial`, save as a smart board: it lists the same assets;
   a newly classified editorial asset appears on it without editing the board.
6. Trash an asset on a board: it disappears from the board; restoring it brings it back at its
   position.
7. MCP: `list_boards` lists the board; `get_board` returns items with roles, `derived`, tokens,
   the briefing prompt and the pictures; `get_design_tokens` for the board in `css` returns the
   same properties as the page.
8. A member cannot delete another person's board; its creator can, and the audit log holds its
   items.

## Decided during implementation

1. **The command palette lists the boards page, not each board.** Boards by title would need the
   list loaded with every palette opening; the boards page is one keystroke further. Revisit when
   there are more boards than fit on that page.
2. **"New board…" in the add-to-board select** creates a board and adds to it in one step, so
   curating does not start with a detour to `/boards`.
3. **Reordering keeps hidden items' positions.** The page sends the items it shows; they take the
   positions they held between them. An item of a trashed asset keeps its own, so restoring the
   asset brings it back where it was — even after the board was reordered meanwhile.
4. **A smart board's filter drops paging and the review queue**, and an empty filter is refused:
   without a filter a smart board is the overview.
5. **`get_design_tokens` takes an asset as well as a board**, treating it as the board's only
   primary item — an agent building from one reference gets the same token shape.
6. **Shadows keep the measured CSS string** in the W3C format, without `$type`: the format's
   shadow value is structured, and parsing every measured shadow into it is guesswork.
7. **The Lab conversions moved from the worker to `@moodboard/shared`** (`color.ts`), since a
   board's palette merges colours by the same distance and threshold as `asset_color` (ΔE 12).
8. **A board's items are read through `AssetSearchService.detail`**, one call per asset, so an
   item shows exactly what the asset's page and `get_asset` show. At 100 items that is 100
   detail reads per board view — fine at the sizes a briefing has.

### Verified (before release)

- **Shared** (`board-derive.spec.ts`): palette merging by weight and ΔE with the overall fallback
  and the avoid list; type pairings from a capture and a font; the motion summary; common facets
  without `type`/`project`/`industry`; both conflict kinds; all four token formats from measured
  values, nothing invented for an empty board; the briefing prompt's roles, counter-examples and
  notes.
- **Api** (`boards.integration.spec.ts`, PGlite): items with roles, weights, notes and order, the
  same asset in two roles but not twice in one, a role change refused when taken; a trashed asset
  hidden and restored at its place across a reorder; a trashed asset refused; delete only by the
  creator or an admin, with the content in the audit log and the assets kept; a smart board's
  stored filter, its live result, and refused curation.
- **MCP** (`mcp.integration.spec.ts`, real client): the seven tools; `list_boards`, `get_board`
  with the §10.1 shape, the prompt and a picture per item, `get_design_tokens` in `css`, and an
  error without an id.
- **Against a stub api in Chromium**: creating a board, "New board…" from a detail page, adding
  with a role (and "already on the board" for a repeat), adding the overview's selection; on the
  board page weight `avoid`, a note, the briefing, move buttons (focus follows the item and
  switches to the other button at the top), drag and drop, the derived panel (palette, avoid
  colours, Fraunces/Inter from a capture, a `theme` split and an `avoided` conflict), the token
  tabs and the prompt; a smart board saved from `style:editorial` with its chips and overview
  link and no curation controls; deleting a board. No horizontal scroll at 375 px.
- `nx run-many -t lint,test,build`: green.

Not verified before release: the migration against the production Postgres, and boards with
real classified assets and pictures in a signed-in session.

## Rollout

v0.19.0 deployed 2026-11-02 (gitops `c358af4`): ArgoCD synced and healthy, api, web and worker
on the `0.19.0` images; the migration step reported `Migrations applied.`, so `0016_board` ran.
Without a session `GET /api/boards` answers `401`, and `/boards` is served.

**Not verified:** 1–8 in a signed-in session — boards with real classified assets, and the MCP
tools against production with a personal token.
