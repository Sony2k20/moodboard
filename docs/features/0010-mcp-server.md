# 0010 — MCP server

> Status: done — deployed in v0.7.2 (2026-10-30)
> Phase: 1
> Created: 2026-10-30

---

## Problem

Claude Code is the primary consumer of this application (§1), and it cannot reach it. Today a
person opens the detail page, copies the prompt and the image, and pastes both into a session.
That works for one reference; it does not let an agent search the memory itself ("find dark
editorial heroes with photography"), look at what it found, or drop a screenshot in mid-session.
Everything such an agent needs exists already — the shared query (`0005`), the detail shape, the
build prompt (`0008`), the visual details (`0009`) — but only behind a browser session.

## Scope

- **A remote MCP server over streamable HTTP at `/api/mcp`**, mounted in `apps/api` (§10), with
  the official TypeScript SDK (`@modelcontextprotocol/sdk`). Stateless: every request stands on
  its own, nothing to keep in Valkey.
- **Four tools**, each a thin layer over the services the web uses — no second query:
  - `list_vocabulary` — facets, values, English labels and descriptions, plus the combination
    rule (OR within a facet, AND across). Its description tells the agent to call it first.
  - `search_assets` — input is `AssetQuerySchema` (`facet`, `q`, `tag`, `author`, `cursor`,
    `limit`); output the page from `AssetSearchService.search`: cards, `nextCursor`, `total`,
    facet counts. A bad filter is a tool error with the reason, not an empty result.
  - `get_asset` — the `AssetDetail` as JSON, **the build prompt** (`buildPrompt`, `0008`), and
    **the image as vision input**: `thumb-lg` as MCP image content. Looking at the reference is
    half its value (§10).
  - `add_asset` — an image as base64 (PNG, JPEG, WebP, GIF; format checked from the bytes like
    an upload) with an optional title; goes through `AssetsService.ingestUpload`, so it is
    classified like any upload. Answers with the new id.
- **Personal API tokens.** A page `/tokens` (linked in the header) lists a person's tokens and
  creates new ones: a name ("Claude Code, laptop"), the token shown **once**, revocation. The
  token carries the person's identity: assets added through it name them as author, writes go to
  the audit log as theirs.
- **Bearer authentication only on `/api/mcp`.** Every other route keeps requiring the session;
  a token does not open the web api. `last_used_at` is updated per request.
- **Setup instructions** on the tokens page, with the command for Claude Code:
  `claude mcp add --transport http moodboard <app url>/api/mcp --header "Authorization: Bearer <token>"`.

### Not in scope

- **`add_asset` from a URL.** A URL means website capture (§8), the next feature; fetching
  arbitrary URLs from the api would be an SSRF surface for nothing. Until then: an image.
- **Write tools beyond `add_asset`** — editing metadata through MCP is not in phase 1 (§10).
- `get_board`, `get_design_tokens` — phase 3.
- OAuth for MCP clients. A bearer token is what Claude Code supports simply; OAuth through
  Authentik can follow if a client needs it.
- Token expiry and scopes. A token is all-or-nothing for its owner and lives until revoked.

## Data model impact

**Additive:** `api_token (id, user_id, name, token_hash, prefix, created_at, last_used_at,
revoked_at)`. Only a SHA-256 of the token is stored — tokens are 32 random bytes, so a slow hash
buys nothing; `prefix` (the first characters) lets a person recognise a token in the list. Format
`mb_<base64url>`, so a leaked token is recognisable as ours in a secret scanner.

Nothing provenance-related changes: assets added through MCP are `created_by` the token's owner,
and everything the model writes stays `origin = 'ai'`.

## Vocabulary impact

None. `list_vocabulary` serves what is there.

## i18n impact

The tokens page in English and German. Tool names, descriptions and results are English — they
are read by a model (§13.3).

## MCP impact

This is it. The result shapes are the ones fixed in `0005`; `get_asset` adds the image and the
prompt. Tool descriptions carry what an agent must know to use them correctly: call
`list_vocabulary` first, the OR/AND rule, that `human` values are confirmed by a person and weigh
more, that the image is attached to `get_asset`.

## Known limits

- **Images cost context.** `get_asset` attaches `thumb-lg` (up to 1600 px wide), not the
  original; `search_assets` attaches none — it returns cards, and the agent fetches what it wants
  to look at.
- **A token is as strong as its owner's account** and does not expire. Revocation is immediate.
- **No rate limit.** A few people and their agents; the monthly LLM cost limit (`0004`) still
  bounds what `add_asset` can spend.
- **`add_asset` takes one image per call**, at most 25 MB like an upload.

## Open questions

None that block the start. Decided here:

1. **Bearer only on `/api/mcp`**, not on `/files` or the rest of the api: the agent gets images
   through `get_asset`, so nothing else needs the token.
2. **Stateless transport.** Sessions would need storage and buy nothing for request/response
   tools.
3. **No URL in `add_asset` yet** — see Not in scope.

## Verification

1. Create a token on `/tokens`: shown once, then only its prefix and name.
2. Add the server to Claude Code with the command from the page; `/mcp` lists four tools.
3. Ask Claude Code for "references with photography and soft shadows": it calls
   `list_vocabulary`, then `search_assets` with `imagery:photography` and `finish:soft-shadow`,
   and finds the leaf reference.
4. `get_asset` on it: the agent sees the image and quotes the visual details and the prompt.
5. Paste a screenshot into the session and ask to add it: `add_asset` creates it under the
   token's owner; it appears in the overview and is classified.
6. Revoke the token: the next call answers `401`. A token on any other `/api` route: `401`.

## Decided during implementation

1. **The larger body limit (36 MB) applies to `/api/mcp` only.** It is registered in `main.ts`
   before Nest's own parsers, which then find the body already read; every other route keeps
   the 100 kB default, so nobody can push a large body at them before authentication. `express`
   became a direct dependency for that — it was already installed through Nest.
2. **`ingestUpload` takes an explicit `title`** (a person's, so `human`) and a `source` for the
   audit log (`upload` or `mcp`).
3. **`search_assets` defaults to 20 results**, not the web's 60: an agent pays for every line.
   Its counts list only values with a count above zero.
4. **Tested at three levels:** the guard (a token opens only bearer routes, a session does not
   open them), the tools through a real MCP client over an in-memory transport against PGlite,
   and the HTTP path — Nest controller, stateless transport, body limit — with the SDK's
   streamable HTTP client against a listening test app.

## Rollout

Two releases broke something, both found during the production check, neither took the site down.

1. **0.7.0 did not start.** `nx prune` builds the image's `package.json` from
   `apps/api/package.json`, which did not list the MCP SDK and `express`. The new pod crashed on
   `MODULE_NOT_FOUND`; the rolling update kept the 0.6.0 pod serving. CI's bundle check only
   started `migrate.js`, which never loads them — it now starts `main.js` from the pruned install
   too. Fixed in 0.7.1.
2. **0.7.0 and 0.7.1 dropped every JSON body outside `/api/mcp`.** The larger parser for that
   path was registered as an extra middleware; Nest skips its own global JSON parser when one
   named `jsonParser` already exists. Editing, bulk actions, creating tokens and the language
   switch answered `400`. The api now starts with `bodyParser: false` and registers all three
   parsers itself (`body-parsers.ts`); the HTTP test uses the same setup and checks another
   route's body. Fixed in 0.7.2.

Also in 0.7.2: `original.jpg` and `thumb-*.webp` — our own file names, back through the download
link — no longer count as a title.

**Result (2026-10-30, v0.7.2):** without a token `/api/mcp` answers `401`, `GET` `405`, and a token
opens no other route. With a temporary token created through the session and revoked right after:
`initialize` and `tools/list` answer with the four tools; `list_vocabulary` returns 13 facets;
`search_assets` with `imagery:photography` and `finish:soft-shadow` finds the leaf reference, an
unknown value is a tool error with the reason; `get_asset` returns the metadata, the build prompt
and the image (WebP, 105 kB). The token list showed only the prefix; after revocation the token
got `401`. `PATCH /api/me` answers `200` again.

Not run in production: `add_asset` (it would add a real asset — covered by the tests, including a
2 MB image over HTTP) and a session in Claude Code itself.
