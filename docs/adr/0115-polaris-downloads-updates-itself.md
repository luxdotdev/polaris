---
status: accepted
---

# Polaris downloads Updates itself

## Context

Squirrel.Mac downloads an Update without reporting progress, so About could only say
"Downloading Polaris" for as long as 131 MB takes (ENG-974). Squirrel.Windows reports none
through Electron either. An Update is also about to skip to the newest Release while an older
one waits (ENG-975), which needs the app, not Squirrel, to know what is downloading.

## Decision

**The main process downloads the Update, verifies it, and has Squirrel install it from a feed
on loopback.** Squirrel still unpacks, checks and swaps the app; it no longer fetches anything
from the internet.

- **The check is Polaris's own request** to the site's feed, in the feed's existing format:
  Squirrel.Mac JSON on macOS, RELEASES on Windows. It carries the consent-controlled headers
  (ADR 0017), as the Windows preflight already did. Only an `https` asset whose file name
  carries a version is downloaded.
- **The download** goes through Chromium's network stack (ADR 0053) into
  `<userData>/pending-update/<asset>.part`. A later try resumes it with a `Range` request; a
  server that ignores the range restarts the file. A connection silent for 60 seconds is a
  failed download. Progress reaches the shared update state at most twice a second.
- **Verification before Squirrel sees it.** macOS: the zip is unpacked with `ditto` and must
  hold one app whose signature is intact (`codesign --verify --deep --strict`) and satisfies
  the running app's designated requirement, the test Squirrel.Mac applies itself. The feed
  names no size or hash for the zip, so the size is the server's `Content-Length`. Windows:
  the package's size and SHA-1 must equal the RELEASES entry fetched over `https`; Windows
  builds carry no Authenticode signature to check. A file that fails is deleted.
- **The local feed** is an HTTP server bound to `127.0.0.1` on a port the OS picks, alive only
  while Squirrel reads it. It answers a request only when the peer address is loopback, the
  `Host` header is its own `127.0.0.1:<port>`, the method is GET or HEAD and the path is under
  a 192-bit random token; it serves the manifest and that one file. Squirrel verifies the
  Update again on its side.
- **The state names two versions.** `readyVersion` is the Release Squirrel has staged;
  `download` is the Release being downloaded, with its byte counts. Restart, "Quit and update"
  and the K menu follow `readyVersion`, not `phase`, so a newer Release can download while an
  older one stays installable (ENG-975) without another change to the state.
- **Failures are in the user's terms**: `failure` says check, download (with how far it got)
  or verify, never upstream text. About says "Couldn't download Polaris 0.12.1".

## Considered Options

- **electron-updater.** It takes the same approach on macOS, but brings its own feed format
  (`latest-mac.yml`), publisher configuration and a second updater; the site's feed and its
  telemetry would have to change.
- **Estimating progress** from the Release's size and elapsed time. A bar that guesses is
  worse than none.
- **Handing Squirrel a `file://` feed or a folder.** Squirrel.Windows accepts a folder;
  Squirrel.Mac only speaks HTTP. One mechanism for both platforms is less to get wrong.
- **Installing the Update without Squirrel.** Replacing a running, signed app and relaunching
  it is what Squirrel is for.

## Consequences

- The Update exists twice on disk for a few seconds (Polaris's copy and Squirrel's), plus the
  unpacked copy during the macOS check; all three are removed once Squirrel has it.
- The feed must keep serving assets that allow a plain GET; a `Range` answer is optional.
- A stable Windows build signed with Authenticode later should add that check beside SHA-1.
