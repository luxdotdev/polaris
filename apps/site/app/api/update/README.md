# Release feed and Mac download

The Desktop App checks `https://polaris.lux.dev/api/update/darwin-arm64/<version>`.
`<version>` is the installed semantic version (no `v` prefix); prerelease and build
identifiers are supported. Headers are optional for feed functionality:

| Request header | Desktop App value | Logged value |
| --- | --- | --- |
| `X-Polaris-Install-ID` | A random UUID v4 created once on first launch and stored in `userData`. Never an account, Host or Workspace ID. | Lowercase UUID, or null if absent/invalid. |
| `X-Polaris-macOS-Version` | Actual macOS version, e.g. `26.0.1` (not the Darwin kernel version). | Numeric version; preferred over User-Agent. |
| `User-Agent` | May identify Polaris and macOS, e.g. `Polaris/1.2.3 (Macintosh; Mac OS X 26_0_1)`. | Only the extracted macOS version, never the raw User-Agent. |

Automatic checks off stops automatic requests and their install ID, per
[ADR-0017](../../../../../docs/adr/0017-update-checks-carry-an-anonymous-install-id.md).
The updater task implements the settings and ID lifecycle; this route has no
account or identity lookup. Manual checks follow the updater's consent policy.

- Same or newer version (ignoring build metadata): **204**, empty body. Never downgrade.
- Older version, including a prerelease of the current stable version: **200**,
  Squirrel.Mac JSON `{ url, name, notes, pub_date }`. `url` is the ZIP asset,
  `name` is the Release title (tag fallback), `notes` the body (empty fallback),
  `pub_date` the GitHub `published_at` timestamp.
- Malformed version: **400**, JSON error; no GitHub lookup.
- No published Release yet (GitHub 404): **204** for update checks.
- GitHub failure, invalid Release or missing/unsafe update asset: **503** with
  `Retry-After: 60`. No upstream error text is returned or logged.

`GET /download/mac` redirects **307** to the latest DMG. With no published Release,
an upstream failure or a missing/unsafe DMG, it returns **503** with `Retry-After`.
Neither route nor redirect is HTTP/CDN cached (`Cache-Control: no-store`), so
requests reach logging even when the Release lookup is cached.

## Release contract

Source: GitHub's [latest-release API](https://docs.github.com/en/rest/releases/releases#get-the-latest-release)
for `luxdotdev/polaris`. Drafts and prereleases are excluded by GitHub and checked
again at the JSON boundary. A stable semver tag, optionally prefixed `v`, is required.
The exact uploaded asset names are:

- Update: `Polaris-<version>-arm64-mac.zip`
- Download: `Polaris-<version>-arm64.dmg`

Both URLs must point at that tag's asset under
`https://github.com/luxdotdev/polaris/releases/download/`. Duplicate assets fail
closed. Each route requires only its own asset (a 204 requires neither).

Validated metadata and 404 results are cached lazily for **300 seconds per server
instance**, shared between both routes, with concurrent lookups deduplicated.
No timer or poll runs. A cold Vercel instance performs its own lookup; cache is
not shared across instances. Lookup failures are not cached; no stale Release
is served after cache expiry. GitHub requests have a five-second timeout.

## Axiom configuration and privacy

Set server-only `AXIOM_TOKEN` (an ingest token scoped to the dataset) and
`AXIOM_DATASET` in Vercel. Never use `NEXT_PUBLIC_` for either. Events are JSON
arrays posted to `https://api.axiom.co/v1/ingest/<dataset>` with a Bearer token.
No Axiom SDK or automatic request capture is used.

Each handled GET emits exactly one wide event (`lib/log`) via Next.js `after()`,
including 400, 503 and cached Release lookups. It is sent to Axiom and written
to the function log as one JSON line with the ingest result (`axiom`: `ok`,
`unconfigured`, `rejected_<status>` or `failed_<ErrorType>`). Shared fields:
`_time`, `request_id` (`x-vercel-id`), `method`, `route`, `service`, `commit`,
`deployment_id`, `environment`, `region`, `status_code`, `outcome`
(`success`/`rejected`/`error`) and `duration_ms`. Route fields:

| Field | Meaning |
| --- | --- |
| `_time` | Request timestamp, ISO 8601. |
| `event` | `update_check` or `download`. |
| `version` | Valid caller semver; null for downloads or malformed versions. |
| `arch` | `arm64`, the artifact architecture this route serves. |
| `macos_version` | Valid explicit header, else numeric Mac OS X User-Agent extract, else null. Browser UAs can report a compatibility version; the explicit header is authoritative. |
| `install_id` | Optional UUID v4; null otherwise. |
| `country` | Two-letter uppercase `x-vercel-ip-country` from Vercel, else null. |
| `release_version` | Tag of the latest published Release, or null. |
| `update` | `current` or `available` for update checks. |
| `failure` | `no_release` or `release_unavailable` (with `error`: type and HTTP status only). |

Country comes directly from Vercel's geo header; the application never reads,
stores or forwards the IP. It also excludes raw headers, User-Agent, URL/query,
cookies, email addresses and upstream error bodies. The event uses an explicit
allowlist. Client values are untrusted; ID, OS version and country are validated
and malformed caller versions are never logged verbatim.

Logging has a five-second timeout and no retry (avoids duplicate events). Missing
configuration or failed ingest emits only a generic server warning and does not
break updates/downloads. This is best-effort delivery, not a durable queue:
one event is attempted per request when configured; delivery is not guaranteed
through outages. This application policy does not configure Vercel's own
infrastructure logs; review those separately when deploying.

Local checks use fake GitHub/Axiom transports, never live telemetry. Run
`bun test apps/site/app/api/update` and `bun run --cwd apps/site build`.
After building, run `bun apps/site/scripts/smoke-feed.ts` for the production HTTP
check. It starts `next start` on a free localhost port, replaces all outbound
fetches with a fake GitHub/Axiom transport, checks six responses and events plus
the shared Release cache, then stops the child and removes temporary files.
