# Desktop App Updates

`index.ts` owns Electron's macOS `autoUpdater`. `identity.ts` creates a UUID v4 on
first launch in `<userData>/install-id` (mode 0600) and detects Downloads, mounted
volumes and App Translocation. The only feed origin is `UPDATE_BASE_URL`,
`https://polaris.lux.dev`; the route and headers follow
[`apps/site/app/api/update/README.md`](../../../../site/app/api/update/README.md).

Only packaged, non-dev darwin-arm64 builds check. Automatic checks default on:
once on launch, then one unref'ed six-hour timeout. Turning them off removes the
timeout and omits the ID on subsequent manual checks. The numeric macOS version
comes from Electron's `process.getSystemVersion()`, never the Darwin kernel.
`settings.json` persists `automaticAppUpdates` and `appUpdateLastCheckedAt`.
A request already sent can finish after opt-out; the next request omits the ID.

Polaris downloads the Update itself (ADR 0116). `index.ts` asks the feed, then
`stage.ts` runs `download.ts` (a resumable `<userData>/pending-update/<asset>.part`
in a `0700` folder, resumed with `If-Range`, never written past its size or 1 GiB,
a 60-second stall limit), `verify.ts` and `localFeed.ts`. The request is
`downloadFetch.ts`, which follows a redirect to `https` only. The state published over
typed IPC carries `download` (version, received and total bytes, at most twice a
second), `readyVersion` (what Squirrel has staged) and `failure` (check, download or
verify). Restart, "Quit and update" and the K menu follow `readyVersion`.
Concurrent checks and checks while ready are ignored. Downloads/DMG/translocated
launches show “Can't install here” before contacting the feed.

Verification on macOS unpacks the zip with `ditto` and requires one app that passes
`codesign --verify --deep --strict` against the running app's designated
requirement; a zip listing more than 2 GiB is refused unopened, and `ditto` is
killed if the folder outgrows its listing or can't be measured. The staged file is
opened once: that descriptor is checked and served. On Windows the
package's size and SHA-1 must equal the RELEASES entry.
A file that fails is deleted and never served. The local feed binds `127.0.0.1` on
an OS-chosen port only while Squirrel reads it, and refuses a non-loopback peer, a
foreign `Host`, a path outside its random token and any method but GET or HEAD.
Squirrel emits `update-downloaded` (ready, when it names this feed's file) or
`error` (a failed download); five minutes without either is a failure too. An
event that names nothing ends the oldest operation that may still answer, never a
newer one. On macOS the next Update waits for that late event, five more minutes
at most; on Windows, where a completion names nothing, no new operation starts
until it arrives or Polaris restarts, and About says so (`failure.stage` `install`).

Restart goes through `app.quit()`: the first `before-quit` waits for the Editor's
existing unsaved-edit choice, disposes the Client and notifications, then calls
`quitAndInstall()`. Cancellation leaves the app and IPC live. A normal quit uses
Squirrel's staged-update-on-exit behavior without requesting a relaunch. Closing
the macOS window still hides it. About, the native menu and the K menu share the
same update state; no notification or toast is generated.

## Verification and limits

`bun test apps/desktop/src/main/updates` fakes the internet (the feed, and an asset
server with Range and dropped connections) and Squirrel, which reads the real
loopback feed over HTTP. It covers progress, resume, an oversized body, a changed
remote file, planted symlinks, a late or mismatched completion, a failed verification, the
feed's refusals, launch/timer scheduling, opt-out/manual headers, persistent
identity, duplicate checks, errors and install gating. `verify.slow.test.ts` runs
the real `ditto` and `codesign` on ad hoc signed fixture apps, a zip with climbing,
absolute and symlink entries, and the unpacking limit (macOS only).
After `bun apps/desktop/scripts/build.ts --no-app`, run
`env -u POLARIS_HANDOFF node apps/desktop/scripts/appUpdatesSmoke.ts`. It takes
the Host's `smoke` lease and runs the production main, preload and renderer.
The fixture answers `polaris.lux.dev` from localhost with a zip of the dev app
itself behind one `https` redirect, so the real download, `codesign` check and loopback feed run; only
Squirrel is a stand-in, and it must be given the loopback feed. It checks actual
headers, the same install ID and persisted opt-out across launches, menu labels,
⌘K, window hiding, cancelled unsaved quits and restart versus ordinary quit.
Only the fixture overrides `app.isPackaged`; shipped code has no
fake-feed switch. No live feed, telemetry or published Release is contacted.
Real Squirrel reading the loopback feed, its ZIP unpacking and app replacement
require a signed installed app and are not proved by these fakes.

## Idle evidence

Before and after: `env -u POLARIS_HANDOFF bun run bench idle --quick --runs 3
--compare packages/bench/baselines/mac14-13-apple-m2-max-12c-quick.json` on Mac14,13
(M2 Max), through the Host's built-in `bench` lease. The inherited Host handoff
was removed because this branch predates the separate bench-handoff fix; the
first run with it inherited measured zero Daemon processes and is invalid.
The fix is accepted on the Lead branch; these runs leave its fixtures unchanged.

| Metric | Before | After | Committed baseline |
| --- | ---: | ---: | ---: |
| Client CPU (% of a core) | 0.302 | 0.224 | 0.456 |
| Client footprint (MiB) | 93.33 | 91.09 | 77.02 |
| Client wakeups/s | 13.50 | 13.49 | 13.40 |
| No-Client footprint (MiB) | 90.97 | 90.58 | 76.33 |
| No-Client wakeups/s | 9.20 | 10.80 | 10.90 |
| Client RSS (MiB) | 74.20 | 128.02 | 110.00 |

Both comparisons exit 1: footprint is already above the old baseline before
this change, and the after run also flags Client RSS. Today's before/after
comparison flags RSS (74.20 → 128.02 MiB with Client, 82.69 → 91.41 without).
Physical footprint stays stable, while RSS includes reclaimable pages. The Host
had 10.2 and 6.0 other cores busy; CPU/RSS attribution is inconclusive. The Daemon
code and benchmark fixtures are unchanged by this task. No baseline is refreshed.

The updater's timer belongs only to the Desktop App, not a Daemon: at most four
scheduled checks per day, cancelled when off or ready. Tests prove there is one
timer and no checks or timer in dev/unsupported/blocked builds. Quiet Upgrade
captions use one-shot expiry timers only after an Upgrade, without polling.
The `idle` scenario measures the Daemon, so it does not prove the packaged
Desktop App's native downloader overhead or six-hour wakeup cost.

## Windows

Packaged, non-dev win32 x64 and arm64 builds use the same controller, opt-out,
quit guard and six-hour scheduling. The feed directory is
`/api/update/win32-<arch>/<version>`; Squirrel appends `/RELEASES`. Maintenance
launches handle `--squirrel-install`, `--squirrel-updated`, uninstall and obsolete
before taking the single-instance lock. Shortcut operations wait for Update.exe
and fail after ten seconds. The matching AUMID is
`com.squirrel.Polaris-<arch>-win.Polaris`. `--squirrel-firstrun` suppresses the
launch check because the installer holds a file lock; the normal timer/manual
check still works. Unpacked/zip builds are blocked unless the executable is in
an `app-<version>` directory with readable `../Update.exe`.

Electron's Windows Squirrel adapter ignores `setFeedURL` headers, so Polaris's own
fetch of RELEASES sends `X-Polaris-Windows-Version` and, only while automatic
checks are on, the install ID. A 204 finishes as current; a failure is retryable;
disposal prevents a download. Polaris downloads the one full nupkg RELEASES names,
checks its size and SHA-1, and serves Squirrel a loopback RELEASES naming the
package beside it. The site sees no native Squirrel request any more.

Windows unit tests run on macOS using injected platform, paths, updater and
transport. They cover both architectures, maintenance/shortcuts, first run,
preflight headers and opt-out, disposal, the loopback RELEASES, a SHA-1 mismatch,
package parsing and install gating.
Native Windows installer/update behavior is a separate verification gate.
