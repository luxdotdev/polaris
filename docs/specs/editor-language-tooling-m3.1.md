# M3.1 · Editor language tooling

Status: accepted by the owner on 2026-10-02; implementation authorized through
the M3.1 · Editor language tooling Constellation.
This is a build plan, not a report of implemented behavior.

- Glossary: CONTEXT.md, especially Language Integration, Host, Workspace,
  Worktree, Review Checkout, Client, Daemon, and Editor.
- Product behavior: DESIGN.md, Editor; foundation: docs/specs/editor-m3.md.
- Evidence and candidate catalog: [research](../research/editor-language-tooling.md).
- Architectural decisions: ADRs 0013–0016.

## 1. Outcome and scope

The Editor must support daily work in Sightline without switching editors.
Deliver diagnostics, completion, hover, signature help, definition and
type-definition, references, rename, code actions, formatting, and document and
workspace symbols where providers support them. Surface actual capabilities;
do not imply every server implements every feature.

Offer managed Language Integrations for JavaScript/TypeScript, HTML/CSS, SQL,
Python, Bash/Shell, Java, PHP, Go, Rust, Lua, Prisma, YAML, and GitHub Actions.
Support additional configurable servers without requiring a Polaris release.
Expand local syntax highlighting independently of installed servers, including
Prisma, .env variants, and broader common file associations.

Include Markdown source highlighting and GitHub-style preview with tables,
tasks, strikethrough, autolinks, highlighted fences, relative images, and Mermaid.
Executable MDX, a VS Code extension host, a plugin marketplace, database
connections/query execution, and Agent/Reviewer access to language intelligence
are outside this milestone. Preserve a Daemon service boundary for future
consumers. AI ghost-text completion remains a separate feature.

## 2. Installation, Settings, and discovery

- Servers are not preloaded. Settings offers one-click installation. First
  encounter with a managed language automatically installs its integration,
  with a toast identifying the language and Host.
- Install once per Host/tool/version, deduplicating concurrent opens and manual
  requests. Use Polaris-owned version directories; do not install globally,
  change shell profiles, or modify repository dependencies.
- Check platform and prerequisites first. Runtimes, interpreters, compilers,
  project dependencies, and toolchains are the developer's responsibility.
  Missing/incompatible prerequisites appear in Settings and first-use feedback,
  with the detected requirement and Retry/refresh action.
- Use tested pinned releases, verified artifacts, retained license notices, and
  staged activation. Updates are explicit in Settings; failed updates retain
  the working version. Switch versions between server sessions.
- Settings → Editor owns configuration: app defaults, per-language choices,
  per-Host executable/environment overrides, and per-Workspace interpreter,
  SDK, provider, formatter, and file-association overrides. Editor preferences
  remain local to the Client; installed-tool facts come from the selected Host.
  Do not introduce a required checked-in Polaris file.
- Custom server controls cover executable, argv, root markers/working directory,
  file patterns, document language ID, environment, initialization options, and
  server settings. Support ordinary stdio LSP without an extension host.
  Bespoke UI for custom methods requires a future adapter, rather than arbitrary
  UI code loaded from configuration. Do not expose environment secrets in logs.
- Discover nested projects/environments within the actual checkout. Server-specific
  root rules must handle monorepos, rather than treating registered Workspace ID
  as the sole root. Overrides show their effective Host path and take precedence.
- Trust a Workspace once before launching tooling that may execute project code,
  including managed servers invoking build scripts or project plugins. Worktrees
  inherit their Workspace's trust. Review Checkouts require explicit trust.
  Syntax and sanitized preview remain available beforehand. Merely discovering
  executable configuration must not evaluate it before trust.

## 3. Architecture proposal

| Boundary | Responsibility |
| --- | --- |
| packages/protocol | Capability-gated language contracts, validated JSON-RPC envelopes, install/availability facts, context identity, document versions, edit proposals, typed failures. |
| apps/daemon/src/languages/ | Host install catalog/availability, discovery, process supervision, stdio framing, ordered server connections, request routing, bounded queues. |
| packages/client | Typed access over existing Host connections, cancellation/connection loss, context recreation and snapshot resynchronization. |
| Desktop main/shared IPC | Persist app configuration, propagate effective settings, bridge typed Host operations/progress, authorize Client-owned contexts. |
| Desktop Editor | Persistent buffers/drafts, provider routing, feature UI, save preflight, workspace-edit preview/undo, and Markdown views. |

Exact module splits and RPC names are implementation choices. Publish the wire
contract before dependent work. Use pinned Effect/XState versions and existing
schema, service, lifecycle, and capability conventions.

Separate Host installations from document contexts. A context identifies its
Client, actual checkout, server-discovered project root, provider configuration,
and server generation. Reuse within that boundary; never mix Clients/checkouts
merely because they share a Workspace or language.

Desktop drafts stay authoritative. Daemon-side unsaved text is ephemeral
language-server input, not a disk mirror, durable event history, or Agent
visibility. Send ordered open/change/close/save notifications with document
versions. Requests must be fenced behind their required document version.
Cancellation, generation changes, typing, and disk changes invalidate obsolete
results. Unversioned diagnostics need conservative handling rather than a claim
of proven freshness. Negotiate position encoding and handle Unicode correctly.

Support push/pull diagnostics as negotiated, configuration requests, capability
registration, progress, and server-initiated edit proposals required by the
catalog. Advertise only implemented capabilities. Bound message sizes, queues,
diagnostics, logs, and request lifetimes. Unsupported methods receive a response
rather than leaving requests hanging.

Compose providers with explicit ownership: one formatter, deterministic
completion/action ordering, and source-labelled diagnostics without duplicates.
Python plus Ruff and YAML plus Actions exercise this boundary. SQL supplies
editing and dialect selection; do not enable database connections or execution.

Evaluate @codemirror/lsp-client as a feature layer; current 6.3.0 behavior is
insufficient as the whole broker. The first gate must prove custom initialization,
server requests, multiple providers, closed-file edits, and awaitable formatting
before selecting the client stack. Prefer supported dependencies; copied/adapted
code requires pinned attribution.

## 4. Lifecycle and failure behavior

- Start on relevant document demand once installation, prerequisites, and trust
  allow it. Opening files and typing must not wait for server initialization.
- Retain servers while related files stay open, including a switch to Orchestrator.
  Release after the last interested file closes and a short grace period.
  Use demand/ref-counted timers, not periodic availability polling.
- Bound automatic crash retries; expose Restart and logs in Settings.
  Exhausting the retry budget leaves a visible failure, not an endless loop.
- On Host connection loss, keep local buffers editable, dim last-known tooling
  results, invalidate pending operations, and prevent disk-mutating actions.
  On reconnect/restart, establish a new generation and send current snapshots
  before requests. Never replay stale edits or blindly retry unknown outcomes.
- Install/runtime states are separate from Agent Session States. Cover not
  installed, installing, missing prerequisite, awaiting trust, ready, stopped,
  failed, unsupported, and update available, alongside Host Connection State.
- Older Daemons retain editing, drafts, syntax, and local preview; unavailable
  language features explain the Host capability and offer upgrade.

## 5. Formatting and refactors

Format-on-save is enabled by default, configurable per language and Workspace.
App Settings selects the formatter; that formatter respects repository
configuration. One save coordinator covers manual save, autosave, Save All,
Vim save, and save-before-close/quit so no entry point bypasses preflight.
Format the current snapshot, reject stale results, then save using existing
disk-version checks. A failed/unavailable/timed-out selected formatter still saves the text
and raises an error toast explaining that formatting failed. A disk save failure
must not be reported as success. Coalesce repeated notices during autosave
without hiding the outcome.

Single-file fixes can apply directly with undo. Multi-file edits require preview
and acceptance, including unopened files, dirty buffers, and resource operations.
Handle both changes and ordered documentChanges. Revalidate affected buffer/disk
versions at acceptance; refuse outdated batches without silently replacing newer
Agent or user work.

Text edits become persistent drafts with coordinated undo. Accepted file
create/rename/delete operations affect disk through a version-checked recoverable
coordinator. Do not claim filesystem-wide atomicity. Track prepared/applied
outcomes and identify failed partial operations. Recovery or undo may restore
only versions still owned by the operation, never overwrite an intervening edit.
Surface unresolved recovery explicitly. Server workspace/applyEdit requests use
the same preview/acceptance path; they cannot bypass user acceptance.

Release resource operations only after fault-injection proves crash recovery,
retry idempotence, cancellation, and guarded undo. Persist draft changes and
necessary Host operation outcomes before acknowledging success.

## 6. Editor and Markdown interactions

- Completion popup, hover/signature tooltips, definition navigation with back
  history, references peek, symbol navigation, and an on-demand Problems panel.
  LSP errors/warnings are diagnostics, not Review Risk Findings.
- The language selector supports per-file manual overrides; Settings controls
  persistent associations. Syntax works when tooling is absent, unsupported,
  untrusted, disconnected, or installing.
- Markdown opens as source. Cmd+Shift+V opens/focuses a rendered preview tab in
  the same editor area, updating from the unsaved buffer. Follow VS Code's
  active-document preview behavior with a lock-to-document option.
- Source/preview have separate view identities over one Host/path buffer.
  Do not overload the existing unpinned-source-tab preview flag.
- Resolve relative documents/images against the Markdown file on its Host and
  checkout. Links use shared Editor navigation; fragments remain in preview.
  Fetch bounded media through typed file access and revoke object URLs.
- External images require “Load external images” with a remembered Workspace
  choice. Sanitize HTML, disable scripts, and retain strict Mermaid rendering.
  Do not enable arbitrary renderer network/file access as a shortcut.
- Follow DESIGN.md tokens, both themes, all densities, Reduce Motion,
  keyboard/focus behavior, and accessible diagnostic labels. New language-tooling
  surfaces have no mockups yet.

## 7. Delivery order and gates

| Stage | Deliverable and gate |
| --- | --- |
| 1. Contracts and feasibility | Publish context/edit/save contracts; evaluate LSP client fit; prove TS SDK/plugin resolution in a fixture; pin an initial catalog with prerequisites/platform/license records. |
| 2. Syntax and preview | Broaden lazy grammars/associations; manual selection, .env/Prisma; source/preview identity, GFM/Mermaid and Host-aware resources. Independent of server supervision. |
| 3. Host tooling foundation | Availability, trust, install deduplication/progress, update activation/rollback, context ownership, ordered transport, lifecycle/reconnect. Fake servers and temporary Hosts/homes. |
| 4. Sightline vertical slice | TS/JS including Next/Effect/Workflow plugins, Prisma, Python/Ruff, nested Rust, YAML/Actions; completion/navigation/diagnostics and formatter selection. |
| 5. Editing correctness | Every save path with formatting; closed-file/dirty-buffer previews, persistent drafts/grouped undo; fault-tested resource operations. |
| 6. Catalog and hardening | Go fixture, HTML/CSS, SQL, Bash/Shell, Java, PHP, Lua; platform matrix, custom-server fixture, performance and actual Desktop App verification. |

Stages can deliver useful subsets, but M3.1 is complete only when the entire
agreed catalog/scope and daily-use checks pass. Proposed Python default: Pyright
plus Ruff to preserve ordinary project diagnostics; basedpyright is an override.
Evaluate Phpactor as the open-source PHP candidate. If it cannot meet the target,
bring the documented alternative/paid-feature decision back instead of silently
dropping rename or requiring a paid license.

Exact release pins, transfer/download mechanics, grace/retry constants, and
provider feature differences are named implementation evaluations. They must
not change agreed installation, trust, saving, or ownership behavior.

## 8. Acceptance and verification

- Sightline fixture: alias-aware launchable TS SDK; proven Next/Effect/Workflow
  plugin behavior; nested Python interpreters; Prisma schema/config and generated
  client navigation; isolated nested Cargo root; Actions expressions plus YAML.
- Separate Go fixture (go.mod/go.work); representative Java, PHP, Lua, HTML/CSS,
  SQL dialect and Bash files. Report unsupported capabilities honestly.
- Syntax cases: .env/.env.local/.env.example/.envrc, Prisma, Markdown/YAML,
  broader associations and Markdown code fences. Use no real environment secrets.
- Custom-server fixture: non-catalog executable overrides, language IDs, roots,
  initialization/settings, registration, cancellation, diagnostics, and server
  requests without new Polaris code.
- Race/failure cases: typing during request/save, Unicode positions, Agent disk
  edits, dirty/unopened files, grouped undo, file operations, duplicate retries,
  two Clients/Worktrees, reconnect/restart, missing toolchains, failed/offline
  installs, update rollback, old peers, and rejection of untrusted execution.
- Markdown: GFM, sanitized HTML, diagrams, unsaved updates, source/preview,
  anchors, Host-relative media, external resource consent, unavailable Host,
  and image cleanup.
- Extend spec/model/trace mappings for changed command, commit, acknowledgment,
  recovery, or resume semantics. Run bun run spec, bun test
  apps/daemon/src/verification, and relevant trace validation per the spec README.
  Finite simulation is not a proof of liveness.
- Before/after idle, editor, and affected benchmark scenarios against the
  committed machine baseline. Add loaded-tooling measurements for startup,
  completion/diagnostic latency, install contention, server child memory/CPU,
  and cleanup. No new polling wakes an unused Daemon.
- Preserve display-rate typing, existing 1 MiB open budgets, and the Desktop App's
  <1 GB budget with 20 tabs. Report Host/server children separately; loopback
  bridge results are not actual remote/browser evidence. Establish catalog
  resource budgets from measurements before broad release.
- Run bun run typecheck, bun run test, bun run lint, license checks, and catalog
  artifact audits. Inspect actual Desktop App behavior in both themes, every
  density, Reduce Motion, and keyboard/accessible states.

## 9. Design-tree closure

Q1–Q25 settle scope, catalog policy, configuration/discovery, unsaved text,
preview/rendering, prerequisites, trust, SQL/Actions, composed providers,
edits/undo, formatting, isolation, updates, lifecycle/recovery, media, and Editor
interactions. Conditional technical choices have named gates and do not promise
untested behavior. The owner confirmed shared understanding and requested
implementation through a Constellation on 2026-10-02.
