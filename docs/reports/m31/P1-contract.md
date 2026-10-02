# P1 language, Settings, edit and save contracts

Protocol commit: `5901287d5a517d95e23187e9b3cb36942a6e8c16` on
`m31/c6ab7f20-9c5e-4b41-b53a-ed418d5f78d4/P1-publish-language-settings-edit-and-save-`.
Base: `48a79df06cf8a912db2bc3e7ed1c66775ebe49db`.

This publishes opt-in contracts before implementation consumers. It does not
register handlers, advertise runtime capabilities or grant artifact activation.
The current Daemon RPC group, protocol version and Agent Session streams remain
compatible. All changed paths are within the assigned P1 Area.

## Consumer paths

| Path | Contract |
| --- | --- |
| `packages/protocol/src/languages/base.ts` | Authenticated identity, checkout kinds, generations, positions, fences, bounded JSON and typed failures |
| `packages/protocol/src/languages/catalog.ts` | K1 descriptor projection, offered eligibility, separate installation/prerequisite/preflight/update facts, progress and effective launch facts |
| `packages/protocol/src/languages/settings.ts` | Scoped Client preferences, S1 syntax IDs, custom servers, provider/formatter selection, trust and preview policy |
| `packages/protocol/src/languages/documents.ts` | Ordered document sync, acknowledgments, actual capabilities, runtime facts and provider-owned diagnostics |
| `packages/protocol/src/languages/broker.ts` | Validated bidirectional JSON-RPC, feature requests, server requests, registration/configuration/progress and context events |
| `packages/protocol/src/languages/edits.ts` | Workspace edits, disk/buffer/draft snapshots, proposals, durable operation receipts, guarded recovery and formatter/save outcomes |
| `packages/protocol/src/languages/rpc.ts` | Separate 24-method `LanguageRpcs` group and local Settings/preview schemas |
| `packages/protocol/src/languages/capabilities.ts` | Complete method gating table and `languageRpcAllowed` |
| `packages/protocol/src/languages/README.md` | Required validation, ownership, ordering, recovery and preview consumer rules |
| `packages/protocol/src/capabilities.ts`, `index.ts` | Seven optional capabilities and public exports |
| `apps/desktop/src/shared/languages.ts` | Optional IPC input/output/subscription schema tables; main-only external media and bounded raster result |
| `apps/desktop/src/shared/api.ts`, `contract.ts` | Optional `PolarisApi.languages` and detached table exports; existing handlers still compile |
| `packages/spec/languages.qnt` | Contract model for generation/version/sequence fences and durable operation acknowledgment/recovery |
| `packages/spec/scripts/language-replay/`, `replay-language.ts` | Independent version-1 trace decoder, observed-state checks and synthetic fixture |
| `packages/spec/README.md`, `scripts/check.ts`, `package.json` | Model/implementation mappings and required checks |

Register `LanguageRpcs` only after its gated handler set is implemented. C1 must
decode both IPC input and output tables explicitly; exporting schemas does not
activate IPC routes. Unknown capability names retain the existing old-peer
behavior. Resource-bearing edits additionally require `languages.resources`.

## Accepted dependency reconciliation

F1's ten requirements map to the following published interfaces:

1. Optional capabilities and authenticated Client/Host/checkout/project/provider/
   configuration/generation identity: `base.ts`, `capabilities.ts`, context RPCs.
   Discovery exposes trust, prerequisites and effective launch paths separately.
2. Integer/string JSON-RPC IDs and bidirectional envelopes: `broker.ts`, server
   response/cancel RPCs. Late responses require the originating generation;
   unsupported requests receive MethodNotFound rather than hanging.
3. Initialization/settings, ordered scoped configuration results, registrations,
   progress, messages and workspace folders: `settings.ts` and `broker.ts`.
4. Ordered open/change/close/save, version fences and distinct queue acknowledgment:
   `documents.ts`. New generations receive fresh snapshots; stale results fail.
5. Negotiated UTF-8/16/32 positions, provider-owned push/pull diagnostics and
   conservative unversioned/last-known data: `base.ts`, `documents.ts`.
6. Cancellable completion/hover/signature/navigation/symbol/action requests and
   actual resolve/execute support: `broker.ts` and provider capabilities.
7. Both edit forms, nullable versions, annotations, resource options and closed/
   dirty-file snapshots: `edits.ts`; server applyEdit uses the same proposal.
8. Exact formatter snapshot/options/deadline and separate formatting/save failures:
   `LanguageFormatPreflight`, format/save outcomes. All six save reasons are typed.
9. Stable operation IDs, prepared/partial outcomes, durable drafts/receipts and
   guarded undo/status/recovery: `edits.ts`, operation RPCs and `languages.qnt`.
10. Custom executable/argv/environment, roots/patterns/document IDs, initialization,
    server settings, provider order and one selected formatter: `settings.ts`.

K1's 14 integrations and 19 tool descriptors decode without changing IDs or
fields; tests preserve the catalog structurally. Eighteen roots are offered.
The evaluation SQL server remains excluded by `languageToolOffered`, including
indirect provider/formatter/companion references. Pending artifact audit is
`audit-required`, distinct from installation and runtime readiness. Install and
feature preflight are distinct; developer runtimes/toolchains are never installed.
K2/G1 retain legal/source closure and activation authority. K2's native linkage
records require I1/D1 actual Host loader checks, including musl/libgcc requirements;
an executable file or installed artifact alone cannot establish readiness.

S1's 31 syntax IDs are checked against its shared metadata. Syntax IDs remain
distinct from LSP IDs (tsx/typescriptreact, jsx/javascriptreact, shell/shellscript).
Custom document-language IDs remain arbitrary. SQL configuration is offline,
without account/database execution; Actions must not acquire account tokens.

Preferences persist in Client main with App → Language → Host → Workspace
precedence and effective origins. Worktrees inherit Workspace execution trust;
Review Checkouts require their own grant. Launch facts reveal effective paths
and environment key names, never environment values. Format-on-save defaults true.

Preview policy defaults to external-image consent, sanitized HTML, scripts
disabled, strict Mermaid and a 10 MiB media limit. Consent is Host/Workspace
scoped and separate from execution trust. Host media returns BlobId on the wire;
main resolves bounded raster bytes for the renderer. External media is main-only
and requires consent, redirect/destination limits and omission of credentials/
cookies. M1/C1 must implement those controls and object-URL cleanup. Source and
locked preview views share a Host/path buffer without conflating tab locks.

## Validation and model limits

P1 schema tests cover catalog/S1 reconciliation, old-peer capability behavior,
all RPC gates, malformed JSON-RPC, identity/version fences, ordered changes,
diagnostic ownership, availability distinctions, edit preservation, durable
acknowledgment, exact formatting fences, settings/media policy and IPC routing.
Bound decoded values at schemas; runtime consumers must additionally bound raw
transport bytes, parsing depth, queues and lifetimes before decoding.

The language model is a finite contract model, not production runtime proof.
Four scenarios and 3,000 simulations of 60 steps exercise fencing, cancellation,
durable draft/receipt acknowledgment and operation-owned recovery. Its trace
format requires observed state after every event, and a mutant stale-result
observation fails replay. The committed fixture is explicitly synthetic. Existing
Engine/Constellation trace formats and stream semantics are unchanged. T1/X1
must extend real runtime/model traces when implementing these contracts.

## Check receipts

- `bun run typecheck`: 9/9 successful; original final-source run had 2 cache
  hits, final repeat 9 cached. Logs `/tmp/p1-typecheck.log` and
  `/tmp/p1-typecheck-final.log`.
- `bun run test` with temporary `POLARIS_HOME`, no inherited coordination/handoff
  variables and global Git disabled: recovered 9/9 successful, 6 cached;
  Desktop 978 pass/0 fail; Daemon 973 pass/11 existing opt-in skips/0 fail.
  Log `/tmp/p1-test-recovered.log`. Live Harness/launchd behavior remains opt-in.
- Focused schema/trace tests: 18 pass, 0 fail, 105 assertions across two files;
  `/tmp/p1-target-final.log`.
- `bun run lint` and scoped quality: format/ratchet pass; no baseline raised.
  Logs `/tmp/p1-lint-final.log`, `/tmp/p1-quality-final.log`.
- `bun run licenses:check`: 529 production dependencies plus four installed
  platform builds; 527 allowed, two existing exceptions, zero violations.
  Log `/tmp/p1-licenses-final.log`.
- `bun run spec`: existing models/scenarios/simulations and language four
  scenarios/3,000 simulations pass; `/tmp/p1-spec.log`. Finite simulation is
  not an Apalache proof; `--verify` was not run.
- `bun test apps/daemon/src/verification`: 10 pass, 0 fail, 18,485 assertions;
  `/tmp/p1-verification.log`. Engine trace replay: 12/12 conform, 85 decisions,
  125 spec events; `/tmp/p1-engine-replay.log`.
- Recovered Constellation trace replay: 101/101 conform, 980 batches, 1,339 spec
  events; `/tmp/p1-constellation-replay-recovered.log`.
- K1 consistency check passes with 14 integrations/19 tools/18 offered.
  Strict release and selected-artifact audit each intentionally exit 1:
  13 offered audit blocks and eight unresolved npm findings respectively.
  Logs `/tmp/p1-catalog.log`, `/tmp/p1-catalog-release.log`,
  `/tmp/p1-catalog-audit.log`; K2/G1 own closure. Workspace licenses passing
  does not certify the disposable artifact graphs.

The initial full suite failed Desktop ad-hoc signing. The Lead reproduced the
same failure on unchanged main and confirmed Host ENOSPC, including failure to
create a temporary file. A read-only stock Electron signature check also failed;
that was not evidence of a P1 schema regression. Later standalone Daemon tests
and Constellation replay encountered ENOSPC. Original logs were retained at
`/tmp/p1-test.log`, `/tmp/p1-codesign-retry.log`, `/tmp/p1-daemon-test.log` and
`/tmp/p1-constellation-replay.log`. The Lead removed only completed Lead fixture
dependency caches and released space. P1 did not remove peer/user/global roots,
modify dependencies, re-sign stock Electron, skip tests or bypass hooks.

Recovery standalone Desktop signing passed 1 test/11 assertions in
`/tmp/p1-codesign-after-cleanup.log`. A first retry used the wrong test path and
matched no tests; the corrected exact path produced this passing receipt.
Initial trace replay also mixed Engine and Constellation formats; corrected
replay uses separate directories while preserving original traces. Schema/model
development failures were corrected without raising lint baselines.

## Performance evidence

Before/after cold-start and idle used the injected Host `m31-bench` lease through
`bun apps/daemon/src/main.ts lease m31-bench -- ...`, with a task-specific wrapper
`POLARIS_HOME`. No real-root endpoint fallback or HOME reassignment occurred.
Benchmark children excluded inherited coordination/handoff variables; the bench
runner created its own disposable Daemons. Control restored only protocol root
exports/capabilities to the assigned base, with restoration in `finally`.

Both valid runs used `--quick --runs 3` and the matching committed
`packages/bench/baselines/mac14-13-apple-m2-max-12c-quick.json`. Both exited 1
against that older baseline. The paired before/after comparator reported zero
regressions; the machine was busy (3 occupied cores), so this is load-qualified
evidence, not certification. Baselines were not rewritten. Raw results are
`/tmp/p1-bench-before-clean.json`, `/tmp/p1-bench-after-clean.json` and
`/tmp/p1-bench-paired-comparison.json`.

Median hello was 186.044 → 188.479 ms; cold RSS 117.906 → 119.203 MiB;
idle RSS 128.391 → 129.422 MiB; idle Client CPU 0.478 → 0.466%; idle wakeups
13.197 → 13.197/s. Earlier runs inherited handoff state, disconnected and sampled
zero processes; those failed runs are excluded and retained as failed logs.
An initial sandbox process-sampler EPERM was resolved by authorized read-only
process access and termination of only the two known stalled P1 processes.

## Consumer follow-ups

- I1/D1: implement offered eligibility, exact artifact verification, legal gates,
  explicit prerequisite/loader probes, staged installs, trust and process lifecycle.
- T1/F2: bind authenticated ownership, ordered sync, actual capabilities,
  bidirectional server requests, cancellation and raw transport/queue limits.
- C1/E1/R1/X1: decode IPC boundaries, apply exact save fences, durable drafts/
  receipts, proposal acceptance, unknown-outcome queries and guarded recovery.
- M1: implement sanitized previews, Host media containment, consent and main-only
  external network policy with renderer object-URL cleanup.
- V1/V2: verify real providers, encoding conversions, runtime traces, durable
  recovery and cross-platform behavior. P1 does not claim those implementations.

No upstream code was copied or adapted; no artifact/license policy was approved.
