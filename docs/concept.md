# Mood Board App — Concept

> Last updated: 2026-10-26 · Status: phase 1 in progress

## 1. Core Idea

A self-hosted, team-wide **design memory**. Not an image archive, but a searchable,
machine-readable reference database.

The order of consumers is what drives every decision below:

1. **Claude Code / Claude Design** — the primary consumer. Pulls structured references to build
   code and designs from.
2. **Humans** — add content, curate and browse.

From this follows the most important architectural rule of the project:

> **The quality of the structured metadata *is* the product.** The frontend is an accessory.
> An image tagged "nice" is worthless. An image carrying
> `{pattern: hero, layout: split-left-text, motion: parallax-on-scroll, palette: [...], type_pairing: [...]}`
> is what makes this application valuable.

Every trade-off in this document resolves in favour of metadata quality.

## 2. Decided Scope

| Topic | Decision |
|---|---|
| Hosting | Linux server running k3s. Target: 16 GB of available RAM |
| Deployment | **k3s** via **ArgoCD**, generic Helm chart, **HostPath volumes** (§4.2) |
| Ingress | **Traefik `IngressRoute`** by default, `Ingress` as an option (§4.4) |
| Domain | set via chart value, e.g. `moodboard.example.com` |
| Postgres | **External dependency** — wired up via values, not bundled in the chart (§4.3) |
| IdP | **External dependency** — Authentik via OIDC (§4.5) |
| Queue | **Valkey** instead of Redis (BSD licence), `deploy` flag in the chart |
| Registry | **GHCR**, built and pushed by GitHub Actions (§4.8) |
| Reachability | Over the internet, through the **path the cluster already uses** — Traefik `IngressRoute`. The chart carries an optional `cloudflared`, off by default (§4.12) |
| Visibility | **All assets visible to all users**, filterable by author. No private assets. |
| Taxonomy | Controlled facet vocabulary **plus** free-form tags — vocabulary in §6 is **approved** |
| Volume | A few hundred assets per year |
| Approach | **Phased** (§11). Phase 1: overview, classification and website capture |
| Languages | UI in English (default) and German, switchable at runtime (§13) |
| Embeddings | **Not in phase 1** — reasoning in §7.6 |
| Boards | **Phase 3.** Purpose: the briefing package handed to the AI (§5.4, §10.1) |
| LLM | Claude by default, provider replaceable |

### What the Volume Implies

A few hundred assets per year is **nothing** by database standards. That permits deliberately
simple decisions which would be wrong at a scale of millions:

- No sharding, caching or CDN complexity.
- Filter performance is irrelevant. The schema is designed for **correctness and
  maintainability**, not query speed.
- Semantic search is dispensable (§7.6).
- Classification may be expensive per asset (§7.4). Quality over throughput.
- Horizontal scaling is not a design goal. k3s is used here as an *operating model*
  (declarative deployment, secrets, rollouts, restart behaviour), not as a scaling tool.

### What Has to Be Right From the Start

Most features are **additive** and can be retrofitted at any time — boards, for instance, are
three tables with foreign keys onto `asset`. Only four things cannot, which is why they belong
in phase 1 even though they deliver no visible benefit there:

| What | Why it cannot be retrofitted |
|---|---|
| `origin` column (`ai` / `human`) on all metadata | Introduced later, it becomes impossible to reconstruct for existing rows what a human corrected — and the first re-analysis then silently overwrites all of it (§5.6) |
| `analysis_run` with `prompt_version` | Without a record from day one, there is no way to know later which asset was classified by which model and prompt version. Targeted re-analysis becomes impossible |
| `jsonb` labels on the vocabulary | Built as a single text column and split later, this means a migration that moves data (§13) |
| The `StorageService` interface | Retrofitting it means touching every file access in the codebase |

Everything else can wait.

## 3. Technology Stack

```
Nx monorepo
├── apps/api        NestJS    REST API, auth (OIDC/BFF), search, MCP endpoint
├── apps/worker     NestJS    BullMQ consumer: thumbnails, capture, classification
├── apps/web        Angular   Signals, standalone components, Tailwind, Transloco
├── libs/shared     —         Zod schemas, facet vocabulary, DTOs (shared by all)
├── libs/classify   —         Provider interface + adapters (Anthropic, others later)
└── deploy/chart    —         Helm chart for k3s
```

| Component | Choice | Reasoning |
|---|---|---|
| Monorepo | Nx | First-class Angular + Nest integration; `libs/shared` allows **one** Zod schema to serve backend validation, frontend forms and LLM structured output. A taxonomy change then breaks at compile time, not at runtime. |
| Backend | NestJS | The backend is the bulk of this system: queues, long-running capture and analysis jobs, MCP server. `@nestjs/bullmq` covers that directly. |
| Frontend | Angular + Tailwind | Existing expertise. Tailwind rather than Material/PrimeNG because an image gallery needs custom layout, where component libraries get in the way more than they help. |
| i18n | **Transloco** | Runtime language switching, which Angular's built-in i18n cannot do (§13) |
| ORM | **Drizzle** | Close to SQL for the combined facet queries. Prisma and TypeORM are both weaker at hand-written SQL and at pgvector (needed later). |
| DB | PostgreSQL (external) | Full-text search via `tsvector`. pgvector is only needed from phase 4 onwards (§7.6) |
| Queue | **Valkey** + BullMQ | Valkey is the BSD-licensed fork under the Linux Foundation, created after Redis moved to RSALv2/SSPL in 2024. Wire-compatible with Redis 7.2 — BullMQ talks to it through ioredis with Lua scripts that run unchanged. |
| Images | sharp | Thumbnails, colour extraction, normalisation. |
| Capture | Playwright + ffmpeg | Screenshot, scroll video, keyframes, DOM/CSS extraction (§8) |
| MCP | `@modelcontextprotocol/sdk` | Streamable HTTP transport, mounted as a NestJS controller. |
| Auth | Authentik (OIDC) | External. OIDC inside the application rather than Traefik ForwardAuth, because identity is needed as a record (§4.5) |
| Deployment | Helm chart, synced by **ArgoCD** | Generic defaults in the repo, environment values in the ArgoCD Application (§4.3) |

## 4. Deployment Architecture (k3s)

```
                         Internet
                            │
                            │  however the cluster is already exposed
                            │  (optional: cloudflared, §4.12)
                            │
                   ┌────────▼─────────┐
                   │ Traefik          │  IngressRoute
                   │ moodboard.       │
                   │ example.com      │
                   └────────┬─────────┘
                            │
                     ┌──────▼──────┐
                     │     web     │  nginx, static Angular bundle
                     └──────┬──────┘
                            │
                     ┌──────▼──────┐          ┌─ ─ ─ ─ ─ ─ ─ ─ ┐
                     │     api     │◄────────►│   authentik    │
                     │ REST + MCP  │  OIDC    │   (external)   │
                     └──┬───────┬──┘          └─ ─ ─ ─ ─ ─ ─ ─ ┘
                        │       │
          ┌─ ─ ─ ─ ─ ─ ─▼─┐  ┌──▼────────┐
          │   postgres    │  │  valkey   │
          │  (external)   │  │  (queue)  │
          │               │  └──▲────────┘
          └─ ─ ─ ─ ─ ─ ▲─ ┘     │
                       │        │
                    ┌──┴────────┴──────────┐
                    │        worker        │  sharp + Chromium + ffmpeg + LLM
                    │  /dev/shm 1Gi        │
                    └──────────┬───────────┘
                               │
                      ┌────────▼────────────┐
                      │ HostPath            │
                      │ /srv/moodboard/…    │
                      └─────────────────────┘

   ┌─ ─ ┐  dashed = external services, wired up via values
```

### 4.1 What k3s Changes Compared to Docker Compose

| Compose assumption | k3s reality |
|---|---|
| Caddy as reverse proxy | **Traefik `IngressRoute`** (§4.4) |
| Bind mount `/data` | **HostPath volume** (§4.2) |
| `.env` file | **Kubernetes secrets**, referenced through `existingSecret` in the values |
| `docker compose up` | **Helm release**, versioned and revertible via `helm rollback` |

### 4.2 Storage: HostPath

Decision: **HostPath**. Chart default `/srv/moodboard/assets`, overridable per value.

Advantages: no provisioner, no PVC lifecycle, and the files sit in plain sight on the node's
filesystem — directly inspectable and backed up with existing tooling (rsync, snapshots, Borg).

**`nodeAffinity` pinning `api` and `worker` to the same node.** Both need access to the same
files: the worker writes thumbnails and captures, the API serves them. With a single node this
is trivial — but stating it explicitly means that a later cluster expansion does not break
things silently; instead the pod visibly fails to schedule.

#### File Ownership: UID 1000, Not Root

The kernel checks permissions by **numeric UID/GID**; usernames inside the container namespace
are unrelated to those on the host. If the directory is owned by `root:root` with `755` and the
container runs as UID 1000, every write fails with `EACCES`.

The failure mode is insidious: **the pod starts up perfectly cleanly.** Mounting does not check
permissions — only the first upload fails, possibly days later, and it then looks like an
application bug.

The pitfall: **`fsGroup` in `securityContext` has no effect on HostPath.** Kubernetes only
performs ownership management for volume types that support it, and `hostPath` is not among
them. The setting is accepted and ignored.

**Why not simply run as root?** Technically possible, and it saves the `chown`. What argues
against it is specific, not general hygiene: the worker loads **arbitrary third-party websites**
into Chromium by design. Browsers are the most heavily attacked software there is, and inside
containers Chromium usually runs with `--no-sandbox`, because its own sandbox needs capabilities
unavailable in the pod. That makes the container the only remaining isolation layer — and a
HostPath mount punches through it at a defined point. Root plus HostPath plus `--no-sandbox`
plus code from foreign servers is precisely the combination where a browser exploit gains
immediate root write access to the host filesystem.

The alternative costs one command, once:

```bash
sudo mkdir -p /srv/moodboard/assets
sudo chown -R 1000:1000 /srv/moodboard
```

plus `runAsUser: 1000` and `runAsGroup: 1000` as chart defaults. Anyone running other HostPath
services overrides the UID accordingly via values.

Moving to S3/MinIO stays open through the `StorageService` interface, should additional nodes
appear later — that would be an adapter swap plus a data migration, not a redesign.

Layout: `/srv/moodboard/assets/<asset-id>/original.<ext>`, `thumb-{sm,md,lg}.webp`,
`capture.webm`, `poster.webp`, `frames/NN.webp`.

### 4.3 Chart Values and ArgoCD

The chart ships no Postgres or Authentik instances of its own; it expects them as configuration.
Valkey is bundled optionally.

The `values.yaml` in this repository contains **generic defaults only**. Environment-specific
values — domain, issuer URL, secret names, UID — are overridden at deployment time through the
**ArgoCD Application** and therefore live outside this repository. There is deliberately no
`values.local.yaml`.

```yaml
image:
  registry: ghcr.io/<owner>
  tag: ""                            # default: Chart.AppVersion
  pullSecret: ghcr-pull

ingress:
  kind: IngressRoute                 # IngressRoute | Ingress
  host: moodboard.example.com
  entryPoints: [websecure]
  middlewares: []                    # e.g. compress, security-headers
  tls:
    certResolver: ""                 # or:
    secretName: ""

postgres:
  existingSecret: moodboard-database-app
  # Keys: uri, host, port, dbname, username, password — see §4.3.1

oidc:
  issuerUrl: https://auth.example.com/application/o/moodboard/
  clientId: moodboard
  existingSecret: moodboard-oidc     # clientSecret

valkey:
  deploy: true                       # false → use an external instance
  host: ""                           # only when deploy: false
  port: 6379

storage:
  hostPath: /srv/moodboard/assets
  runAsUser: 1000
  runAsGroup: 1000

llm:
  provider: anthropic
  model: claude-opus-5
  existingSecret: moodboard-llm      # API key
  monthlyCostLimitUsd: 25

i18n:
  defaultLocale: en                  # en | de
  availableLocales: [en, de]

worker:
  concurrency: 2
  shmSize: 1Gi
  resources:
    requests: { memory: 512Mi, cpu: 250m }
    limits:   { memory: 2.5Gi, cpu: "2" }
```

**Backups stay outside the application.** For a memory system, data loss is the one
irreversible failure, so to state it explicitly: what matters is not that backups are
configured but that a **restore has been rehearsed at least once**. An untested restore path is
not a backup. The same applies to the asset files on the HostPath; they cannot be reconstructed
from the database.

#### 4.3.1 The Database Secret Belongs to the Operator

Postgres is operated by **CloudNativePG**, and the application secret is created by the operator
itself when it bootstraps the cluster (`cnpg.io/userType=app`), not by this chart and not by
hand. Two consequences follow, and both are easier to accept than to work around:

- **The key names are the operator's.** `username`, `password`, `dbname`, `host`, `port`, plus a
  ready-made `uri`. The application therefore reads exactly these names in addition to
  `DATABASE_URL`, so the secret can be mounted with `envFrom` and nothing has to be kept in sync
  with the operator. Renaming them in a copy of the secret would mean reconciling that copy on
  every password rotation. Note that `uri` is preferred over assembling a URL from the parts: the
  generated password is 64 arbitrary characters, and the operator has already escaped it
  correctly.
- **The secret does not exist before the first sync.** The database cluster therefore lives in
  its **own ArgoCD Application**, separate from the application chart. Otherwise the `PreSync`
  migration job (§4.11) would, on a first install, run before the secret it needs exists —
  a failure that only ever appears once, which is precisely why it is easy to forget.

The keys `jdbc-uri`, `fqdn-uri` and `fqdn-jdbc-uri` contain hyphens and are not valid environment
variable names; `envFrom` skips them with an event. Nothing here needs them.

### 4.4 Ingress: IngressRoute

`IngressRoute` is the standard in the target cluster and therefore the chart default; the
generic `Ingress` variant stays selectable via `ingress.kind` so the chart is not tied to
Traefik.

The practical difference: `IngressRoute` exposes middlewares and router rules as first-class
fields instead of annotations, which stays far more readable for TLS and header manipulation.

### 4.5 Authentik: OIDC in the Application, Not ForwardAuth

Authentik is wired up **via OIDC inside the application** (authorization code flow with PKCE,
BFF pattern, HttpOnly cookie), not through the Traefik ForwardAuth middleware.

Reasoning: the application needs identity as a **record**, not merely as a request header —
`created_by` on every asset, personal API tokens for MCP access, the audit log. On top of that,
MCP clients arrive with a bearer token rather than a browser session; a ForwardAuth middleware
in front would reject them.

An Application and an OIDC provider named `moodboard`, with the matching redirect URIs, are
created in Authentik for this.

### 4.6 Playwright on Kubernetes

Three things must be in the manifest, or capture fails reproducibly:

- **Enlarge `/dev/shm`.** Containers default to 64 MB; Chromium crashes on larger pages with
  that. Solution: an `emptyDir` with `medium: Memory` and `sizeLimit: 1Gi` mounted at
  `/dev/shm`. This is the single most common cause of "works locally, dies in the cluster".
- **Resource limits.** `requests: 512Mi`, `limits: 2.5Gi`. An OOM kill of the worker must not
  take the API down with it — hence separate deployments.
- **Concurrency capped at 2**, so two parallel video captures do not double the memory peak.

### 4.7 Memory Budget (16 GB available)

Postgres and Authentik are external services and are not counted here.

| Workload | Steady state | Peak |
|---|---|---|
| valkey | 100 MB | 200 MB |
| api | 400 MB | 700 MB |
| web (nginx, static) | 50 MB | 50 MB |
| worker (Chromium + ffmpeg) | 500 MB | **2.5 GB** |
| cloudflared (optional, §4.12) | 50 MB | 100 MB |
| **Total** | **~1.1 GB** | **~3.5 GB** |

### 4.8 Build and Registry: GHCR via GitHub Actions

Three images: `api`, `worker`, `web`. Built and pushed to **GHCR** by GitHub Actions.

A concrete limit rules out Docker Hub here: its free tier allows exactly **one private
repository** — we need three. GHCR has unlimited private packages, and inside Actions the
automatically provided `GITHUB_TOKEN` is enough to push, so there is no extra secret and no
rotation concern. It also avoids the Docker Hub pull limits that occasionally bite on image
pulls in the cluster.

Tagging: `sha-<commit>` for every build, plus `v<semver>` on releases. The real gain is
rollback — `helm rollback` to the previous image tag is a matter of seconds.

In the cluster, an `imagePullSecret` (`ghcr-pull`) holding a read-only PAT, as long as the
packages stay private.

### 4.9 Local Development

No k3s on the development machine. Rather than maintaining dev and prod manifests in parallel:

- `api`, `worker` and `web` run through `nx serve` directly on the host: fast HMR, ordinary
  debugging, no image build per change.
- **Postgres through a `kubectl port-forward` to the cluster instance**, not a local one. The
  database is operated by CloudNativePG and its credentials are generated there (§4.3.1), so a
  local copy would mean maintaining a second set — and development would no longer run against
  the Postgres version, extensions and settings that production uses. The price is a forwarded
  connection that dies with the terminal: a dropped forward looks like `ECONNRESET` in the
  middle of a migration rather than like a lost tunnel.
- Valkey becomes relevant with the job pipeline; until then nothing local depends on it.
- The Helm chart is purely a deployment artefact and is validated in CI with `helm template`.

### 4.10 Operational Risk: the IdP as a Single Point of Failure

Authentik has to be reachable from the internet (the OIDC redirect goes through the user's
browser) and is therefore on the critical path. If Authentik is down, **nobody** gets into the
application — not even the admin.

**Mitigation:** a local emergency admin account that does not go through SSO — login restricted
to the LAN, separately hashed password, disableable by configuration flag, every use recorded in
the audit log.

### 4.11 Database Migrations Under GitOps

With ArgoCD there is no manual `helm upgrade`, so Drizzle migrations need a defined place in the
sync sequence. Otherwise the new application version starts against an old schema — a fault that
surfaces as seemingly random runtime errors.

Solution: a migration `Job` annotated `argocd.argoproj.io/hook: PreSync`. ArgoCD runs it before
the actual rollout and aborts the sync if it fails. Helm's own `pre-upgrade` hooks are the wrong
tool here, because ArgoCD only renders the chart and does not apply Helm's hook semantics.

From this follows a rule for every migration: it must be **forward compatible**. Between the
PreSync job and the completed rollout, the old application version briefly runs against the new
schema. Columns are therefore added first and removed later in a separate release, never both in
one step.

### 4.12 Reachability: No Tunnel of Its Own

The cluster already exposes other applications over the internet through Traefik
`IngressRoute`s — the IdP among them, which has to be reachable for the OIDC redirect (§4.10).
Moodboard uses that same path and adds nothing: one more `IngressRoute` on the existing
entry points.

A `cloudflared` of its own would be worth it only if no such path existed. It is in the chart
behind `cloudflared.deploy`, defaulting to **false**, so the chart stays usable in a cluster
without one — but running a second tunnel beside an existing one would mean a second token to
rotate and a second component to debug, for an application that is not the reason the cluster is
exposed.

What this does mean: **Moodboard inherits whatever protects that path.** TLS termination,
redirect and security headers come from the cluster's Traefik middlewares, set per environment
in the ArgoCD Application, not from this chart.

## 5. Data Model

Phase 1 covers §5.1 to §5.3 and §5.5. Boards (§5.4) arrive in phase 3.

### 5.1 Core

```
user                 id, sub (OIDC), email, display_name, role (admin|member),
                     locale (en|de) default 'en',      -- UI language, see §13
                     created_at
asset                id, type, title, description, created_by, created_at, updated_at,
                     source_url, license, status (pending|ready|failed),
                     deleted_at            -- soft delete, 30-day trash
asset_file           id, asset_id, kind (original|thumb_sm|...|capture|poster|frame),
                     path, mime, width, height, bytes, duration_ms
```

### 5.2 Taxonomy

The controlled vocabulary is **normalised** (not JSONB rows), so referential integrity holds and
a value can be renamed globally without touching any asset:

```
facet                id, key, is_multi_value,
                     label jsonb,              -- {"en": "...", "de": "..."}  see §13
                     description jsonb
facet_value          id, facet_id, value, sort_order,
                     label jsonb,              -- {"en": "Calm", "de": "Ruhig"}
                     description jsonb
asset_facet_value    asset_id, facet_value_id,
                     origin (ai|human),        -- who set it
                     confidence,               -- only when origin=ai
                     set_by, set_at
tag                  id, name, created_by      -- free-form tags, flat
asset_tag            asset_id, tag_id, origin, set_by, set_at
```

Note the split: `facet_value.value` is the machine-readable key and stays English and
single-language; only `label` and `description` are translated (§13).

### 5.3 Colour, Search and Capture Technique

```
asset_color          asset_id, hex, lab_l, lab_a, lab_b, ratio, position
                     -- Lab values, so colour proximity is perceptual rather than RGB-based
asset_search         asset_id, tsv tsvector
                     -- generated column, to_tsvector('english', title || description); see §13
capture_tech         asset_id, fonts jsonb, css_properties jsonb,
                     libraries jsonb, viewport, captured_at
                     -- result of the technique extraction from §8
asset_embedding      asset_id, model, dim, embedding vector(N), created_at
                     -- phase 4 only (§7.6), listed here for completeness
```

### 5.4 Boards — the Briefing Package for the AI (Phase 3)

Two things that blur together easily are kept deliberately separate here:

- **Facets and tags** describe *what an asset is*. Assignable automatically,
  context-independent.
- A **board** is a *curated combination for a purpose* — and, per the requirement, explicitly
  the **package handed to the AI to work from**.

That makes the board the most important data structure for the primary consumer, and it demands
more than a list of assets:

```
board            id, title, briefing, kind (manual|smart), created_by, created_at
                 -- briefing: free text. What should come out of this?
board_item       board_id, asset_id, position,
                 role,     -- color | layout | typography | motion | imagery | copy | overall
                 weight,   -- primary | secondary | avoid
                 note      -- "the animation only, not the colours"
board_filter     board_id, filter_json        -- kind=smart only
```

**Why `role` is the decisive field:** hand a model seven images without roles and it has to
guess which aspect of each one is meant — producing a mash-up of seven directions. With `role`
the statement is unambiguous: *this* asset supplies the palette, *that* one the layout, *this*
one only the motion. The same asset can hold different roles in two different boards.

**Why `weight: avoid` exists:** in design briefs, counter-examples are often more precise than
positive ones. "Explicitly *not* like this" rules out an entire region of the solution space
that nothing else rules out.

These three tables are purely additive — foreign keys onto `asset`, nothing more. Creating them
in phase 1 would gain nothing.

### 5.5 Traceability

```
analysis_run         id, asset_id, provider, model, prompt_version,
                     input_tokens, output_tokens, cost_usd,
                     raw_response jsonb,       -- raw LLM response as an audit trail
                     status, error, created_at
audit_log            id, user_id, action, entity, entity_id, diff jsonb, created_at
```

`analysis_run` serves three purposes and therefore belongs in phase 1: reproducibility (which
model, at which prompt version, produced this?), targeted re-analysis (re-run everything below
`prompt_version < N`) and cost transparency.

### 5.6 The Central Invariant

> `origin = 'human'` **always** wins over `origin = 'ai'`.

A re-analysis must never overwrite human corrections. Without this rule, the painstakingly
curated data quality is silently destroyed by the next taxonomy update — the most common way
systems like this lose their users' trust. It is enforced at the database level, not in
application logic.

## 6. Facet Vocabulary

**Approved.** `is_multi_value` means multiple values per asset are allowed.

| Facet | Multi | Values (initial set) |
|---|---|---|
| `type` | no | image, component, font, palette, website |
| `ui_pattern` | yes | hero, nav, footer, pricing, card, form, table, dashboard, onboarding, auth, empty-state, modal, sidebar, gallery, testimonial, cta, blog-post, product-detail |
| `style` | yes | minimal, brutalist, neo-brutal, glassmorphism, editorial, swiss, retro, memphis, corporate, playful, luxury, tech, organic, maximalist |
| `mood` | yes | calm, energetic, luxurious, playful, technical, warm, cool, serious, friendly, dramatic |
| `theme` | no | light, dark, both |
| `density` | no | airy, balanced, dense |
| `typography` | yes | serif, sans, mono, display, script, mixed, oversized, condensed |
| `layout` | yes | centered, split, asymmetric, grid, full-bleed, sidebar, stacked, overlapping |
| `motion` | yes | none, fade, slide, parallax, scroll-reveal, hover-transform, 3d, morphing, marquee, sticky-scroll, cursor-follow, video-bg |
| `industry` | yes | saas, fashion, finance, food, health, education, agency, ecommerce, media, gaming, nonprofit, real-estate |
| `project` | yes | *(free-form, curated per client or project by an admin)* |

Note that `playful` appears in both `style` and `mood`. This is intentional, not an oversight:
in `style` it describes the visual language, in `mood` the effect on the viewer. An asset can be
playful in effect without using a playful visual language, and vice versa. Do not "clean this
up" as a duplicate.

Extending an existing facet is cheap at any time. Adding a **new facet** costs prompt space, and
therefore accuracy on the remaining ones — plus a re-analysis for all existing assets.

## 7. Classification Pipeline

### 7.1 Flow

```
upload / paste / URL / MCP
        │
        ▼
  asset (status=pending)      ◄── immediate response to the client
        │
        ▼  BullMQ
  ┌──────────────────────────────┐
  │ 1. normalize                 │  strip EXIF, verify format, read dimensions
  │ 2. thumbnails                │  sharp → webp sm/md/lg
  │ 3. colors                    │  extract palette → Lab
  │ 4. capture      (URLs only)  │  screenshot, scroll video, keyframes, tech (§8)
  │ 5. classify                  │  LLM vision → facets + description + tags
  │ 6. index                     │  update tsvector
  └──────────────────────────────┘
        │
        ▼
  asset (status=ready)
```

The steps are separate jobs with their own retry. If `classify` fails (API down, rate limit),
thumbnails, colours and capture survive; the asset is usable and gets classified later. A
failure in an expensive late step never destroys the cheap early ones.

### 7.2 Provider Replaceability — the Schema Is the Contract

Requirement: Claude by default, other APIs possible later.

**Not chosen:** a generic multi-provider wrapper (Vercel AI SDK or similar) as the foundation.
The price would be the lowest common denominator — and what would be lost is exactly the
features that matter here: guaranteed schema-valid JSON, batch processing at half price, prompt
caching.

**Chosen:** what gets abstracted is not the API but the **result**. The Zod schema in
`libs/shared` is the contract; each adapter uses the **native SDK of its provider** and is free
to exploit its strengths fully.

```typescript
// libs/shared — the contract. Single source of truth for facets.
export const AnalysisResultSchema = z.object({
  description: z.string().describe('2-4 sentences, factual, English, for full-text search'),
  facets: z.object({
    ui_pattern: z.array(UiPatternEnum),
    style:      z.array(StyleEnum),
    theme:      ThemeEnum,
    motion:     z.array(MotionEnum),
    // … generated from the vocabulary
  }),
  free_tags:   z.array(z.string()).max(10),
  ocr_text:    z.string().nullable(),
  confidence:  z.number().min(0).max(1),
});

// libs/classify — the port interface
export interface AssetClassifier {
  readonly providerId: string;
  readonly modelId: string;
  classify(input: ClassifyInput): Promise<ClassifyOutput>;
}
```

`ClassifyInput` carries one or more images (screenshot, keyframes) plus optional textual context
(URL, title, extracted capture technique). The provider is selected via chart value
(`llm.provider`) through a NestJS DI token.

The Anthropic adapter uses `@anthropic-ai/sdk` with `client.messages.parse()` and
`zodOutputFormat(AnalysisResultSchema)`, which makes the result schema-validated without any
parsing code of our own. Adapters for providers without a real structured-output mode validate
against the same Zod schema after the call and throw on violation; the contract is identical for
all of them.

### 7.3 Model Choice

**Default: `claude-opus-5`** with `output_config: { effort: 'low' }`.

- Low effort, because classification is one of those tasks where more deliberation barely
  improves quality — unlike coding or agentic work.
- Also enabled: server-side **refusal fallbacks**
  (`betas: ['server-side-fallback-2026-07-01']`, `fallbacks: 'default'`). With third-party
  screenshots a safety classifier may occasionally decline; without a fallback the asset would
  simply stay unclassified. With it, the same request continues automatically on another model.
- **Prompt caching** does not pay off for single uploads (5-minute cache TTL), but it does for
  batch re-analysis, where it is enabled.

### 7.4 Cost

Assumption per image asset: ~1,500 input tokens for the image, ~2,000 tokens of system prompt
including the vocabulary, ~1,000 output tokens.

| | Input | Output | Per asset |
|---|---|---|---|
| Opus 5 ($5 / $25 per MTok) | 3,500 → $0.018 | 1,000 → $0.025 | **~$0.04** |
| Website capture, 8 keyframes | ~14,000 → $0.070 | 1,000 → $0.025 | **~$0.10** |

At 500 assets per year that is **roughly 20-30 USD annually.** Optimising cost through model
choice at this volume would be micro-management in the wrong place — metadata quality is the
product, and this is exactly where it is created. The strongest model is the right call.

The monthly limit (`llm.monthlyCostLimitUsd`) exists as a guard against runaway loops, not
against normal operation.

### 7.5 Re-analysis

When the vocabulary grows, everything with `prompt_version < N` can be reclassified through the
**Batch API** (50% discount, up to 24 hours runtime). The real advantage here is not the price
but that rate limits stop being a concern. `origin = 'human'` remains untouched per §5.6.

### 7.6 Why No Embeddings in Phase 1

Embeddings deliver two things: semantic search ("everything that feels warm and earthy", even
without those words in the text) and "similar assets". Both are **dispensable** here:

- A **controlled facet vocabulary is more precise at this data volume.**
  `style=editorial AND theme=dark` hits exactly; an embedding returns a similarity ranking with
  a fuzzy edge.
- **Full-text search over the LLM description** covers the rest. If the model wrote "warm,
  earthy tones", `tsvector` finds it. Embeddings only help with paraphrases that appear nowhere
  literally.
- The value of semantic search **scales with volume**. Indispensable at 50,000 assets; at a few
  hundred, everything is scrollable.

The decisive point: **there is no lock-in.** Embeddings are computed from the stored
description, which is in the database anyway. They can be backfilled across the entire corpus at
any time without loss — unlike the items in §2, "What has to be right from the start".

Infrastructure would not be an obstacle either: a local model such as bge-m3 needs roughly
100-300 ms per text embedding on a current desktop CPU, at ~2.5 GB RAM; even image embeddings
via CLIP (~0.5-1 s per image on CPU) would be inconsequential at this volume. The decision is
purely about value, not about technical feasibility.

## 8. Website Capture

### 8.1 Why a Job and Not an Agent

It is the same library an agent would drive through a Playwright tool — but a fundamentally
different mode of use:

> An **agent is in the loop**: load the page, look at the result, notice "the cookie banner
> covers everything", dismiss it, reassess. Every step is a decision based on the previous one.
>
> The **capture job has no such luxury.** It runs unattended in a queue, has to produce the same
> result for the same URL, and has to retry sensibly on failure without supervision. That is a
> program, not tool use.

Hence the deterministic job is the main path. The agent approach still has a place — see §8.4.

### 8.2 Flow

```
 1. chromium.launch(headless), context with fixed viewport 1440×900,
    deviceScaleFactor 2, recordVideo enabled
 2. page.goto(url), wait for the network to go quiet
 3. dismiss the cookie banner          ← the main problem, §8.3
 4. scroll slowly all the way down     ← triggers lazy loading of all images
 5. back to the top, brief wait
 6. full-page screenshot + viewport screenshot (poster)
 7. scroll video: scripted, even scrolling over 8-12 s
 8. page.evaluate(): technique extraction in the page context
 9. context.close()  → only now does Playwright write the video file
10. ffmpeg: extract 8 keyframes, transcode to MP4
11. keyframes + screenshot + technique context → LLM analysis
```

**WebM/MP4 rather than GIF** — a GIF of the same length is several times the size at worse
quality.

Two steps are what make this part valuable:

- **Step 11: keyframes instead of a single image for the analysis.** From a sequence of frames
  the model can describe the movement and fill the `motion` facet. A single screenshot cannot do
  this in principle — animation is precisely what a still frame lacks.
- **Step 8: technique extraction.** JavaScript running in the page context collects things no
  screenshot shows: the `font-family` values actually in use, every `transition` and `animation`
  property on visible elements, transform types, and the signatures of known libraries
  (`window.gsap`, `window.ScrollTrigger`, `data-aos` attributes, Lenis, Framer Motion). That is
  the difference between "looks smooth" and
  `scroll-reveal via GSAP ScrollTrigger, 0.6s cubic-bezier(0.16,1,0.3,1)`.

The result lands in `capture_tech` (§5.3) and feeds into classification as textual context.

### 8.3 Known Limits

These are properties of the approach, not bugs:

- **Cookie banners** are the most common reason for a useless capture — they cover exactly the
  hero you were after. There is no perfect solution: heuristics over known selectors and accept
  buttons, optionally Consent-O-Matic rule sets. Expect a residual share needing manual rework.
- **A tension around scroll animations:** for the screenshot they should be *finished*
  (otherwise you photograph half-faded elements), for the video they have to be *freshly
  triggered*. Hence the ordering in §8.2: scroll through and screenshot first, then reset the
  page and record.
- **Sticky headers** appear multiple times in full-page screenshots, or cover sections,
  depending on the implementation.
- **Bot detection** (Cloudflare, DataDome) blocks headless Chromium outright on some sites.
  Stealth plugins help, but not everywhere — some pages will not be capturable. Report the
  failure properly instead of silently storing a blank image.
- **Duration:** 20-60 s per capture. This belongs in the queue, never on the HTTP request.

Because websites change, every capture is **archived permanently and locally**; the reference
stays valid even after the site is rebuilt.

### 8.4 Later Stage: Deep Analysis by an Agent (Phase 4)

The deterministic job can only scroll. An agent with browser access could hover, open menus and
trigger interactions — and thus see animations that remain invisible to plain scrolling. That is
more powerful, but slow, expensive and not reproducible.

A sensible division: the deterministic job as the standard for every capture, plus an optional
"deep analysis" button later for individual pages worth it.

Region selection ("the hero only") is also phase 4: CSS selector or image crop.

## 9. Permissions and Visibility

Roles: `admin`, `member`.

| Action | Rule |
|---|---|
| View | everyone sees everything |
| Create | anyone |
| Edit metadata and tags, including other people's | **anyone** |
| Delete | own assets only; admins everything. Soft delete, 30-day trash |
| Extend the controlled vocabulary | admins only |
| Create free-form tags | anyone |
| Manage users | admins (in Authentik) |

**Why those two rows are asymmetric:** shared tagging is deliberately open, because friction in
taxonomy maintenance is the most common reason systems like this fall into disrepair — the audit
log provides traceability without slowing anyone down. Deletion, by contrast, is destructive and
gets the tighter boundary; the trash keeps the residual risk small.

Access: invite-only through Authentik. No self-registration, since the application is exposed to
the internet.

## 10. MCP Interface

The entry point for Claude Code and Claude Design. A remote MCP server over streamable HTTP,
mounted as a route in `apps/api`, authenticated by a personal API token per user.

| Tool | Phase | Purpose |
|---|---|---|
| `search_assets` | 1 | Facet filters plus full-text search. Returns metadata and image URLs |
| `get_asset` | 1 | One asset with all metadata, colours, files, capture technique |
| `list_vocabulary` | 1 | The controlled vocabulary — **so valid filter values are known rather than guessed** |
| `add_asset` | 1 | Create an asset, including from a URL — dropping something in mid-session |
| `get_board` | 3 | **The briefing package** (§10.1) |
| `get_design_tokens` | 3 | Palette and typography as design tokens |

**Images and captures are retrievable as vision input**, not only as descriptions — with design
references, looking at the reference is half the value.

`list_vocabulary` is not a convenience tool: without it an agent would invent filter values and
receive empty result sets without understanding why.

### 10.1 `get_board` — the Key Interface (Phase 3)

Per the requirement, the board is the package handed to the AI to work from. `get_board`
therefore returns not a search result but a **finished briefing**:

```
{
  title, briefing,                      // what should come out of this
  items: [{
    role,        // color | layout | typography | motion | imagery | copy | overall
    weight,      // primary | secondary | avoid
    note,        // "the animation only, not the colours"
    asset: { facets, colors, description, image_url, capture_url, capture_tech }
  }],
  derived: {
    palette,          // consolidated from the items with role=color
    type_pairings,    // from role=typography
    motion_summary,   // from role=motion, including detected libraries
    common_facets,    // what all primary items share → the actual direction
    conflicts         // contradictory signals, named explicitly
  },
  tokens: { json, w3c_design_tokens, css_custom_properties, tailwind_fragment }
}
```

Three design decisions in there:

- **`derived` is computed server-side, not inferred by the model.** Consolidating a palette from
  five images is arithmetic, not a matter of interpretation — server-side it is deterministic
  and identical for every consumer.
- **`conflicts` names contradictions instead of smoothing them over.** If a board contains both
  an `airy` and a `dense` primary, that is information for whoever works from it, not an average
  to be computed.
- **Four token formats**, so work can start immediately instead of interpreting a prose
  description.

## 11. Phases

### Phase 1 — Overview, Classification and Website Capture

Goal: an image or a URL lands in the application, gets captured and classified automatically,
and is findable through facets. By the end of this phase the application is usable daily and
readable by Claude Code.

**Foundation**
- [ ] Nx monorepo, Dockerfiles, GitHub Actions → GHCR (§4.8)
- [ ] Helm chart with the `IngressRoute`/`Ingress` switch, optional cloudflared (§4.12)
- [ ] Wiring to external Postgres and Authentik via values (§4.3)
- [ ] Valkey with its `deploy` flag
- [ ] HostPath volume + nodeAffinity + UID 1000 (§4.2)
- [ ] OIDC login (BFF pattern, HttpOnly cookie) + emergency admin
- [ ] `StorageService` interface (HostPath adapter)

**Data**
- [ ] Data model §5.1-5.3, §5.5 — including `origin` and `analysis_run` from day one
- [ ] Migration job as `argocd.argoproj.io/hook: PreSync` (§4.11)
- [ ] Facet vocabulary as a seed, with English and German labels (§13)
- [ ] Admin maintenance for the vocabulary

**Ingest and Classification**
- [ ] Upload: drag & drop, clipboard paste, multi-upload
- [ ] Job pipeline: normalize → thumbnails → colors → capture → classify → index
- [ ] Anthropic adapter + provider interface

**Website Capture**
- [ ] Playwright in the worker image, `/dev/shm` mount, resource limits (§4.6)
- [ ] Drop in a URL → screenshot, scroll video, keyframes, technique extraction (§8.2)
- [ ] Cookie banner heuristics, proper error reporting (§8.3)
- [ ] Multi-image analysis: keyframes into classification → `motion` gets genuinely filled
- [ ] Video player in the detail view

**Overview**
- [ ] Masonry grid, facet filters, full-text search, author filter
- [ ] Detail view: editable metadata, colours, capture technique
- [ ] Multi-select + bulk tagging

**Internationalisation**
- [ ] Transloco setup, `en.json` and `de.json`, language switcher, `user.locale` persisted (§13)

**Access and Operations**
- [ ] MCP server: `search_assets`, `get_asset`, `list_vocabulary`, `add_asset`
- [ ] Database restore rehearsed once (§4.3)

### Phase 2 — Sharpening

- [ ] Components with real code + live preview
- [ ] Fonts with file upload and live rendering
- [ ] Command palette (Cmd+K)
- [ ] Batch re-analysis UI

### Phase 3 — Boards

- [ ] Board tables (§5.4) as a migration
- [ ] Board UI: create, combine assets, assign roles and weights, reorder, add notes
- [ ] The `briefing` field, smart boards
- [ ] `get_board` including `derived` and token export, `get_design_tokens`

### Phase 4 — Expansion

- [ ] Deep analysis by an agent (§8.4)
- [ ] Region selection for website captures
- [ ] Semantic search + "similar assets" (§7.6) — **only if search proves too narrow**
- [ ] Comments, favourites, activity feed

### Later / Open

- [ ] Public read-only board links for clients
- [ ] Browser extension for clipping
- [ ] Watch-folder import
- [ ] Further LLM adapters
- [ ] Multiple workspaces

## 12. Open Points

1. **Work out the migration strategy** (§4.11) — ordering, idempotency, behaviour on a failed
   migration, rollback.
2. **Authentik application** — an Application plus an OIDC provider named `moodboard`, with
   redirect URIs, must be created in the respective instance.
3. **Valkey for local development** — the chart deploys it in the cluster; whether local work
   forwards to that instance or runs its own is open until the job pipeline exists (§4.9).

> Environment-specific values (domain, issuer URL, HostPath, UID, registry owner) are
> deliberately **not** part of this document. They are set through the ArgoCD Application; for
> local work they live in `infra.local.md`, which is not versioned.

## 13. Internationalisation

The UI supports **English (default) and German**, switchable at runtime. Exactly these two
languages. Everything else — code, database identifiers, documentation, commit messages — is
English only.

### 13.1 Transloco, Not `@angular/localize`

Angular's built-in i18n works at build time and produces one bundle per language; switching
language means a different deployment path and a page reload. The requirement "users can switch"
calls for runtime i18n, so **Transloco**: translations as JSON, a single bundle, switching
without a reload.

The price of this choice: translation keys are not checked at compile time, unlike the template
extraction `@angular/localize` performs. Mitigation is a lint step in CI comparing the key sets
of `en.json` and `de.json`.

### 13.2 What Is Translated

| Content | Where |
|---|---|
| UI strings | Transloco JSON (`en.json`, `de.json`) |
| Facet labels and descriptions | Database, `jsonb` (§5.2) |
| User-facing error messages | Transloco JSON |

The user's choice is persisted in `user.locale` (§5.1) so it survives across devices. The
initial value comes from the `Accept-Language` header, falling back to English.

### 13.3 What Is Deliberately Not Translated

| Content | Why |
|---|---|
| Facet `value` (`calm`, `hero`, `dark`) | The machine-readable key. It feeds the Zod enum, the LLM prompt and MCP filters, so it has to be stable and single-language |
| Asset descriptions (LLM-generated) | English only, by decision. They are primarily search material and context for Claude Code |
| Free-form tags | User input in whatever language they choose — this is the taxonomy's escape valve, and controlling it here would be wrong |
| `ocr_text` | It reproduces whatever the image says |
| Audit log actions | Technical keys, translated only at display time |

### 13.4 Consequence for Full-Text Search

`asset_search.tsv` is built with `to_tsvector('english', …)` from title and description — one
fixed stemming configuration, which is possible precisely because descriptions are English.

Free-form tags do **not** feed into the `tsvector`. They may well be German, and English
stemming would mangle them; they are matched separately and exactly. This is worth knowing
before someone "improves" search by folding tags into the vector.

### 13.5 Why `jsonb` and Not Two Columns

Facet labels live in `jsonb` as `{"en": "Calm", "de": "Ruhig"}` rather than in `label_en` /
`label_de` columns or a separate translation table.

- No join on every vocabulary fetch, and the vocabulary is fetched on every filter render.
- A third language would need no migration, even though none is planned.
- The structure is validated by Zod, in the same place as the rest of the contract.

With roughly 120 vocabulary values that change rarely, this is the simplest form that holds up.
Note that this has to be decided **now**: built as a plain text column and split later, it would
be a migration that moves data — which is why it appears in §2 among the things that cannot be
retrofitted.
