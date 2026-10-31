# 0014 — Vocabulary maintenance: project values

> Status: accepted
> Phase: 1
> Created: 2026-10-31

---

## Problem

`project` is the one facet a person curates rather than a model guesses: "per client or project,
curated by an admin" (§6). It ships with no values, and nothing in the application can add one.
So a team cannot say "these twelve references are for client X", although that is the first
question asked of a mood board before a pitch. Tags stand in, but they are free-form, untranslated
and spelled differently by everyone, which is exactly what the controlled vocabulary exists to
prevent (§5.2).

§9 already decides who may do it: extending the controlled vocabulary is for admins. §11 lists
"Admin maintenance for the vocabulary" as the last open data item of phase 1.

## Scope

- **An admin page `/vocabulary`**, linked in the header for admins only. It lists every facet
  with its values, labels in both languages, and how many assets use each value.
- **`project` values can be created, relabelled and deleted there:**
  - **create:** English and German label, an optional description in both languages, and the
    machine-readable key. The key is proposed from the English label (`Client X Relaunch` →
    `client-x-relaunch`) and can be adjusted before saving. New values go to the end of the list.
  - **relabel:** both labels and the description. The key stays, so URLs, filters, MCP calls
    and audit entries keep working (§13.3).
  - **delete:** only while no asset — trashed ones included — carries the value. A used value
    shows its count and cannot be deleted.
- **Api:** `POST /api/vocabulary/:facet/values`, `PATCH` and `DELETE
  /api/vocabulary/:facet/values/:value`. Admins only (`403` otherwise). Each write goes to
  `audit_log` with `entity = 'facet_value'`.
- **Everything else already follows the database:** filter pills, the inspector, bulk tagging,
  `search_assets` and `list_vocabulary` read the values at runtime. A new project value can be
  assigned and filtered by at once; the web reloads the vocabulary after an admin write.

### Not in scope

- **Values of the classified facets** (`style`, `mood`, …). They are defined in code because the
  prompt and the output grammar are built from them (§7.2): a new value there is a new prompt
  version and a re-analysis (§6, §7.5), a code change with a release. The page shows them
  read-only and says so.
- **New facets.** Same reason, plus the prompt-space cost of §6.
- **Renaming a key.** A key is in URLs, MCP filters and the audit log; changing it is a
  migration, not a form field.
- **Reordering values.** Insertion order until a list is long enough to need more.
- **Merging two values, or deleting a used one** (which would also remove people's assignments,
  something the origin guards refuse for good reason, §5.6). Reassign through bulk tagging first,
  then delete.
- **Per-project visibility or access.** Everyone still sees everything (§9).

## Data model impact

**Additive only. No migration.** `facet_value` already has `label` and `description` as
`{en, de}` `jsonb` (§13.5) and `sort_order`. The seed upserts the coded vocabulary on every
deploy and never deletes, so values an admin created survive every migration run. The seed
cannot collide with them either: `project` has no coded values.

## Vocabulary impact

No change to a classified facet, **no re-analysis**. `project` stays out of the prompt; the
model never sees or guesses it.

## i18n impact

- New UI strings for the page, its form, the counts and the "classified in code" note, in
  `en.json` and `de.json`.
- Both labels are required when a value is created, so a German interface never falls back to
  English for a project. The form pre-fills the German label with the English one.
- The key is single-language and never translated (§13.3).

## MCP impact

None in shape. `list_vocabulary` returns `project` with its values as soon as they exist, and
`search_assets` accepts `project:<key>` as a filter. An agent asked for "the references for
client X" finds the key there rather than guessing it.

## Known limits

- **A used value cannot be deleted** without reassigning its assets first, one bulk action per
  value.
- **Deleting is permanent.** The value and its audit entry go; assets that had it never did.
- **Two admins editing the same value:** the last save wins, as everywhere (`0006`).
- **Labels are not checked for duplicates**, only keys are. Two values may read the same in one
  language.

## Open questions

None that block. Whether projects later need a client grouping or an archive flag is answered
once there are more than a handful.

## Verification

1. As an admin, open `/vocabulary`. Every facet is listed; the classified ones are read-only.
2. Add "Client X Relaunch": the key is proposed as `client-x-relaunch`, the German label is
   pre-filled. Save. The value is listed with 0 uses.
3. In the overview, the `project` pill offers "Client X Relaunch"; assign it to an asset in the
   inspector. Filtering by it shows the asset. Back on `/vocabulary` the value shows 1 use and
   cannot be deleted.
4. Relabel it. The overview shows the new label; the URL filter `project:client-x-relaunch`
   still works.
5. As a member, `/vocabulary` says it is for admins, and the api answers `403`.
6. `audit_log` holds the create, the relabel and, after removing the assignment, the delete.
7. MCP: `list_vocabulary` lists the value under `project`.
