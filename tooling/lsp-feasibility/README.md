# Disposable LSP feasibility experiment

Run `tooling/lsp-feasibility/run.sh` from the repository. Requirements: Node 24
(tested 24.18.0; TLS requires >=22.22.2), pnpm 9.15.0, gzip, registry access.
The runner creates a fresh `/private/tmp/polaris-lsp-feasibility.*` project,
installs the integrity-locked graph with lifecycle scripts disabled, and retains
logs for inspection. It never assigns HOME, home or CODEX_HOME. The installer
and server children receive an explicit environment allowlist. `install.mjs`
uses empty `config/user.npmrc` and `config/global.npmrc` through pnpm's supported
npm_config_userconfig/globalconfig overrides, plus XDG_CONFIG_HOME for pnpm's
additional global rc location. Config inspection verifies those paths, the
public registry and absence of credential keys before installing. Cache, state
and store paths use supported npm_config_cache_dir/state_dir/store_dir settings;
all point inside the fixture. Inherited npm/pnpm credentials and registry settings
are excluded. Server temp paths use TMPDIR/TMP/TEMP; direct tsserver logFile and
TLS initializationOptions.tsserver.logDirectory point inside the fixture.
Automatic typing acquisition is disabled; no user-global typings cache is needed. No real Host,
account, Sightline files, project dependencies or Polaris home are modified.

The generated pnpm lock is stored compressed to keep the large fixture-only
artifact separate from source. Decompress with `gzip -dc pnpm-lock.yaml.gz`.
Do not add this dependency graph to production manifests or the root bun.lock.

- `install.mjs`: supported pnpm config/cache isolation and credential checks.
- `process.mjs`: common bounded process-group termination and awaited child close.
- `cleanup.mjs` / `stubborn-server.mjs`: success/failure/timeout cleanup against
  SIGTERM-resistant parent and descendant; confirms escalation to SIGKILL.
- `faults.mjs`: injected failure/timeout in both real tsserver and TLS launchers;
  expects exit 1 only with the named fault and confirmed process-group cleanup.
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
Process-group tests support macOS/Linux; Windows needs a separate process-tree
implementation. Termination waits up to 1 second after TERM, 2 after KILL and
1 for child pipes to close; unresolved cleanup fails the fixture. The protocol/IPC handoff and verification limits are in `docs/reports/m31/F1.md`.
