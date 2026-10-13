# Daemon downloads

`GET /api/daemon/<version>/<platform>` is where a Host (or the Desktop App, when
the Host can't) downloads a Release's Daemon ([ADR 0043](../../../../../docs/adr/0043-daemon-downloads.md)).
A release Desktop App bundles only its own platform's Daemon; its `manifest.json`
holds this URL template and every archive's SHA-256, which the Client checks.

- **307** to `https://github.com/luxdotdev/polaris/releases/download/v<version>/polaris-daemon-<version>-<platform>.tar.gz`,
  `Cache-Control: no-store`, no body. No GitHub API call: the asset URL is
  deterministic, so prereleases (alphas, release candidates) resolve exactly like
  stable releases, unlike the stable-only `latest` routes. A missing asset (a draft
  or unpublished version) is GitHub's 404, and the Client falls back or reports it.
- **400** for a malformed version.
- **404** for a platform outside `darwin-arm64`, `linux-x64`, `linux-arm64`,
  `linux-x64-musl`, `linux-arm64-musl`, and for dev versions (`-dev.`, `+build`),
  which have no Release.

Bytes never pass through Vercel. R2 can replace GitHub behind this URL later.

## Telemetry

Each request emits one Axiom wide event (`lib/log`, see `../update/README.md` for
configuration, shared fields and privacy rules) with `event: "daemon_download"`:

| Field | Meaning |
| --- | --- |
| `version` | Requested version if valid semver, else null. |
| `platform`, `os`, `arch`, `libc` | The requested platform and its parts (`libc` is `gnu` or `musl` on Linux, null on macOS). |
| `client_version` | `?client=` if valid semver: the Desktop App's version. |
| `via` | `?via=host` (the Host downloads) or `client` (the Desktop App downloads, then uploads over SSH). |
| `install_id` | Optional `X-Polaris-Install-ID` UUID v4. Host downloads (curl/wget) send none. |
| `country` | Vercel's `x-vercel-ip-country`. |
| `rejection` | `invalid_version`, `unknown_platform` or `unreleased_version`. |

A redirected request also records a Vercel Analytics event `daemon_download`
(`version`, `platform`, `arch`, `client_version`, `via`) through
`@vercel/analytics/server`'s `track`, scheduled with `after()` so it never delays
the redirect. Only the User-Agent goes along as session context: no IP, cookies or
other headers. A failing tracker logs a generic warning and changes nothing.

Tests (`_lib/index.test.ts`) inject the wide-event and analytics schedulers; they
never call GitHub, Axiom or Vercel. Run `bun test apps/site/app/api/daemon`.
