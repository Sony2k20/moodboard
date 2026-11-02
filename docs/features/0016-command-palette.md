# 0016 — Command palette

> Status: accepted — implemented
> Phase: 2
> Created: 2026-11-02

---

## Problem

Getting to a reference takes several clicks: open the facet pills, find the facet, find the
value, close the menu — and again for the next facet. Someone who knows they want "editorial,
dark" types it faster than they click it. The same goes for the pages that hide behind the
header (review, trash, tokens, vocabulary, analysis) and for an asset whose title they remember.
Phase 2 names it: a command palette on Cmd+K (§11).

## Scope

- **Cmd+K (macOS) / Ctrl+K (elsewhere)** opens the palette on every page while signed in; the
  same keys or Esc close it. Focus returns to where it was.
- **One input, four kinds of result**, matched against what is typed:
  - **Facet values**, by their label in the current language, their key, or the facet's label —
    `dark`, `dunkel`, `theme dark` all find `theme:dark`. Choosing one adds it to the overview's
    filter (or removes it when already set) and goes to the overview.
  - **Assets** whose title or description matches, from the ordinary search (`q`, eight
    results), shown with their thumbnail. Choosing one opens its detail page.
  - **Full-text search** for the typed text in the overview, always offered as the first entry
    once something is typed.
  - **Pages and actions**: overview, review, trash, API tokens, vocabulary, analysis (admins),
    switching the language, signing out.
- **Keyboard first:** ↑/↓ move, Enter chooses, the mouse works too. Matching is a plain
  case-insensitive substring and word-prefix match, ranked label-start before word-start before
  anywhere.
- Asset results are requested 200 ms after the last keystroke, and only from two characters on.

### Not in scope

- **Fuzzy matching** (`edtrl` → editorial). The vocabulary is small and its labels are words;
  a substring match finds them without surprising rankings.
- **Recent items or a history.** Nothing is stored.
- **Actions on the open asset** (trash, re-analyse, edit a facet). They are one click away where
  the asset is shown; a palette that knows the page's context is a larger feature.
- **Uploading from the palette.** Drop and paste work on the overview already.
- **New api endpoints.** Asset results use `GET /api/assets?q=…&limit=8`.

## Data model impact

None.

## Vocabulary impact

None. The palette reads the vocabulary as the filter bar does, including admin-made `project`
values (0014). Selecting a value writes its key into the URL, never its label (§13.3).

## i18n impact

New UI strings for the placeholder, the result group names, the action labels and the hint line,
in `en.json` and `de.json`. Matching uses the labels of the active language *and* the keys, so a
German interface still finds `dark`.

## MCP impact

None — this is navigation for people.

## Known limits

- **Asset results match like the overview's search:** English full text over title and
  description (§13.4). A German word finds an asset only if the description contains it.
- **Cmd+K is the browser's search shortcut in some browsers.** The palette takes it while the
  application has focus; the browser's own shortcut still works from the address bar.
- **Matching is substring only**, so a typo finds nothing — the full-text entry is always there
  as a fallback.

## Open questions

None.

## Verification

1. On any page, Cmd/Ctrl+K opens the palette with the cursor in its input; Esc closes it and
   focus returns.
2. Type `dark`: `Theme: Dark` is listed; Enter adds the filter on the overview. Open again, type
   `editorial`, Enter: both filters are set. With the language on German, `dunkel` finds the same
   value.
3. Type a word from an asset's title: the asset appears with its thumbnail after a moment;
   Enter opens its detail page.
4. Type `trash` and choose it: the trash opens. As a member, `analysis` is not offered.
5. Type a phrase and choose the first entry: the overview searches for it.
6. In review mode, Cmd+K opens the palette and Enter in it does not confirm a facet.

## Decided during implementation

1. **A header button opens the palette too.** A shortcut nobody knows is no way in, and a phone
   has no Ctrl key.
2. **The vocabulary and the overview's state are resolved on first use**, not with the shell:
   the vocabulary loads when it is constructed, and a palette nobody opened should not cost a
   request on every page.
3. **Choosing a facet value toggles it** — an already selected value says so and is removed.
   Opening the palette twice therefore combines filters instead of replacing them.
4. **Focus never leaves the input.** Entries take the mouse but not focus, and the active entry
   is announced through `aria-activedescendant`.

### Verified (before release)

- **Web** (`palette-match.spec.ts`): ranking of a text start before word starts before inner
  matches, every word required, hyphens and colons as word boundaries, case and accents folded.
- **Against a stub api in Chromium:** Ctrl+K in review mode opens the palette with the cursor in
  it; `dark` lists the search entry and `Theme: Dark`; ↓ and Enter go to `/?facet=theme:dark`
  without confirming anything in review. Ctrl+K, `edit`, ↓, Enter adds `style:editorial` to the
  same filter. `asset 2` finds the asset after the debounce. Esc closes it.
- `nx run-many -t lint,test,build`: green for all projects.

Not verified before release: a German interface finding `dunkel` in a browser — the stub cannot
store a language change; the match runs on the label of the active language, the same code
path as `dark`.
