# 0008 — A build prompt per asset

> Status: done — deployed in v0.5.0 (2026-10-30)
> Phase: 1
> Created: 2026-10-30

---

## Problem

The point of a reference is to build something in its style (§1). Today that means reading the
detail page and retyping its facets, palette and description into Claude Code. The structured
metadata is exactly what such a briefing needs; it only has to be put into words.

## Scope

- **`buildPrompt(asset, vocabulary)` in `libs/shared`**: a pure function that turns an
  `AssetDetail` into a prompt for Claude Code or Claude Design to build a UI in that style —
  patterns, layout, style, mood, theme, density, typography, palette with shares, motion, the
  description and the tags.
- **Assembled from the metadata, no model call.** Free, instant, and always current: a facet a
  person corrects is in the next prompt.
- **Detail page:** a "Prompt for Claude Code" section with a preview and a copy button. The
  original image is not inlined; the hint says to attach it.

### Not in scope

- A prompt for image generators (Midjourney and the like) — decided against, the consumer is
  Claude Code (§1).
- Prompts for several assets at once — that is the board's briefing (§5.4, phase 3).
- Writing the prompt with the model.

## Data model impact

None. Nothing is stored; the prompt is computed from what is.

## Vocabulary impact

None. Labels come from the vocabulary in English.

## i18n impact

The prompt is English in either UI language — it is input for a model, like the description
(§13.3). The section heading, hint and button are translated.

## MCP impact

None yet. Because the function lives in `libs/shared`, `get_asset` can return the same text
later instead of every agent writing its own.

## Known limits

- **The prompt is as good as the metadata.** An unclassified asset gets a thin prompt; empty
  facets are left out rather than guessed.
- **The image is not in the prompt.** `/files` URLs need a session, so an agent cannot fetch
  them; the person attaches the original.
- **Fixed wording.** A template, not prose — readable for a model, plain for a person.

## Open questions

None.

## Verification

1. Open a classified asset: the prompt names its patterns, the palette in order of share with
   the largest as background, and its description.
2. Change a facet: the prompt changes with it, without a reload.
3. Copy: the clipboard holds the prompt; the button confirms.
4. Switch the UI to German: the prompt stays English.
