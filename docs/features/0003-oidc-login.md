# 0003 — OIDC login, BFF session and the emergency admin

> Status: implemented, not yet switched on in the cluster
> Phase: 1
> Created: 2026-10-27

---

## Problem

The application is deployed and reachable, and it has **no authentication**: the chart is running
with `oidc.enabled: false`, the api carries `AUTH_MODE=disabled` and the pod the annotation
`moodboard.dev/auth: disabled`. That is acceptable only because there is nothing behind it yet —
one Angular skeleton and a `Hello API`.

Nothing else in phase 1 can be built first. Every table that follows records *who*: `asset.created_by`,
`asset_facet_value.set_by`, `audit_log.user_id`. Those columns exist (`0001`) and are `NOT NULL`
where the concept demands it, so an upload endpoint without a user has nothing to write. And
`origin = 'human'` — the invariant the whole data model is built around (§5.6) — is meaningless if
"human" cannot be named.

Access is invite-only through Authentik (§9), the instance is exposed to the internet, and the
IdP is on the critical path for everyone including the admin (§4.10).

## Scope

To be decided during implementation, but the shape follows from §4.5:

- **Authorization code flow with PKCE, BFF pattern.** Tokens stay in the api; the browser gets an
  HttpOnly, Secure, SameSite cookie. No token in `localStorage`.
- `user` row created or updated on first login from the OIDC claims: `sub` (the stable identity),
  `email`, `display_name`, `locale` from `Accept-Language` falling back to `en` (§13.2).
- `AUTH_MODE` is honoured rather than ignored: with `disabled`, the api serves health and the UI
  shell and **refuses data endpoints**. The flag already reaches the container (`0002`); this is
  where it gains meaning.
- **The emergency admin** (§4.10): local account, not through SSO, LAN-restricted, separately
  hashed password, disableable by configuration flag, every use in the audit log.
- Personal API tokens are what MCP clients authenticate with (§4.5, §10) — the table may land
  here, the MCP endpoint itself does not.

### Not in scope

- The MCP server (§10). It needs these tokens, but it is a later step.
- Upload, pipeline, UI beyond a login state.
- Role management: roles live in Authentik, the application only reads them (§9).

### Decided

- **Server-side sessions in Valkey.** The cookie carries an opaque session id, nothing else.
  Authentik is configured with a backchannel logout URI (`/api/auth/backchannel-logout`), and
  a logout notification can only end a session the server can find and delete — a signed cookie
  cannot be revoked. Valkey already runs, so this costs no new component.
- **Role from the `groups` claim, on every login.** One Authentik group maps to `admin`, one to
  `member`; the group names are chart values (`oidc.adminGroup`, `oidc.memberGroup`), because
  they belong to the environment, not to the code. A user in neither group is refused with 403
  even if Authentik let them through — the Application's policy binding is the first gate, this
  is the second.
- **Post-logout redirect** goes to the application root, which sends an anonymous visitor
  straight back to the Authentik login. No separate "signed out" page in phase 1.
- **Session lifetime:** 7 days sliding, 30 days absolute; 12 hours absolute for the emergency
  admin. The session id in the cookie is stored in Valkey only as its SHA-256, so a dump of
  Valkey holds nothing that can be replayed as a cookie.
- **The api starts without Authentik.** Discovery and the signing keys are fetched on first use
  and retried, not at startup — otherwise the api would not come up during exactly the outage
  the emergency admin exists for.
- **The emergency admin's password hash lives in a secret** (`emergencyAdmin.existingSecret`, key
  `passwordHash`, scrypt from `node:crypto`, generated with `tools/hash-password.mjs`), not in
  a column. It has to work when the IdP is down, and rotating it must not need database access.
  The account itself is an ordinary `user` row with `sub = 'local:emergency-admin'` and role
  `admin`, so `created_by` and the audit log can point at it.
- **"LAN only" is enforced by port, not by source IP.** Behind the cluster load balancer the
  source address of LAN traffic is rewritten, so an IP allowlist would either let everyone in or
  nobody. The emergency login is served on a second api port (default 3001) and only there; the
  chart routes that port through a separate IngressRoute bound to the LAN entry point
  (`emergencyAdmin.entryPoints`). From the internet the same path reaches port 3000 and gets 404.
  Five failed attempts lock the login for 15 minutes; every attempt is in `audit_log`.
- **Personal API tokens do not land here.** The table arrives with the MCP step; it is additive
  and nothing here depends on it. The format is fixed now so the MCP step does not reopen it:
  `mbp_` followed by 32 random bytes in base64url, stored only as SHA-256.

## Data model impact

**Additive.** `user` exists with `sub`, `email`, `display_name`, `role`, `locale` (§5.1,
implemented in `0001`). A table for personal API tokens would be new and additive — hashed token,
`user_id`, label, `last_used_at`.

The one thing to get right rather than retrofit: the emergency admin must be a `user` row like
any other, so that `created_by` and the audit log can point at it. A parallel identity mechanism
that is not a `user` would leave rows it cannot be attributed to.

## Vocabulary impact

None.

## i18n impact

First real UI strings, so this is where `en.json` / `de.json` are created and the CI key-set check
(`tools/check-translations.mjs`, in place since `0002`) starts doing something. Login and error
messages are translated; `user.locale` is persisted and is what the UI follows after login.

## MCP impact

Decides how MCP clients authenticate later: a personal API token per user, not the browser
session, because an MCP client arrives with a bearer token and no cookie. Worth settling the token
format here even if the endpoint comes later.

## Known limits

- **The IdP is a single point of failure** (§4.10). If Authentik is down nobody gets in; the
  emergency admin is the mitigation, and it is only as good as the one rehearsal nobody does.
- **A BFF session is per-browser.** No token means no API access from a script — that is what the
  personal API tokens are for.
- Roles come from Authentik, so a role change there needs a re-login to take effect.

## Open questions

- **Authentik is set up** (provider, groups, redirect and backchannel logout URI); the real
  values are in `infra.local.md`. The client secret must be in a secret `moodboard-oidc` under
  the key `clientSecret`, which is what the chart reads.

## Implementation

| Where | What |
|---|---|
| `apps/api/src/app/auth/` | Login, callback, logout, backchannel logout, `/api/me`, the global guard, the emergency login |
| `oidc.client.ts` | The only file that imports `openid-client` and `jose`; lazy discovery |
| `session.store.ts` | Valkey keys under `mb:auth:` — session, `sid` and `sub` indexes, one-shot login state |
| `identity.ts` | Pure mapping: groups → role, `Accept-Language` → locale, `returnTo` sanitising, logout token claims |
| `deploy/chart` | `oidc.adminGroup`, `oidc.memberGroup`, `emergencyAdmin.*`, health probes, the LAN-only IngressRoute |
| `apps/web` | Session state, sign-out, language switch, `/login-failed`, `/emergency`; Transloco with `en.json` / `de.json` |
| `tools/hash-password.mjs` | Writes the emergency admin's `passwordHash` |

Every non-public route requires a session by default; `@Public()` is the opt-out, so an
endpoint that forgets about authentication is protected anyway.

### Switching it on

1. Image tag in the ArgoCD Application to the build that contains this.
2. `oidc.adminGroup` and `oidc.memberGroup` to the real Authentik group names.
3. `oidc.enabled: true`.
4. Optional, separately: the emergency admin —
   `node tools/hash-password.mjs | kubectl -n <namespace> create secret generic moodboard-emergency-admin --from-file=passwordHash=/dev/stdin`,
   then `emergencyAdmin.enabled: true` with `emergencyAdmin.entryPoints` set to the LAN entry
   points only.

## Verification

1. `oidc.enabled: true` in the ArgoCD Application, with `moodboard-oidc` present: the api pod
   starts, `AUTH_MODE=oidc`, the annotation `moodboard.dev/auth` is gone.
2. Opening `https://moodboard.example.com` redirects to Authentik and back, and a `user` row
   appears with the right `sub`.
3. A data endpoint without a session answers 401, not 200.
4. With `oidc.enabled: false` the same endpoint answers 503 or 401 — never data.
5. The emergency admin logs in from the LAN, is refused from outside, and the attempt appears in
   `audit_log`.
