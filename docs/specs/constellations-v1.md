# Constellations v1: the build spec

Use this to build Constellations v1, the feature that lets Polaris build itself: a **Lead** Agent Session maps a graph of Tasks, starts worker Agent Sessions in worktrees (on any Host), hears their Claims, merges and verifies, and gates the work.

It replaces the herdr + dagr workflow used for M2.

- **Decisions:** from the Linear map "Constellations v1" (ENG-232). Each section names its ticket, and the ticket's resolution comment holds the detail.
- **Terms:** in `CONTEXT.md` ("Constellations": Constellation, Lead, Task, Attempt, Claim, Area, Gate, Future, Subagent). Use them exactly.
- **UI:** `DESIGN.md` "Constellation (DAG)" and the Paper page "C1 · Constellation per Lead". Screenshots are in `.dagr/reports/m2/CONST-paper/` (C1–C9).
- **Research:**
  - `docs/research/herdr-dagr.md`;
  - the branches `research/constellation-model`, `research/per-session-mcp` and `research/handoff-skill` (each has a doc under `docs/research/`).

## 1. Scope

- **Ownership:** a Constellation belongs to one Lead session. A Workspace can run several at once, and workers can be on other Hosts.
- **v1 does all eight:**
  1. the Lead authors the graph;
  2. the Lead starts workers (Harness/Model per Task, a worktree, a brief);
  3. Polaris tracks liveness and outcome mechanically;
  4. a live Constellation tab;
  5. workers hand results back;
  6. direct steering, reported to the Lead;
  7. Gates with evidence;
  8. send-back as a linked Attempt (including from Review).
- **Merging:** merging and running the checks stays the Lead's job (git and shell). Polaris records the evidence.
- **No terminal panes:** you peek into a worker through the UI focus swap.
- **Out of scope:** dagr `run.json` export; Constellations spanning several repositories; mobile; token and usage budgets; dagr's predicted loop Futures.

## 2. Model and events (ENG-235, ENG-236)

**Shape:**
- Graph data is folded from append-only events, with **one pure decider** over the whole graph, as `apps/daemon/src/engine/session.ts` and `checkout.ts` do (ADR 0006).
- A small XState machine covers only the Constellation's own lifecycle: **planning → running ⇄ paused → completed → archived**. Only decided states: "completed" is declared by the Lead or the user, and offered when all Tasks are done.
- Task state, Gate fan-in, "blocked" and "all done" are **projections**, never stored.

**Storage:** one stream per Constellation, `constellation:<id>`, in the Daemon's event store. It's committed, acknowledged and resumed like session streams, and served on the same feeds. An Attempt references its worker session; sessions don't reference back.

**Events:**

| Group | Events |
|---|---|
| Lifecycle | `ConstellationStarted`, `ConstellationStateChanged`, `LeadChanged { from, to, summary }` |
| Tasks | `TaskDeclared`, `TaskEdited`, `TaskCanceled` (deps, Area, brief, criteria, kind task/gate, suggested Harness/Model), `TaskProposed` (by an Attempt) → `ProposalAccepted` / `ProposalDeclined` |
| Attempts | `AttemptStarted { cause: initial · sent_back · merge_conflict(base) · recover · followup · superseded, by, ref, sessionId, worktree, branch, base }`; `AttemptProgressed`; `AttemptClaimed` (the Claim, below); `AttemptAccepted { mergedHead, receipts, evidence }`; `AttemptRejected` (send-back); `AttemptSettled { lost · settled_unverified · failed }` |
| Gates | `GatePromoted` (emitted by the decider when every dep is accepted; never asserted by a caller) |
| Delivery | `NotificationQueued` → `LeadNotified { items, turnId }`; `OperatorMessageSent { id, authority, target }` / `OperatorMessageResolved { id }`; `PeerMessage { from, to, text }` |

**Settling:**
- A **Claim** puts the Attempt in **review**. The Lead or the user then **accepts** it (done) or **sends it back**: the Attempt is rejected and a new Attempt opens with `cause: sent_back`.
- **Mechanical settles skip review:** `lost`, `settled_unverified`, `failed` (Harness failure).
- **Gates count only accepted Attempts.**

**The Claim carries a structured report:**
- branch, head SHA, commits;
- checks run, as receipts;
- what isn't done, and follow-ups;
- questions for the user;
- files touched outside its Area;
- decisions made;
- a prose summary.

On accept, the merged head must match the claimed head.

**Evidence tiers:**
- **verified:** a receipt that points at a Daemon-recorded tool-call item (command, exit code, output) in any session, including the Lead's own Gate Attempt;
- **reported:** a text-only receipt;
- **asserted:** a Claim with no receipts.

**Rules:**
- **Cancel:** rejected while other Tasks depend on the Task (name them).
- **Briefs:** a brief edited on a working Attempt is offered to its worker as a steer.
- **Revisions:** commands name the Task or Attempt revision they act on. The decider serializes each stream and rejects commands on a non-latest or settled Attempt, with the current state in the rejection.
- **Session reuse:** a worker session carries **at most one active Attempt**, but may take Attempts on several Tasks over its life.
- **Areas:** a Task may declare an Area (path globs). Overlapping working Areas warn the Lead. A merge conflict is a send-back with `cause: merge_conflict(base)`.

## 3. Tools, commands and skills (ENG-233, ENG-237)

**Commands first:**
- Constellation commands are new `DaemonRpcs`, used directly by the UI.
- MCP tools are thin adapters over them.
- A caller's role comes from the session its MCP binding belongs to, never from an argument.

**Lead tools:**

| Tool | What it does |
|---|---|
| `plan` | A batch of add, edit and cancel ops and deps, validated as a whole and applied all or nothing. |
| `dispatch` | Starts every ready Task, or the ones named. A worker is new (Host, worktree) or an existing idle session. |
| `review` | Accept (merged head plus receipts), send back (reason; same or fresh session; `merge_conflict(base)`) or stop. |
| `answer` | Answers proposals and questions. |
| `message` | A steer to one worker, or a note to all. |
| `status` | A readable text outline: graph, states, Claims to review, questions, what's ready. JSON on request. |
| `set_state` | Pause, resume, complete or hand over. |

No polling or wait tool: updates arrive as Lead Turns.

**Worker tools:**

| Tool | What it does |
|---|---|
| `progress` | A note and an optional n/total; shown in the UI only. |
| `ask` | A question to the Lead or the user. |
| `block` | Pause a working Attempt with `{on: TaskId[], reason}`. Use it when independent work is exhausted; `ask` requests a decision or answer. Empty `on` waits for the Lead. |
| `claim` | The structured report. Rejected with uncommitted changes or a head that isn't on the Attempt's branch, saying what to fix. |
| `propose` | Suggests a new Task. |
| `message` | A message to a peer in the same Constellation. |
| `status` | The read-only outline. |

The assignment arrives with the brief, so there's no `get_assignment`.

**Inputs and results** (per Vercel's "second wave of MCP"):
- Inputs are friendly: the Lead's own short Task ids (A1, G1), worker names, Host and model names.
- Every result is a short summary ending with "what's next", plus the current revision.
- Revisions are required only on review, cancel and edit.
- **Errors:** MCP `isError` with **findings** `{ code, message, fix }` (stable codes such as `E-DEP-CYCLE`) plus the relevant graph slice. A batch reports every finding at once.

**Transport:**
- **Codex:** one **streamable-HTTP MCP endpoint per Host** on `127.0.0.1`. Each session gets an unguessable token URL (`…/mcp/<token>`) in that thread's `config` (`mcp_servers.*`). The token identifies session and role. Requests are stateless, with no idle connection and no process per session. Tokens are stored hashed, survive restarts, and are revoked when the Attempt ends or the session is archived.
- **Claude:** an in-process `createSdkMcpServer` with `strictMcpConfig: true` and `allowedTools: ["mcp__polaris__*"]`.
- **Idle cost:** the `idle` benchmark must show a Constellation with idle workers costs nothing.

**Skills:**
- Delivered through instruction fields (Codex `developerInstructions` on `thread/start`; Claude `systemPrompt` append), **never files in the repository**.
- Two variants, Lead and worker, generated from one source and versioned with the Daemon.
- Their example loops come from the real M2 transcripts.
- Repo-specific rules stay in the repository's own `AGENTS.md`.

**Skill content:**
- **Lead:**
  - map coarse and refine;
  - use Areas;
  - dispatch in parallel;
  - don't poll;
  - review Claims against their head;
  - merge, run the checks and accept with receipts;
  - send back with a reason or `merge_conflict`;
  - keep briefs self-contained;
  - hand user questions up.
- **Worker:**
  - read the assignment;
  - stay in the Area or say why;
  - ask instead of guessing;
  - commit on the branch;
  - claim with the full report;
  - message peers, never keystrokes;
  - take leases with `polaris lease`.

**Eval:** a scripted run where a Lead plans and dispatches a small Constellation on the bench Harness, counting tool calls and errors.

## 4. A worker's life (ENG-238)

**Worktree:**
- `dispatch` creates `<repo>.worktrees/<constellation>/<taskId>` on `polaris/<constellation>/<taskId>-<slug>`. The prefix is a Constellation setting.
- It's made from a base the Lead picks (default: the Lead's current branch head), or the Lead names an existing worktree or branch.
- Send-backs keep the worktree. It's removed after the merging Gate is accepted, or on archive, and never while it holds unmerged changes.

**Cross-Host git:**
- **Default:** **git bundles carried by the Desktop App** over its SSH connections: the base goes out, and the claimed branch comes back. Pushing through `origin` under the prefix is a per-Constellation option.
- **App offline:** the Claim waits in "review · branch not yet fetched".

**Harness/Model/Effort precedence:**
1. the Lead's `dispatch`;
2. the Task's suggestion;
3. the Constellation defaults (prefilled: backend on Codex · GPT-6.1-Sol · high, UI and design on Claude Code · Opus 5.5);
4. the user's default.

The user can override in the UI. Workers use the user's default Harness permissions.

**Brief:**
- The first Turn is a Polaris header (Task, Area, branch and base, the accepted Claims of its deps, how to claim) followed by the Lead's brief.
- The session is titled `<taskId> · <title>` and grouped under its Lead in the sidebar.

**Ending without a Claim:**
- **Blocked:** `WorkerBlock` emits `AttemptBlocked` and a `Blocked` Lead notification. Only working Attempts may block (`E-BLOCK-STATE`); targets must exist, differ from this Task and not be canceled (`E-BLOCK-TARGET`), and nonempty targets must include unaccepted work (`E-BLOCK-SATISFIED`). A blocked Task projects `blocked`, with unaccepted targets in `blockedBy`.
- **Resume:** acceptance of every named Task delivers its merged heads and starts a worker Turn with `AttemptUnblocked(cause: Accepted)` in the same local commit. A Lead message does the same with cause `Lead`. Durable pending inputs are re-derived on restart; remote delivery uses its existing durable receipt handshake. Unblock clears `blockedOn`, `blockedReason`, and `blockedAt`. SendBack and Stop remain available. No polling or timers detect acceptance.
- **Silent end:** one automatic nudge ("Your Attempt isn't claimed: claim it, ask for a decision or answer, or call block with the Tasks and reason you are waiting on"). Blocked Attempts skip this nudge. If it ends silently again, a `Stopped` notification reaches the Lead digest and it becomes attention ("A3 stopped without claiming").
- **User interrupt:** stays working (paused).
- **Harness failure:** failed.

**Send-back:**
- **Same session:** a new Turn with the reason and any Review feedback.
- **Fresh session:** the same worktree, with the original brief, the rejected Claim and the reason.

**Liveness, from session events (never the LLM):**
- the current tool or command and how long it's been running ("bun run bench · 4m", "waiting on bench (held by B2)");
- the last output time;
- context %;
- queued input.

## 5. What reaches the Lead, steering, attention (ENG-241)

**What reaches the Lead:** only settles and "needs an answer", in a compact **digest** Turn: one line per item, ending with "Next:", with the revision in the header. Details come from `status` or the Claim.

**Coalescing:** an idle Lead waits **20 s** for Claims and **5 s** for a blocking question. Both are settings.

**When the Lead can't take a Turn:**
- **Mid-Turn:** queued for the boundary.
- **In terminal:** queued, with "N updates waiting for the Lead", delivered on take-back.
- **Blocked:** queued, with the approval in Needs you.
- **Harness down:** attention.
- **Paused:** never woken; a count is shown.

Nothing is dropped. There's no wake budget in v1.

**Steering:** the user's focus-swap composer steers a worker directly. It's journaled, and the Lead sees "You told A3: …" in its next digest. A steer doesn't wake the Lead by itself.

**Authority:** the row menu's "Message the Lead about this" offers **Ask for a recommendation** (`recommend_and_return`) or **Let it decide** (`may_decide_and_continue`). The plain composer is ordinary conversation.

**Routing:**
- `ask(to: user)` goes to Needs you; the answer goes straight to the worker, and the Lead gets a digest line.
- `ask(to: lead)` goes into the digest.
- **Only the user approves worker approvals.** The Lead isn't woken; its `status` shows "A2 waiting on your approval · 6m".

**Needs you, in priority order:**
1. a worker blocked on an approval;
2. a question to the user;
3. the Lead blocked or asking;
4. a worker that stopped without claiming;
5. a worker or Host gone stale;
6. a worker at ≥ 85% context (Send back fresh / Ask it to compact);
7. the Lead near its context limit (Hand over).

The Constellation header shows the top item. Area overlaps and Claims awaiting review stay in the Constellation tab, unless the Constellation is paused.

## 6. Handover (ENG-234, ENG-239)

**Trigger:** only the user or the Lead (`set_state(hand_over)`), offered at ≥ 85% context. A Harness compaction isn't a handover.

**The new Lead:** a fresh session in the same Workspace and checkout, on the same Harness/Model by default.

**What it receives (its first Turn):**
- a header built from the event log:
  - the `status` outline;
  - Claims awaiting review;
  - open questions;
  - queued digest items;
  - every message in transit, explicitly carried over;
  - settings;
- the old Lead's prose summary, from one "write your handover" Turn. The prompt is adapted from mattpocock/skills `/handoff` (MIT, pinned `d28dfdc39b`; attribution applies). If that Turn fails, the header alone continues the work.

**The switch:**
- an atomic `LeadChanged`, with the old Lead's tokens revoked;
- workers untouched, and queued items moved to the new Lead;
- a handover waits for the old Lead's Turn to end; "Hand over now" interrupts it;
- the old Lead is archived read-only, with no tools.

**Record:** a handover row with "Summary ›" (C9).

## 7. Recovery and Review (ENG-243)

**Ownership across Hosts:**
- The stream lives on the **Lead's Host**, and only that Daemon commits Constellation events.
- A remote worker's tools run on **its own Host's Daemon**, which validates locally (role, branch state) and writes to a **durable outbox**.
- The **Desktop App relays** outboxes and decisions, alongside the bundles. Entries are idempotent by id. A same-Host Constellation needs no relay.
- This keeps "Daemons only talk to Clients". **Write an ADR.**

**Restart or upgrade:**
- re-fold the stream;
- re-derive and send queued notifications once, with coalescing restarting from zero;
- Codex tokens survive (stored hashed); Claude's in-process tools are rebuilt on resume.

**An interrupted worker Turn:** a delegated Attempt is auto-continued **once** ("The Daemon restarted; continue your Task"), journaled with cause `recover`. A second interruption becomes attention. **Amend ADR 0004:** standalone sessions keep "only the user continues".

**Stale and lost:**
- **Stale:** the worker's Host is Offline (the existing Connection State rule). Stale never settles by itself.
- **Lost:** only through `review` → stop. A fresh Attempt can then go on another Host, from the last bundled commit.

**Lead failures:**
- **Lead's Host down:** nothing decides; outboxes fill and show "waiting for the Lead's Host".
- **Lead's Harness crashed:** attention, with Continue the Lead or Hand over (header-only).

**Review of a worker session** (instead of the normal session Accept):
- **Approve:** records the user's verdict; the Attempt becomes accepted only when the Lead merges it.
- **Send to @worker.**
- **"Accept and merge myself"** (menu): merges into the Lead's branch, accepts with that head and notifies the Lead.

## 8. Resources (ENG-244)

**Leases:**
- **Host-scoped**, held in a Host stream (`ResourceLeased` / `ResourceReleased`).
- Declared by the Lead in `plan` or by the user in Settings → Hosts, with a name and a capacity (default 1).
- **Taking one:** `polaris lease <name> -- <command>` holds the lease exactly as long as the command runs, so release is tied to the process. Repo scripts such as `bun run bench` may take it themselves under Polaris.
- **Fairness:** a FIFO queue per resource. A hold past its limit (default 30 min) warns and offers **Release**; it's never killed.

**Workers per Host:**
- A cap on **working** workers, about one per 3 cores (Mac Studio 4, devbox 2, Pi 1), editable in Settings → Hosts.
- **Over the cap:** "waiting for a slot on devbox", started automatically when a slot frees, or the Lead moves the Attempt.

## 9. Telemetry (ENG-245)

**Derived, not collected:** metrics are derived from existing streams and Usage, with nothing new recorded and no idle cost. They're computed when viewed and cached per revision.

**Metrics:**
- **Lead:** wakeups, tokens and cost per digest, and the coalescing hit rate;
- **Review:** time from Claim to review, the share of Claims accepted first time, and send-backs by cause;
- **Workers:** time working, idle, waiting for a slot, waiting on a lease, and stale;
- **Cost:** tokens and cost per Task and per role, plus wall-clock duration.

**Where they appear:**
- a "Stats" popover in the Constellation header;
- a completion summary card;
- **By Constellation** in Usage;
- `polaris constellation stats <id> --json`.

Local-only. App-wide OpenTelemetry is a separate effort (ENG-246).

## 10. UI (ENG-242)

Follow Paper "C1 · Constellation per Lead" and `DESIGN.md`. User decisions:
- **Accepted colour:** a yellower green, so it isn't confused with Codex mint.
- **Working glyphs:** the Harness hue. Starlight stays rare.
- **Claim review:** the Lead reviews by default. Every Claim row has Accept / Send back in its menu, promoted to buttons only when the Constellation is paused or the Lead hands the Claim up.
- **Cards:** briefs and Lead digests get their own Polaris-authored card, not the user prompt bubble.
- **States:** empty (C7), 128 Tasks (C8) and the handover summary (C9) are drawn. Densities and the rest come from preview scenes.

## 11. Spec properties (Quint, `packages/spec`)

**From the events ticket:**
- the graph is acyclic;
- causes point backward;
- Task state follows its latest Attempt;
- a Gate is promoted only when every dep is accepted, and promoted once;
- one Lead at a time (handover is atomic);
- never two active Attempts on one session;
- every settle and question is delivered to the Lead exactly once, across restarts;
- no command changes a settled Attempt.

**From recovery:**
- an outbox entry is applied exactly once, across app disconnects;
- only the owning Daemon commits Constellation events;
- an interrupted worker Turn is auto-continued at most once per interruption;
- a stale Attempt never settles without a command;
- no delivery to an old Lead after a handover.

**From resources:**
- never more holders than a resource's capacity;
- a FIFO waiter is eventually granted.

**Tests:** model-based tests check the real decider against a reference fold, and trace validation replays real logs (`packages/spec/README.md`).
