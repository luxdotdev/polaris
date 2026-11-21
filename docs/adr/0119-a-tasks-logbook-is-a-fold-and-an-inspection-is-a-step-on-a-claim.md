---
status: accepted (ENG-1010)
---

# A Task's Logbook is a fold, and an Inspection is a step on a Claim

## Context

Vercel Board (`@vercel/board`, Apache-2.0, `vercel/board@d73458d5`) coordinates agent swarms
through a shared message store: a task is a thread, and agents post to it and wait on it. A
review is a task that `needs` the work it checks. Two gaps in Constellations match what Board
solves. First, there is no shared record per Task: messages are injected Turns, `read_worker`
is Lead-only, and a SendBack Attempt starts with a header and a reason. Second, the Lead reads
every Claim itself, which is the largest cost to its context.

## Decision

**The Logbook is derived, not stored.** A Task's Logbook folds the Constellation events it
already has (progress, questions and answers, operator and peer messages, Claims, reviews,
settles), plus one new note event. It spans all of the Task's Attempts. Board's store is the
alternative: agents write messages directly and Polaris projects state from them. We rejected
it because it would make a second source of truth beside the event log, a second model in the
Quint spec, and a second history that could disagree with the graph.

**An Inspection is a step on a Claim, not a Task in the graph.** When a Claim arrives on a Task
the Lead marked, the Daemon starts an Inspector, without a Lead Turn. Its verdict either
reaches the Lead or becomes an ordinary SendBack. Board's shape, a review Task that depends on
the work, would add rows to the rail. It would also inherit Board's open problem: a completed
task can't be sent back. Attaching the Inspection to the Attempt's review state reuses the
send-back path that already exists. The verdict is advisory unless the Lead granted the
Inspector Accept for that Task.

## Consequences

- Anything that should appear in a Logbook must be a Constellation event first.
- Inspectors are sessions the Constellation owns, like Workers. They hold no Attempt and never
  see the worker's transcript.
- An Inspector reads text a worker wrote (the Claim, the diff, the checkout), so its Harness
  opens under the Reviewer's read-only confinement (ADR 0042, ADR 0055) with one addition: the
  verdict server. A Harness whose driver can't hold that (`capabilities.inspector`) doesn't
  start one, and the Claim goes to the Lead with the reason. Its approval requests are denied,
  never asked: nobody watches a hidden session.
- A verdict's merge is a side effect outside the event log, so a verdict and whatever could end
  its Inspection (a review, a newer Claim, a plan or state change, a lost Inspector) run one at
  a time per Constellation. The verdict checks that it is current, weighs the Claim's receipts
  and merges inside that step.
- Board's claim fencing (epoch and token) isn't needed: per-Attempt MCP tokens and the
  decider's current-Attempt check already refuse stale writes.
