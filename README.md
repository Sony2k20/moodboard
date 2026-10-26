# Mood Board App

A self-hosted, team-wide **design memory**. Images, screenshots, colour palettes, typefaces and
website references are collected, classified automatically by an LLM, and made findable through
a controlled facet vocabulary.

The primary consumer is not a human but **Claude Code**: an MCP server delivers structured
design references straight into development — instead of "looks good", an answer like
`{pattern: hero, layout: split-left-text, motion: parallax-on-scroll, palette: [...]}`.

## Status

**Phase 1 in progress.** The workspace, the data model and the facet vocabulary are in place
(see [`docs/features/0001-foundation-data-model.md`](./docs/features/0001-foundation-data-model.md));
deployment, authentication, the job pipeline, website capture, the UI and the MCP server are
still to come. The full concept lives in [`docs/concept.md`](./docs/concept.md) — data model,
facet vocabulary, classification pipeline, deployment architecture and the phased plan.

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
npm run db:migrate                    # apply migrations (also the ArgoCD PreSync job, §4.11)
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
