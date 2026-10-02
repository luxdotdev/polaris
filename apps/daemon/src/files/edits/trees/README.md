# Recoverable directory resources

`createTreeEditCoordinator` is a detached format-2 coordinator. G2 must wire its
own group before legacy RPC/Client Struct decoding, verify the R1 draft receipt,
and register all authenticated accept/status/recovery paths before capability
activation. Protocol and effective 1 MiB wire limits are in
`packages/protocol/src/languages/TREES.md`. X1's format-1 coordinator, tests and
regular-file `FileVersion` remain unchanged. Tree journals use a separate
`tree-<owner-operation SHA256>` namespace and never parse format-1 journals.

The authorize callback verifies the actual accepted preview, authenticated
Host/Client/checkout, current generation/sequence/documents and a durable Client
draft group containing all dirty source and overwritten destination descendants.
It runs initially, after the checkout queue and after final path locks. Status
and each recovery call also require authorizeRecovery, repeated after lock waits.
Undo must verify current Client reconciliation. Matching requests query their
prior durable receipt; altered reuse fails. Expired unknown accepts fail closed.
Server applyEdit remains an unaccepted preview.

A complete ordered virtual subtree map tracks root and descendant identities,
membership, modes and regular-file byte versions through every move. All source
and destination roots, including absence and overwritten trees, need initial
snapshots. Overlapping snapshots must agree exactly and count toward aggregate
limits. Paths use exact Unicode spelling/code-unit order; existing case/Unicode
canonical aliases fail closed, as do aliases between URIs. Direct or self-containing
renames fail; ordered descendant operations after an earlier directory rename
are supported. Creates stage regular files, per LSP CreateFile; directory creation
is not invented as an LSP extension. Overwrite backs up any existing tree first
and takes precedence over ignore. Empty directory deletion needs no recursive
flag; nonempty directory deletion requires recursive:true. Deletes never traverse
or unlink a tree: they rename it into the operation's private backup.

No-follow lstat checks all ancestors and entries, rejecting links/special entries.
Regular-file descriptors use O_NOFOLLOW, bounded streaming hash reads, and matching
before/after device/inode/mode/size/mtime/ctime checks. Directory enumeration streams
entries instead of allocating a full unbounded readdir. Root and directory stat
checks bracket enumeration; repeated complete scans detect snapshot instability.
Each pass across initial roots is bounded to 4096 entries, 64 levels and 64 MiB
file bytes; no growth read proceeds beyond one sentinel byte. Every move revalidates
complete source/destination manifests and captured ancestor identities before and
after durable intent. Checkout root replacement and occupied owned absences fail.

This is not a native openat/renameat isolation primitive. Portable Node/Bun path
APIs cannot atomically bind directory enumeration/rename to all ancestor descriptors.
An adversarial replacement between final path checks and syscalls remains an OS
TOCTOU boundary, including check-to-open/enumerate and check-to-rename intervals.
Encountered unsafe links fail without traversal; detected races prevent mutation.
Do not claim filesystem-wide atomicity, hostile-process isolation or certification
of untested platforms. The tests exercise explicit race checkpoints and external
writes, not every possible adversarial syscall interleaving.

The journal root must be canonical, private (no group/other access), outside the
checkout and on the same device. Backups are same-filesystem rename moves. All
canonical original and translated descendant paths plus parents are locked in
sorted order through final validation and mutation, sharing X1's file queue.
A checkout queue serializes tree planners. Operation-private directories are not
reacquired during recovery. Snapshot validation repeats after lock waits.

Prepared receipts/staging and every forward/reverse intent and result are fsynced.
Recovery never resumes stale forward work; it reverses only exact owned trees
with an absent reverse destination. Intervening descendants or overwritten-backup
edits cause recovery-required and retain backups, including partially restored
chains. Revision CAS prevents stale undo; query after unknown/crashed responses.
Disk/fsync failure may leave an earlier durable receipt; never acknowledge an
in-memory outcome. Unresolved and terminal undo backups remain; no pruning/timer
or idle work is introduced.

Preflight bounds expanded ordered move manifests to 32768 entries, 256 MiB of
repeated file sizes and 2 MiB encoded move data. Outcomes reserve 512-byte messages
per step and max revision before mutation and must fit 1 MiB. Private journals
cap UTF-8 JSON at 4 MiB including duplicated manifests; raw receipt reads are
size-checked and bounded before JSON parsing. The prepared receipt must persist
before the first checkout move; excessive receipts fail without checkout mutation.
All fixtures use temporary files and fake owners. R1 durability and authenticated
transport assertions are injected test seams, not live product evidence.
