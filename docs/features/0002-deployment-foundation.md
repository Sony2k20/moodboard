# 0002 — Deployment foundation: images, CI and Helm chart

> Status: accepted
> Phase: 1
> Created: 2026-10-26

---

## Problem

The application exists as source only. There is no way to get it onto the cluster, which means
every later step of phase 1 — login, upload, the job pipeline, capture — would be built without
ever running where it has to run. Two of those steps also depend on infrastructure that only the
chart can provide: the job pipeline needs Valkey, and the upload needs the HostPath volume with
the right ownership.

The deployment path is also where the mistakes are expensive and invisible. A HostPath whose
owner does not match the container's UID produces a pod that starts perfectly cleanly and fails
on the first upload, days later, looking like an application bug (concept §4.2). A migration that
runs after the rollout instead of before it surfaces as seemingly random runtime errors (§4.11).
Both are cheaper to get right now than to diagnose later.

## Scope

- **Three images** — `api`, `worker`, `web` — built from the repository and pushed to GHCR by
  GitHub Actions, tagged `sha-<commit>` on every build and `v<semver>` on releases (§4.8).
- **CI**: `lint`, `test`, `build` for every project, plus `helm template` and `helm lint` on the
  chart, plus a check that `en.json` and `de.json` have the same key set (§13.1) — the latter as
  a placeholder that passes trivially until those files exist.
- **Helm chart** in `deploy/chart`, with generic defaults only (§4.3):
  - Deployments for `api`, `worker` and `web`, with the resource requests and limits from §4.6
    and §4.7
  - `IngressRoute` by default, `Ingress` selectable via `ingress.kind` (§4.4)
  - `cloudflared` deployment, off by default (§4.12)
  - Valkey behind a `deploy` flag (§4.3)
  - HostPath volume, `nodeAffinity` pinning `api` and `worker` to one node, `runAsUser: 1000`
    (§4.2)
  - `/dev/shm` as an `emptyDir` with `medium: Memory`, `sizeLimit: 1Gi` on the worker (§4.6)
  - The migration as an initContainer in front of api and worker (§4.11)
  - All secrets referenced, never created: the CNPG application secret (§4.3.1), OIDC, LLM, GHCR
    pull

### Not in scope

- **Playwright in the worker image.** The capture step owns that, and the base image is large
  enough that carrying it before anything uses it would slow every build for no benefit. The
  `/dev/shm` mount is in the chart already, because it is free and forgetting it later is the
  single most common cause of "works locally, dies in the cluster" (§4.6).
- **The ArgoCD Application** itself. It carries the environment-specific values and lives outside
  this repository (§4.3).
- **The CNPG `Cluster`.** It is its own Application and already exists (§4.3.1).
- Everything behind the deployment: login, upload, pipeline, UI, MCP.
- A staging environment. One cluster, one release.

## Data model impact

None. This step adds no table and no column.

It does fix **when** migrations run, which is the operational half of §4.11: an initContainer
applies them before api and worker start, under any deployment tool, and a failure leaves the new
pod unready while the previous one keeps serving. The rule that follows applies to every later
migration: during a rolling update the previous version runs against the new schema for as long
as the rollout takes, so columns are added in one release and removed in a later one, never both
at once.

## Vocabulary impact

None. The seed is not run by the deployment — it is an administrative action, not a migration,
and running it automatically would overwrite label corrections made in the cluster on every
sync.

## i18n impact

No new strings. The CI key-set check for `en.json` / `de.json` is set up here because it is the
mitigation the concept names for choosing Transloco over compile-time i18n (§13.1), and a check
added after the files exist tends to be added after they have already drifted.

## MCP impact

None directly. Indirectly it is a precondition: an MCP server that is not deployed is not
reachable by Claude Code, which is the primary consumer (§1).

## Known limits

- **A first install depends on the database Application syncing first.** The migration reads the
  CNPG secret, which the operator creates while bootstrapping the cluster. That is an ordering
  between Applications, not something this chart can enforce — the initContainer simply retries
  until the database answers, so it resolves itself, just later.
- **`nodeAffinity` on a single-node cluster is a formality** that does nothing today. It is in
  the chart so that a later second node makes the pod fail to schedule visibly, instead of the
  API silently serving files the worker wrote somewhere else.
- **HostPath ownership cannot be fixed by the chart.** `fsGroup` is accepted and ignored for
  `hostPath` volumes; the `chown` on the node is a manual, one-time step and will stay one.
- **`helm template` in CI proves the chart renders, not that it works.** Rendering catches typos
  and missing values, nothing about whether the result schedules.
- **Image size is not optimised.** Correctness and reproducibility first; the worker image will
  grow considerably when Playwright arrives.

## Open questions

- **Scaling `api.replicas` beyond one** is a values change, and two pods would then migrate
  concurrently. The advisory lock in `runMigrations` covers that, but nothing else about running
  two api replicas has been thought through — sessions, in particular.

## Verification

1. `npx nx run-many -t lint,test,build` stays green.
2. `helm lint deploy/chart` and `helm template deploy/chart` render without error, and with
   `--set ingress.kind=Ingress` produce an `Ingress` instead of an `IngressRoute`; with
   `--set valkey.deploy=false` no Valkey objects appear.
3. The rendered api and worker both carry the migration initContainer, and the worker carries
   the `/dev/shm` mount with `medium: Memory`.
4. A push to `main` produces three images in GHCR tagged `sha-<commit>`, and each one starts:
   `docker run` on `api` answers on its port, `web` serves the Angular bundle.
5. Pointed at the cluster through the ArgoCD Application, the sync completes, the migration
   initContainer logs "Migrations applied", and all three deployments become ready.
