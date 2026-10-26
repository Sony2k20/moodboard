# Mood Board App

A self-hosted, team-wide **design memory**. Images, screenshots, colour palettes, typefaces and
website references are collected, classified automatically by an LLM, and made findable through
a controlled facet vocabulary.

The primary consumer is not a human but **Claude Code**: an MCP server delivers structured
design references straight into development — instead of "looks good", an answer like
`{pattern: hero, layout: split-left-text, motion: parallax-on-scroll, palette: [...]}`.

## Status

**Concept phase.** No application code yet. The full concept lives in
[`docs/concept.md`](./docs/concept.md) — data model, facet vocabulary, classification pipeline,
deployment architecture and the phased plan.

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

To follow, along with the project scaffolding.
