# 0013 — Review what the model is unsure about

> Status: accepted
> Phase: 1 (decided 2026-10-31)
> Created: 2026-10-31

---

## Problem

Review mode (`0012`) queues every facet a model filled that no person has decided. The first
real review covered three assets and still meant confirming 34 facets one by one, most of them
obviously right. That does not scale: at a few hundred assets nobody works through the queue,
and the `human` share stays where it was. The person wants to spend their attention where the
model is unsure and let the obvious guesses stand.

The data cannot say where the model is unsure. The classification returns **one** `confidence`
for the whole run, and the classify step writes that one number onto every `ai` value of the
asset. Production holds three distinct values across 94 `ai` rows (0.72, 0.80, 0.90). A filter
on it would keep or drop whole assets, not the facets that are actually doubtful (`0012`,
"Finding").

## Scope

- **A confidence per facet from the model.** The analysis result gains `facet_confidence`, one
  number from 0 to 1 for each classified facet, next to the existing overall `confidence`. The
  number rates the facet as a whole — the values chosen *and* the ones left out — because a
  facet is confirmed as a whole (`0006`, `0012`).
- **The prompt anchors the scale**, so the numbers spread instead of clustering at 0.9:
  - ≥ 0.9: plainly visible, any designer would agree
  - 0.7–0.9: likely, one value could be argued
  - 0.4–0.7: plausible but ambiguous, or a borderline value included or left out
  - < 0.4: a guess
  
  For `motion` without measured technique the guideline already demands `none`; its confidence
  says how sure that is.
- **Stored on the existing column.** Every `ai` row of a facet carries that facet's confidence
  in `asset_facet_value.confidence`. Human rows keep `null`, as today.
- **`PROMPT_VERSION` 5.** The reconciler re-classifies everything below it on its own (§7.5), so
  existing assets get per-facet numbers without a manual step.
- **The review queue holds uncertain facets only.** A facet is *uncertain* when it is undecided
  (`unconfirmedFacetKeys`, unchanged) **and** its confidence is below
  `REVIEW_CONFIDENCE_THRESHOLD = 0.7`, or unknown (`null`). The queue is the assets with at least
  one uncertain facet, the least confident first, then oldest first. That answers `0012` open
  question 3.
- **Review mode shows only the uncertain facets as steps.** Confident guesses collapse into a
  line of dashed chips ("5 confident guesses"); clicking one makes it current, so a wrong one
  can still be corrected. `⇧⏎` confirms the uncertain facets, not the confident ones.
- **"Review N" counts the uncertain queue.** A switch in review mode ("Uncertain | All guesses")
  opens the `0012` queue unchanged, for spot checks of the threshold. The URL says which:
  `review=1` (uncertain) and `review=all`.

### Not in scope

- **Turning confident guesses into `human`.** `human` means a person decided (§5.6). A confident
  guess stays `ai`: it is not reviewed, and a re-analysis may still replace it.
- **A confidence per value.** Confirming is per facet, so the number is too.
- **Reviewing a facet the model left empty.** An empty facet has no row to carry a confidence.
  It stays the known limit of `0012`, now slightly sharper: a low confidence on an empty facet
  is computed and discarded.
- **A threshold per facet or per user.** One constant until real numbers show it is wrong.
- **Changing the tile counter.** `unconfirmedFacets` keeps counting every undecided facet. It is
  provenance, not a to-do list, and MCP relies on its meaning.
- **A settings page for the threshold.**

## Data model impact

**Additive. No migration.**

`asset_facet_value.confidence` exists (§5.2) and is filled today with the run's number. After
this change it holds the facet's number. That is a change of meaning for existing rows, but it
is self-healing: rows written before prompt version 5 are rewritten by the re-analysis, and the
version on `analysis_run` says which meaning a row has until then.

The overall `confidence` stays in the result and on `analysis_run`. Nothing reads it for the
queue any more.

This is the part that is cheap now and expensive later. Per-facet numbers for existing assets
need a re-analysis, whose cost grows with the corpus. Today it is three assets.

## Vocabulary impact

No vocabulary change. **A re-analysis of every asset** follows from the prompt version, done by
the reconciler (§7.5) at about $0.03 per asset. `origin = 'human'` is untouched by the existing
guards (§5.6). The three live assets are fully `human`, so nothing visible changes on them:
their re-analysis only rewrites `ai` rows, and they have none.

The prompt grows by the scale and one schema field, roughly 150 tokens. The system prompt stays
static and cacheable (§7.3).

## i18n impact

New strings in `en.json` and `de.json`: the queue switch ("Uncertain" / "All guesses"), the
collapsed line ("N confident guesses"), and the empty state when only confident guesses are
left ("Nothing uncertain left. N confident guesses remain."). No database content.

## MCP impact

- **`get_asset`** already returns `confidence` per facet value. Its meaning becomes useful:
  the tool description says it is the model's confidence in that facet, `null` for a person's
  value. An agent can then treat a low-confidence `ai` facet with care.
- **`search_assets`** is unchanged. The review filter stays out of MCP (`0012`).

## Known limits

- **Self-reported confidence is not calibrated.** The model's 0.9 is not a 90 % hit rate. The
  anchored scale makes the numbers spread, not true. The "All guesses" switch is how the
  threshold is checked: review a sample of confident guesses and count the corrections.
- **A confident wrong guess is never queued.** That is the trade this feature makes: less
  review, and some errors that only a spot check finds.
- **Until the re-analysis has run**, rows carry the old run-wide number. With `0.72` and `0.80`
  under or over the threshold, the queue is briefly coarse. With three assets the reconciler
  finishes within a minute of the deploy.
- **One threshold for all facets.** `mood` is more subjective than `theme`; a single cut-off
  queues more of the first and less of the second than a person might want.

## Open questions

1. **Phase 1 or 2 — decided 2026-10-31: phase 1.** It refines a phase 1 feature and is cheapest
   now, while the corpus is three assets.
2. **Is 0.7 the right threshold?** Decide after the first twenty assets classified at prompt
   version 5, from the spread of the numbers and from one "All guesses" spot check.
3. **Should a person be able to mark a confident guess as "fine" without making it `human`?**
   Not now; it would be a second kind of decision. Revisit if spot checks show the confident
   guesses are reliably right.

## Verification

1. **Prompt:** after the deploy, `analysis_run` rows at version 5 exist for every asset, and the
   `ai` rows of a new upload carry more than one distinct `confidence`.
2. **Spread:** upload five varied references. At least one facet lands below 0.7. If every
   number is ≥ 0.9, the scale is not working and the prompt needs another round.
3. **Queue:** "Review N" counts only assets with an uncertain facet. In review mode, the steps
   are the uncertain facets, least confident asset first; the confident ones sit in the
   collapsed line.
4. **Correcting a confident guess:** click a chip in the collapsed line, change the value, save.
   It becomes `human` and stays through a re-classification.
5. **All guesses:** the switch shows every undecided facet, as in `0012`.
6. **MCP:** `get_asset` on a new upload shows differing `confidence` values across its facets.
