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
  `<userData>/pending-update/<asset>.part`. It is an Electron `net.request`, not `net.fetch`,
  because only a request can refuse a redirect: one is followed to `https` only. The hosts are
  not listed: GitHub chooses its storage host, a list would strand every installed app the day
  it changes, and the signature check below is what decides whether the bytes are Polaris. A
  connection silent for 60 seconds is a failed download. Progress reaches the shared update
  state at most twice a second.
- **The file never grows past its size.** The size is the feed's (Windows) or the server's
  `Content-Length` (macOS), and never more than 1 GiB; with neither, 1 GiB is the limit. Each
  chunk is checked before it is written, and a body that runs past the limit is deleted, not
  kept as a resume point.
- **A resume names the file it started.** The first answer's strong `ETag` (else its
  `Last-Modified`) is kept beside the partial file and sent as `If-Range` with the `Range`, so
  an asset replaced in the meantime restarts instead of mixing two files. A partial file with
  no such name, and a server that ignores the range, start over.
- **The pending folder is private.** It is created `0700` and refused if it is a symlink; the
  partial file is opened without following symlinks. The finished file is opened once, the
  same way: that descriptor is hashed (Windows), must still be the file its path names after
  the check that reads the path (`ditto`, macOS; device and inode compared), and is what the
  local feed serves every request from.
- **Verification before Squirrel sees it.** macOS: the zip is unpacked with `ditto` and must
  hold one app whose signature is intact (`codesign --verify --deep --strict`) and satisfies
  the running app's designated requirement, the test Squirrel.Mac applies itself. `ditto`
  keeps entries that climb (`../`) or are absolute inside the folder and will not write through
  a symlink. The unpacked app may take 2 GiB: a zip whose own listing (`zipinfo -t`) adds up to
  more, or can't be read, is refused unopened. `ditto` does not honour the sizes a zip states,
  so the folder is also measured (`du`, one scan at a time, 100 ms apart, killed when `ditto`
  ends) and `ditto` is killed once it passes twice the listed size plus 64 MiB of block
  rounding, or 2 GiB, or can't be measured. The feed
  names no size or hash for the zip, so the size is the server's `Content-Length`. Windows:
  the package's size and SHA-1 must equal the RELEASES entry fetched over `https`; Windows
  builds carry no Authenticode signature to check. A file that fails is deleted.
- **The local feed** is an HTTP server bound to `127.0.0.1` on a port the OS picks, alive only
  while Squirrel reads it. It answers a request only when the peer address is loopback, the
  `Host` header is its own `127.0.0.1:<port>`, the method is GET or HEAD and the path is under
  a 192-bit random token; it serves the manifest and that one file. Squirrel verifies the
  Update again on its side.
- **Squirrel runs one operation at a time.** A handover lasts from `checkForUpdates` to
  Squirrel's terminal event (`update-downloaded`, `error`, `update-not-available`). Five
  minutes without one publishes a failure and closes the feed; the quiet operation then holds
  Squirrel's slot for five more minutes at most, or until its late event. The next verified
  Update waits for that and is then handed over, so a Squirrel that never answers delays a
  retry but cannot stop it. A completion makes an Update ready only when the address Squirrel
  names is under that handover's own token and, on macOS, carries its version, so a late
  completion is never taken for a newer handover's; Squirrel.Windows may name nothing, and
  there the order of operations is the tie. A quiet Update that Squirrel finishes after all
  becomes ready if nothing newer has begun. `error` names nothing: it ends the operation
  holding the slot.
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
- The feed must keep serving assets that allow a plain GET; a `Range` answer is optional, and
  without an `ETag` or `Last-Modified` a dropped download starts over.
- After a quiet operation's claim lapses, a late `error` from it would be taken for the next
  handover's and fail it; the retry after that works.
- The unpacking limit can be passed by what `ditto` writes during one scan and its 100 ms gap.
- A stable Windows build signed with Authenticode later should add that check beside SHA-1.
