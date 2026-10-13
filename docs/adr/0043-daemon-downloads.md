---
status: accepted
implements: Release downloads ship only the Client's own Daemon
---

# A Host downloads its own Daemon; the app bundles only its own platform's

Until alpha.2 every Desktop App carried all five Daemon builds (darwin-arm64,
linux-x64, linux-arm64 and both musl builds): 657 MB of the 980 MB Mac app and
about 65% of its 390 MB DMG. Windows installers carried the same five, including
the darwin build a Windows machine can never use. Each build is `polaris` (85 MB
on macOS, 130 MB on Linux) plus betterleaks (about 21 MB).

## Decision

A release app bundles only the Daemon its own machine runs: darwin-arm64 in the
Mac app, none in Windows (it has no local Daemon; a WSL distro is a Linux Host
like any other). Every platform is published with the GitHub Release as
`polaris-daemon-<version>-<platform>.tar.gz` (a gzipped ustar holding `polaris`
and `betterleaks`) plus `polaris-daemon-<version>-SHA256SUMS`.

The bundled `manifest.json` still lists every platform: per-file SHA-256 and size,
each archive's name, SHA-256 and size, the download URL template, and `bundled`,
the platforms whose files are present. A downloaded build is trusted only when it
matches what shipped inside this app, so a compromised CDN or site can't change it.
Approval still names the `polaris` binary's SHA-256, so it reads the same however
the build arrives.

## Distribution

GitHub Releases are the CDN. The marketing site fronts them:
`GET https://polaris.lux.dev/api/daemon/<version>/<platform>` answers 307 to the
exact-tag asset, `Cache-Control: no-store`, and logs one Axiom wide event
(`daemon_download`: version, platform split into os/arch/libc, client version and
`via` from the query, install ID, country) plus a Vercel Analytics event, both after
the response. The route makes no GitHub API call: the asset URL is deterministic,
so prereleases resolve exactly like stable releases, and a missing asset is GitHub's
404, which the Client treats as any other failed download. Dev versions (`-dev.`,
`+build`) answer 404 because no Release exists for them. Bytes never pass through
Vercel. R2 can replace GitHub behind the same URL later.

## Install flow

The probe also reports `curl`/`wget`, `tar` and `sha256sum`/`shasum`. The planner
decides the delivery for an install or upgrade:

- **Upload**: the build is bundled (dev apps, the Mac's own platform): streamed over
  SSH as before.
- **HostFetch**: the Host has a downloader, tar and a SHA-256 tool. It downloads the
  archive into its fresh `~/.polaris/upload-<id>/`, checks the archive's SHA-256,
  extracts it, and every file's SHA-256 is checked against the manifest before
  `polaris install|upgrade` runs. Like `curl … | sh` installers, the Host pulls
  from the web, with no transfer over SSH.
- **ClientFetch**: the Host can't (no tools, no egress, a mismatch, a 404). The
  Client downloads the same URL into `<userData>/daemon-builds/<version>/<platform>/`,
  checks the archive and each file, and uploads it over SSH as before. Other versions
  in that cache are removed. HostFetch falls back to this on any failure.

## Linux C library

The probe decides glibc first, as the Daemon's own check does
(`apps/daemon/src/languages/composition/environment.ts`): a Host with a glibc loader
is glibc even when musl's loader is installed beside it (Debian's `musl` package).
Only a Host whose sole libc is musl gets a musl build. The loader list lives in one
place, `GLIBC_LOADERS` in `packages/client/src/install/builds.ts`.

## Consequences

- Dev and unreleased builds (`package` without `--release`, `dev`) still bundle every
  platform; there is no Release to download from.
- The release workflow uploads the archives with the DMG and ZIP. The archives are
  made after signing, so the darwin-arm64 archive holds the signed binary. The
  Windows job reuses the macOS job's dist and manifest, so both apps list identical
  archives.
- A Host install now needs the network on either the Host or the Client for platforms
  the app doesn't carry. An offline Client with an offline Host can only install the
  bundled platform.
