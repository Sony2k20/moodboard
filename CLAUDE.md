# CLAUDE.md

Guidance for Claude Code working in this repository. Rules and pitfalls only — the architecture
lives in [`docs/concept.md`](./docs/concept.md), which is the source of truth. Read it before
making design decisions rather than re-deriving them.

## North star

> The quality of the structured metadata **is** the product. The frontend is an accessory.

## Language

- **Everything written is English**: code, database identifiers and contents, documentation,
  comments, commit messages, PR descriptions, the facet vocabulary.
- **Conversation with the user is German.** Both at once — English artefacts, German replies.
- The application UI is the one exception: English (default) and German, switchable at runtime
  via Transloco. Machine-readable keys (facet `value` such as `calm`, `hero`) are never
  translated. See §13.

## This repository is public

Never commit environment-specific values. Concretely forbidden in versioned files:

- Domains and hostnames (app, Authentik issuer URL)
- HostPath directories, node names, UIDs taken from the real cluster
- Hardware details, private email addresses

These live in `docs/infra.local.md`, excluded via `*.local.md`. This file is public too and is
bound by the same rule. After pushing, verify what actually landed — a `404` on
`docs/infra.local.md` is the expected result.

The commit identity is set repo-locally to the GitHub noreply address. Do not change it, and do
not fall back to the global config.

## Scope discipline

Implement **phase 1 only** (§11). Later phases are described in detail, but that detail is a
plan, not an invitation.

For a new feature: write a document from [`docs/features/template.md`](./docs/features/template.md)
**first**, then implement. The template asks the two questions that are expensive to answer
late — whether a change can be retrofitted, and whether it forces a re-analysis of existing
assets.

## Data model: what cannot be retrofitted

Before touching the schema, check these four against §2. Everything else is additive and may
wait:

1. `origin` (`ai` / `human`) on all metadata
2. `analysis_run` with `prompt_version`
3. `jsonb` labels on the vocabulary
4. The `StorageService` interface

**The central invariant** (§5.6), enforced at the database level:

> `origin = 'human'` **always** wins over `origin = 'ai'`.

A re-analysis must never overwrite human corrections. No test will catch a violation of this;
it has to be designed in.

## Working style

The user wants a **recommendation with reasoning**, not a list of options — "make me a concrete
proposal" is the standing request. Decide, state why, and name the trade-off you accepted. Ask
only when the answer would genuinely change the work.

## Commits

- English, imperative subject line, with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- **Separate file moves from content changes.** A move plus a rewrite in one commit means Git no
  longer detects the rename and `git log --follow` loses the history. Move first, change second.

## LLM integration defaults

- Model `claude-opus-5` with `output_config: { effort: 'low' }` — classification gains little
  from more deliberation (§7.3)
- Always enable server-side refusal fallbacks (`betas: ['server-side-fallback-2026-07-01']`,
  `fallbacks: 'default'`); third-party screenshots occasionally trip a safety classifier, and
  without a fallback the asset silently stays unclassified
- Use `@anthropic-ai/sdk` directly with `client.messages.parse()` and `zodOutputFormat`. Do not
  introduce a generic multi-provider wrapper — the Zod schema is the contract, each adapter uses
  its own native SDK (§7.2)

## Known pitfalls

| Area | Pitfall |
|---|---|
| Playwright in k8s | `/dev/shm` defaults to 64 MB and Chromium crashes; mount an `emptyDir` with `medium: Memory`, `sizeLimit: 1Gi` |
| Website capture | Cookie banners are the most common cause of a useless capture. Report failures instead of storing a blank image |
