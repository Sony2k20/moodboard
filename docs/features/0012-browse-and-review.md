# 0012 — Browse and review: the overview with an inspector

> Status: draft
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

1. **Review mode in phase 1?** It is not on the §11 list. Recommendation: yes, as release 2. It
   adds no table and no endpoint beyond one query parameter. It is also the most direct lever on
   the north star: more `human` facets, faster. The user decides. If not, release 2 moves to
   phase 2 unchanged.
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
