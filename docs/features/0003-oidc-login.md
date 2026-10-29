# 0003 — OIDC login, BFF session and the emergency admin

> Status: draft
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

- **The Authentik Application and OIDC provider do not exist yet.** Needed: a provider named
  `moodboard`, redirect URI `https://moodboard.example.com/api/auth/callback`, and the client
  secret as `moodboard-oidc` in namespace `prod`. Owner: the user.
  The real host is in `infra.local.md`.
- Where the emergency admin's password hash lives: a secret, or a column on `user`?
- Session storage: signed cookie alone, or a server-side session in Valkey? Valkey is deployed
  and running, so the second option is available at no extra cost.

## Verification

1. `oidc.enabled: true` in the ArgoCD Application, with `moodboard-oidc` present: the api pod
   starts, `AUTH_MODE=oidc`, the annotation `moodboard.dev/auth` is gone.
2. Opening `https://moodboard.example.com` redirects to Authentik and back, and a `user` row
   appears with the right `sub`.
3. A data endpoint without a session answers 401, not 200.
4. With `oidc.enabled: false` the same endpoint answers 503 or 401 — never data.
5. The emergency admin logs in from the LAN, is refused from outside, and the attempt appears in
   `audit_log`.
