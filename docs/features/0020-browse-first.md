# 0020 — Browse first: a calmer overview

> Status: accepted
> Phase: 3
> Created: 2026-11-02

---

## Problem

The overview grew one feature at a time (`0005`, `0011`, `0012`, `0016`, `0018`, `0019`), and
each one put its entry point on the start page. Before the first image, a person now sees:

- a header with up to ten controls: command palette, Boards, Trash, API tokens, Vocabulary,
  Analysis, name, role, language, sign out
- an upload panel with three lines of instructions, a URL form and a link to write a component
- a search field and twelve facet pills
- a row with the result count, "Review N", the Images/Facets switch and "Select"

Tiles carry a counter of unconfirmed guesses. The inspector, where a click on a tile leads, lists
all twelve facets, most of them "—", and puts its one action, "Copy prompt", below them. "Add to
board" is not in the inspector at all: it needs "Select" mode or the full page.

The most common visit is: scroll, pick a reference, then copy its prompt or put it on a board.
Everything that needs is there, but it competes with the tools for curating, administering and
adding content, and someone new to the app cannot tell which is which.

## Scope

Progressive disclosure on the start page and in the inspector. **Nothing is removed**: every
function stays reachable, at most one click further away than today.

- **Header.** Left: the name, "Library", "Boards". Right: "+ Add" and an account menu. The menu
  holds name and role, the language, the command palette (with its shortcut), API tokens, Trash,
  for admins Vocabulary and Analysis, and sign out.
- **Adding.** "+ Add" opens the existing panel (drop or choose files, capture a website, write a
  component) above the grid; from another page it goes to the library first. Dropping and pasting
  keep working anywhere on the library without opening the panel; while files are dragged over
  the page, an overlay says that letting go adds them. An empty library shows the panel open.
- **Filters.** Search plus five facets: type, UI pattern, style, mood, theme. The other facets and
  the author sit behind "More filters". A facet with an active value always shows its pill, so an
  active filter is never hidden. The semantics are `0005`'s, unchanged.
- **Tiles.** The unconfirmed-guess counter (`0012`) moves to the Facets view, which is the
  curation view. The Images view keeps the states that stop an asset from being used: capturing,
  pending, not classified, failed.
- **Results row.** "Review N" becomes a quiet link instead of the loudest element on the page.
- **Inspector.** The footer holds "Copy prompt" and "Add to board" side by side, so both are
  visible without scrolling. The facet list shows only facets that hold a value; "All facets (N)"
  shows the rest for editing, together with the legend and the analysis run. "N AI guesses left ·
  Confirm all" moves to the top of the facet list.
- **Add to board** becomes a button that opens the list of boards plus "New board…"; choosing one
  adds at once, instead of a select followed by a separate "Add" button. It is the same component
  in the inspector, the bulk bar and the detail page; the detail page keeps its role choice.

### Not in scope

- **The detail page, the review page and the board pages.** They are reached on purpose, by
  someone who wants the depth. Only the shared "Add to board" changes there.
- **Quick actions on tile hover.** The prompt needs the asset's detail, which the card does not
  carry; copying after an extra request loses the click's user activation in Safari. One click
  to open the inspector is the price.
- **A separate "simple mode".** Two layouts to keep in step, and a switch someone has to find
  first. Disclosure solves the same problem without a mode.
- **Persisting "More filters" or "All facets".** Both start collapsed on every visit.

## Data model impact

None. The change is in the web app only.

## Vocabulary impact

None. Which five facets are visible is a constant in the filter bar, not a property of the
vocabulary; a new facet appears under "More filters".

## i18n impact

New keys in `en.json` and `de.json`: the "Library" link, the account menu's label, "+ Add", the
drop overlay, "More filters" / "Fewer filters", "All facets (N)" / "Fewer facets", "No facets
yet", and the "Add to board" button with its states. `inspector.confirmN` (the phone label of the
footer's confirm button) and `boards.add.submit` go.

## MCP impact

None. The MCP tools read the same data; nothing about the metadata changes.

## Known limits

- **Curation loses some visibility.** The tile counter and the full facet list were a constant
  nudge to confirm guesses, and confirmed metadata is the product (§1). The nudge that stays is
  "Review N" in the results row and the guess line at the top of the inspector's facets. This is
  the trade-off accepted for a calmer first impression.
- **The five visible facets are a judgement**, not measured: there is no usage data. A curator
  who filters by motion or industry every day needs one click more.
- **"More filters" scrolls sideways like the rest of the row** on a narrow window rather than
  wrapping.

## Open questions

None that block. The five visible facets can be revisited once there is a sense of what people
filter by.

## Verification

In the running app, as a member:

1. The header shows the name, Library, Boards, "+ Add" and the account menu, nothing else. The
   menu opens and closes (click, outside click, Escape) and every entry leads where it did.
2. The library shows search, five facet pills and "More filters"; "More filters" reveals the rest
   and the author. Activating a value under "More filters" and collapsing again keeps that pill.
3. "+ Add" opens the panel; choosing files or capturing a URL works as before. With the panel
   closed, dragging a file over the page shows the overlay and dropping uploads it; pasting a
   screenshot uploads it.
4. Clicking a tile opens the inspector with "Copy prompt" and "Add to board" at the bottom.
   "Add to board" lists the boards; choosing one adds the asset and says so; "New board…"
   creates one and adds to it.
5. The inspector shows only filled facets; "All facets" shows the empty ones, the legend and the
   run. Editing and "Confirm all" work as before.
6. The guess counter shows on tiles in the Facets view only.
7. At phone width the header fits, the inspector is a bottom sheet with both actions, and the
   add-to-board list opens upward inside it.
