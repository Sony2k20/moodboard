# 0006 — Editing, bulk tagging and the trash

> Status: implemented — not yet deployed
> Phase: 1
> Created: 2026-10-30

---

## Problem

The classification is good but not always right, and nobody can correct it. The detail page
(`0005`) shows a wrong `mood` or a missing `ui_pattern`, and the only way to fix it is SQL — which
is how the `0004` verification had to set a `human` facet. The whole provenance design (`origin`,
the guards, §5.6) exists for corrections that cannot be made yet.

Two further gaps follow from the same missing write side. Assets cannot be grouped by hand: the
`project` facet is curated per client (§6) but nothing can set it, and tagging thirty screenshots
of one project one by one is not going to happen. And nothing can be removed: a wrong upload
stays in the overview for good, and the four test assets from `0004` are soft-deleted by SQL with
no way to purge them.

## Scope

- **Edit one asset** on the detail page from `0005`, which becomes editable rather than replaced:
  - **Title and description.** A saved description gets `description_origin = 'human'`; the guard
    from `0004` already keeps it through every re-analysis.
  - **Facets, one facet at a time.** Saving a facet replaces its whole value set with what the
    person chose, **every value written as `human`** — including values the AI had set and the
    person left in place. They saw them and kept them; leaving them as `ai` would let the next
    re-analysis delete them while the guard blocks the replacement. The facet is then marked as
    decided (see data model), also when the person emptied it.
  - **Tags.** Add and remove. A tag a person removes is remembered as rejected, so a re-analysis
    does not bring it back.
- **Multi-select in the overview** with an action bar: add or remove tags, add or remove facet
  values, move to trash. At most 100 assets per action. Each asset goes through the same service
  as a single edit, so a bulk action means exactly what the same edit on each asset would mean.
- **Trash.** Delete is a soft delete (`deleted_at`). `/trash` lists what is in it — own assets for
  members, everything for admins (§9) — with restore. After 30 days a job in the worker purges an
  asset for good: rows and stored files. The `0004` test assets go the same way.
- **Permissions (§9):** anyone signed in may edit metadata and tags, also of other people's
  assets; deleting and restoring only one's own, admins everything. Every write goes to
  `audit_log` with the previous and the new value.
- **`PATCH /api/assets/:id`** (title, description), **`PUT /api/assets/:id/facets/:facet`**
  (`{ values }`), **`PUT /api/assets/:id/tags`** (`{ tags }`), **`POST /api/assets/bulk`**,
  **`DELETE /api/assets/:id`**, **`POST /api/assets/:id/restore`**, **`GET /api/trash`**.

### Not in scope

- **Re-classifying an asset on demand.** Useful, and the reconciler can already do it, but it is
  the batch re-analysis UI of phase 2 in small. Until then: SQL, as in the `0004` verification.
- **Undo** beyond the trash. The audit log holds the old values; a UI for it can come later.
- **Maintaining the vocabulary** (new `project` values) — the admin item of §11, its own feature.
  Until then the `project` facet stays empty in the UI because it has no values.
- **Editing through MCP.** Phase 1 has no write tool for agents besides `add_asset` (§10).
- Concurrent-edit detection, see known limits.

## Data model impact

**Three changes, and none of them can be retrofitted** — each records a human decision that a
re-analysis would otherwise erase before the record exists. They belong in this feature because
this is the first one that lets a person make those decisions.

1. **`asset_facet_decision (asset_id, facet_id, decided_by, decided_at)`** — this facet of this
   asset is a person's. The facet guard (`0001`, rule 2) discards an `ai` write into a facet that
   has a decision row, in addition to one that has a `human` value. Without it, a person who
   empties a facet ("this has no motion worth naming") leaves no `human` row behind, and the next
   re-analysis fills the facet again.
2. **`asset_tag_rejection (asset_id, tag_id, rejected_by, rejected_at)`** — a tag a person removed.
   The tag guard discards an `ai` insert of a rejected tag. Adding the tag back by hand deletes
   the rejection. Tags are scoped per tag rather than per list, like their guard: a person who
   removes one wrong tag should not freeze the AI out of the others.
3. **Who is writing, declared per transaction.** The guards refuse to delete a `human` row — also
   for a person removing their own correction, and also in the cascade of a purge, which is why
   the `0004` test assets could only be soft-deleted. The api and the purge job set
   `SET LOCAL moodboard.actor = 'human'` (or `'purge'`) in their transaction; the guards allow
   deleting `human` rows only when it is set. The classify step never sets it, so a re-analysis
   still cannot touch them. A guard against application bugs, not against someone with database
   access — that is what it was before, too.

Additive on top: an index on `asset (deleted_at) where deleted_at is not null` for the trash and
the purge.

## Vocabulary impact

None. No re-analysis. Facet edits offer exactly the values of the vocabulary, single-value facets
(`type`, `theme`, `density`) take one.

## i18n impact

- New strings for the edit controls, the action bar, the trash and the confirmations, in
  `en.json` and `de.json`.
- Facet values stay keys in every request; the controls show labels.
- Descriptions remain English by decision (§13.3). A person may write a German one — nothing
  prevents it — but it then misses the English stemmer of the full-text search. The edit field
  says so.

## MCP impact

No new tools. `get_asset` already returns `origin` per facet value and for the description
(`0005`), so an agent can tell what a person confirmed from what a model guessed. The tool
description should say that `human` values are confirmed and weigh more. Trashed assets disappear
from `search_assets` and `get_asset`, as they already do.

## Known limits

- **The last save wins**, per facet, per tag list, per text field. Two people editing the same
  facet at the same moment overwrite each other; the audit log shows both. Detection (an
  `updated_at` precondition) is cheap to add when it ever happens.
- **A decided facet never takes a model's improvement.** That is the point of §5.6, but it also
  means a better prompt cannot correct a person's mistake. Undoing a decision — handing a facet
  back to the AI — is not in this feature.
- **Files of a trashed asset stay reachable by their URL** until the purge, for signed-in users.
  All assets are visible to all of them anyway (§2).
- **The purge is final.** The database backup is a monthly `pg_dump`; stored files are not part of
  it.

## Open questions

None that block the start. Decided here:

1. **A facet edit owns the whole facet**, not single values. The guard already works per facet,
   and a person who looks at a facet and saves it has judged all of its values.
2. **Rejections per tag, not ownership of the tag list.** See data model, point 2.
3. **The actor is declared per transaction rather than the guard being relaxed.** It keeps the
   rule "a model never deletes a person's value" in the database, where §5.6 puts it.

## Decided during implementation

1. **A saved tag list confirms the tags left in it**, like a saved facet: they become `human`. A
   bulk action does not — it adds or removes one tag across assets and says nothing about the
   others.
2. **The retention period is a chart value**, `trash.retentionDays` (default 30), read by the api
   (to show the purge date) and the worker (to purge). Verification step 7 sets it to 0.
3. **Tag normalisation moved to `libs/shared`**, so a person's tags are stored like the model's:
   lower-case, whitespace collapsed, at most 64 characters. `Client X` and `client x` are one tag.
4. **In select mode a tile carries no link.** `RouterLink` navigates even after
   `preventDefault`, so a selecting click opened the detail page. Found while clicking through.
5. **The guards are tested against PGlite with a replay of the classify step's writes** — the
   rule that matters is what a re-analysis does after an edit. PGlite has one connection: a test
   that queries `db` inside an open transaction waits for itself.

## Verification

1. On the detail page, change `mood`: the saved values show as `by hand`. Trigger a
   re-classification (SQL, as in `0004`): `mood` is unchanged, the other facets are refreshed.
2. Empty `motion` and save. Re-classify: `motion` stays empty.
3. Remove an AI tag, re-classify: it does not come back. Add it again by hand: it stays.
4. Edit the description, re-classify: the description is unchanged, and the search finds the new
   wording.
5. Select 20 tiles, add the tag `client-x`: all 20 carry it, the audit log has 20 entries, and
   `tag=client-x` in the overview finds exactly them.
6. As a member, delete someone else's asset: refused. Delete an own one: gone from the overview,
   listed in `/trash`, restorable. As an admin, delete and restore anyone's.
7. With the purge window shortened for the test, the purge removes the asset's rows and files —
   also for an asset with `human` facets, which the guard blocked so far.
8. Every write endpoint without a session: `401`.
