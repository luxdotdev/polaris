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

Native events publish checking, current, downloading, ready or neutral failure
over typed IPC. Concurrent checks and checks while ready are ignored. Squirrel
downloads in the background; macOS reports neither progress nor release metadata
until download completion. The UI therefore says “Downloading Polaris” with no
bar. The ready version comes from the contract's exact ZIP filename, because
the Release title may be arbitrary prose. Downloads/DMG/translocated launches
show “Can't install here” before contacting the feed.

Restart goes through `app.quit()`: the first `before-quit` waits for the Editor's
existing unsaved-edit choice, disposes the Client and notifications, then calls
`quitAndInstall()`. Cancellation leaves the app and IPC live. A normal quit uses
Squirrel's staged-update-on-exit behavior without requesting a relaunch. Closing
the macOS window still hides it. About, the native menu and the K menu share the
same update state; no notification or toast is generated.

## Verification and limits

`bun test apps/desktop/src/main/updates` uses a fake feed transport with 204,
Release JSON and ZIP bytes; it covers launch/timer scheduling, opt-out/manual
headers, persistent identity, duplicate checks, errors and install gating.
After `bun apps/desktop/scripts/build.ts --no-app`, run
`env -u POLARIS_HANDOFF node apps/desktop/scripts/appUpdatesSmoke.ts`. It takes
the Host's `smoke` lease and runs the production main, preload and renderer
against a localhost feed and a stand-in native downloader. It checks actual
headers, the same install ID and persisted opt-out across launches, menu labels,
⌘K, window hiding, cancelled unsaved quits and restart versus ordinary quit.
Only the fixture overrides `app.isPackaged`; shipped code has no
fake-feed switch. No live feed, telemetry or published Release is contacted.
Real Squirrel signature verification, ZIP unpacking and app replacement require
a signed installed app and are not proved by these fakes.

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
