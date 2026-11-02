# 0020 — Browse first: a calmer overview

> Status: accepted — implemented, deployed in v0.20.0 (2026-11-02)
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

## Decided during implementation

1. **The panel's state lives in `UploadsService`** (`panelOpen`): "+ Add" is in the shell, the
   panel in the library. It closes as soon as something is added, and when the library is left.
2. **On a phone (≤ 480 px) the app's name gives way and the account button shows the initial.**
   "Library" already leads home; this keeps the header on one line at 360 px, in German too.
3. **"Add to board" says what happened in its own label** — "✓ Added", "✓ Already on it" — for
   2.5 seconds, as "Copy prompt" does. The full sentence with the board's title goes to a status
   region for screen readers; an error stays visible as text.
4. **It is a disclosure, not an ARIA menu:** a button and a list of buttons, so Tab moves through
   the boards. Escape closes the list before it reaches the inspector, and focus returns to the
   button after a choice. The list opens upwards in the inspector and in the selection bar, which
   both sit at the bottom.
5. **"Copy prompt for Claude" became "Copy prompt"**, so both actions fit side by side at 360 px.
6. **A facet being edited stays in the short list** even once its last value is taken off; it
   leaves after saving.

### Verified (before release)

Against the stub api in Chromium:

- The header shows the name, Library (underlined on the library only), Boards, "+ Add" and the
  account menu. The menu lists language, command palette, API tokens, Trash and sign out, and
  closes on an outside click.
- "+ Add" opens the panel and marks itself pressed; × closes it. With the panel closed, a file
  dragged over the page shows the overlay, and leaving the window removes it.
- Five facet pills and "More filters"; expanded, all twelve and "Fewer filters". With
  `?facet=motion:fade` the Motion pill shows, active, with the rest collapsed.
- Inspector: three filled facets of twelve, "All facets (12)" shows all of them with the legend
  and the run. The board list opens upwards; choosing a board says "✓ Added", a second time
  "✓ Already on it"; Escape closes the list and leaves the inspector open.
- Detail page: role "Colour", then the board list, opening downwards. Selection bar: two assets
  added to a board, the list opening upwards.
- 360 px: no horizontal scroll, header on one line with the German labels, both inspector actions
  side by side without truncation.
- `nx run-many -t lint,test,build -p web` and `check-translations`: green.

Not verified before release: real assets with guesses on tiles in the Facets view, and a
signed-in session against production.

## Rollout

v0.20.0 deployed 2026-11-02 (gitops `6a1dce4`): ArgoCD synced and healthy, api, web and worker
on the `0.20.0` images. No migration. The web app serves the new translations ("Library",
"More filters"); without a session `GET /api/me` answers `401`.

**Not verified:** the new layout in a signed-in session with real assets — guesses on tiles in
the Facets view, adding to a real board from the inspector.
