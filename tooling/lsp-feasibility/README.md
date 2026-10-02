# Disposable LSP feasibility experiment

Run `tooling/lsp-feasibility/run.sh` from the repository. Requirements: Node 24
(tested 24.18.0; TLS requires >=22.22.2), pnpm 9.15.0, gzip, registry access.
The runner creates a fresh `/private/tmp/polaris-lsp-feasibility.*` directory,
redirects HOME/TMPDIR, installs the integrity-locked dependency graph with
lifecycle scripts disabled, and retains its logs for inspection. No real Host,
account, Sightline files, project dependencies or Polaris home are modified.

The generated pnpm lock is stored compressed to keep the large fixture-only
artifact separate from source. Decompress with `gzip -dc pnpm-lock.yaml.gz`.
Do not add this dependency graph to production manifests or the root bun.lock.

- `client.mjs`: real CM client initialization and rejected server requests;
  real JSON-RPC paired streams with configuration, dynamic registration,
  ordered unsaved changes, code actions, closed-file proposals and formatting.
- `format.mjs`: real CM command with a headless view double and delayed reply.
- `providers.mjs`: independent fake-server connections; deterministic provider
  ordering and single formatter; in-memory closed-file draft/undo/conflict model.
- `typescript.mjs`: real alias-resolved tsserver, differential plugin controls.
- `lsp.mjs`: real TLS process, all three plugin diagnostics and Effect actions.
- `provenance.json`: npm root versions, artifact integrity, licenses and supplied
  source heads. No upstream implementation is copied or adapted.
- `evidence.txt`: actual complete runner output from 2026-10-02, including paths,
  warnings and exact fixture versions. Temporary retained paths are not portable.

These are feasibility probes, not the implemented Polaris language service.
They do not certify production edit recovery, Unicode conversion, isolation,
reconnection, physical network transport, real Python/Ruff behavior or UI.
The protocol/IPC handoff and verification limits are in `docs/reports/m31/F1.md`.
