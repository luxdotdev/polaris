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
  rounding, or 2 GiB. A scan that exits
  non-zero skipped something, so its total is only a lower bound: `ditto`'s own temporary files
  vanish under a scan, so one miss is ordinary, but three in a row kill `ditto`, and the scan
  after it ends must be clean. The feed
  names no size or hash for the zip, so the size is the server's `Content-Length`. Windows:
  the package's size and SHA-1 must equal the RELEASES entry fetched over `https`; Windows
  builds carry no Authenticode signature to check. A file that fails is deleted.
- **The local feed** is an HTTP server bound to `127.0.0.1` on a port the OS picks, alive only
  while Squirrel reads it. It answers a request only when the peer address is loopback, the
  `Host` header is its own `127.0.0.1:<port>`, the method is GET or HEAD and the path is under
  a 192-bit random token; it serves the manifest and that one file. Squirrel verifies the
  Update again on its side.
- **Squirrel runs one operation at a time, and an event only touches the operation it can be
  tied to.** A handover lasts from `checkForUpdates` to Squirrel's terminal event
  (`update-downloaded`, `error`, `update-not-available`). Five minutes without one publishes a
  failure and closes the feed, and the operation goes stale: it may still answer. A completion
  that names an address under a handover's own token ends that handover, and makes its Update
  ready only if, on macOS, the address carries its version. An event that names nothing ends
  the oldest operation that may still answer, since Squirrel ends them in the order it was
  given them; so a late event from a stale operation never readies, fails or deletes the files
  of a newer one. A stale Update that Squirrel finishes after all becomes ready if nothing
  newer has begun.
- **macOS frees the slot after five more minutes; Windows does not.** On macOS a completion
  names its feed, so the next verified Update is handed over once the stale operation ends or
  five more minutes pass. Squirrel.Windows may name nothing it finishes, so a second operation
  could not be told from the first: there no new operation starts until the stale one sends
  its terminal event or Polaris restarts, checks do nothing meanwhile, and About says
  "Couldn't install Polaris 0.12.1 · The installer didn't answer; restart Polaris to try
  again" (`failure.stage` `install`).
- **The state names two versions.** `readyVersion` is the Release Squirrel has staged;
  `download` is the Release being downloaded, with its byte counts. Restart, "Quit and update"
  and the K menu follow `readyVersion`, not `phase`, so a newer Release can download while an
  older one stays installable (ENG-975) without another change to the state.
- **Only the newest Release is downloaded (ENG-975).** Checks continue while an Update is
  ready or downloading; their feed request leaves the row as it is. A Release newer than the
  one downloading or ready is downloaded in the background (a half-done older download is
  stopped and its files go); one that isn't newer changes nothing. Once Squirrel finishes the
  newer one it is `readyVersion`; until then Restart installs the older. A newer one that fails
  leaves the older ready, with the failure kept. `replaces` and `skipped` let About say why.
  No check runs while Squirrel reads an Update. Whether real Squirrel accepts a second
  operation after one is staged is unproven here (ENG-985); if it refuses, the older stays ready
  and that Release isn't downloaded again this run (a still newer one is). Releases are ordered
  by semver, Nightlies (`X.Y.Z-nightly.YYYYMMDD`) included: below their own X.Y.Z, by date
  among themselves, and between `beta` and `rc` of the same core, as semver orders the names.
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
- If Squirrel ever ended operations out of order, an unnamed event would be tied to the wrong
  one; the newer handover would then time out instead of failing at once.
- The unpacking limit can be passed by what `ditto` writes during one scan and its 100 ms gap.
- A stable Windows build signed with Authenticode later should add that check beside SHA-1.
