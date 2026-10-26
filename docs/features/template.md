# NNNN — <Feature name>

> Status: draft | accepted | implemented | rejected
> Phase: 1 | 2 | 3 | 4 | later
> Created: YYYY-MM-DD

Copy this file to `NNNN-<slug>.md`, using the next free number. The number makes the document
referenceable from the concept and from other features.

---

## Problem

What is missing, and for whom? One or two paragraphs. Describe the problem, not the solution —
if the problem cannot be stated without naming the solution, it is not understood yet.

## Scope

What this feature covers.

### Not in scope

What it deliberately does not cover. This section is usually the more useful of the two,
because it is what prevents scope creep during implementation.

## Data model impact

> **Leading question: is this change additive, or can it not be retrofitted?**

See concept §2. Additive changes (new tables, new nullable columns) are cheap and can wait.
Changes that cannot be retrofitted have to be right the first time, because retrofitting them
means losing data or rewriting history:

- Columns recording *provenance* (who or what set a value)
- Anything the LLM pipeline writes, where the prompt version matters
- Splitting a single-value column into a structured one

State explicitly which of the two this is. If it cannot be retrofitted, it belongs in the
earliest phase that touches the affected table, not in the phase where the feature is wanted.

## Vocabulary impact

> **Leading question: does this require a re-analysis of existing assets?**

- New values inside an existing facet → cheap, no re-analysis needed
- A **new facet** → costs prompt space and therefore accuracy on the remaining facets, and
  requires a re-analysis of the entire corpus (concept §6, §7.5)
- Renaming a `value` → migration; renaming a `label` → translation only

Remember that `origin = 'human'` always wins (concept §5.6). Any re-analysis has to preserve
manual corrections.

## i18n impact

- New UI strings? They go into `en.json` **and** `de.json` — a missing key is a lint failure
- New translatable database content? Then it needs a `jsonb` label, not a text column
  (concept §13.5)
- Anything that must stay single-language? Machine-readable keys always do (concept §13.3)

## MCP impact

Claude Code is the primary consumer (concept §1), so this section is not optional.

- New tools, or changes to existing ones?
- Does the result shape change for `search_assets` or `get_asset`?
- Does an agent need to know something new in order to use this correctly? If so, is that
  discoverable through `list_vocabulary`, or does it have to be guessed?

## Known limits

What this feature will *not* do well, written down **before** implementation rather than
discovered after. Properties of the chosen approach, not bugs. See concept §8.3 for the tone:
cookie banners, bot detection and capture duration were all known limits, not surprises.

## Open questions

Things that need a decision before or during implementation. Name who decides, if it is not
obvious.

## Verification

How to tell this works end to end. Not "unit tests pass" — what does someone do in the running
application to see it working?
