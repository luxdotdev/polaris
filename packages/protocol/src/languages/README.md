# Language contracts

These are opt-in M3.1 contracts, not active handlers. `LanguageRpcs` is separate
from `DaemonRpcs`; no current Daemon advertises a language capability. P1 does
not change protocol version 1, Agent Session commands/events or durable streams.
Older peers drop unknown capability names with the existing `CapabilityList`.

## Registration and validation

`LANGUAGE_RPC_CAPABILITIES` covers every wire method. Require `languages` plus
the method's listed capability, except `languages.preview-media` which is
independent of language execution. A resource-bearing proposal additionally
requires `languages.resources` on both peers. Do not advertise a capability
until its entire corresponding handler set and client path pass their tests.
Feature support is the provider's actual `LanguageProviderCapabilities` and
dynamic registrations, not the presence of a catalog entry. Runtime code must
enforce supported commands/methods before forwarding them.

Effect RPC validates payloads/results. C1 must explicitly decode both optional
Desktop input and output tables from `shared/languages.ts`, and structured
server messages with `LanguageJsonRpcEnvelope`. Cap raw transport bytes and
parsing depth before decoding; cap queues/logs/diagnostics/lifetimes using
`LanguageLimits`. Unsupported server methods must receive JSON-RPC -32601;
every server request must resolve, reject, time out or cancel. Never put private
environment values, unsaved text or tokens in logs or Agent Session events.

## Identity and sync

Bind `clientId` to the authenticated connection in the Client/main/Daemon;
renderer-supplied IDs never grant ownership. Validate Host routing, Workspace
membership, canonical checkout/project paths and provider configuration on
every operation. Server generation is Daemon-issued, changes on recreation
and cannot be reused after restart. Context reuse is restricted to that exact
Client+Host+checkout+project+provider+configuration boundary. Interest IDs are
idempotent, scoped to their owning context and released on connection loss.

`LanguageSyncInput.sequence` is context-local and contiguous. Open supplies a
full snapshot; changes require the exact previous version and a higher new
version. Save/close refer to the current open version. Validate positions with
the negotiated encoding and document text, reject overlapping/out-of-bounds
ranges, and apply change arrays in order. Duplicate sequences can acknowledge
only identical notifications; a reused sequence with different content fails.
`LanguageSyncAck` means delivered to the ordered server queue, not analyzed.
`LanguageRequestFence`/`languageFenceSatisfied` require exact identity and
document versions after the required queue cut. Results still need the same
fence check against the current buffers before application. Typing, disk changes,
cancel, settings changes and connection loss invalidate pending results. Send
fresh full snapshots after a new generation; never replay stale edits.

## Catalog, Settings and providers

Wire descriptors preserve K1 IDs/fields exactly, including `disposition`,
formatter source and artifact roots. `languageToolOffered` is mandatory for
every install/activation caller: evaluation entries cannot become active through
a provider/formatter/companion reference. Pending audit/source/legal closure
is `audit-required`, never installed or ready. G1 policy review is a separate
gate; descriptor preflight cannot grant installation or execution approval.

Installation, prerequisites, install/feature preflight, runtime readiness and
update candidate are separate facts. Deduplicate jobs by Host/tool/version,
verify/stage before activation, retain the active version after failures, and
switch only between sessions. Install preflight checks server/build requirements;
feature preflight also checks developer project SDK/interpreter/toolchains and
selected formatter prerequisites. Refresh is explicit, with no idle polling.

Preferences persist in Client main, scoped App → Language → Host → Workspace
(Workspace-wide then Workspace-language). Expose effective origins/Host paths;
never persist preferences as installation facts. Format-on-save defaults true.
Provider arrays determine deterministic completion/action priority; merge
diagnostics per provider+URI and label their source. A full diagnostic report
replaces only that provider's set; pull unchanged reports keep the prior result
ID set. Unversioned and disconnected last-known diagnostics are conservative.
There is one selected formatter; its repository configuration still applies.

S1 syntax IDs differ from LSP document IDs (tsx/typescriptreact,
jsx/javascriptreact, shell/shellscript). Custom servers retain arbitrary document
IDs, initialization/settings, roots/patterns, argv/environment and working paths.
SQL settings disable execution/account access; Actions must never acquire an
account token. Execution trust precedes plugins/build/config evaluation;
Worktrees inherit Workspace trust, Review Checkouts need an explicit grant.
`LanguageLaunchFact` exposes resolved SDK/plugin/interpreter paths but only
environment key names. Syntax and sanitized preview require no execution trust.

## Formatting and refactors

All save reasons use `LanguageFormatPreflight` for the selected formatter and
exact snapshot/options/deadline. Apply formatting only after rechecking the
buffer fence, then call existing version-checked file save. Failed/unavailable/
timed-out formatting saves current text and reports a formatting error; disk
failure remains a separate failed `LanguageSaveOutcome`. Coalesce repeated
autosave notices without losing the failed formatting or save outcome.

Rename/actions return `LanguageFeatureResult.proposals`; server applyEdit uses
the same `LanguageEditProposal`. Preserve both LSP edit forms, null versions,
annotations and ordered resource options. Snapshot canonical paths and exact
disk/buffer/draft versions, including unopened/dirty files. Validate edits and
revalidate at acceptance. Single-file text fixes may use undo directly; batches
require user preview/acceptance. Text becomes durable drafts, not implicit saves.

Use stable operation IDs and matching receipt revisions; acceptance/status/
recover/undo/cancel are scoped to the authenticated owner. Persist prepared and
per-step applied outcomes, plus Client draft acknowledgments, before reporting
applied success. The schema rejects success without durable drafts and receipt.
Timeout/reconnect with unknown outcome requires an outcome query, never blind
retry. Restore only operation-owned versions (including absence); intervening
edits yield conflict/recovery-required. There is no filesystem-wide atomicity.

## Preview

`LanguagePreviewPolicy` defaults to asking before external images and enforces
sanitized HTML, scripts disabled, strict Mermaid and a 10 MiB media ceiling.
Remember consent per Host/Workspace; it is independent of execution trust.
Host media access validates canonical relative paths and symlinks within the
actual checkout. C1 resolves BlobId bytes in main and emits the bounded raster
`LanguagePreviewMediaView`; raw active SVG/HTML is never served as an image.
M1 can safely decode/rasterize other source formats before producing that view.
External-image IPC is main-only: enforce remembered consent, size/redirect and
network destination limits; omit credentials/cookies and validate every redirect.
Renderer gets bounded bytes, creates/revokes object URLs, and has no direct
network/filesystem authority. `LanguageEditorView` separates source and preview
views over the same Host/path buffer; preview locks are distinct from unpinned
source tabs. Relative links use shared Host-aware Editor navigation.
