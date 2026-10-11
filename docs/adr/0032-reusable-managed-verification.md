# Reuse immutable managed-tool verification on the Pi

Owner manual pass 2 reproduced a typed Python preflight timeout on lucas-rpi.
File discovery and the file pill already select the Language Integration's tools;
the settings inventory intentionally selects the complete Host catalog. Python
delivery selects basedpyright, Ruff, private Node and the selected interpreter.
Ruff's launch plan no longer reads private Node. Interpreter presence and captured
request authority remain fresh; no Workspace execution or authorization is cached.

The old standalone checks cost approximately 0.9 seconds for Node, 0.8–1.1 seconds
for basedpyright and 0.2 seconds for Ruff. Each later open, prerequisite check and
launch check repeated complete file hashes. This supersedes ADR 0026's decision
to retain only in-flight verification and its unchanged two-second demand budget.

Successful full tree and file verification produces an atomic, private version
certificate binding the exact installation identity, receipt digest and metadata
fingerprint. Every later read checks canonical private storage, the receipt and
every recorded file and directory's device, inode, owner, mode, link count, size,
mtime and ctime at nanosecond resolution. Directory changes invalidate added or
removed entries; ctime detects same-size writes even when mtime is restored.
The version directory's timestamps are excluded because writing the certificate
changes them; its identity, owner, type and permissions remain checked. Payload
directory timestamps are always checked. Metadata is checked before and after
full verification, with the receipt bytes checked again before publication.

A bounded 32-version memory cache shares completed verification. The certificate
also permits reuse after Daemon restart; missing, invalid or changed certificates
fall back to complete hashes and tree validation. Failures never enter the cache,
and callers receive cloned descriptors. Selection pointers, artifact approval,
Trust, admission guards and launch leases remain authoritative on every demand.
Receipts are not protection from code already running as the installation owner,
which can replace both the original receipt and installed files. No idle watcher,
polling or timer is introduced. Read-only counters distinguish full verification,
certificate reuse and memory reuse for measurements and regression tests.

Demand-only inspection, prerequisite observation and Host snapshot deadlines are
ten seconds to accommodate first verification on a Pi 4 with headroom. Artifact
approval, reservation cleanup and installation resource limits are unchanged.
Timeouts retain the typed retryable LanguageError. Check again invalidates cached
Desktop discovery and performs another RPC; a cancelled observation must finish
owned cleanup before the next observation starts, rather than adopting its failed
promise. Tests use short injected deadlines to exercise the real timeout path.
