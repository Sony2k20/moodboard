# 0015 — Batch re-analysis

> Status: accepted — implemented, deployed in v0.15.0 (2026-11-02)
> Phase: 2
> Created: 2026-11-02

---

## Problem

Re-analysis already happens, but nobody can see or steer it. The worker's reconciler picks up 50
assets every ten minutes whose last successful run is below `PROMPT_VERSION` (§7.5), and gives up
on an asset after three failed runs at the current version. After a prompt bump that means:

- nobody knows how much of the corpus is still classified by the old prompt, or when it will be
  done;
- an asset that failed three times stays unclassified for good, silently;
- a result that is plainly wrong cannot be re-run without a code change — the reconciler only
  looks at the version, never at a person's judgement;
- nobody sees what the month has cost against the limit until the limit stops the worker.

The metadata is the product (§1). The tool that keeps it current has to be visible.

## Scope

- **An admin page `/analysis`**, linked in the header for admins. It shows:
  - the current prompt version and whether classification is enabled at all;
  - the live corpus split into four states: **current** (a succeeded run at the current prompt
    version), **outdated** (succeeded, but only below it), **unclassified** (never succeeded,
    still being retried) and **stuck** (no success at the current version and three or more
    failed runs there — the reconciler's cap);
  - a breakdown of current and outdated assets by prompt version and model;
  - this month's LLM spend against the monthly limit, and the average cost of a run over the
    last 30 days;
  - how many pipeline jobs are waiting or running;
  - the latest failed runs with asset, error and time, linked to the asset.
- **Two corpus actions on that page**, each with the count and an estimated cost in its
  confirmation: *Re-analyse outdated* and *Retry stuck*. Both enqueue `classify` at once instead
  of waiting for the reconciler's 50-per-tick pace.
- **Re-analysing a selection**, for everyone: a *Re-analyse* button in the bulk bar (up to
  `MAX_BULK_ASSETS`) and on the detail page. That re-runs assets already at the current version —
  the case the reconciler never covers.
- **Api:** `GET /api/analysis` (admins) returns the summary; `POST /api/analysis/requests` takes
  either `{ ids }` (anyone) or `{ scope: 'outdated' | 'stuck' }` (admins) and answers
  `{ queued }`. Each queued asset gets an `audit_log` entry `analysis.requested`.
- The page polls every five seconds while jobs are waiting, so the counts move as runs finish.

### Not in scope

- **The Message Batches API** that §7.5 names. At a few hundred assets a full re-run costs a few
  dollars at the normal price; halving it does not pay for a second result path with polling, up
  to 24 hours of latency and its own error handling. The queue already respects the cost limit
  and the worker's concurrency. Revisit when a full re-run costs real money.
- **Prompt caching for re-analysis** (§7.3). It depends on the batch path above.
- **Choosing a model or prompt version per request.** A re-analysis always uses what the worker
  is configured with; anything else would produce runs nobody can reproduce from the chart.
- **Cancelling queued jobs.** A queued re-analysis of an asset costs cents; the monthly limit is
  the guard against a runaway.
- **Re-capturing websites.** A re-analysis classifies the stored capture again; a new capture is
  the existing retry for failed captures (0011).

## Data model impact

**None. No migration.** Everything the page shows is derived from `analysis_run`, which records
provider, model, prompt version, cost and status from day one (§2, §5.5) — exactly what makes
this feature possible without a backfill.

`PROMPT_VERSION` moves from `@moodboard/classify` into `@moodboard/shared`, so the api can name
the current version without importing the provider SDK. `@moodboard/classify` re-exports it.

## Vocabulary impact

None. This is the tool that makes the *next* vocabulary change cheap to roll out.

The invariant is untouched (§5.6): a re-analysis is the same `classify` step as always, and the
database guards discard every `ai` write where a person has decided. A re-analysis never needs
to — and never may — check for human values itself.

## i18n impact

New UI strings for the page, the four states, the confirmation texts and the button in the bulk
bar and the detail page, in `en.json` and `de.json`. Model ids, prompt versions and error
messages are shown as they are, untranslated (§13.3).

## MCP impact

None. Re-analysis is curation by people; an agent reads the results through `search_assets` and
`get_asset` as before. `get_asset` already returns the run that produced the current metadata.

## Known limits

- **Estimates are averages.** The cost shown before a corpus action is the count times the
  average run of the last 30 days; a website with a long technique costs more than an image.
- **The queue is not a record.** Valkey runs without persistence (0004): a worker restart during
  a large re-analysis loses the queued jobs. Outdated assets are picked up again by the
  reconciler; a re-run of *current* assets requested by hand is lost and has to be requested
  again.
- **A request while the same asset is already queued is a no-op** — the job id is deterministic.
- **With classification disabled** (`llm.enabled: false`) the api refuses requests with `409`
  rather than queuing work no worker will do.
- **"Stuck" depends on the cap of three.** An asset that failed twice is still "unclassified" and
  will be retried by the reconciler on its own.

## Open questions

None that block.

## Verification

1. As an admin, open `/analysis`. The four counts add up to the number of live, ready assets;
   the month's spend matches the sum of this month's `analysis_run.cost_usd`.
2. Select three assets in the overview, *Re-analyse*. The page shows jobs waiting; within a
   minute each of the three has a new `analysis_run` and a fresh `classified at`.
3. Correct a facet on one of them first. After the re-analysis the correction is still there,
   as `human`.
4. *Retry stuck* on a stuck asset: a new run is attempted although the reconciler had given up.
5. As a member, `/analysis` says it is for admins, `GET /api/analysis` and a scope request answer
   `403`; re-analysing a selection works.
6. `audit_log` holds one `analysis.requested` entry per queued asset.

## Decided during implementation

1. **Stuck wins over outdated.** An asset with an old result and three failures at the current
   version is stuck: the reconciler has given up on it either way. `analysisState` in
   `@moodboard/shared` decides this once, for the api and its tests.
2. **The version breakdown counts the run the metadata came from** — each asset's newest
   succeeded run — not every run. An asset classified at versions 4 and 5 counts once, under 5.
3. **The api reads `LLM_ENABLED` and `LLM_MONTHLY_COST_LIMIT_USD`** from the chart, as the worker
   does. It never sees the API key.
4. **The detail page's button only queues.** It says the result appears in about a minute
   instead of polling the asset: a classify run does not change `status`, which is what the page
   follows for a capture.
5. **The month's spend counts failed runs too**, as the worker's guard does: a refused request
   with a fallback is still billed.

### Verified (before release)

- **Api** (`analysis.integration.spec.ts`, PGlite): the four states over a corpus with a current,
  an outdated (with one failure at the current version), an unclassified and a stuck asset, a
  trashed and a pending one left out; the version breakdown by latest run; month spend, average
  run and the latest failures; scope requests queue with the asset's pipeline (`website` for a
  website) and are audited; a member re-runs a selection, current asset included, trashed and
  pending skipped; summary and scopes refuse a member; disabled classification refuses with
  `409`.
- **Shared** (`analysis.spec.ts`): the state precedence and the request schema.
- **Against a stub api in Chromium** (1280 × 900, 390 × 844): `/analysis` shows the four counts,
  actions, cost with meter, version table and failures; *Retry stuck* asks with the estimated
  cost (3 × $0.046 = $0.138), reports "3 queued", and the queue count falls to 0 through polling.
  In the overview, two selected tiles and *Re-analyse* ask once and report "2 queued". No
  horizontal scroll on a phone.
- `nx run-many -t lint,test,build`: green for all projects.

Not verified before release: the detail page's button in a browser (the stub serves no asset
detail; build and lint cover the template), and a real run through the worker — that needs the
cluster.

## Rollout

v0.15.0 deployed 2026-11-02 (gitops `3548d6b`): ArgoCD synced and healthy, api, web and worker
on the `0.15.0` images.

- Without a session, `GET /api/analysis` and `POST /api/analysis/requests` answer `401`, and
  `/analysis` is served.
- **Not verified:** 1–6 in a signed-in session, and the api's view of `llm.enabled` — reading
  the pod's environment and logs was refused to this session. Opening `/analysis` as an admin
  shows both at once: the counts, the month's spend and whether classification is on.
