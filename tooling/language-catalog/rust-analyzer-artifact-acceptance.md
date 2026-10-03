# Darwin arm64 disposable artifact acceptance

This is a prepared acceptance contract, not execution evidence. The original
published artifact remains blocked. Run only after the explicit K3 slot release;
all stages share the original 20-minute/3 GiB stop/4 GiB successful-attempt budget.
Do not resume a failed attempt or create another root to evade its limits.

1. Revalidate immutable inputs and direct compiler commit/digests immediately
   before staging. Hash every staged source/vendor file and retain the frozen
   Cargo lock, both workspace/private Cargo configuration files, exact argv,
   target, allowlisted environment and resolved dependency/features graph.
2. Retain aggregate peak/final bytes, lowest free space, observed sampling gap,
   capped logs, external receipt reserve, process-group cleanup and every limit
   failure. A polling interval is a measurement target, not an absolute ceiling.
3. Capture the new output SHA-256, executable architecture, linked libraries,
   unresolved symbols, link map, linker/SDK/native sysroot identities and exact
   proc-macro helper identity. The developer helper is separately provided by
   the existing compiler; it is not silently included in the new distribution.
4. Deliver source and notices for actual resolved dependencies, compiler/runtime
   membership and included helpers. Bind a complete delivery manifest to the
   build-input/output roots. A source commit or matching bytes alone cannot
   establish this closure. If any actual runtime membership cannot be mapped,
   retain that explicit missing evidence instead of promoting the artifact.
5. Execute a bounded isolated LSP fixture under the same network/write sandbox:
   initialize; verify advertised completion/hover/diagnostics capabilities;
   open a private Rust document; observe semantic completion, typed hover and
   a diagnostic for an intentional type error; shutdown/exit; verify cleanup.
   Persist request/response evidence with output caps and exact binary identity.
6. Use a small private two-crate Rust workspace with a locally implemented
   identity procedural macro and no registry dependencies. Freeze its source
   bytes and private Cargo config. Build/check only with the existing direct
   compiler, two jobs, no network and the shared attempt limits. Supply the
   exact existing helper path explicitly. Require a semantic observation on
   the macro-generated item and successful macro expansion; helper existence,
   version output, a declared capability or a synthetic mock is insufficient.
7. Formatting ownership remains explicit: rust-analyzer formatting requires a
   separately available developer rustfmt and project execution trust. Record
   its identity and actual edits if present; if absent, disclose the missing
   formatter capability. Do not install it or substitute an unrelated formatter.
8. Compare a second identical-input build only if the same attempt's remaining
   time/bytes permit. Otherwise state that byte reproducibility was not proved.
   Output success does not approve legal scope or change catalog/provider/defaults.

K3 owns the new immutable build/dependency/output/legal record and probes. A1
reviews the exact distribution/prerequisite proposal and any product decision.
Every other target remains unverified regardless of this local result.
