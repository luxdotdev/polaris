---
status: accepted
implements: ADR-0019, Editor language tooling v2 slice 1
---

# Isolate bundled TypeScript from Workspace code

The first zero-configuration provider uses pinned Node 24.18.0 LTS, TypeScript
6.0.3 and typescript-language-server 6.0.1. These are private Host installations,
verified against their upstream archive SHA-256 and retained license evidence.
Official Node binaries cover macOS and glibc Linux on arm64 and x64; musl remains
unsupported. Node is never resolved from PATH. Other prerequisites use bounded,
demand-only observations of developer executables and still require Trust.

An explicit bundled compiler path alone does not disable tsconfig plugins.
For the pinned compiler, a receipted private preload disables `ts.sys.require`
and `ts.sys.importPlugin` before either server loads it. The server and its
tsserver children inherit that preload. The launch replaces inherited
NODE_OPTIONS and NODE_PATH, disables automatic typing acquisition, and supplies
no initialization plugins. Live acceptance includes hostile Workspace SDK and
plugin sentinels. A future compiler version must repeat that proof; this relies
on the pinned compiler's internal plugin-loading hooks. Project SDKs and plugins
remain unavailable on this path, including after a Trust grant, until slice 2.

The existing selection ledger, installation receipts, connection identity and
registered checkout remain authoritative. Trust authorizes execution of
Workspace code, so it does not gate this bundled provider or acceptance of its
rename drafts. Those edits retain document acknowledgments, proposal provenance
and explicit acceptance. Feature preparation mints format-2 proposals before
recording provenance, including empty resource snapshots for text-only edits,
so the Desktop's single receipt coordinator accepts the exact Host-issued
representation. Configured providers keep their existing Trust gate.

Official Node archives exceed the legacy installer limits. A separate bounded
upstream runtime profile permits 96 MiB downloads, 256 MiB expansion, 128 MiB
individual files and 32,768 entries. Node extracts only bin/node and LICENSE;
Linux Node's GNU long-name metadata is decoded and path-checked, never extracted;
selected links and other archive extension/special entries are refused. Legacy
installers retain their smaller caps. No package scripts or builds run.

The entire language service graph, including preview media, loads on the first
language RPC. Language wire tagged-union guards also construct on demand through
suspended codecs; their wire shapes and case constructors remain identical.
Once startup installs the listener and handlers, the existing full collection/
shrink operation returns temporary startup allocations. This runs once, adds no
idle timer, and also covers recovered Dormant sessions,
which do not emit a new TurnEnded event to trigger the usual quiet collection.
