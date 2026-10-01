# Constellation contract

Public exports are available from `@polaris/protocol` and this module's `index.ts`.
The contract implements `docs/specs/constellations-v1.md` §§2–3, 7–8. The graph
is folded on the Lead's Host; these schemas do not implement its decider.

| File | Contract |
| --- | --- |
| `domain.ts` | IDs, revisions, Constellation lifecycle, Task definitions, Attempts and linked causes, full Claims, receipt references, questions, projections, settings and Host resources |
| `commands.ts` | Atomic plan operations, worker placement, review/answer/state actions and the internal tagged command union |
| `events.ts` | Constellation and Host resource event field sets, codecs and the remote worker outbox entry |
| `rpc.ts` | `ConstellationRpcs`, typed results/refusals and resumable Constellation stream |

## Commands

`DaemonRpcs` includes `ConstellationRpcs`. Mutations take `commandId` (idempotency)
and `constellationId`. RPC payloads have no `_tag`; the internal
`ConstellationCommand.cases.*.make` constructors add it. A caller's role is
resolved from its authenticated session binding; no command accepts a role.
Desktop App authorization is checked by the Daemon, not asserted in a payload.

- `constellation.plan`: `start?` initializes an absent graph with name,
  Workspace, Lead and settings; `operations` is an atomic Add/Edit/Cancel batch;
  `resources` declares Host-scoped resources. Edit carries a full replacement
  definition and its previous revision. Cancel carries the current Task revision.
- `constellation.dispatch`: named `tasks` pair short Task IDs with placements;
  empty means every ready Task, using `defaultWorker` and graph defaults.
  `New` carries Host, optional Harness/Model/effort, base and optional existing
  worktree/branch; `Existing` names an idle session. Gates use the Lead's session.
- `constellation.review`: Attempt ID, current **Attempt revision**, and Accept,
  SendBack or Stop. Accept supplies merged head and receipts; the decider checks
  it against the claimed head and resolves every verified reference. SendBack
  chooses same/existing or new session; `mergeConflictBase` selects that cause.
- `constellation.answer`: a proposal verdict or an answer to a durable question.
- `constellation.message`: a worker, the Lead or all workers, with optional
  authority (`conversation` by default). Only the user may confer decision authority.
- `constellation.set_state`: Pause, Resume, Complete, Archive or HandOver.
- `constellation.worker.{claim,ask,progress,propose,message}`: the current Attempt
  ID and operation data. No revision is required; the binding must belong to its
  latest active Attempt. Peer messages name the recipient Task's short ID.
- `constellation.status`: the shared read-only outline; `json` requests the
  folded Constellation and its Task projections in addition to the text.

Every success has `summary`, `next`, current graph `revision`, and its last event
`sequence` (null for a read/no-op). MCP adapters append `next` to the summary.
`ConstellationRejected` carries every `{code,message,fix}` finding, the current
revision, and the relevant `graph` slice (null when the graph does not exist).
MCP adapters turn it into `isError`; codes are open strings (`E-DEP-CYCLE`,
`E-REVISION`, `E-SETTLED`, `E-CLAIM-DIRTY`, `E-CLAIM-HEAD`, `E-AUTHORITY`, etc.).

## Events and projections

All tags in `ConstellationEvent` and `ResourceEvent` are also `DomainEvent` tags,
so `EventEnvelope` is the persisted and Host-feed codec. A Constellation stream
uses `StreamKey.cases.constellation` and `constellation.subscribe`, with the
usual Snapshot → Synchronized → live Event/resume sequence. Events carry the
new graph `revision`; Attempt changes also carry the new `attemptRevision`;
Task cancellation/promotion carries `taskRevision`. Declaration/edit embeds
`task`; start embeds `attempt`, including its cause, worker, Host, branch and base.
A `ConstellationStarted` embeds the initial graph. Revision allocation and
atomic multi-event decisions belong to the owner Daemon's decider.

`Task` stores its definition, revision and cancellation marker. Task state,
blocked dependencies, latest Attempt, Gate promotion, stale Host and fetched
branch are `TaskProjection` values. A Claim changes an Attempt to review; only
acceptance changes it to accepted. Mechanical settle outcomes skip review.
Only the decider emits `GatePromoted`. Causes use tagged constructors (Initial,
SentBack, MergeConflict, Recover, Followup, Superseded); every linked cause's
`ref` must point backward in the same Task's Attempt history.

A verified receipt contains a `ToolCallReference` to Host/session/Turn/item;
it does not copy caller-supplied command output as proof. The owner resolves
that persisted item and checks its command, exit code and output. Reported
receipts carry text and optional command/exit code. A Claim with no receipts is
asserted; the decider assigns the acceptance's evidence tier.

Questions are persisted in `NotificationQueued` items (including Claim questions).
Their answers use `OperatorMessageSent.questionId` and a QuestionAnswered digest
item; resolution is journaled with `OperatorMessageResolved`. Notification IDs
are retained through restart/handover; `LeadNotified.items` lists the IDs consumed
by the one recorded digest Turn. The delivery journal must be atomic with that
Turn, not just an in-memory acknowledgement.

`AttemptRecoveryContinued` journals the automatic Continue with cause `recover`,
its Turn and durable interruption ID. It does not create a second active Attempt.
Recovery consumes this marker so another restart cannot repeat that Continue;
a second interrupted worker Turn becomes attention (ADR 0004 amendment).

## Hosts and compatibility

`ConstellationOutboxEntry` accepts only worker commands. Its stable `id` is the
owner's idempotency key on relay. The worker Host validates binding/git state;
the Lead's Host revalidates the current graph before committing. Entries wait
when the Desktop App or owner is unavailable; remote Daemons do not communicate
directly. Apply/ack decisions are relayed back by the Desktop App.

Resource declarations, queued requests, grants and releases are Host events.
The lease `id` is its queued `requestId`; grants must consume the FIFO head and
respect the declared capacity. The command process owns the hold; exit or an
explicit user Release records `ResourceReleased`, never an automatic kill.

New Host snapshot fields are optional, and existing events/sessions gain no
required fields. Clients announce `constellation` and/or `host.resources` to
receive the respective new event tags; an older Client cannot decode new union
variants, so capability filtering is mandatory. Existing session/Workspace/SQL
reducers explicitly leave graph/resource events alone. The engine slice will
add the graph's own fold, persistence/resume and handlers; the current transport
returns `E-UNAVAILABLE` until those handlers are mounted.
