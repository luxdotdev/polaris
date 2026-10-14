# Test suite audit

Date: 2026-10-13. Commit: `7b7e0fe6` on `main`. This is the commit that added the "no tautological tests" rule to AGENTS.md, and this audit works as a backlog against that rule.

Scope: every `*.test.ts(x)` in `apps/*`, `packages/*`, `scripts` and `tooling`.

**I edited no source or test file.** I ran the mutation spot checks in a `git archive` copy under the session scratch directory, never in the checkout.

## Summary

- **Inventory.** There are 763 test files and 4,940 executed tests (4,313 `test()` sites before `.each` and loop expansion), with 12,980 `expect` calls.
- **Runtime.** Run serially, the suite takes about 397 s. The Daemon accounts for 243 s and the Quint replay tests in `packages/spec` for 107 s; everything else together is under 50 s.
- **Overall quality is high.** Most tests drive the real Engine, EventStore, git, recorded Harness traces, brokers or pure folds, and assert exact outcomes. Fakes sit at the boundary, as AGENTS.md asks, and almost no test only checks mock call order.
- **Dead weight is small.** It is roughly 3–7% of tests or assertion lines per area. The exception is `packages/protocol`, where about 35% of tests round-trip values built with `.make`.
- **The bigger problem is tests that pass when behaviour breaks.** I mutated 20 behaviours, picked for being the ones I suspected were weakly tested, so this is not a random sample. 13 survived the owning test file or package suite, and 6 of those survived the entire Desktop App suite.
- **Deleting buys almost no runtime.** It removes about 50–60 tests and under 1 s. The time is in fixed sleeps and in the replay tests' serial `quint` spawns, which together cost about 80–100 s.

## Method and caveats

- **Static scan.** I parsed all 763 test files with `@babel/parser` and recorded each test's `expect` calls, matchers and helper calls, self-comparisons, constant pins and identical bodies. That found 23 constant pins, 6 self-comparisons and no byte-identical test bodies.
- **Runtime scan.** I ran each package's `bun test` with the JUnit reporter, which gives a time and an assertion count per test. 29 tests made zero `expect` calls. 16 of those are skipped e2e tests, and 12 assert through `node:assert`, a thrown `Error` or a `waitFor` timeout. One is genuinely vacuous: `needs-you/model/dismissed.test.ts:41`.
- **Reading.**
  - Six parallel reviewers covered daemon core, daemon harness/languages/constellation/mcp, desktop main/shared/scripts/store/shell, the desktop editor and settings, the other desktop features, and packages/site/tooling. They read 451 of the 763 files fully (59%), each against its production module, and skimmed the rest with grep.
  - Every desktop renderer-feature and desktop-main file was read.
  - In the Daemon, 111 of 343 files were read fully.
  - I re-checked a sample of their findings myself and verified every cited commit SHA.
- **Coverage.**
  - I ran `bun test --coverage` per package (lcov plus text).
  - **Bun reports line and function coverage only, with no branch coverage.** A one-line `if (x) throw …` counts as covered as soon as the condition is evaluated. `packages/client/src/install/download.ts` shows 100% lines, yet two of its safety checks survive mutation (M11, M12).
  - Code that only runs inside spawned Daemons or CLIs is not counted, for example `transport/serve.ts`, `service/upgrade.ts` and `service/cli.ts`.
- **A moving tree.** While the timing and coverage runs were going, the checkout moved: `2181da25` became `7b7e0fe6` and another session's staged platform-services change came and went. Every package passed in both runs. The mutations ran against a fixed copy of `7b7e0fe6`. Line numbers below are as of `7b7e0fe6`.

## 1. Inventory

| Package | Test files | Tests run | Wall time |
|---|---:|---:|---:|
| apps/daemon | 343 | 1,934 (13 skipped e2e) | 243.0 s |
| apps/desktop (incl. `scripts/`) | 316 | 2,141 | 21.5 s |
| apps/site | 14 | 232 | 5.6 s |
| packages/spec (replay tests) | 3 | 28 | 106.9 s |
| packages/client | 25 | 200 | 2.8 s |
| packages/protocol | 23 | 127 | 0.9 s |
| packages/ui | 14 | 94 | 0.9 s |
| packages/predict | 6 | 24 (1 skipped live) | 0.1 s |
| packages/syntax-diff | 2 | 22 | 0.2 s |
| packages/bench | 4 | 20 | 2.2 s |
| packages/lint-config | 1 | 2 | 0.8 s |
| tooling | 9 | 87 | 11.4 s |
| scripts | 3 | 29 | 0.1 s |
| **Total** | **763** | **4,940** | **≈ 397 s serial** |

Time per test:

| Threshold | Tests |
|---|---:|
| ≥ 0.1 s | 473 |
| ≥ 0.5 s | 160 |
| ≥ 1 s | 83 (together 236 s, 60% of the total) |
| ≥ 5 s | 15 |

There are also 82 `*.testing.ts` helper and fixture modules and 6 `*.graph.test.ts` model-based path suites.

### Slowest 30 tests

| # | s | Package | Test | Name |
|---|---:|---|---|---|
| 1 | 13.51 | spec | `scripts/constellation-replay/replay.test.ts:498` | Host resource streams use their own owner and capacity |
| 2 | 12.41 | spec | `…/replay.test.ts:383` | handover requests replay in order… |
| 3 | 11.30 | spec | `…/replay.test.ts:684` | first-Turn trace validation rejects blocked, review and settled Attempts |
| 4 | 10.83 | spec | `…/replay.test.ts:555` | recovery replay requires eligible proof… |
| 5 | 10.12 | daemon | `src/languages/runtime/processAdmission.test.ts:158` | retirement timeout retains capacity… |
| 6 | 8.75 | daemon | `src/verification/tempDirectories.test.ts:98` | representative suites leave no temp directories |
| 7 | 6.58 | spec | `…/replay.test.ts:359` | repeated delivery… rejected |
| 8 | 5.87 | spec | `…/replay.test.ts:452` | stale settlement requires explicit context |
| 9 | 5.84 | spec | `…/replay.test.ts:637` | quoted multiline feedback and merge base replay safely |
| 10 | 5.67 | spec | `…/replay.test.ts:713` | re-claim trace preserves earlier Claim |
| 11 | 5.66 | spec | `…/replay.test.ts:482` | remote receipt reapplication is rejected |
| 12 | 5.60 | spec | `…/replay.test.ts:340` | refused remote intents can commit empty owner receipt batches |
| 13 | 5.42 | spec | `…/replay.test.ts:422` | stale intervals and per-recipient input receipts |
| 14 | 5.12 | daemon | `src/languages/runtime/cleanup.test.ts:62` | repeated broker close stays bounded |
| 15 | 5.00 | site | `app/api/email/_lib/validator.test.ts:236` | 5 s deadline aborts a client that never settles |
| 16 | 4.42 | tooling | `language-catalog/fixture.test.ts:5` | fixture poison… (runs Python) |
| 17 | 4.41 | daemon | `src/engine/session.graph.test.ts:402` | 367 transition paths |
| 18 | 4.35 | daemon | `src/reviewer/Reviewer.test.ts:720` | Rules-only summary… |
| 19 | 4.10 | daemon | `src/engine/checkout.graph.test.ts:211` | every state-changing transition |
| 20 | 3.65 | daemon | `src/git/review/fetch.test.ts:237` | shallow clone deepens to the merge base |
| 21 | 3.12 | desktop | `scripts/lib/devBundle.test.ts:13` | named, signed, reused… (copies Electron, codesigns) |
| 22 | 3.11 | tooling | `language-catalog/bounded-build.test.ts:5` | synthetic source-build guards (runs Python) |
| 23 | 3.09 | daemon | `src/engine/session.graph.test.ts:402` | 277 transition paths |
| 24 | 3.07 | daemon | `src/resources/cli.test.ts:20` | CLI child leases survive SIGKILL and restart |
| 25 | 3.06 | daemon | `src/files/search/watch.test.ts:49` | git watches are capped |
| 26 | 2.83 | spec | `…/replay.test.ts:615` | unblock replay rejects a fresh broadcast |
| 27 | 2.80 | spec | `…/replay.test.ts:304` | JSON boundary and CLI replay a log |
| 28 | 2.80 | spec | `…/replay.test.ts:346` | mismatched merged head is rejected |
| 29 | 2.79 | daemon | `src/languages/catalog/developer-shellcheck.test.ts:123` | held pipes fail closed |
| 30 | 2.77 | spec | `…/replay.test.ts:300` | protocol events replay Claims… |

The slowest files are:
- Daemon: `reviewer/Reviewer.test.ts` 14.0 s, `git/review/fetch.test.ts` 13.1 s, `engine/Engine.reviewCheckouts.test.ts` 11.5 s, `languages/runtime/processAdmission.test.ts` 11.4 s, `git/review/interdiff.test.ts` 10.5 s.
- Spec: `constellation-replay/replay.test.ts` 99.9 s.

**Why the constellation replay is slow.** Its `check()` (`packages/spec/scripts/constellation-replay/replay.test.ts:163`) runs `quint test` once per generated module through a blocking `Bun.spawnSync`, at about 2.5 s each and 35 calls in all.

## 2. Coverage

These figures come from each package's own run. Where a file is not loaded by its own package, the best figure from another package's run is used instead; this applied to 10 client files and 21 ui files. "Unloaded" means no test in any package imported the file in-process.

| Package | Prod files | Unloaded | Lines (loaded) | Funcs (loaded) | Lines, est. incl. unloaded |
|---|---:|---|---:|---:|---:|
| apps/daemon | 813 | 235 (~1.6k lines) | 92.1% | 88.5% | 89.6% |
| apps/desktop | 994 | 244 (~19.9k lines) | 60.4% | 72.3% | 46.4% |
| apps/site | 47 | 26 (~1.0k lines) | 96.4% | 92.5% | 51.3% |
| packages/protocol | 60 | 0 | 93.9% | 71.7% | 93.9% |
| packages/client | 50 | 5 (~0.3k) | 92.6% | 81.0% | 86.5% |
| packages/ui | 83 | 15 (~1.7k) | 46.9% | 60.2% | 35.2% |
| packages/predict | 10 | 1 | 95.8% | 88.5% | 93.8% |
| packages/bench | 29 | 21 (~2.1k) | 57.3% | 68.2% | 18.6% |
| packages/syntax-diff | 8 | 1 | 100% | 98.5% | 95.9% |
| packages/lint-config | 35 | 35 | n/a | n/a | n/a: plugins run inside the oxlint subprocess its fixtures test spawns |
| tooling | 15 | 7 | 83.6% | 88.8% | 55.7% |

- **What the Daemon's unloaded files are.** They are almost all entry points and subprocess-only modules: `transport/serve.ts`, `transport/bridge.ts`, `service/cli.ts`, `resources/cli.ts`, `files/search/fffWorker.ts`, `main.ts`. There are also the Harness `generate.ts` codegen scripts and bench files. Most are exercised by tests that spawn `bun main.ts`, just not counted.
- **The Desktop App's gap is mostly views.** Its `.tsx` files hold 38k coverable lines with 33k missed. Its `.ts` logic is 70% covered.

### Largest untested or under-tested production modules, by risk

Daemon:

| Module | Coverage | Missed lines | Note |
|---|---:|---:|---|
| `transport/handlers.ts` | 46% | 180 | |
| `engine/rpc.ts` | 42% | 60 | |
| `transport/lazy.ts` | 48% | 64 | |
| `terminal/Terminals.ts` | 65% | 187 | |
| `service/upgrade.ts` | 35% | 267 | the execve hand-off is exercised in a subprocess |
| `service/libc.ts` | 46% | 94 | |
| `constellation/transfers/preparation.ts` | 34% | 73 | |
| `languages/composition/preparation.ts` | 38% | 73 | |
| `constellation/composition/index.ts` | 63% | 86 | |

The engine and store themselves are well covered: `session.ts` 83%, `EventStore.ts` 92% in-package, `decider.ts` 80%. They are also deep, with model-based, graph and spec replay tests.

Client install:
- Line coverage is 95–100%, but the branches are not exercised. The download size limit, the per-file manifest hash, the `-`-alias option-injection guard and the tar header checksum all survive mutation; see §4.
- `HostConnection.ts` is at 86% and is only tested directly by `transport.test.ts:13`.

Desktop main:
- `main/notifications/index.ts`, the Needs You centre glue: 0%, 180 lines.
- `main/ipc/requests.ts`: 45%, 197 missed.
- `main/ipc/feeds.ts`: 53%.
- `main/index.ts`: 0%, entry point.
- `main/snapshotCache.ts`: no test.
- `main/github/poller.ts`: indirect only.

Desktop renderer logic with no importing test (not views):

| Module | Lines |
|---|---:|
| `review/ui/useReviewModel.ts` | 240 |
| `composer/editor/editor.ts` | 210 |
| `terminal/runtime.ts` (attach/IO) | 207 |
| `editor/commands/useLanguageCommands.ts` | 174 |
| `accept/ui/useAcceptPanel.ts` | 165 |
| `comments/data/actions.ts` | 164 |
| `editor/explorer/gutter/gitGutter.ts` | 158 |
| `review/checkout/useCheckout.ts` | 149 |
| `review/constellation/actions.ts` | 124 |

Some renderer modules are loaded but barely run:

| Module | Coverage | Missed lines |
|---|---:|---:|
| `editor/runtime/buffers.ts` | 14% | 593 |
| `editor/lsp/queries.ts` | 22% | 318 |
| `editor/runtime/actions.ts` | 21% | 224 |
| `editor/prediction/store.ts` | 19% | 168 |
| `constellation/hooks.ts` | 13% | 197 |

`packages/ui`: 47% of loaded lines. The primitives are rendered in the gallery, not in tests.

### Well-covered code with shallow tests

- **`packages/client/src/install/download.ts` and `archive.ts`** show 100% lines with untested failure branches; see M11–M14.
- **`languages/composition/core.test.ts`** (lines 136–172, 358–389, 391) and **`apps/desktop/src/main/languages/identity.test.ts:73-118` and `bridge.test.ts:138-172`** assert only the error class, or `ok === false`. Any failure satisfies them, including `not-connected` or a crash.
- **`apps/daemon/src/harness/codex/planLimits.test.ts:94`** claims "the weekly window keeps its last value", which is never asserted. **`:147`** asserts an empty list, which is also the default, after a 30 ms sleep.
- **`packages/client/src/languages/connection.test.ts:38`** is a single 300-line test with 20 assertions. It is hard to diagnose when it fails.

## 3. Findings by category

Counts are approximate and add up the six reviewers' lists after my spot-checks. "Lines" means individual assertions inside otherwise useful tests.

| Category | Findings | Whole tests deletable |
|---|---:|---:|
| A. Tautological | ~38 (mostly single lines) | ~12 |
| B. Incidental pins | ~29 | ~8 |
| C. Type-level facts restated | ~35, of which ~30 are protocol round-trips | ~15 after merging |
| D. Duplicates | ~37 | ~20 |
| E. No meaningful assertion | ~9; 1 confirmed vacuous at runtime | ~3 |
| F. Over-mocked, order only | 3 reviewed, all kept: the order is the property | 0 |
| G. Weak, would pass with the behaviour broken | ~45, plus ~30 un-awaited `.rejects` | 0 (strengthen) |

### A. Tautological

| Location | Problem |
|---|---|
| `apps/daemon/src/engine/turnPage.test.ts:103` | `expect(MAX_TURN_PAGE).toBe(50)`. The cap is never exercised (2 Turns, `limit: 10_000`). M01 survived. |
| `apps/daemon/src/engine/Engine.limited.test.ts:143` | `RESUME_DEVICE` contains "Polaris": a constant check. |
| `apps/daemon/src/service/templates.test.ts:41` | "is deterministic" compares a pure function's output with itself. |
| `apps/daemon/src/resources/resources.test.ts:239` | "Release without killing" uses `process.pid`, the test runner, which can't have been killed. |
| `apps/daemon/src/mcp/tools/bootstrap.test.ts:157` | Tool names compared with the array they were built from. |
| `apps/desktop/src/renderer/store/store.test.ts:31,68` | `other` is a spread copy taken before the reduce, so `toEqual({})` can't fail. |
| `apps/desktop/src/main/languages/runtime.test.ts:362` | The test's own fake filters latency (l.301-303), then the test asserts latency is null. |
| `apps/desktop/src/main/github/pullActions.test.ts:466-467` | Asserts that the GitHub fake merged the pull: tests the fake. |
| `apps/desktop/scripts/packaging/manifest.test.ts:139` | `toHaveLength(5)` is the fixture's `PLATFORMS` count. |
| `apps/desktop/src/renderer/features/editor/lsp/groups.test.ts:10` | Compares `contextIdOf(k)` with `contextIdOf(k)`, the same string. M04 survived. It is a regression guard (`53f668a7`): rewrite it, don't delete it. |
| `…/editor-inline/cm/state.test.ts:56` | The test dispatches the change itself, then asserts the doc contains it. |
| `…/editor/status/LogView.test.tsx:148` | Two fixtures compared with each other. |
| `…/editor/refactors/refactors.test.ts:336` | Asserts the `hostKey` the constructor set; it would pass if `applyAction` were a no-op. |
| `…/terminal/model/model.test.ts:91` | The expectation copies the format string. |
| `…/needs-you/model/constellation.test.ts:20` | `PRIORITY` equals a literal copy of itself. |
| `…/session/model/intent.test.ts:171` | `archiveCommand` and `forkCommand` are one-line passthroughs. |
| `…/constellation/model/model.test.ts:587-588` | Asserts fixture sizes (134). |
| `…/review/data/load.test.ts:69` | Asserts the harness's own initial value. |
| `packages/protocol/src/languages/trees.test.ts:144` | `make(x)` compared with `make(x)`. |
| `packages/ui/src/components/polaris/dither/frames.test.ts:47-49` | `ditherStillMask(x)` is `ditherStillMask(x)`. |
| `packages/ui/src/components/polaris/state-icon.test.tsx:109` | Selected by `data-slot=state-icon`, then asserts it isn't `severity-badge`. |
| `packages/client/src/prediction/machine.graph.test.ts:41` | Replays the transitions xstate already used to compute `path.state`. |
| `packages/client/src/install/plan.test.ts:233` | The expectation is computed with `deliveryFor`, the implementation. |
| `apps/site/app/api/email/_lib/validator.test.ts:105-111,148` | The table re-derives the policy instead of spelling out the outcomes. |

### B. Incidental pins

Deliberate copy stays. Product copy, glossary terms, platform conventions and DESIGN.md mappings are requirements: clientCopy, shell/copy, offline, ShortcutHelp, menuTemplate, notification titles, machines cards, `state-icon.test.tsx:15` (DESIGN.md glyphs) and `float.test.tsx` scrim.

Incidental pins:
- `packages/protocol/src/constellation/contract.test.ts:73`: `ConstellationRpcs.requests.size === 18`, which breaks on every new RPC.
- `packages/protocol/src/languages/contracts.test.ts:113,115`: catalog counts of 16 and 22. Use invariants instead, as `:122` already does.
- `apps/desktop/src/main/ipc/ipc.test.ts:289`: compares feed keys with a hand-copied list and opens nothing.
- `apps/desktop/src/renderer/shell/windowsChrome.test.tsx:15-16`: "138px" and the `env(...)` CSS string.
- `apps/desktop/src/shared/keymap.test.ts:106-107` and `keymapPlatforms.test.ts:158`: object identity.
- `…/settings/model/constellationDefaults.test.ts:9-14`: pins the shipped default model ids.
- `…/editor/navigation/navigation.test.tsx:225`, `…/lsp/completionDocs.test.tsx:214-215` and `…/status/LanguageStatus.test.tsx:119`: Tailwind and config literals.
- `packages/ui/src/styles/tokens.test.ts:69-110,148-153`: duration and selector regexes. The DESIGN.md↔tokens parity checks at `:41-67` are the valuable part.
- `apps/daemon/src/engine/Engine.followups.test.ts:402`: the checkpoint ref string. `service/templates.test.ts:16-27`: exact plist whitespace.
- `apps/site/app/api/email/_lib/validator.test.ts:249`: a 5000 ms constant. `components/email-download.test.ts:69`: also covered by `platform.test.ts:64`.

### C. Type-level facts restated at runtime

**`packages/protocol` round-trips** encode a value built with `.make`, decode it and compare. For a plain Struct or TaggedUnion this tests Effect, not Polaris. M05 removed the `thoughtMs ≥ 0` wire check, and the protocol suite still passed. The affected tests are:
- `contract.test.ts:76, 85, 111, 192, 238, 387, 398, 467`
- `review.test.ts:186, 240, 277, 328, 337-339, 423-425`
- `accept.test.ts` (the whole file)
- `commitMessage.test.ts:13`
- `resources.test.ts:24, 62`
- `constellation/contract.test.ts:115, 123, 166, 214, 228` (round-trip halves)
- `constellation/liveness.test.ts:100-102`
- `files.test.ts:7` (round-trip parts)
- `worktreeSetup.test.ts:73, 91` (round-trip parts)
- `languages/trees.test.ts:349-354, 364`
- `prediction.test.ts:8-9`

The legacy-JSON decode tests in the same files are the real compatibility evidence and must stay: `contract.test.ts:40, 55, 96, 162, 179, 202, 304, 359, 372, 428, 444`.

Other type-level checks:
- `apps/desktop/src/main/ipc/ipc.test.ts:157` "every method has a handler". The mapped `Handlers` type already forces the exact key set.
- `apps/desktop/src/shared/languages.test.ts:28, 52, 91, 124, 140`: positive `decode(make(x))` halves. Keep the bounds and rejection halves.
- `packages/protocol/src/contract.test.ts:144`: `TerminalLaunch` asserts only `toBeInstanceOf`.
- `apps/daemon/src/mcp/tools/catalog.test.ts:163`: `fields.claim` `toBeDefined`.
- `packages/ui/src/components/polaris/state-icon.test.tsx:12`: should be a `satisfies Record<SessionState, …>`.
- `…/harness/model/options.test.ts:100`.

### D. Duplicates

| Behaviour | Locations | Keep |
|---|---|---|
| Unknown capabilities are dropped (M06: one bug fails 6 tests) | `packages/protocol/src/capabilities.test.ts:5`, `contract.test.ts:231`, `review.test.ts:444`, `languages/contracts.test.ts:144`, `constellation/contract.test.ts:181`, `files.test.ts:27-29` | `capabilities.test.ts` |
| Keymap conflicts and format (M15: one bug fails both files) | `apps/desktop/src/shared/keymap.test.ts:20, 35, 41, 55, 83` vs `keymapPlatforms.test.ts:48, 206, 224` and `renderer/shell/menu/ellipsis.test.ts:35` | keymapPlatforms, ellipsis |
| `LANGUAGES.*.documentLanguageId` | `apps/desktop/src/renderer/features/editor/model/language.test.ts:84-86` and `packages/protocol/src/languages/contracts.test.ts:131-135`. The protocol test also imports `apps/desktop/...`, a layering inversion. | desktop |
| A rejected command's receipt replays | `apps/daemon/src/store/EventStore.test.ts:321` vs `:191-266` (and `Engine.test.ts:100-119`) | `:191-266` |
| `languageFor` by extension and shebang | `…/editor/model/model.test.ts:208` vs `model/language.test.ts:72, 96` | language.test |
| Vim key → command | `…/editor/navigation/navigation.test.tsx:203` vs `editor/cm/vim.test.ts:30` | vim.test |
| Save-reason loop | `…/editor/formatting/coordinator.test.ts:99-119, 265-303`: 24 cases over 6 reasons, but only `autosave` branches | parametrize over 2 reasons |
| Settings copy | `…/settings/model/usage.test.ts:146` (= `:130`), `planLimits.test.ts:44` (= `:91`), `github.test.ts:123` (= `:84`), `updates/model.test.ts:19` (= `:33`) | the later one |
| Status pill and popover | `…/editor/status/LanguageStatus.test.tsx:70-111` vs `status/model.test.ts:18, 46, 128`; `settings/editor/EditorSettings.test.tsx:221` vs `settings/editor/model.test.ts:33` | the model tests, plus one render |
| Failed poll | `…/pulls/model/list.test.ts:394` vs `pulls/model/notices.test.ts:21-32` | notices |
| `isDimmed` (the production code itself is duplicated) | `risk/model/summary.ts:31` and `review/model/findings.ts:27`, each with its own test | merge the code |
| MCP tool-name lists | `apps/daemon/src/mcp/tools/catalog.test.ts:27` = `mcp/transports.test.ts:49`; `mcp/tools/transports.test.ts:78` = `mcp/tools/bootstrap.test.ts:57` | one canonical list per role |
| Claude Constellation options | `mcp/transports.test.ts:131-136` vs `harness/claude/ClaudeDriver.test.ts:740-755` | ClaudeDriver |
| Engine-level guard tests | `Engine.test.ts:124, 549` vs `session.test.ts:154-213` (exact reasons) | session.test, plus one e2e |
| `terminalCommand` argv | `Engine.test.ts:577-605` vs `Engine.followups.test.ts:318-346` | followups |
| Recorded Turn tags | `harness/codex/CodexDriver.test.ts:42-49`: a tag list immediately followed by a full `toEqual` | drop the tag list |
| `classifySshFailure` | `packages/client/src/install/remote.test.ts:544` vs `windowsSsh.test.ts:6` | windowsSsh |
| WSL argv | `apps/desktop/src/main/machines/wsl.test.ts:43` vs `wslService.test.ts:187` | wslService |
| Copy-pasted `fixture()` | `apps/desktop/scripts/packaging/archives.test.ts:36` and `manifest.test.ts:18` | extract to a `.testing.ts` |
| Small cases | `packages/ui/src/lib/hue.test.ts:31` (special case of the `:21` loop); `state-icon.test.tsx:113` (= `:61`) | the loop / `:61` |

### E. No meaningful assertion

- **`apps/desktop/src/renderer/features/needs-you/model/dismissed.test.ts:41`** makes 0 assertions at runtime. `if (also === undefined) return;` and the fixture has no Also items. M02 survived the whole Desktop App suite.
- **`dismissed.test.ts:11`** asserts the fixture, not the code.
- **`apps/daemon/src/store/EventStore.bounded.test.ts:244`** and **`reviewer/session.test.ts:82`** call `toBeDefined` on values that can't be absent.
- **`apps/daemon/src/verification/findings.test.ts:269-277`** has a dead `if (late.pending.size > 0)` branch.
- **`apps/daemon/src/languages/runtime/events.test.ts:41`** creates 16 watchers and asserts nothing about the cap.
- **`apps/desktop/src/renderer/shell/menu/reveal.test.ts:16-23`** only checks `not.toBeNull` on the entry.
- **The static scan's other 44 "no expect" Daemon hits are fine.** They assert through local helpers (`rejected`, `until`, `waitFor`), `node:assert` or a thrown `Error`.

### G. Weak tests

**Un-awaited `expect(p).rejects`.** About 30 sites, at:
- `apps/daemon/src/git/constellationBundles.test.ts:33-41, 62-66`
- `apps/daemon/src/files/write.test.ts:94, 104, 108, 111, 157, 160`
- `apps/daemon/src/prediction/assemble.test.ts:100`
- `apps/daemon/src/resources/resources.test.ts:230-233`
- `apps/daemon/src/git/diffIndex.test.ts:121`
- `apps/daemon/src/files/edits/edits.test.ts:39, 59`
- `apps/daemon/src/harness/codex/CodexDriver.test.ts:790` and `harness/claude/ClaudeDriver.test.ts:790`
- `apps/daemon/src/languages/{python/detection.test.ts:121, runtime/format.test.ts:87,89, runtime/logs.test.ts:94, composition/configuredLaunch.test.ts:68-89, sql/dialect.test.ts:105}`
- `apps/desktop/src/renderer/features/editor/lsp/sessions.test.ts:75, 135, 446-452`

M07 shows that Bun still fails the test when an un-awaited `rejects` never rejects, so these are not vacuous. Two things are still wrong:
- The assertions after them run before the promise settles.
- `write.test.ts:157` races a following `deletePath`, which is a flake risk.

Fix: add `await` everywhere and enable a lint rule (oxlint's `jest/valid-expect` with `alwaysAwait`, or a small custom rule in `packages/lint-config`).

**Spec replay negatives.** `packages/spec/scripts/constellation-replay/replay.test.ts:163` `check()` returns `exitCode === 0` and discards stderr. Its 16 `toBe(false)` assertions therefore can't tell "the reference model rejected the trace" from "the generated Quint failed to parse or typecheck". Return `{exitCode, stderr}`, and assert that the failure is the named test's.

Behaviours whose mutation survived (§4): M01, M03, M08, M09, M10, M17. Others:
- `apps/desktop/src/renderer/features/machines/model.test.ts:73` only asserts a non-empty title per reason.
- `…/needs-you/model/summary.test.ts:15` and `sessions/model/peek.test.ts:10,20` assert `length > 0`.
- `…/editor/lsp/adapters.test.ts:303, 535, 734, 757` check lengths only, or that the fake resolves X and X comes back.
- `apps/daemon/src/reviewer/output.test.ts:86, 92` assert `isSuccess` or `isFailure` only.
- `apps/daemon/src/engine/Engine.test.ts:278-294` does a negative check after a fixed sleep. So do `:292, 460, 599` and `Engine.subagents.test.ts:288, 322`.
- `apps/daemon/src/constellation/working.test.ts:297` waits for `resumed === 1` and stops, so a second resume goes unseen.
- `packages/predict/src/predictor.test.ts:17, 48`: `p50 ≥ 0`; the assertions sit inside a fetcher that may never be called.

## 4. Mutation spot checks

There were 20 mutants, run in a pinned copy of `7b7e0fe6`; the checkout was never touched. Each mutant was run against the owning test file or folder, and against the whole package where the narrow run survived.

**Limitation.** In the copy, `@polaris/*` imports resolve to the live checkout, so mutants in `packages/client` and `packages/protocol` were only checked against their own package's suite.

**This was a targeted sample.** 15 of the 20 aimed at tests already suspected of being weak, and 5 were controls on core logic.

| # | Mutation | Tests run | Result |
|---|---|---|---|
| M01 | `engine/streams.ts`: remove the `MAX_TURN_PAGE` cap | `turnPage.test.ts`, then all of `src/engine` (198) | **survived** |
| M02 | `needs-you/model/dismissed.ts`: the Also stamp becomes a constant | needs-you folder, then all of desktop (2,141) | **survived** |
| M03 | `store/hostModel.ts`: removing a Workspace keeps its Worktrees | store folder, then all of desktop | **survived** |
| M04 | `editor/lsp/groups.ts`: `contextIdOf` salted per page load (exactly bug `53f668a7`) | all of desktop | **survived** |
| M05 | `protocol/commitMessage.ts`: `thoughtMs` loses its `≥ 0` integer check | all of protocol | **survived** |
| M06 | `protocol/capabilities.ts`: keep unknown capability names | all of protocol | killed (6 tests fail: duplication) |
| M07 | `daemon/files/write.ts`: drop the `W_OK` check before replacing | `write.test.ts`, ×3 | killed, despite the missing `await` |
| M08 | `editor/prediction/index.ts`: refresh no longer aborts the pending request | prediction folder | **survived** |
| M09 | `settings/model/github.ts`: a blocked owner loses its approval and SSO links | all of desktop | **survived** |
| M10 | `terminal/Terminals.ts`: `loginShell()` hard-coded to `/bin/sh` | `src/terminal` | **survived** |
| M11 | `client/install/download.ts`: no download size limit | all of client | **survived** |
| M12 | `client/install/download.ts`: skip the per-file manifest SHA check | all of client | **survived**; only the whole-archive SHA is tested |
| M13 | `client/install/Ssh.ts`: drop the `alias.startsWith("-")` option-injection guard | all of client | **survived** |
| M14 | `client/install/archive.ts`: skip the tar header checksum | all of client | **survived** |
| M15 | `shared/keymap.ts`: two commands share ⌘⇧P | all of desktop | killed (6 tests: keymap and keymapPlatforms both fail) |
| M16 | `machines/model.ts`: the host-key-changed card loses its warning and `ssh-keygen -R` | all of desktop | killed (by `:…"a changed host key never gets a one-click fix"`, not by the `:73` loop) |
| M17 | `sessions/model/leadGroups.ts`: a blocked worker never reads needs-you | all of desktop | **survived** |
| M18 | `store/EventStore.ts`: ignore receipts written earlier in the batch | `src/store` and `src/verification` | killed |
| M19 | `engine/session.ts`: answering an already-resolved approval is not rejected | `src/engine` and `src/verification` | killed |
| M20 | `engine/session.ts`: steering with no Turn in flight is not rejected | `src/engine` and `src/verification`, then all of daemon | survived engine and verification; killed only by the whole Daemon suite (via `resources/userAdmission.test.ts`, whose assertion is `toBeInstanceOf(CommandRejected)`) |

13 of the 20 survived their package. The controls on the core (M18, M19) and the security copy (M16) were killed. The survivors cluster in small model functions and install safety branches that have no negative test.

## 5. Recommendations

### Delete

Confidence is high for each item, and none came from a fix commit; each was checked with `git log -S`.

1. **`packages/protocol/src/accept.test.ts`** (whole file, 2 tests): round-trips plus `requests.has`. Replace it with one legacy-payload decode only if accept has wire history.
2. **Capability-dropping duplicates** ×5: `contract.test.ts:231`, `review.test.ts:444`, `languages/contracts.test.ts:144`, `constellation/contract.test.ts:181`, `files.test.ts:27-29`.
3. **`apps/desktop/src/shared/keymap.test.ts:20, 35, 41, 55, 83`**: covered by `keymapPlatforms.test.ts` and `menu/ellipsis.test.ts` (M15).
4. **`apps/desktop/src/main/ipc/ipc.test.ts:157` and `:289`**: type-guaranteed or hand-copied key lists.
5. **`apps/daemon/src/store/EventStore.test.ts:321`**: duplicate of `:191-266`.
6. **`apps/desktop/src/renderer/features/needs-you/model/dismissed.test.ts:11` and `:41`**: rewrite `:41` with a fixture that has an Also item; it currently runs zero assertions.
7. **`packages/protocol/src/contract.test.ts:144`** (TerminalLaunch) and **`commitMessage.test.ts:13`**.
8. **Weaker duplicates:**
   - `apps/desktop/src/renderer/features/pulls/model/list.test.ts:394`
   - `…/editor/model/model.test.ts:208`
   - `…/editor/navigation/navigation.test.tsx:203`
   - `…/settings/model/usage.test.ts:146` (guard `c46e74e1` stays covered by `:130`)
   - `planLimits.test.ts:44`
   - `github.test.ts:123`
9. **`packages/protocol/src/languages/contracts.test.ts:131-135`**: a duplicate pin, and it imports `apps/desktop`.
10. **Single tautological lines:**
    - `ui/dither/frames.test.ts:47-49`
    - `ui/state-icon.test.tsx:109, 113`
    - `ui/lib/hue.test.ts:31`
    - `engine/turnPage.test.ts:103`
    - `engine/Engine.limited.test.ts:143`
    - `needs-you/model/constellation.test.ts:20`
    - `constellation/model/model.test.ts:587-588`
    - `session/model/intent.test.ts:171`
    - `scripts/packaging/manifest.test.ts:139`
    - `mcp/tools/catalog.test.ts:163`
    - `protocol/constellation/contract.test.ts:73`
    - `service/templates.test.ts:41`

**Estimated saving:** about 25 whole tests and about 35 assertion lines from these items, and roughly 50–60 tests including the merges below. All are millisecond tests, so the runtime saving is under 1 s. The gain is signal and maintenance, not speed.

### Merge or parametrize

- Protocol round-trips (about 30 tests) become **one table-driven "every DomainEvent / Command / RPC payload survives JSON" test**. Keep every legacy-JSON decode test.
- `editor/formatting/coordinator.test.ts:99-119, 265-303`: 24 cases become a loop over `[manual, autosave]`. Keep its intent, which guards `b3bac31e`.
- MCP tool-name lists: one canonical list per role, which the transport tests compare `listTools` against.
- Merge the two `isDimmed` implementations (`risk/model/summary.ts:31`, `review/model/findings.ts:27`) and keep one test.
- Trim the Engine-level guard tests to one end-to-end rejection; `session.test.ts` already has the exact reasons.
- `LanguageStatus.test.tsx` and `EditorSettings.test.tsx:221`: one render per component; the copy matrix stays in the model tests.
- Extract the packaging `fixture()` into a `.testing.ts`.

### Strengthen

Each item names what to assert instead.

1. **Add `await`** to every `expect(...).rejects/resolves` (the about 30 sites above), and add the lint rule.
2. **Spec replay `check()`:** return `{exitCode, stderr}`. For the 16 rejection cases, assert that the failing Quint test is the expected one, and print stderr on failure.
3. **Mutation survivors**, one test each:

   | Mutant | What to test |
   |---|---|
   | M01 | MAX + 1 Turns, so the page holds 50 |
   | M03 | Seed a Worktree, remove the Workspace, and assert the Worktree is gone |
   | M17 | A blocked worker with a pending approval reads needs-you |
   | M09 | The blocked owner's `approvalUrl` and `ssoUrl` |
   | M08 | Hold the request open, refresh, and assert `signal.aborted` |
   | M10 | Set `SHELL`, assert it is returned, and test the fallback |
   | M04 | Pin a literal expected id, or compute it in a fresh module |
   | M11–M14 | An oversize body, a per-file hash mismatch, a `-oProxyCommand` alias, a corrupt or truncated tar header |
   | M05 | A negative `thoughtMs` is rejected on decode |

4. **Error class becomes error reason:**
   - `languages/composition/core.test.ts:136-172, 358-389, 391`
   - `apps/desktop/src/main/languages/identity.test.ts:73-118` and `bridge.test.ts:138-172`
   - The Claude and Codex driver failure tests
   - `resources/userAdmission.test.ts:137, 277`, which is the only test that catches M20; also add a `session.test.ts` case for steering with no Turn.
5. **Weak checks to replace:**
   - `machines/model.test.ts:73`: a table of reason → expected `fix.action`.
   - `needs-you/summary.test.ts:15` and `sessions/peek.test.ts`: exact ids and counts.
   - `codex/planLimits.test.ts:94, 147`: assert the merged values, and that the failed read happened and the session still runs a Turn.
   - `store/store.test.ts:31, 68`: assert `initialState.hostModels` after the reduce.
6. **Fixed-sleep negative checks:** wait for a processed-sequence marker instead of `sleep(20–100ms)`. Sites: `Engine.test.ts:292, 460, 599`, `Engine.subagents.test.ts:288, 322`, `lifecycleDemand.test.ts:85, 122, 204`. This is both faster and stronger.

### Gaps worth new tests

1. **Client install safety branches** (M11–M14): size limit, per-file hash, alias guard, tar checksum and truncation, the non-2xx fetch path, and refetching a corrupted cache.
2. **Desktop renderer mutation paths** with 0% coverage: `review/ui/useReviewModel.ts`, `accept/ui/useAcceptPanel.ts`, `review/checkout/useCheckout.ts`, `comments/data/actions.ts`, `review/constellation/actions.ts` and `terminal/runtime.ts`. Test them with a fake bridge. Also the low-coverage editor runtime: `editor/runtime/buffers.ts` at 14% and `editor/lsp/queries.ts` at 22%.
3. **Desktop main glue:** `main/notifications/index.ts`, the Needs You centre (0%), `main/ipc/requests.ts` (45%), `ipc/feeds.ts` (only 3 feed kinds opened) and `snapshotCache.ts`.
4. **Daemon transport and RPC edges:** `transport/handlers.ts` (46%), `engine/rpc.ts` (42%), `transport/lazy.ts` (48%), `terminal/Terminals.ts` (65%), and the session guard for steering with no Turn (M20).
5. **Model-level behaviours that mutation showed unguarded:** Workspace removal drops its Worktrees (M03), blocked worker → needs-you (M17), Needs You Also-item dismissal (M02) and the Turn page cap (M01).

### Speed

Roughly 397 s serial; Turborepo runs packages in parallel, so the wall-clock time is bounded by the Daemon (243 s) and spec (107 s).

| Change | Saving |
|---|---:|
| `packages/spec` constellation replay: run its about 35 `quint test` spawns concurrently (`Bun.spawn` plus `Promise.all`) or batch the modules into one invocation | ~60–80 s |
| `apps/site/.../validator.test.ts:236`: pass `deadlineMs: 50` instead of waiting the real 5 s | 5 s |
| `…/editor/lsp/completionResolve.test.ts:112`: inject `SETTLE_MS` | 2 s |
| `docs.test.tsx` and `completionDocs.test.tsx`: the 150 ms `afterEach` sleeps, over about 26 tests | 4 s |
| `Engine.limited.test.ts`: TestClock instead of real sleeps | ~2.5 s |
| `service/supervisor.test.ts`, `memory/release.test.ts`, `files/FileSearch.test.ts` sleeps | ~3 s |
| `processAdmission.test.ts:158` and `cleanup.test.ts:62`: inject shorter retirement and close deadlines | ~10 s |
| `git/snapshot.test.ts` racy-git cases: `utimes` instead of waiting for the second boundary. Keep the tests (`53e60293`, `3b6e18bd`). | ~3 s |

## 6. Looks tautological, but guards a regression: keep

Rewrite where noted, but don't delete.

| Test | Guards |
|---|---|
| `apps/desktop/src/renderer/features/editor/lsp/groups.test.ts:10` | `53f668a7` "language tools come back after the renderer reloads". Can't fail as written (M04): **rewrite**. |
| `apps/desktop/src/main/chrome.test.ts:103-110` (`WM_ENTERMENULOOP`) | `6b27af83`. The constant line itself can go. |
| `apps/daemon/src/languages/runtime/process-capacity.test.ts:11` | `376c1d1f` |
| `apps/daemon/src/languages/runtime/wire.test.ts` constant pins | `66925861` |
| `apps/daemon/src/harness/claude/sandbox.test.ts:37-62` (read-only option constants; security policy) | `4d2eaefa` |
| `apps/desktop/src/renderer/features/editor/ui/paneLayout.test.ts:5` (class pin `flex-1 min-h-0`) | `ae7af987` |
| `editor/formatting/coordinator.test.ts:265-303` | `b3bac31e`. Parametrize, don't drop. |
| `settings/model/usage.test.ts:146` | `c46e74e1`. Safe to merge into `:130`. |
| `apps/desktop/src/main/ipc/ipc.test.ts:161` "installs go only through machines" | `b4be29d3` |
| `apps/desktop/src/shared/needsYouContract.test.ts:6` | `964a35d9` |
| `apps/desktop/src/main/ipc/constellation.test.ts:37` | `edaccdba` |
| `apps/desktop/scripts/lib/daemon.test.ts:19` | `f887e031` |
| `apps/daemon/src/constellation/working.test.ts:92` | `86ddbb63` |
| `apps/daemon/src/harness/registry.test.ts:46` | `1dbd116c` |
| `apps/daemon/src/reviewer/harnessPath.test.ts` | `b8eecb7` |
| `packages/protocol/src/languages/external-records.test.ts:79` | `7c5643ed` |
| `packages/client/src/rpc.test.ts:119` | `b56d998a` |
| `packages/client/src/windowsSsh.test.ts:28` | `cd61c9d9` |
| `packages/client/src/client.test.ts:242` | `52b6d189` |
| `packages/ui/src/components/polaris/state-icon.test.tsx:135` | `5cc3ed07` |
| `needs-you/model/summary.test.ts:29` | `fd518eec` |
| `pulls/model/notices.test.ts:21-32` | `3bde6440` |
| `sessions/model/workerCopy.test.ts` | `cb54b0d0` |
| `machines/model.test.ts:123, 142` | `c16bbc76`, `5d77b164` |
| `session/model/search.test.ts:51` | `a6796345` |
| `open-folder/rows.test.ts:73` | `f4bd32df` |
| `constellation/model/{lane, digest:9, reclaim}` | `43f3119e`, `099d7faf`, `bff20be3` |
| `constellation/model/model.test.ts:340, 701` | `0c048b0c` |
| `needs-you/model/dismissed.test.ts:21` | `93250b80` |
| `apps/daemon/src/verification/findings.test.ts` | ENG-209 Findings 1–4 (see the spec README) |
| `engine/session.test.ts:233, 277` | ENG-209 Findings 2 and 3 |
| `verification/engine.reference.test.ts` | B1 |
| `git/snapshot.test.ts:21, 83` (racy git) | `53e60293`, `3b6e18bd` |
| `editor/model/model.test.ts:174, 327` | labelled QCHECK / QDESIGN bug guards |
| Graph path-count pins `engine/session.test.ts:136` and `packages/client/src/connection.test.ts:202` | Tied to the README diagrams on purpose. Keep them while the README states the counts. |
| `packages/client/src/connection.test.ts:133` (oracle re-implementing the pre-machine reconnect decisions) | A refactor-equivalence guard. Retire it once the explicit scenario tests at `:151-200` are trusted. |
| Order-only tests where the order is the property: `apps/site/.../gates.test.ts:135-182` (validator before SES, fail closed), `apps/desktop/scripts/packaging/dmg.test.ts:61` and `release.test.ts:104` (notarisation), `accept/model/model.test.ts:118` | keep |
