# 0004 — Upload and the job pipeline

> Status: done — deployed in v0.2.0, verified end to end on v0.2.2 (2026-10-30)
> Phase: 1
> Created: 2026-10-29

---

## Problem

A signed-in user can do nothing yet: there is no way to put an image into the application, and
nothing that turns an image into the structured metadata that is the product (concept §1). The
tables exist (`0001`), the classification contract exists (`AnalysisResultSchema`, the
`AssetClassifier` port), the storage port and its HostPath adapter exist — but no code path
connects them.

Everything after this step depends on assets existing: the overview needs something to show,
website capture is a further pipeline step, and the MCP tools `search_assets` / `get_asset`
need classified assets to return.

## Scope

- **Upload**: drag & drop, clipboard paste, several files at once. PNG, JPEG, WebP and GIF; the
  format is verified from the file content, never from the name or the `Content-Type`. One HTTP
  request per file, so a failing file does not take the others with it and each has its own
  progress.
- **`POST /api/assets`** stores the original through `StorageService`, creates the `asset` row
  (`status = 'pending'`, `type = 'image'`, `created_by` = the session user), writes `audit_log`,
  enqueues the pipeline and answers immediately (§7.1).
- **The job pipeline in the worker**, on BullMQ over the existing Valkey: `normalize →
  thumbnails → colors → classify`. Each step is its own job with its own retries; a failure in a
  late step never undoes an early one (§7.1).
  - `normalize`: decode with `sharp`, verify, record dimensions in `asset_file`.
  - `thumbnails`: `thumb-sm` 320 px, `thumb-md` 800 px, `thumb-lg` 1600 px wide, WebP, EXIF
    orientation applied, no metadata. Animated GIFs: first frame.
  - `colors`: palette of up to 6 colours, k-means in Lab on a 64 × 64 downscale, written to
    `asset_color` with `ratio` and `position`. No library — about 60 lines, and the Lab
    conversion is needed anyway.
  - `classify`: the **Anthropic adapter** in `libs/classify` (CLAUDE.md defaults: `claude-opus-5`,
    `effort: 'low'`, server-side refusal fallback, `messages.parse()` with `zodOutputFormat`).
    Input is a 1568 px-long-edge WebP rendered for the model. Writes facets and tags with
    `origin = 'ai'`, the description, and one `analysis_run` row per attempt — failed attempts
    included.
  - `index` (§7.1) is **not a job**: `asset_search.tsv` is maintained by a trigger since `0001`.
- **`asset.status`** becomes `ready` once `thumbnails` and `colors` are done — the asset is
  viewable. Classification state is read from `analysis_run`, not from `status`; an asset is
  usable unclassified (§7.1). `failed` means the file itself is unusable (`normalize` failed).
- **A reconciler in the worker**, at start and every 10 minutes: re-enqueues assets stuck in
  `pending`, and assets without a succeeded `analysis_run` at the current `prompt_version` while
  the LLM is enabled. Required, not optional: Valkey runs without persistence (chart), so a
  restart loses queued jobs — the database is the source of truth, the queue only a schedule.
- **Monthly cost limit** (`llm.monthlyCostLimitUsd`): before each `classify`, the sum of
  `analysis_run.cost_usd` for the calendar month is checked; over the limit, the job is skipped
  and the reconciler picks the asset up next month. A guard against loops, not a budget (§7.4).
- **`GET /files/<asset-id>/<file>`** serves stored files through the api, behind the session
  guard (the ingress already routes `/files` there). `Cache-Control: private`.
- **Minimal web UI**: a drop zone on the start page (drop, paste, file picker) and a list of the
  latest uploads with thumbnail, status and whether it is classified. Not the overview — the
  masonry grid, filters and detail view are the next step.

### Not in scope

- URLs and website capture — the `capture` step is the next feature (§8). The pipeline is built
  so that it slots in between `colors` and `classify`.
- Editing metadata, the detail view, delete and trash.
- MCP `add_asset` — it will call the same ingest service, but the MCP server is a later step.
- Batch re-analysis via the Batch API (§7.5) — phase 2 UI; the reconciler covers the
  single-asset case.
- SVG, AVIF, HEIC, video uploads. SVG in particular: rendering untrusted SVG is a script and
  XXE surface for no gain in phase 1.

## Data model impact

**Mostly additive — with one exception that cannot be retrofitted.**

Additive: nothing new for files, colours, facets, tags or runs; the tables from `0001` fit.

**Not retrofittable: `asset.description` has no provenance.** The description is LLM-written and
is the primary search material (§5.1), and it is editable by humans once the detail view exists.
Without an origin, the first re-analysis after a human correction overwrites it silently —
exactly the failure §5.6 exists to prevent, just on a column instead of a join table. So this
feature adds:

- `asset.description_origin origin NOT NULL DEFAULT 'ai'`
- a trigger with the same two rules as the facet guard: an `ai` write over a `human` description
  is discarded, not raised (a re-analysis must complete), and nothing written as `ai` can turn a
  `human` description back.

It belongs here rather than with the editing UI because this is the feature that first writes
descriptions; adding it later would mean guessing for every existing row who wrote it.

`title` needs no such column: the model never writes it. `asset.type` mirrors the `type` facet
and is updated only when the facet write was not discarded by the guard.

**`ocr_text` gets no column yet.** It stays in `analysis_run.raw_response`. A column plus its
inclusion in `asset_search.tsv` is additive and can be backfilled from the stored raw responses
without a re-analysis.

## Vocabulary impact

None. The prompt is generated from the vocabulary in `libs/shared`; `prompt_version` starts at
1. Every later change to the prompt or the vocabulary bumps it, which is what makes targeted
re-analysis possible (§7.5).

## i18n impact

New UI strings for the drop zone, upload errors and the status list — in `en.json` and
`de.json`. Status and facet values stay machine keys in the data; only their display is
translated (§13.3). The description is English by decision (§13.3).

## MCP impact

None directly. Two things prepared for it:

- The ingest logic lives in a service, not in the controller, so `add_asset` reuses it.
- `analysis_run` records provider, model and prompt version from the first asset on, so
  `get_asset` can later say how a classification came about.

## Known limits

- **One image, one look.** `motion` stays empty for still images in principle — it is filled by
  website capture keyframes (§8.2).
- **GIFs are classified from their first frame.**
- **Classification takes seconds to a minute** after the upload; the asset shows up first,
  its facets later.
- **Lost jobs are found within 10 minutes**, not immediately, after a Valkey or worker restart.
- **Upload size limit 25 MB per file.** Design references above that are almost always
  uncompressed exports.
- **`multer` 2.4.0 carries a DoS advisory** (GHSA-q7qp-rjg7-q26m) and stays for now. Only Nest 12
  ships the fixed version, and an npm `overrides` entry does not survive `nx prune` — the image
  build fails on it. The advisory needs an asynchronous `fileFilter`; the upload uses none, and
  the controller says that none may be added before the move to Nest 12.

## Decided

1. **The stored original stays byte-exact; metadata is stripped from everything derived from
   it** — thumbnails and the image sent to the model. Deviates from §7.1, which says
   `normalize` strips EXIF: doing that to the original means re-encoding it, lossy for JPEG, and
   EXIF also carries the orientation, so stripping it without re-encoding turns photos sideways.
   Fidelity of the reference is the point. Accepted trade-off: an uploaded photo can carry GPS
   coordinates in its original, visible to every signed-in user; screenshots, the bulk of the
   corpus, carry none.
2. **Local development has its own database and queue.** A `moodboard_dev` database on the same
   CNPG cluster, the queue prefix `mb-dev` (production: `mb`), and a local `STORAGE_ROOT`.
   Until now local work used a port-forward to the production database; with uploads a local
   upload would create a production `asset` whose files exist only on the laptop, and a local
   worker on the cluster's Valkey would take production jobs. Closes open point 3 of §12.
3. **The structured-output schema is built by hand, not with `zodOutputFormat`.** Deviates from
   CLAUDE.md. The SDK helper in the installed version moves every `enum` into the description
   text, so the vocabulary would no longer be enforced by the grammar and the model could produce
   a value outside it. `libs/classify/src/lib/output-schema.ts` derives the JSON schema from the
   same Zod schema with `enum` intact and validates the response against Zod afterwards — the
   contract of §7.2 is unchanged.

## Verification

1. Drag three images onto the start page: three requests, three rows in the list, each
   `pending` → `ready` within seconds, thumbnails visible.
2. Paste a screenshot from the clipboard: same result.
3. Upload a `.txt` renamed to `.png`: refused with 415, nothing written to storage or database.
4. On the node: `<asset-id>/original.png` and `thumb-{sm,md,lg}.webp` exist under the HostPath,
   owned by UID 1000. This is also the first proof that the HostPath is writable
   (`infra.local.md`).
5. With `llm.enabled: true`: facets, tags and description appear; `analysis_run` has provider,
   model, `prompt_version = 1`, tokens and cost.
6. Set a facet to `origin = 'human'` by hand, trigger a re-classification: the human value
   stays, the run completes.
7. Restart Valkey while an asset is `pending`: within 10 minutes it is `ready` anyway.
8. `GET /files/<asset-id>/thumb-sm.webp` without a session: 401.

**Result (2026-10-30, v0.2.2):** all eight pass. Four test images went from upload to a succeeded
`analysis_run` in about six seconds each, at roughly $0.026 per classification. How the steps
were run, so the next verification can repeat them:

- Drop and paste were dispatched as synthetic events in the signed-in browser. A paste event
  dispatched on `document` itself fails in `onPaste` (`document` has no `closest`); a real paste
  always targets an element, so this does not happen in use.
- Step 6 has no endpoint yet: the facet and the description were set to `human` in SQL, and the
  run marked `failed` so the reconciler picked the asset up. Afterwards the facet held only the
  two human values, the description was unchanged, and the run succeeded.
- Step 7 set an asset to `pending` with an `updated_at` older than the grace period, then
  restarted Valkey. The worker logged connection timeouts while Valkey was gone and recovered on
  its own; the next reconcile tick re-enqueued the asset and it was `ready` again. Re-running
  `normalize` also re-runs `classify`, so a lost job costs one more classification.
- The test assets were soft-deleted (`deleted_at`). A hard delete is impossible once an asset
  carries a `human` facet: the cascade fires the origin guard, which refuses to delete human
  assignments. The delete endpoint will have to soft-delete, or the guard needs to exempt the
  cascade.
