# Mood Board App

A self-hosted, team-wide **design memory**. Images, screenshots, colour palettes, typefaces and
website references are collected, classified automatically by an LLM, and made findable through
a controlled facet vocabulary.

The primary consumer is not a human but **Claude Code**: an MCP server delivers structured
design references straight into development — instead of "looks good", an answer like
`{pattern: hero, layout: split-left-text, motion: parallax-on-scroll, palette: [...]}`.

## Status

**Phase 1 in progress.** Deployed and usable: sign in through Authentik, upload images, and find
them again by facet, full-text search or author once the worker has classified them. Editing
metadata, website capture and the MCP server are still to come.

| Step | State |
|---|---|
| [`0001`](./docs/features/0001-foundation-data-model.md) Workspace, data model, vocabulary | done — schema and 93 vocabulary values live in the cluster database |
| [`0002`](./docs/features/0002-deployment-foundation.md) Images, CI, Helm chart | done — three images on GHCR, synced by ArgoCD |
| [`0003`](./docs/features/0003-oidc-login.md) OIDC login, BFF session, emergency admin | done — login through Authentik is live; emergency admin implemented, not enabled |
| [`0004`](./docs/features/0004-upload-job-pipeline.md) Upload and the job pipeline | done — upload, thumbnails and classification verified end to end on `v0.2.2` |
| Website capture | not started |
| i18n | done — Transloco with English and German, language switcher, `user.locale` persisted |
| [`0005`](./docs/features/0005-overview-search.md) Overview: grid, facet filters, search | done — live in `v0.3.0` |
| [`0006`](./docs/features/0006-editing-trash.md) Editing, bulk tagging, trash | done — live in `v0.4.0` |
| [`0007`](./docs/features/0007-model-titles.md) Titles by the model | done — live in `v0.5.0` |
| [`0008`](./docs/features/0008-build-prompt.md) Build prompt per asset | done — live in `v0.5.0` |
| [`0009`](./docs/features/0009-visual-details.md) Visual details for the build prompt | done — live in `v0.6.0` |
| [`0010`](./docs/features/0010-mcp-server.md) MCP server: search, get, vocabulary, add | implemented — not yet deployed |

**Authentication is on**: every data endpoint requires a session, and every row written from here
on can name the human who acted — which is what `origin = 'human'` (concept §5.6) rests on.

The full concept lives in [`docs/concept.md`](./docs/concept.md) — data model, facet vocabulary,
classification pipeline, deployment architecture and the phased plan. It is the source of truth;
read it before making design decisions.

## Core idea

> The quality of the structured metadata *is* the product. The frontend is an accessory.

An image tagged "nice" is worthless. What makes it valuable is machine-readable facets, an
extracted colour palette and — for website references — the animation technique actually in
use. Every design decision in the concept resolves in favour of metadata quality.

## Planned stack

| Area | Choice |
|---|---|
| Monorepo | Nx (Angular + NestJS) |
| Backend | NestJS, BullMQ, Drizzle |
| Frontend | Angular, Tailwind, Transloco |
| Database | PostgreSQL |
| Queue | Valkey |
| Classification | Claude (`@anthropic-ai/sdk`), provider replaceable |
| Website capture | Playwright + ffmpeg |
| Auth | Authentik (OIDC) |
| Deployment | k3s via ArgoCD, Helm, Traefik `IngressRoute`, Cloudflare Tunnel |

Reasoning for each choice is in [`docs/concept.md`](./docs/concept.md) §3.

## Phases

1. **Overview, classification and website capture** — drop in an asset or a URL, get it
   classified automatically, find it again through facets, read it over MCP
2. **Sharpening** — components with code, fonts, command palette, batch re-analysis
3. **Boards** — curated asset combinations with roles and weighting, forming a briefing package
   for the AI
4. **Expansion** — deep analysis by an agent, region selection, semantic search

## Documentation

```
docs/
├── concept.md           The overall concept. Start here.
└── features/
    ├── template.md      Template for new feature documents
    └── NNNN-<slug>.md   One document per feature, numbered
```

Feature documents are numbered so they can be referenced from the concept and from each other.
The template asks the questions that turned out to be the expensive ones in this project —
whether a change can be retrofitted, and whether it forces a re-analysis of existing assets.

## Languages

The application UI is available in **English (default) and German**, switchable at runtime.
Everything else — code, database identifiers, documentation, commit messages — is English only.
See [`docs/concept.md`](./docs/concept.md) §13.

## Releasing

Semantic versioning, one version for chart and images. While phase 1 is in progress the major
version stays 0: a new feature is a minor release, a fix a patch.

1. Set `version` and `appVersion` in [`deploy/chart/Chart.yaml`](./deploy/chart/Chart.yaml) to the
   new version, commit.
2. `git tag vX.Y.Z && git push origin vX.Y.Z` — the publish workflow checks that the tag matches
   the chart and pushes the images as `X.Y.Z` and `X.Y`.
3. In the ArgoCD Application, set `targetRevision: vX.Y.Z`. Nothing else: the image tag comes
   from the chart's `appVersion`.

## Development

Requires Node 24 and npm 11. Postgres is an external dependency, operated by CloudNativePG in
the cluster, and is reached locally through a port-forward rather than a local instance (concept
§4.9) — the connection details belong in `.env`, see [`.env.example`](./.env.example). Valkey
becomes relevant with the job pipeline; nothing here depends on it yet.

```bash
npm install

npx nx run-many -t lint,test,build    # all projects
npx nx serve api                      # NestJS API
npx nx serve worker                   # BullMQ consumer
npx nx serve web                      # Angular frontend

npm run db:generate                   # diff the schema into a new migration
npm run db:migrate                    # apply migrations (same code the initContainer runs, §4.11)
npm run db:seed                       # seed the facet vocabulary, idempotent
```

`npm run db:migrate` and `npm run db:seed` need a reachable database. They read `DATABASE_URL`,
or the key names CloudNativePG puts in its application secret (`uri`, or `host` / `port` /
`dbname` / `username` / `password`), so in the cluster the secret can be mounted as-is with no
key-by-key mapping.

### Layout

```
apps/api        NestJS    REST API, auth, search, MCP endpoint
apps/worker     NestJS    BullMQ consumer: thumbnails, capture, classification
apps/web        Angular   Signals, standalone components
libs/shared     —         Facet vocabulary, Zod schemas, the StorageService port
libs/db         —         Drizzle schema, migrations, vocabulary seed
libs/storage    —         HostPath adapter for the StorageService port
libs/classify   —         Classification port; provider adapters
```

`libs/shared` is imported by the Angular bundle, so it carries no Node dependency. That is
enforced by the `platform:` tags and the module-boundary rule in `eslint.config.mjs`, not by
discipline.

### Deployment

```
deploy/chart    Helm chart — generic defaults only
apps/*/Dockerfile
.github/workflows/ci.yml       lint, test, build, schema-vs-migrations, chart rendering
.github/workflows/publish.yml  three images to GHCR, sha-<commit> and v<semver>
```

```bash
helm lint deploy/chart
helm template moodboard deploy/chart            # defaults
helm template moodboard deploy/chart --set ingress.kind=Ingress
```

Environment-specific values — domain, issuer URL, HostPath, UID, registry owner — are set in the
ArgoCD Application and deliberately live outside this repository (concept §4.3). The database is
a separate ArgoCD Application: CloudNativePG creates its secret while bootstrapping the cluster,
so the chart only references it (§4.3.1).

One manual step on the node, once, before the first upload — `fsGroup` has no effect on
`hostPath` volumes, so Kubernetes cannot do this:

```bash
sudo mkdir -p /srv/moodboard/assets
sudo chown -R 1000:1000 /srv/moodboard
```
