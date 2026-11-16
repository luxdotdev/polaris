# Account Server (`@polaris/accounts`)

An Account Server holds Accounts for sharing and team work: it signs people in with GitHub, vouches
for their devices with short-lived statements, finds people by login, and carries Invites between an
owner and a Teammate. It never decides what anyone may do on a Host and is never on the data path
([ADR 0112](../../docs/adr/0112-accounts-vouch-for-people-hosts-decide-access.md); terms are
CONTEXT.md's Sharing section).

One Bun process serves [Better Auth](https://better-auth.com) under `/api/auth` (GitHub sign-in, the
JWT plugin's JWKS with key rotation, Bearer sessions, the device authorization flow), a few browser
pages (`/sign-in`, `/device`), and the Polaris API under `/v1` (an Effect `HttpApi`), on Postgres
through Drizzle.

**This README is the contract.** Daemons, Clients and Extensions code against it; change it here
first.

## Polaris Cloud and self-hosting

| | Polaris Cloud | Self-hosted |
|---|---|---|
| Account Server (issuer) | `https://auth.polaris.lux.dev` | your `BETTER_AUTH_URL` |
| Polaris Relay | `wss://relay.polaris.lux.dev/v1` | your relay ([apps/relay](../relay/README.md)) |
| GitHub | github.com, Polaris's OAuth app | your OAuth app on github.com or GitHub Enterprise Server |
| Postgres | Polaris's | your own |

`https://auth.polaris.lux.dev` is the issuer every Client uses by default; a self-hosting team points
its Clients at its own. Invites and finding people work only within one Account Server, and a Host
trusts only the issuer pinned on each Share.

## Contract

The issuer `{iss}` is the server's origin, exactly `BETTER_AUTH_URL` (no path, no trailing slash).
Bodies are JSON. Errors are JSON with a `_tag` (`Unauthorized` 401, `PersonNotFound` 404,
`InviteNotFound` 404, `InviteClosed` 409, `InvalidInvite` 400, `CommitEmailNotAllowed` 400,
`InvalidGrant` 400; a body
that doesn't match the schema is 400).

### Statements

A statement is an EdDSA (Ed25519) JWT, valid 15 minutes, binding a person to one device's relay key:

```json
{
  "iss": "https://auth.polaris.lux.dev",
  "aud": "https://auth.polaris.lux.dev",
  "sub": "<personId>",
  "iat": 1794862973,
  "exp": 1794863873,
  "cnf": { "noiseKey": "<base64url X25519 static public key, 43 chars>" },
  "login": "octocat",
  "name": "The Octocat",
  "avatarUrl": "https://avatars.githubusercontent.com/u/583231",
  "commitEmail": "octocat@github.com"
}
```

Verify it against the JWKS at `{iss}/api/auth/jwks`, fetched over TLS from the issuer pinned on the
Share; the header's `kid` names the key. Keys rotate every 30 days and a retired key stays in the
JWKS for 7 more, so cache the JWKS but refetch on an unknown `kid`. `avatarUrl` may be `null`.

### Signing a device in

A device ends up with a **session token**, sent as `Authorization: Bearer <token>`. Sessions last 7
days and renew while used.

- **With a browser (Desktop App, Mobile App): authorization code with PKCE (RFC 8252).**
  1. Make a `code_verifier` (43–128 characters of `A–Z a–z 0–9 - . _ ~`) and its
     `code_challenge = base64url(SHA-256(code_verifier))`, and a random `state`.
  2. Open `{iss}/sign-in?redirect_uri=<uri>&state=<state>&code_challenge=<challenge>&code_challenge_method=S256`
     in the user's browser. `<uri>` is `http://127.0.0.1:<port>/…`, `http://localhost:<port>/…` or
     `http://[::1]:<port>/…` (prefer a loopback listener on the Desktop App), or `polaris://…`
     (the Mobile App). Anything else, or a missing `state` or S256 challenge, is refused.
  3. The server records a pending sign-in bound to that browser (a cookie), always sends the browser
     through GitHub for it, and then redirects to `<uri>?code=<code>&state=<state>`. It never puts a
     token in a redirect. Check `state`.
  4. `POST {iss}/v1/sign-in/token {code, code_verifier}` gives `{token}`, the session token. A code
     works once, for 60 seconds, and only with its own verifier; a wrong verifier spends it. Anything
     else is 400 `InvalidGrant`.

  `/sign-in/done`, where GitHub returns the browser, issues a code only for a pending sign-in this
  browser started, and only after a GitHub sign-in newer than it.
- **Without one (fallback).** Better Auth's device authorization flow:
  `POST {iss}/api/auth/device/code {client_id}` gives `user_code` and `verification_uri_complete`
  (`{iss}/device?user_code=…`) for the user to open on any signed-in browser; poll
  `POST {iss}/api/auth/device/token {grant_type: "urn:ietf:params:oauth:grant-type:device_code",
  device_code, client_id}` no faster than every 5 s until it returns `{access_token}`, the session
  token. Codes expire after 15 minutes.

Sign out with `POST {iss}/api/auth/sign-out` and the Bearer token. Signing out, revoking the
session (`POST {iss}/api/auth/revoke-session`), its expiry, or deleting the person takes every device
that accepted an Invite with that session off its Share (see Devices long-poll).

### Endpoints

| | Auth | Request | Response |
|---|---|---|---|
| `POST /v1/sign-in/token` | none | `{code, code_verifier}` | `{token}` |
| `POST /v1/statements` | Bearer | `{noiseKey}` | `{jwt}` |
| `GET /v1/people?login=` | Bearer | | `{personId, login, name, avatarUrl}`: whoever holds `login` on GitHub now, if they have an Account here |
| `GET /v1/me` | Bearer | | `{personId, login, name, avatarUrl, commitEmail, commitEmails}` |
| `PUT /v1/me` | Bearer | `{commitEmail}` | as `GET /v1/me` |
| `POST /v1/invites` | Bearer (owner) | `{inviteeLogin, share, host, role, expiresAt}` | `{inviteId, hostCapability}` |
| `GET /v1/invites` | Bearer (teammate) | | `[{inviteId, owner, share, host: {name}, role, expiresAt}]` |
| `POST /v1/invites/{id}/accept` | Bearer (teammate) | `{relayAddress, noiseKey}` | `{host, share, role, owner}` |
| `POST /v1/invites/{id}/decline` | Bearer (teammate) | | 204 |
| `GET /v1/shares/{inviteId}/devices` | Capability | `?wait=` seconds | `[{personId, relayAddress, noiseKey, statement}]` |
| `DELETE /v1/shares/{inviteId}/devices` | Capability | | 204 |

where `share` is `{id, title, kind: "session" | "constellation"}`, `host` is
`{name, relayAddress, noiseKey}`, `role` is `"contributor" | "commenter"`, `owner` is a person as
`GET /v1/people` returns it, and times are ISO 8601.

- **Identity.** A person is one GitHub account (its numeric ID), never an address: two GitHub
  accounts are never merged, and a login is resolved through GitHub (with the asker's token) so a
  login someone renamed away from never reaches them. Login, name and avatar are refreshed from
  GitHub at every sign-in.
- **Commit email.** `commitEmails` lists the person's verified GitHub addresses (primary first,
  read with the `user:email` scope) and GitHub's noreply address, `ID+login@users.noreply.<host>`.
  `commitEmail` defaults to the primary verified address, else the noreply one; `PUT` takes only an
  address from `commitEmails`. It is in every statement.
- **Invites.** `expiresAt` must fall within the next 30 days; a pending Invite lapses then
  (`InviteClosed` with `status: "lapsed"`). `inviteeLogin` is resolved through GitHub at invite
  time and the Invite records that person's GitHub ID: only they see or answer it, whatever their
  login becomes; anyone else gets 404. Accepting registers the accepting device under the session it
  accepted with; each further device of the Teammate accepts the same Invite again to join the list. Declining an accepted Invite leaves the Share and empties
  the list. The Account Server keeps no Share expiry of its own: the Host enforces and renews it.
- **The host capability** is returned once, at creation; the server keeps only its SHA-256. Send it
  as `Authorization: Capability <hostCapability>`. It reads only its own Share and works until
  `DELETE` revokes it, after which it is 401 and the Invite can't be accepted.
- **Devices long-poll.** The list is empty until the Invite is accepted, and again once declined.
  A device leaves it when the session it accepted with ends (sign-out, revocation, expiry), so no
  statement is issued for it again and the last one lapses within 15 minutes.
  Each response carries an `ETag`. Send it back as `If-None-Match`: the server answers as soon as the
  list changes, or `304` after `wait` seconds (default and at most 60; `0` answers at once). The
  `ETag` also rolls over every 5 minutes so a waiting Host always holds statements with at least 10
  minutes left. Waiting requests on one instance wake at once; across instances within 5 s.

## Running it

### Configuration

| Variable | Required | |
|---|---|---|
| `BETTER_AUTH_URL` | yes | The public origin, which is the issuer. Polaris Cloud: `https://auth.polaris.lux.dev`. |
| `DATABASE_URL` | yes | Postgres, e.g. `postgres://user:pass@db:5432/accounts`. Migrations run at start. |
| `BETTER_AUTH_SECRET` | yes | 32+ random bytes (`openssl rand -base64 32`); encrypts the JWKS private keys and signs cookies. Changing it orphans the keys. |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | yes | The GitHub OAuth app. |
| `GITHUB_URL`, `GITHUB_API_URL` | no | GitHub Enterprise Server: `https://git.example.com` and `https://git.example.com/api/v3`. Default github.com. |
| `PORT` | no | Default 3000. |
| `TRUSTED_ORIGINS` | no | Comma-separated extra origins allowed to call Better Auth from a browser. |

### A GitHub OAuth app

On GitHub: Settings → Developer settings → OAuth Apps → New OAuth App (or an organisation's).
Homepage URL is `BETTER_AUTH_URL`; Authorization callback URL is
`{BETTER_AUTH_URL}/api/auth/callback/github`. Generate a client secret. The server asks for
`read:user` and `user:email`. A GitHub App works too if it has "Email addresses: Read-only".

### With Docker

From the repository root:

```sh
docker build -f apps/accounts/Dockerfile -t polaris-accounts .

docker network create polaris-accounts
docker run -d --name accounts-db --network polaris-accounts \
  -e POSTGRES_USER=accounts -e POSTGRES_PASSWORD=change-me -e POSTGRES_DB=accounts \
  -v accounts-db:/var/lib/postgresql/data postgres:17-alpine

docker run -d --name accounts --network polaris-accounts -p 3000:3000 \
  -e BETTER_AUTH_URL=http://localhost:3000 \
  -e DATABASE_URL=postgres://accounts:change-me@accounts-db:5432/accounts \
  -e BETTER_AUTH_SECRET="$(openssl rand -base64 32)" \
  -e GITHUB_CLIENT_ID=… -e GITHUB_CLIENT_SECRET=… \
  polaris-accounts

curl http://localhost:3000/healthz          # ok
curl http://localhost:3000/api/auth/jwks    # {"keys":[{"alg":"EdDSA",…}]}
```

Keep `BETTER_AUTH_SECRET` fixed across restarts (store it, don't regenerate it). In production put
TLS in front and set `BETTER_AUTH_URL` to the public `https://` origin; Hosts fetch the JWKS only
over TLS. The server is stateless apart from Postgres, so it runs as several instances behind a load
balancer; give it an idle timeout over 60 s for the long-poll.

### Locally

```sh
bun install
BETTER_AUTH_URL=http://localhost:3000 DATABASE_URL=postgres://… BETTER_AUTH_SECRET=… \
  GITHUB_CLIENT_ID=… GITHUB_CLIENT_SECRET=… bun run --cwd apps/accounts start
```

## Development

- `src/api/definition.ts` is the `/v1` API as an Effect `HttpApi`; `src/api/handlers.ts` implements
  it. `src/auth/` configures Better Auth; `src/server/pages.ts` holds the browser pages and
  `src/signIn/` the pending sign-ins and code exchange behind them.
- Schema changes: edit `src/db/schema.ts`, then `bunx drizzle-kit generate --name <what>` in this
  directory, and commit the new file under `drizzle/`.
- Tests: `bun run --cwd apps/accounts test`. The slow tier runs the whole server against a fake
  GitHub (`src/testing/fakeGitHub.ts`) and a real Postgres: a `postgres:17-alpine` container it
  starts and leaves running (`polaris-accounts-test-pg`), or `ACCOUNTS_TEST_DATABASE_URL` (an admin
  URL; each test file creates and drops its own database).
- **CI and Docker.** Only the slow tier (`*.slow.test.ts`) needs Postgres; the fast tier needs
  nothing. CI's `ubuntu-latest` runners have Docker, so the "other packages" test job starts the
  container itself. Where there is no Docker, run Postgres as a service (a GitHub Actions
  `services: postgres`) and set `ACCOUNTS_TEST_DATABASE_URL`; without either, the slow tier fails
  at setup with a message saying so.
