# Verify pinned package files within the existing Pi preflight deadline

The real Pi basedpyright package has 5,422 files and 897 directories. Sequential
eight-file batches took 2.34 seconds to verify, followed by another second for
private Node. The existing two-second preflight deadline stopped Python startup.

Directory discovery scans at most 16 directories concurrently and awaits all
owned scans, retaining every canonical-path and tree check. Inventory and file
integrity checks run independently in parallel and both must finish before
returning; this removes their sequential latency without retaining successful
verification results. The receipt decoder is compiled once and parses every read.
Verification batches at most 32 files and 16 MiB of buffers; a larger file runs
alone. Stored files are hashed completely through 1 MiB buffers with asynchronous
reads between chunks; this limits private Node's buffer and synchronous CPU burst.
A bounded extra byte detects growth beyond the receipt size. Every hash,
tree, symlink, owner, mode and size check still runs on
every read. There is no completed verification cache or deadline extension.
The same installed Pi package measured 1.03 seconds on its first standalone read
and 0.84 seconds on the next read with the overlapped checks.

Overlapping reads of the same identity share only their in-flight verification;
settlement removes the promise, and each reader receives an isolated descriptor.
Later corruption is still detected, and a repaired file clears a failed read.
Host snapshots inspect at most four rows concurrently and verify private Node
once within each read. Each row verifies its package alongside its prerequisite
observation, waiting for both before publication. Discovery defers Node observation along with installation.

Managed TypeScript, basedpyright and Ruff additionally observe their prerequisite
facts in parallel with verification of the selected pin. The returned fact still
requires complete verification, exact descriptor identity, artifact approval and
current authorization. Ordinary retained-version inspections keep their existing
descriptor semantics. The existing launch selection lease remains authoritative.
