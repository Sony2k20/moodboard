# 0018 — Components with real code and live preview

> Status: accepted
> Phase: 2
> Created: 2026-11-02

---

## Problem

`component` is a value of `type` (§6), but a component reference today is a screenshot: a button
someone built, a card from a design system, a pricing table that worked. The screenshot shows how
it looks; the code that makes it look that way is gone. For the primary consumer that is the
expensive half — Claude Code asked to "build it like our pricing card" has to reverse-engineer
spacing, radii, shadows and transitions from pixels, when the exact CSS existed.

A component reference needs its code stored as the asset itself, a rendering of that code as its
picture, and a preview that runs the code rather than showing a still.

## Scope

- **Create a component from code**: a page `/components/new` with fields for HTML, CSS and
  JavaScript, a preview width (390, 768, 1280 px) and an optional title. The preview beside the
  editor re-renders as one types. Linked from the upload area and the command palette.
- **The code is the asset.** It is stored in `component_code`; `type: component` is the person's
  decision, as for websites and fonts.
- **A rendering as the picture.** A new first pipeline step, `render`, loads the code in the
  worker's Chromium at the chosen width, behind the egress guard (0011), and screenshots the
  rendered content as `poster`. Thumbnails, colours and classification follow as for a website.
  `render` runs in the capture queue: one Chromium at a time.
- **The model reads the code** next to the rendering (truncated to a budget), so `ui_pattern`,
  `style`, `motion` and `finish` describe what the code does — a `transition` in the CSS is
  motion even if the screenshot is still.
- **The detail page runs the code** in a sandboxed preview, shows HTML, CSS and JavaScript with
  a copy button each, and lets anyone edit the code. Saving re-renders and re-classifies; what a
  person set on the facets stays (§5.6).
- **`get_asset` returns the code** in a `component` field, so an agent builds from the real
  thing.

### Isolation of the preview

The code is untrusted: anyone signed in can save it, everyone else's browser runs it.

- The preview is an `<iframe sandbox="allow-scripts">` with the document in `srcdoc` — an opaque
  origin, so the code can neither read the application's DOM nor make credentialed requests as
  the viewer. No `allow-same-origin`, no forms, no popups, no top navigation.
- The document starts with its own Content Security Policy: `connect-src 'none'`, scripts only
  inline, images, fonts and styles over `https:` or `data:`. A component can load a web font or
  a placeholder image; it cannot send anything anywhere with `fetch`, and it cannot load a
  script.
- The worker renders the same document, with every request through the egress guard.

### Not in scope

- **Framework code with a build step** — React, Vue, Svelte, Angular, JSX, Tailwind classes.
  Previewing them needs a bundler or a compiler in the browser; this feature stores and runs
  what a browser runs as is. Framework code can be pasted into the JS field as plain text for
  reference; it will not render. A framework preview is a later feature.
- **External scripts and stylesheets by URL** other than through `@import` in CSS (`style-src
  https:`). Scripts are inline only.
- **Several files, assets uploaded with the component, a dependency list.**
- **Versions of the code.** The audit log records each save with the previous code; there is no
  history view.
- **`add_asset` for components over MCP.** Agents read components; adding one stays a person's
  action for now.

## Data model impact

**Additive.** One new table, `component_code` (asset id, html, css, js, width, updated by,
updated at). The code is the asset's content, like an uploaded file — not metadata a model could
have guessed — so it carries no `origin`; every write is a person's and goes to `audit_log` with
the previous code in `diff`.

## Vocabulary impact

None. `type: component` exists. No existing asset is a component; no re-analysis. As for fonts
(0017), the model's per-asset text gains a section present only for components, the system prompt
is unchanged and `PROMPT_VERSION` stays.

## i18n impact

New strings for the editor, the preview, the code panes and the entry links, in `en.json` and
`de.json`. Code is never translated.

## MCP impact

- `get_asset` gains `component: { html, css, js, width } | null`.
- The server instructions say that for `type: component` the code is authoritative and the image
  is only its rendering.

## Known limits

- **What a browser runs as is, only.** See *Not in scope*.
- **The rendering is one frame** after load and a short settle. Hover states and animations are
  in the code and the live preview, not in the picture.
- **A component that needs a page around it** (fixed positioning, a full-height layout) renders
  as it would in an empty page at the chosen width.
- **Remote images and fonts may be missing from the rendering** when their host is slow or
  refused by the egress guard; the live preview loads them in the viewer's browser.
- **Code size is capped** at 100,000 characters per field. The model sees at most about 12,000
  characters of it in total.

## Open questions

None.

## Verification

1. *New component*: paste a button with a hover transition. The preview updates while typing;
   save. The tile shows the rendered button within a minute; `type` is `component` as a
   person's value.
2. The detail page runs the code: hovering the button in the preview plays the transition. The
   HTML, CSS and JS panes each copy their code.
3. Edit the CSS (another colour), save: the preview shows it at once, the tile after the
   re-render. A facet a person had set is unchanged after the re-classification.
4. A component with `fetch('https://example.com')` in its script: the request is blocked by the
   preview's policy; `document.cookie` is empty and `parent.document` throws.
5. After classification, `motion` reflects the transition in the CSS.
6. MCP: `get_asset` returns the code in `component`.
