<!-- suzuka:summary -->
> [!WARNING]
> **Caution** — acme/widgets#42

Impersonation now writes audit events on start and stop. The expiry path skips the stop event, and one new log line carries the target's email. Two migrations add the audit_events index and a retention column; both are reversible.

<details><summary>Evidence</summary>

`src/auth/impersonation.ts:41` writes the target email to app logs.

</details>

## Impact Analysis

Support staff can trace impersonation starts and stops in the security log.

## Deterministic Checks

Head: `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa` · Base: `bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb`

typecheck passed · lint passed · tests passed · bundle passed — 2 migrations touched

| Check | Result |
| --- | --- |
| typecheck | passed |
| lint | passed |
| tests | passed |
| bundle | passed |

<details><summary>Bundle budget</summary>

| Bundle | Before | After | Budget |
| --- | --- | --- | --- |
| app | 142 kB | 143 kB | 160 kB |
| admin | 91 kB | 92 kB | 120 kB |

</details>

## Dependency changes

None.

| Migration | Change |
| --- | --- |
| 0142 | index on audit_events(actor, time) |
| 0143 | retainUntil, backfilled to 400 days |

## Findings

No finding met the bar for an inline comment.

## Cross-module interactions

- The audit write shares the session transaction.

[Full review](https://example.test/reviews/42) · [Review page](https://example.test/review/42)

Reviewed `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa` against `bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb`. Comment `/review` to re-run, `/retry` after a failure, or `/memory <guidance>` to teach Suzuka.
