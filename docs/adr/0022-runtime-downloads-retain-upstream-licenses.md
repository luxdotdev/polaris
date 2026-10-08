---
status: accepted
implements: owner decision 2026-10-08, Editor language tooling v2 slice 5
amends: ADR-0019
---

# Runtime downloads retain upstream licenses

Managed tools downloaded onto a user's Host from their own pinned upstream
release are not bundled in the Polaris installer. For these downloads, require
an explicitly recorded permissive top-level license, verify the exact archive
checksum, and retain the release LICENSE and notices beside the installation.
Full compiler/runtime/vendor closure is not an activation prerequisite for this
path. Existing closure evidence remains historical evidence, not certification.
Tools distributed inside Polaris's own installer keep the full closure gate.

Ruff 0.16.10 (MIT) and basedpyright 1.40.2 (MIT) use this runtime-download policy.
The catalog records `distribution: runtime-upstream` explicitly; missing fields
retain the earlier closure rules. Scoped runtime review records bind the upstream
release, artifacts and legal bytes. Checks reject unsupported licenses, absent
notices and changed checksums. No interpreter or project toolchain is installed.

basedpyright normally executes Python to discover search paths and the runtime
version. The private managed launch preloads a Polaris guard that blocks all
child-process execution and answers only its pinned search-path query from bounded
filesystem observations. It passes the selected entry path as `python.pythonPath`.
Versions from `pyvenv.cfg` are configuration facts, not execution measurements;
when absent, basedpyright chooses its own default target version. The guard runs
in background workers too. Its exact bytes are bound into the artifact audit root,
so changing the guard changes the installed selection identity. Changing the selected interpreter uses the existing
restart machine and Replaced handoff, preserving unsaved documents.

The basedpyright archive contains 5,419 files; file receipts alone take about
1,000,314 bytes before its directory inventory. The upstream runtime profile has
a separate 2 MiB receipt ceiling for this complete inventory. Catalog/manifest
metadata stays at 1 MiB, and the legacy profile keeps 1 MiB receipts. Archive,
file and entry limits stay bounded; no package script runs.
