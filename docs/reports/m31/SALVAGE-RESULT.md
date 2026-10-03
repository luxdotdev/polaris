# M3.1 local v1 salvage

The inherited joint branch `m31/j1-joint-integration` now supplies a local editing v1 with the accepted foundations, E1's preserved patch, and completed refactor/resource bindings. The original Polaris Constellation remains paused; its historical Claims/Attempts and broader release gates were not rewritten.

## Delivered behavior

- Main persists a private language credential, provides independently authenticated identity/connection epochs, and owns typed IPC.
- One first-use Host graph supplies explicit Workspace trust, configured existing executables, launch leases, preparation/provenance, document synchronization and feature requests. No managed downloads or artifact approvals are supplied.
- The Editor binds the existing controller/coordinator and strict IndexedDB group store. Text proposals use the format-2 path for coordinated drafts. Preview, accept/reject, dirty-buffer preservation, guarded undo and recovery use R1/X1/X2.
- Host resource handlers authenticate private Client receipt challenges through existing context.watch/server.respond, pin current group/revisions across movement, and verify historical recovery through an independently current same-owner/checkout context. Old acceptance never replays.
- Settings refreshes language contexts and Markdown policy. Markdown source/preview and existing formatter/save coordination are preserved.
- Capabilities advertise implemented current format-2 services. Older receipt-less legacy text mutation RPCs remain unavailable. The full managed-language matrix, media activation and remote/release certification remain deferred.

## Verification receipts

Working root during checks: `/private/tmp/m31-j1-integration`; base `d423cdc22d7eec23cd3a206e7485db34ae7d4eb8`. Final source is committed on the named branch; the root checkout retains its separate identity WIP and newer main history.

- Full `bun run typecheck --env-mode=loose --concurrency=2`: 10 tasks pass, 7 cached; `/private/tmp/m31-salvage-typecheck-final.log`.
- Full `bun run test --env-mode=loose --concurrency=1`: 10 tasks pass, 9 cached from matching candidate runs; `/private/tmp/m31-salvage-tests-final.log`. The fresh Daemon run passed 1359 tests with 11 existing skips; fresh Desktop passed 1241 tests, zero failures. Prior failed catalog count, source startup, teardown deadline and long socket fixtures were corrected without raising test timeouts or weakening checks.
- `bun run lint`: format and ratchet pass, no increased baseline; `/private/tmp/m31-salvage-lint-final.log`.
- `bun run licenses:check`: 679 production dependencies plus 8 installed platform builds, zero violations; `/private/tmp/m31-salvage-licenses-final.log`.
- `bun run spec`: scenarios, 3000-trace simulations and expected mutant violations pass; `/private/tmp/m31-salvage-spec-01.log`. New resource-receipt model supplements X1/X2; no Apalache claim.
- Model tests: 10 pass / 19711 assertions; `/private/tmp/m31-salvage-verification.log`. Both accepted real tree recovery/intervention trace replays pass.
- Main/preload and renderer source build pass; `/private/tmp/m31-salvage-desktop-build.log`. No packaging, signing or cross-target build claim.
- Real installed TypeScript server through actual first-use default Host services: authenticated Unix socket, explicit trust and configured launch, unsaved completion and unchanged disk, 4 assertions; `/private/tmp/m31-salvage-real-provider/real-host-final-03.log`. Reproducible opt-in source: `apps/daemon/src/languages/composition/configuredLaunch.live.testing.ts`, requiring three explicit existing executable/package paths. No downloads.
- Bounded joint native runner: Settings, actual CodeMirror interactions, resource accept/recovery/undo, strict IndexedDB reopen and async discard preservation pass; `/private/tmp/m31-salvage-joint-native-05`. Scripted Host/provider services; owned profile/process cleanup recorded. Fixture hashes were deliberately refreshed after reviewed fixes; bounds unchanged.
- Connected native resource proof: `/private/tmp/m31-refactors-connected/proof-run07/evidence.json`, screenshots/cleanup, 19 assertions. Actual Electron Accept/Undo, production R1 binder/controller/strict IndexedDB, authenticated socket feed/responses, real directory operations and exact original disk/draft restoration. Trust/provenance/provider setup is fixture-injected; this does not certify the entire production Default Host preparation-to-resource path. Earlier failed temporary attempts remain recorded. Run08 adds explicit optimizer discovery and extra disappearance assertions; consult the worker receipt for its final result.
- Actual built Desktop App + source Daemon launched against isolated profile and registered playground: Main identity valid, no renderer errors; `/private/tmp/m31-play-v1/evidence/launch.json`. Bench Harness is used for Agent Sessions, not as a substitute language provider.

## Performance and local-v1 tradeoff

Three-run quick idle comparison retains a visible historical-baseline failure: 135.8 MiB client RSS / 98.11 MiB physical footprint versus old 110.0 / 77.02 MiB. Current main separately measured approximately 88 MiB physical footprint; both runs exceeded the old memory baseline. The salvage adds approximately 10 MiB against current main. Idle CPU/wakeups remain within tolerance; background load was 4.4–5.7 cores, so CPU is busy-host evidence, not quiet-host certification.

Language services use existing first-use composition; no new idle polling timer was added. The v1 accepts this bounded memory cost explicitly. The scoped measurement is retained in `packages/bench/baselines/mac14-13-apple-m2-max-12c-m31-idle-quick.json`; its source was dirty at the recorded base and its background-load classification is preserved. The older full-machine baseline and comparison thresholds remain intact; the scoped snapshot does not turn the older comparison green. Full baseline refresh/performance certification remains a separate release gate.

## Preservation and launch

Before edits: 293 files / 4,854,164 bytes were hash-verified in `/private/tmp/m31-salvage-preserve-20261003T170630Z`, including staged/unstaged diffs and E1's exact candidate. No reset/clean or live graph database edits occurred.

The durable checkout is `/Users/lucasdoell/code/polaris/.polaris-dev/m31-v1/source`. Playground launcher/profile/demo live beside it, isolated from the system Daemon and normal Desktop profile. Run `node /Users/lucasdoell/code/polaris/.polaris-dev/m31-v1/launch.mjs`. The launcher owns its app/Daemon and stops the Daemon when the app exits. Existing TS server configuration is provided explicitly; managed tooling remains unapproved. Opening a language file after reconnect supplies the current context required for historical guarded recovery.
