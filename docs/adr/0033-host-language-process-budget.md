---
status: accepted
implements: Host language process budget
---

# Scale language-server admission with Host resources

The owner requested automatic scaling and approved a persistent, authenticated
Host override on 2026-10-11. Desktop/Workspace preferences do not control this
Host-wide pool. `languages.host.processBudget.get/set` expose a revision-CAS
setting; null selects automatic admission, and explicit limits are 1–32. Lowering
the limit retains active servers and blocks new reservations until there is room.
The setting is atomically persisted in the private Host language directory.

## Measurement and policy

On the Mac Studio (32 GiB, 12 available CPUs), an isolated authenticated Host
started each pinned managed provider against a copy of the owner's slice7 fixture.
Sampling used the existing `darwin-libproc` process-tree reader at 100 ms from
document open through readiness and ten seconds of settled operation. TypeScript
includes the language-server wrapper and tsserver; Bash includes transient
ShellCheck children. No package script or project code ran. These are observed
fixture workloads, not bounds on every possible project.

| Managed provider tree | Peak RSS, MiB |
| --- | ---: |
| TypeScript/tsserver | 333.59 |
| basedpyright | 99.17 |
| Ruff | 16.53 |
| JSON / CSS / HTML | 71.98 / 89.70 / 157.97 |
| YAML | 85.17 |
| Actions | 83.55 |
| Prisma | 129.72 |
| Svelte | 172.77 |
| sqllens | 529.63 |
| Bash + ShellCheck | 660.56 |

Slice 6's Pi snapshot reports a 511.69 MiB TS tree including a 205.75 MiB
Daemon: its two TypeScript processes consume 305.94 MiB. Its memory observation
is 3,881,676 KiB total and 2,945,652 KiB available. This is historical evidence;
the process-budget task does not certify a new Pi workload.

Round the largest observed server tree upward with 25% headroom to a 64 MiB
boundary: 832 MiB per reservation. The automatic pool is the smaller of half
effective RAM and a quarter of effective RAM plus reclaimable available RAM.
Admission is the smaller of twice available CPUs and pool/832 MiB, floored at
four on a four-core Host with enough total memory for four allowances; smaller
Hosts receive a smaller floor. The absolute cap is 32, matching the context bound.
Effective RAM honors process/OS constraints. Linux reads MemAvailable; macOS
counts free, inactive and speculative pages without adding overlapping purgeable
pages. Raw free memory alone was below 100 MiB on this Mac despite several GiB
of inactive pages. Unknown observations fall back to free memory.

Resources are observed once when the lazy Host language subsystem loads. This
keeps its automatic capacity stable during a session, avoids self-induced
shrinking as servers start, and adds no idle sampling timer. Resetting an override
uses that Host observation; a Daemon restart observes resources again.

The real Desktop smoke observed 7,339,950,080 bytes available and selected 18
slots automatically. All 14 original slice7 files plus temporary TS/Python proof
files stayed open, with 14 simultaneous Ready contexts. The cached Pi inputs
select four slots; this is a derivation, not a fresh Pi certification.

## Pressure and ownership

One serialized admission lane chooses the least recently used idle reservation.
Open documents in any Client with the same checkout, project, provider and
configuration pin every corresponding server. Independent dialect/configuration
contexts can retire separately. Observation subscriptions and retained context
interests are not demand.
Evict is an explicit grace-to-stopped lifecycle transition. It publishes a
Replaced stopped fact, preserves synchronization sequence, and retains interests
so reopening starts again. Active documents, their pending initialization and
outstanding feature requests are never discarded to make space.

Distinct companion servers consume distinct reservations (basedpyright/Ruff,
YAML/Actions). Descendants are included in the memory allowance of their owning
server tree. Retiring processes retain capacity until raw owned teardown settles;
failed teardown never releases it. A new request waits for retirement, with the
existing ten-second cleanup deadline. Closing/disconnecting waiting demand
cancels it without a reservation leak or crash-budget charge.

Only an entirely active pool refuses with `process-limit`; its copy says every
slot is in use and directs the user to close unused-language files and restart.
Retirement timeout uses process-retiring without spending crash retries or
claiming all slots are active. Grace, crash history, Trust, receipts and cleanup deadlines
remain their existing authorities.
