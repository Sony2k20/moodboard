# 0011 — Website capture

> Status: accepted — release 1 of 3 implemented, not yet deployed
> Phase: 1
> Created: 2026-10-30

---

## Problem

Today a website only reaches the design memory as a screenshot somebody took by hand. That
screenshot shows one viewport, usually with the cookie banner in it. What made the site worth
keeping is missing. Nobody sees the scroll animation, the easing, the fonts actually in use or
the library behind the effect. So the `motion` facet stays `none` for everything (prompt v3 says
so explicitly). An agent asking "what scroll reveals do we have?" finds nothing. The `website`
value of the `type` facet exists, and no asset carries it.

The site also changes. A reference that is only a link is gone after the next relaunch, and a
hand-made screenshot is a poor archive of it.

## Scope

- **A URL is an input.** It can come from the web, as a text field next to the upload area or by
  pasting a URL into the overview (the clipboard handler already exists for images). It can
  also come from MCP: `add_asset` accepts `url` as an alternative to `image_base64`. Either way
  this creates an asset with `type = 'website'`, `source_url` set and `status = 'pending'`, and
  enqueues the pipeline. Only `http` and `https` URLs are accepted.
- **A `capture` step in the worker** (§8.2), the first step for website assets. It is a separate
  BullMQ queue with **concurrency 1**, so only one Chromium runs at a time and a 60 s capture
  never blocks image classification behind it. Image jobs keep concurrency 2. The capture uses
  two browser contexts, which settles the screenshot-versus-video tension from §8.3:
  1. **Context A (no video):** 1440×900 at DPR 2. Load the page, wait for network idle, dismiss
     the cookie banner, scroll slowly to the bottom (lazy loading), go back to the top. Then take
     the viewport screenshot, the full-page screenshot and the technique extraction (§8.2 step 8),
     and save `storageState`.
  2. **Context B (`recordVideo` at 1440×900):** start from A's `storageState` so the consent is
     already given. Load the page, then scroll evenly over 10 s. Animations fire fresh. The time
     at which the scroll starts is recorded so the load can be cut off later.
  3. **ffmpeg:** trim the video to the scroll, transcode it to H.264 MP4 (`+faststart`, no
     audio) and extract 8 evenly spaced keyframes as WebP.
- **Files**, all in the existing `asset_file` kinds:

  | Kind | Content |
  |---|---|
  | `original` | Full-page screenshot, DPR 1, height capped at 16,000 px, WebP. The archived record of the page (§8.3) |
  | `poster` | Viewport screenshot, DPR 2. Thumbnails and colours are derived from it, not from the full page |
  | `capture` | The scroll video, MP4 |
  | `frame` | 8 keyframes, `frames/00.webp` … `frames/07.webp`; the order is in the path |

- **Pipeline for websites:** `capture → thumbnails → colors → classify`. `normalize` is skipped
  because the worker produced these images itself. `nextPipelineStep` takes the asset type.
- **Cookie banners** (§8.3), as a heuristic in three tiers:
  1. Known consent-management platforms by selector: OneTrust, Cookiebot, Usercentrics, Didomi,
     Quantcast, TrustArc, Borlabs, Complianz.
  2. Buttons by accessible name, in English and German ("Accept all", "Alle akzeptieren",
     "Zustimmen", …). This also looks inside iframes.
  3. As a last resort, remove fixed or sticky elements that cover more than 30 % of the viewport
     and contain consent words.

  **Accept, not reject.** The capture should look like the page a visitor sees after clicking
  through. Rejecting often replaces embedded videos and maps with "content blocked"
  placeholders. The browser context is thrown away afterwards, so the consent goes nowhere.
- **Proper failures** instead of blank images (§8.3, CLAUDE.md). A capture that fails ends with
  `status = 'failed'` and a machine-readable reason. The reasons:
  - `blocked`: a challenge page, detected by status 403/429/503 plus Cloudflare or DataDome
    markers
  - `unreachable`: DNS failure, refused connection or TLS error
  - `http-error`: any other status ≥ 400
  - `timeout`: the page did not settle within 45 s, or the whole capture took more than 120 s
  - `blank`: the viewport screenshot is nearly uniform
  - `forbidden-target`: see below

  `timeout` and `unreachable` are retried twice. The other reasons are final. A failed website
  asset gets a **Retry capture** button.
- **Egress guard.** The worker runs inside the cluster, so a URL can point at internal services.
  There are two layers:
  1. **In the app:** a forward proxy in the worker process that every connection of the capture
     browser goes through. It resolves each host itself, refuses loopback, private, link-local
     and CGNAT addresses, and connects to exactly the address it checked. That covers
     subresources, redirects, WebSockets and DNS rebinding. The refusal reason is
     `forbidden-target`. (The draft said `page.route`; see "Decided during implementation".)
  2. **In the cluster:** an optional egress NetworkPolicy for the worker in the chart, with an
     allow list for the database, Valkey and DNS, and only public addresses on ports 80 and 443.
     It is the layer below, for anything Chromium might do outside its proxy settings.
- **Classification with frames.** `classify` sends the poster and the 8 keyframes, labelled in
  order. The user message also carries the capture context: host, page `<title>`, fonts,
  detected libraries, and the most frequent transition and animation values. The system prompt
  gains one guideline: frames are a scroll recording in order, and measured technique outranks
  guessing for `motion`. That makes this **prompt version 4**.
- **Detail view** for website assets:
  - a video player (`poster` attribute, muted, loop, controls)
  - the full-page screenshot, scrollable
  - a capture technique panel: fonts, libraries, transitions and easings
  - the source URL and the capture date
- **Overview card:** the poster as thumbnail, plus a small video badge.
- **Build prompt** (0008) and `get_asset` include the capture technique. That is the part an
  agent rebuilding the effect needs most.
- **Worker image:** node 24-slim, plus `npx playwright install --with-deps chromium` (full
  Chromium with the new headless mode, not the headless shell, which bot detection spots more
  easily), plus `ffmpeg` from apt. Browsers go into `/ms-playwright`, readable by UID 1000.
- **The `index` step** from §7.1 is dropped from the concept. The `asset_search` trigger
  (0001) already keeps the vector current, so there is nothing for a step to do.

### Not in scope

- Re-capturing a site that changed. Every capture is a snapshot. Submitting the URL again
  creates a new asset; there is no deduplication.
- Replacing a bad capture with an uploaded screenshot.
- Stealth plugins and Consent-O-Matic rule sets. Reconsider them if `blocked` or visible banners
  turn out to be frequent.
- Hover, menu and interaction capture, deep analysis by an agent (§8.4), and region selection.
  All of these are phase 4.
- Mobile viewport captures.
- Video playback on hover in the overview.
- Storing the page's HTML or CSS.

## Data model impact

**Additive. Nothing here is hard to retrofit.**

- `asset.status_reason`: new nullable `text` column holding one of the failure keys above. It is
  machine-readable and never translated (§13.3).
- `capture_tech` (§5.3) exists already and gets filled. `css_properties` holds counted
  transition, animation and transform values: `{ "transition": [{ "value": "…", "count": n }] }`.
- `asset_file` stays unchanged. Frame order is in the path, and `assetFilePath` already takes
  `frameIndex`. The extension of `capture` changes from `webm` to `mp4` in the helper; no
  captures are stored yet.
- `analysis_run` already records `prompt_version`. A run for a website records version 4, and
  `raw_response` keeps what the model saw.

The `origin` invariant (§5.6) is untouched. A website is classified through the same path as an
image, so human corrections win in the same way.

## Vocabulary impact

**No re-analysis.** The vocabulary does not change. `type: website` and the `motion` values
already exist. Prompt version 4 adds a guideline that only applies when frames are present. For
the existing v3 image assets the prompt makes no difference, so re-classifying them would buy
nothing. This is the one case where `prompt_version < 4` does **not** mean "worth re-running".
The doc says so here so that nobody re-runs them by reflex later.

## i18n impact

- New UI strings in `en.json` and `de.json`:
  - the URL field and its validation
  - "Capturing…"
  - the six failure reasons, keyed by `status_reason`
  - Retry capture
  - the labels in the technique panel
  - the video badge
- No new translatable database content.
- `status_reason` keys and the technique values (font names, CSS values, library names) stay
  untranslated.

## MCP impact

- **`add_asset`** takes `url` **or** `image_base64`; exactly one is required. With `url` it
  answers like today: `id` and `pending`. The note says that a capture takes up to two minutes
  and can fail with a reason that `get_asset` will show.
- **`get_asset`** for websites adds:
  - `capture_tech`
  - `source_url`
  - `status_reason` when the capture failed
  - the build prompt including the technique section
  - the poster as image content

  The new optional `frames: boolean` (default `false`) also returns the 8 keyframes. They cost
  the agent around 12k tokens, so they are not sent by default.
- **`search_assets`** does not change. `type:website` and `motion:*` already filter.
- **`list_vocabulary`** does not change.

## Known limits

- **Cookie banners:** the heuristic will miss some. Expect a share of captures with the banner
  still visible. They are not detected as failures, because a banner over a real page is not
  "blank".
- **Bot detection:** sites behind Cloudflare challenges or DataDome end as `blocked`. Without
  stealth this will be a noticeable share of big-brand sites.
- **Sticky headers** repeat or overlap in the full-page screenshot (§8.3). The poster and the
  video are unaffected.
- **Scrolling is the only interaction.** Hover effects, menus and click-triggered animation are
  invisible. `motion: hover-transform` comes only from CSS found by the extraction, never from
  watching it.
- **Pages taller than 16,000 px** are cut off in the full-page screenshot. The video still
  covers the whole page.
- **Duration and cost:** 30–90 s per capture, about $0.10 per classification (§7.4). Since
  captures run one at a time, ten URLs dropped at once take around ten minutes.
- **Chromium without its sandbox** (see the open questions). A renderer exploit on a captured
  page would run with the worker's rights.
- **Image size:** the worker image grows by roughly 500–700 MB.

## Open questions

1. **Chromium sandbox — decided 2026-10-30: `--no-sandbox` for phase 1.** Chromium's sandbox
   needs unprivileged user namespaces. The container runtime's default seccomp profile blocks
   them, so the usual container setup runs `--no-sandbox` (Playwright's default). Accepted
   because:
   - only authenticated users can submit URLs
   - the team is small
   - Renovate keeps Chromium current
   - the egress policy limits what a compromised worker can reach

   Revisit by moving capture into its own Deployment, without the database secret and with only
   a write-only drop directory. That is additive later.
2. **Egress NetworkPolicy in this cluster.** It needs the CIDRs and selectors for Postgres and
   Valkey. Those go in the ArgoCD values and in `infra.local.md`, not here. Before relying on the
   policy, check that the cluster's network setup actually enforces NetworkPolicies.

## Implementation order

There are three releases, each deployable on its own:

1. **Image and guard:** the new worker image, the URL input (web and MCP), the egress check and
   `status_reason`. The capture step only takes the screenshots and fails properly. Website
   assets get thumbnails, colours and a v3 classification of the poster.
2. **Technique and context:** the extraction, `capture_tech`, the cookie banner tiers, the
   detail panel and the build prompt section.
3. **Video and frames:** context B, ffmpeg, keyframes, prompt v4, the player and `frames` in
   `get_asset`. This is where `motion` gets filled.

Release 1 checks the riskiest part, Chromium in the cluster with `/dev/shm` and memory limits,
before the logic on top depends on it.

## Verification

In the running application, after release 3:

1. Paste the URL of a site with GSAP ScrollTrigger reveals into the overview. Within two
   minutes:
   - a website card with a poster appears
   - the detail page plays a video in which the reveals happen
   - `capture_tech.libraries` lists GSAP and ScrollTrigger
   - `motion` contains `scroll-reveal`
2. Paste a site with a OneTrust or Cookiebot banner. The poster and the video show no banner.
3. Paste a site behind a Cloudflare challenge. The asset ends as `failed` with the reason
   `blocked` and no image, and the detail page offers Retry capture.
4. Paste `http://localhost:3000`, a cluster service name and a private LAN address. All three
   end as `forbidden-target`, and the worker log shows no navigation to them.
5. Through MCP, call `add_asset` with `url`, then `get_asset` with `frames: true`. This returns
   the technique, the build prompt with its technique section, the poster and 8 frames.
6. During two parallel URL captures, `kubectl top pod` shows the worker below its limit. The
   second capture waits in the queue instead of running alongside the first.

## Decided during implementation (release 1)

1. **The egress guard is a proxy, not `page.route`.** The first version used `route` and the
   capture test caught it letting a redirect through: a public page answering
   `302 Location: http://localhost/…` was followed, because Playwright hands only the first
   request of a redirect chain to `route`. `EgressProxy` (`apps/worker/src/app/capture/egress-guard.ts`)
   now sits on loopback, and Chromium is launched with it as its proxy. Playwright already
   routes loopback through the proxy rather than bypassing it. CONNECT carries https and
   WebSockets, plain http is forwarded, and both go only to the address the proxy checked.
   IPv4-mapped IPv6 addresses are unpacked and judged as IPv4: a `::ffff:0:0/96` rule in
   Node's `BlockList` matches every IPv4 address too.
2. **`type: website` is the submitter's decision** (`origin = 'human'` plus an
   `asset_facet_decision`), set at ingest. The model sees a screenshot and could call it
   `image`; the guard keeps the type through every re-analysis.
3. **Failed websites stay in the overview,** with a red badge and their host in place of a
   picture. Failed uploads stay hidden as before (0005). The detail page shows the reason and
   **Capture again** (`POST /api/assets/:id/capture`, only for a failed website).
4. **Job data carries the pipeline** (`image` or `website`), so the worker knows the next step
   without asking the database. Jobs from before 0011 have none and count as `image`. The
   reconciler restarts a pending website at `capture`.
5. **The poster feeds thumbnails, colours and the model** (`ImageSteps.source`): poster first,
   original otherwise. Nothing changes for uploads.
6. **Not in release 1:** `capture_tech` stays empty (the page `<title>` is captured but not yet
   stored), and ffmpeg is not in the image yet. Both come with releases 2 and 3.
7. **The URL field skips the browser's own URL check** (`novalidate`), which refuses
   `example.com` without a scheme; `parseCaptureUrl` accepts it and adds `https://`. Pasting
   a text that is nothing but one URL starts a capture too.
8. **The NetworkPolicy allows public traffic on 80 and 443 only.** A site on another port is
   reported as unreachable when the policy is on.

### Known limit found on the way

The user agent no longer says `HeadlessChrome`, but the `sec-ch-ua` client hints still do.
That is a bot signal like the user agent was. Rewriting the client hints is stealth territory,
which is out of scope (see "Not in scope"); reconsider if `blocked` turns out to be frequent.

### Verified so far

- **Capture against real Chromium** (`website-capturer.integration.spec.ts`, also in CI):
  - poster 2880×1800, full page 1440×2700
  - a redirect into the inside is refused, and the inside never receives a request
  - a page's requests to the inside are dropped
  - challenge → `blocked`, 410 → `http-error`, single colour → `blank`, closed port →
    `unreachable`
- **The proxy's CONNECT path** and the address ranges (`egress-guard.spec.ts`).
- **Ingest against Postgres with the real guards** (`website-ingest.integration.spec.ts`):
  - a re-analysis that says `image` keeps `website`
  - failed websites are listed, failed uploads are not
  - only a failed website can be retried
- **`add_asset` with `url`** through a real MCP client.
- **The web UI against a stub api:** badges, the URL field with its error, the reason on the
  detail page, Capture again, and the polling while a capture is pending.

Not verified: the worker image itself. Docker is not installed on the development machine, so
the image is first built by the publish workflow after the push. Also not verified: a capture in the cluster
(`/dev/shm`, memory, real sites) and the NetworkPolicy under the cluster's network setup. Those
are the production check after the rollout.
