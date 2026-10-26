# 0001 — Foundation: workspace, data model and vocabulary

> Status: accepted
> Phase: 1
> Created: 2026-10-26

---

## Problem

Phase 1 of the concept (§11) is a greenfield build: the repository holds documentation and no
code. Phase 1 as a whole is too large for one pass, so it has to be cut into steps — and the
first cut is not free to choose. Concept §2 names four things that **cannot be retrofitted**:
`origin` on all metadata, `analysis_run` with `prompt_version`, `jsonb` labels on the
vocabulary, and the `StorageService` interface. On top of those sits the central invariant
(§5.6), `origin = 'human'` always wins over `origin = 'ai'`, which has to be designed in because
no test will catch its absence.

Any step that delivers visible value first — an upload form, a grid, a classification run —
would have to write into tables that do not exist yet, and would create pressure to add the
provenance columns "later". Later is exactly when they become unreconstructable.

## Scope

- Nx monorepo with the project structure from §3: `apps/api`, `apps/worker`, `apps/web`,
  `libs/shared`, `libs/classify`, plus `libs/db`.
- `libs/shared`: the facet vocabulary from §6 as the single source of truth, the Zod enums
  derived from it, `AnalysisResultSchema` (§7.2), the `LocalizedText` schema for `jsonb` labels
  (§13.5), and the `StorageService` interface (§4.2).
- `libs/db`: the Drizzle schema for §5.1, §5.2, §5.3 and §5.5, generated migrations, a
  hand-written migration for the invariant triggers and the `tsvector` trigger, and an
  idempotent vocabulary seed.
- `libs/classify`: the `AssetClassifier` port and its DI token. Interface only.
- `libs/storage`: the HostPath adapter for that port, kept out of `libs/shared` because it
  imports `node:fs`.

### Not in scope

Deliberately absent, all of it still phase 1 and all of it additive:

- Helm chart, GitHub Actions, GHCR, cloudflared, running the migrations in the cluster
- OIDC/BFF login and the emergency admin account
- The BullMQ job pipeline, the Anthropic adapter, any LLM call
- Playwright website capture
- Angular UI beyond the generated skeleton: no grid, no detail view, no Transloco setup
- The MCP server
- Admin maintenance for the vocabulary
- Board tables (§5.4, phase 3) and `asset_embedding` (§7.6, phase 4)

Also out of scope: running the migrations. Postgres is operated by CloudNativePG in the cluster
and is reached locally through `kubectl -n prod port-forward svc/moodboard-database-rw`, but the
database and its secret only exist after the first ArgoCD sync — which belongs to the deployment
step, not this one. The schema, the migrations and the seed are therefore written so they can be
generated and type-checked without a reachable database; running them is the first action once
one exists.

What is in scope is the connection handling: the application reads CloudNativePG's own secret key
names (`uri`, or `host` / `port` / `dbname` / `username` / `password`) in addition to
`DATABASE_URL`, so the chart can mount that secret with `envFrom` and nothing has to be kept in
sync with the operator.

## Data model impact

**This change is the part that cannot be retrofitted.** That is the entire reason it comes
first.

Carried from day one, per §2:

| Item | Where |
|---|---|
| `origin` (`ai` \| `human`) | `asset_facet_value`, `asset_tag` |
| `analysis_run` with `prompt_version` | own table, §5.5 |
| `jsonb` labels | `facet.label`, `facet.description`, `facet_value.label`, `facet_value.description` |
| `StorageService` interface | `libs/shared`, HostPath adapter separate |

Everything additive is left out rather than guessed at.

Two further decisions worth recording:

- **`libs/db` is a separate library, not part of `libs/shared`.** `shared` is imported by the
  Angular bundle; Drizzle and `pg` must not be reachable from there. The concept lists five
  projects (§3) and does not name `libs/db`; this is that list plus one, for that reason.
- **`asset_search.tsv` is written by a trigger**, not by application code, so it cannot drift
  from title and description. Free-form tags stay out of it (§13.4). This is a deviation from
  §5.3, which calls it a generated column: a generated column may only reference columns of its
  own row, and title and description live on `asset`. Keeping the separate table from §5.3 and
  filling it from a trigger preserves the property that matters.

### Enforcing the invariant

§5.6 requires database-level enforcement. Implemented as triggers on `asset_facet_value` and
`asset_tag`:

- A write with `origin = 'ai'` is **silently discarded** when a row with `origin = 'human'`
  already exists for that asset and that facet. A re-analysis then completes instead of failing;
  it simply has no effect where a human has decided.
- An attempt to update or delete an existing `origin = 'human'` row from an `origin = 'ai'`
  write **raises**. Discarding here would hide a caller doing something it should not.

The asymmetry is intentional: the first case is normal operation (§7.5 re-analysis), the second
is a bug.

## Vocabulary impact

The vocabulary from §6 is introduced in full, unchanged, as the seed. No new facets, no new
values, no re-analysis implied — there are no assets yet.

`playful` appears in both `style` and `mood` by design (§6) and is not deduplicated.

`project` is seeded as a facet with no values; it is curated by admins per client or project.

Because the vocabulary lives in `libs/shared` and the Zod enums are derived from it, removing a
value breaks compilation rather than failing at runtime. That is the stated purpose of
`libs/shared` (§3) and is verified once below rather than assumed.

## i18n impact

- No new UI strings: there is no UI in this step, so `en.json` / `de.json` stay untouched.
- New translatable database content: yes — facet and facet value labels and descriptions. They
  are `jsonb` with `{en, de}`, validated by a Zod `LocalizedText` schema, never text columns
  (§13.5).
- Single-language by rule: `facet.key` and `facet_value.value` (§13.3). They feed the Zod enums,
  the LLM prompt and the MCP filters.

## MCP impact

No tools in this step. What it does fix is the shape they will later serve: `list_vocabulary`
returns exactly the seeded `facet` / `facet_value` rows including their `jsonb` labels, and the
`origin` column is what lets `get_asset` later distinguish a human decision from a model guess.
Getting those wrong here would be visible in every tool response afterwards.

## Known limits

- **Nothing is usable yet.** This step produces no running feature. That is accepted in exchange
  for the four irreversible items being right.
- **The invariant is verified manually, by hand, in `psql`.** There is no automated test for it
  in this step, because there is no test database. The concept is explicit that no test catches
  its absence (§5.6) — the triggers are the mechanism, the manual check is the evidence.
- **The migrations are unexecuted** until a database is reachable. Generated SQL that has never
  run is not proven SQL.
- **The module boundaries are enforced by lint, not by the type system.** `platform:` tags plus
  `@nx/enforce-module-boundaries` catch a `libs/db` import from the Angular app; skipping lint
  would not.
- **`to_tsvector('english', …)` is hardcoded.** Correct only because descriptions are English by
  decision (§13.4). If that decision ever changes, this column changes with it.

## Open questions

- **The migration and the CNPG secret are a first-install ordering problem.** The migration reads
  a secret the operator only creates while bootstrapping the cluster. Resolved in the deployment
  step (`0002`) by letting the database be its own ArgoCD Application — but it is the reason the
  migration runner exits non-zero rather than warning.
- **`docs/concept.md` §4.3 still shows `postgres.existingSecret: moodboard-db` with the keys
  `host, port, database, user, password`.** The real secret is created by CNPG and uses
  `dbname` / `username`. The concept is the source of truth, so this is left for an explicit
  decision rather than edited in passing. Owner: the user.

## Verification

Without a database, possible immediately:

1. `npx nx run-many -t lint,build` — every project builds; `libs/shared` builds with no Node-only
   imports reaching it.
2. `npx drizzle-kit generate` twice in a row produces no second migration file: the generated
   schema matches what is committed.
3. Remove a value from the vocabulary in `libs/shared` and compile: the facet's label map no
   longer type-checks (`TS2353`), because `valueLabels` is keyed by the value tuple. Restore it
   afterwards. This proves the §3 claim rather than restating it. The unit tests in
   `vocabulary.spec.ts` cover the runtime half: every value has both labels, and
   `AnalysisResultSchema` accepts exactly the vocabulary values.

With a database, once one is reachable:

4. `npm run db:migrate && npm run db:seed`, then both a second time: no errors, no duplicate
   facets or values.
5. In `psql`: set a facet value on an asset with `origin = 'human'`, then write the same facet
   with `origin = 'ai'`. The row stays `human` and the insert returns without error. Then try to
   update and to delete that `human` row as `ai`: both raise.
6. Update an asset's `description` and read `asset_search.tsv`: it contains the new lexemes with
   no separate indexing step.
