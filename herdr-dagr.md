# herdr-dagr: DAG model and how it learns agent state

Research for [ENG-169](https://linear.app/luxdev/issue/ENG-169). Researched 2026-09-27.

**Question.** What is herdr-dagr's data model (run file contract: projects, tasks, attempts, gates, evidence, policies, events, operator messages)? How does it learn about agent progress (who writes the run file, polling or events)? Could Claude Code or Codex hooks feed an equivalent model natively, without a terminal? What is its licence?

**Sources.** Primary only:
- herdr-dagr source at `github.com/aemrebarut/herdr-dagr`, HEAD `52991f9` (2026-08-22, v0.3.1), cloned to `scratchpad/src/herdr-dagr`. The locally installed plugin at `~/.config/herdr/plugins/github/herdr-dagr-bd0ed2fe5515` is `c0f8b33` (2026-08-21), one day older.
- herdr source at `github.com/herdrdev/herdr`, HEAD `21d71a0` (2026-09-27).
- Official Claude Code and Codex hook docs, linked inline.

Unless a claim names another file, file paths below are relative to the herdr-dagr repo.

## TL;DR

- **dagr only reads the run file. Something else writes it.** dagr is a "representation kernel, not an enforcement kernel". It never writes run state; "the producer … owns authority and settlement" (`CONTRACT.md` §Design stance, `README.md` "How it works").
- **The producer is an LLM agent following a skill.** The shipped `dagr-producer` skill tells the orchestrator agent to write the whole JSON document to `run.json.tmp`, validate it with `dagr check --strict --json`, then atomically `mv` it over `run.json` (`skills/dagr-producer/SKILL.md` "The loop"). Nothing in dagr records progress mechanically: no hooks, no scraping, no daemon (`CONTRACT.md` §Non-goals).
- **The data model is Run → Projects (recursive) → Tasks → Attempts, plus an append-only event log.** The central idea is the **Task/Attempt split**. A retry appends a new Attempt with a typed `cause` and never rewrites an old one. Task state is a checked *projection* over its latest Attempt.
- **Every terminal outcome carries an evidence tier**: `verified`, `reported`, `heuristic` or `asserted`. When nobody claimed completion, the outcome is a separate terminal state, `settled_unverified`, not a soft `done` (`CONTRACT.md` §4).
- **The pane learns about changes by polling.** It checks the mtime of `run.json` (plus `actions.json` and `messages.jsonl`) about every 300 ms and re-reads on change (`src/view.rs` `event_loop`). A separate thread holds a herdr socket `events.subscribe` connection, but only for **liveness hints**: whether a pane is alive and herdr's idle/working/blocked label. Those hints never become task state (`src/herdr.rs` module doc).
- **Operator steering flows back as text.** The `m` composer appends to `messages.jsonl` (mode 0600), then calls herdr's `agent.prompt` to queue the message into the orchestrator's terminal. The orchestrator later appends a `message_resolved` event carrying the `message_id` (`CONTRACT.md` §9; `src/message.rs`; `src/herdr.rs` `prompt`).
- **Hooks could feed an equivalent model without a terminal, but only for the *Attempt/liveness* layer.** Both Harnesses expose `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `SubagentStart/Stop`, `Stop` and `SessionEnd`. Claude Code also has `TaskCreated`/`TaskCompleted` and HTTP hooks. **Claude Code's `Stop` does not fire on user interrupt; Codex has an `Interrupt` hook.** The *Task/DAG/gate/evidence* layer is planning intent, and no hook emits it. dagr gets it from the orchestrating agent.
- **herdr itself stopped trusting hooks for Claude Code and Codex state.** Since herdr 0.6.7 those integrations "report session identity only. Native state for those agents comes from Herdr's screen detection" (herdr `CHANGELOG.md` line 591). The current Claude integration installs only a `SessionStart` hook and *removes* the old `PreToolUse`/`Stop`/`PermissionRequest`/… state hooks (herdr `src/integration/claude_settings.rs`). This is direct evidence that hook-only lifecycle tracking has gaps (interrupts, cancelled permission prompts).
- **Licence: `MIT OR Apache-2.0`, dual, at your option** (`Cargo.toml`, `LICENSE-MIT`, `LICENSE-APACHE`, `README.md` §License). herdr itself is Apache-2.0 (herdr `LICENSE`). Polaris can freely adopt the contract's shape, or even vendor code, with attribution.
- **For Polaris:** adopt dagr's *concepts* (Attempt-with-cause, evidence tiers, liveness triple, append-only events, authority-tagged operator messages). Do not adopt its *transport* (a whole JSON file rewritten by an LLM and mtime-polled). Polaris's Daemon owns the Harness process, so it can build the Attempt/liveness layer mechanically from structured streams (Codex app-server notifications, Claude Agent SDK hooks/stream) and keep the LLM-authored layer to the plan: Tasks, deps, gates.

## The data model (contract v3)

The source of truth is `CONTRACT.md` ("Schema v3 — field reference"), enforced by `src/check.rs`. The run file is a single JSON document. v1 and v2 files remain readable; producers write `"dagr": 3`. Unknown fields are ignored for forward compatibility (`CONTRACT.md` Schema v3).

**Top level** (`CONTRACT.md` Schema v3):
- `dagr`: version, `1|2|3`.
- `run {id*, title, started_at, orchestrator {pane, agent}}`. `orchestrator` is where operator messages are delivered.
- `generated_at`: the staleness anchor for every "Nm ago" in the view. A missing value is W100.
- `projects[]`, `tasks[]*`, `events[]`.
- Legacy `actions`: inert in v3 (§10).

| Entity | Fields | Semantics |
|---|---|---|
| **Project** | `id*`, `title*`, `parent`, `owner`, `note` | A recursive *visual* scope; the run is the implicit root. Phases and workstreams are just nested projects. Containment is orthogonal to dependency: a task has one `project` home, and cross-project deps render as `⇠` edges rather than duplicate tasks (§0). |
| **Task** | `id*`, `title*`, `kind*` (open set: `impl/review/test/gate/question/docs/ship/…`), `owner`, `project`, `state*`, `deps[]`, `inputs[]` (gates), `unblock`, `note`, `criteria`, `policy`, `attempts[]` | The stable work item. `state` ∈ `queued · working · review · blocked · done · failed · rejected · canceled · settled_unverified`, and is a **projection over attempts** checked by E150. For example, `working` needs a working attempt and `done` needs the latest attempt `done` (§1 table). Readiness (`waits X` / `ready` / `unassigned` / `needs answer`) is *derived*, never authored (§3). |
| **Attempt** | `id*` (`T·aN`), `n*`, `cause {type, by, ref, reason}`, `actor`, `model`, `locator {pane, agent}`, `state*`, `started_at`/`ended_at`, `outcome`, `progress {done,total,note}`, `liveness`, `chain_key` | One try at a task. `state` ∈ `queued · working · done · failed · rejected · settled_unverified · lost`. `cause.type` ∈ `initial · sent_back · gate_failed · followup · superseded`, and must reference an *earlier* attempt (E135/E136). `locator` is a volatile runtime address (a herdr pane id), never identity (§Design stance, §2). |
| **Outcome / evidence** | `result` (= state), `evidence` ∈ `verified · reported · heuristic · asserted`, `receipt`, `reason` | Required on terminal attempts (E140/E141). `verified` = mechanical receipt, such as a test run or commit provenance. `reported` = a typed result envelope from the actor. `heuristic` = inferred, e.g. screen-classified. `asserted` = bare claim. "Pane survival and herdr's `done` … are **never** success evidence" (§4). |
| **Liveness** | `prompt_acknowledged` (bool), `last_output_at` (ts), `queued_input` (count) | Per live attempt, first-class and not derived (§6). Each field exists because of a stall seen in real sessions: a 35-minute prompt-delivery failure, and five unsent composer lines. W208 fires when a working attempt has no liveness. |
| **Gate** | A task with `kind: "gate"`; fan-in = `deps`, or `inputs` when it differs | A milestone, not a lane child. Its placement is its `project`, or else the nearest common ancestor project of its inputs (§3, E108). |
| **Promotion** | A `promoted` event | "Promotion is an event, not an inference": the producer emits it when a fan-in completes (§3). |
| **Policy** | `rounds_max`, `gate_cmd[]` (inert metadata; dagr never executes it), `futures[] {on: pass/fail, streak, ref XOR node{id,title,actor,model,attribution}, after, loop_back, source}` | Declared *future* work, rendered dotted and only for working/blocked tasks. This is the one block producers edit in place ("current intent, not history"). When a future materializes, the node is removed and a real attempt is appended (§5; `skills/dagr-producer/SKILL.md` "Materialize a future"). |
| **Event** | `at*`, `type*` ∈ `attempt_started · attempt_settled · promoted · directive · message_resolved · note`, `task`, `attempt`, `actor`, `verb` (`reject/unblock/answer/rule`), `by`, `detail`, `message_id`, `source_messages[]` | Append-only, ascending time (W207). Directives form the human decision log (§7, §8). |
| **Operator message** | `messages.jsonl` beside the run: `message id`, run, task, document revision, starter, authority (`recommend` / `decide`), exact text, destination, then a delivery record | Written by dagr, not by the producer. The orchestrator links back with a `message_resolved` event that carries `message_id` (§9). `actions.json` optionally customizes the prompt starters (at most 9). |

**Bounds:** 16 MiB file size, at most 4,096 combined project/task/attempt/future items, at most 32,768 events (`CONTRACT.md` "Admission and display bounds").

**Validation:** `dagr check` reports E-codes (errors, exit 1) and W-codes (warnings; failures under `--strict`). Exit 2 means the file was unreadable. The codes cover cycles over `deps ∪ inputs` (E122), projection contradictions (E150), dangling causes and refs, and bad timestamps (`CONTRACT.md` "dagr check — findings"; `skills/dagr-producer/SKILL.md` "The loop").

A worked, strict-clean example set lives in `skills/dagr-producer/examples/01…08`. `demos/selfrun/run.json` is dagr's own overnight build, recorded as a run by an agent onboarded only with the skill.

## Event flow: who writes what, and how dagr learns

```
orchestrator agent (LLM, in a herdr pane, following dagr-producer skill)
   │ writes whole doc → run.json.tmp → `dagr check --strict --json` → mv run.json
   ▼
run.json ──(mtime poll ~300 ms)──► dagr view (TUI pane) ◄──(events.subscribe)── herdr socket
                                       │                      pane_created/closed/exited,
                                       │                      pane.agent_status_changed
                                       │ `m` composer          (liveness overlay ONLY)
                                       ├─► messages.jsonl (append, 0600)
                                       └─► herdr `agent.prompt` → orchestrator's input queue
orchestrator ──(appends message_resolved{message_id} event)──► run.json
```

1. **Writer.** A single writer, the "producer", is typically the orchestrating agent. The skill makes it the "single writer of a run file" and requires the write → check → atomic-rename transaction, so the pane never sees a half-written or invalid file (`skills/dagr-producer/SKILL.md` intro and "The loop"). Discovery order is `$DAGR_RUN`, then `.dagr/run.json`, then `run.json` (same file, "Where to write it").
2. **Reader: polling.** `event_loop` in `src/view.rs` polls terminal input with a 300 ms timeout. Each loop iteration stats `run.json`, `actions.json` and `messages.jsonl` and reloads on an mtime change. `CONTRACT.md` §Transport says: "A single JSON document read from a path; watch = mtime poll or producer-touched signal file."
3. **herdr link: events, but hints only.** `src/herdr.rs` speaks herdr's socket API (newline-delimited JSON over `$HERDR_SOCKET_PATH`, protocol 19). It calls `session.snapshot` and holds one `events.subscribe` connection for `pane.created/closed/exited/agent_detected`, plus per-locator `pane.agent_status_changed`. The resulting `Hints` map pane_id → `idle|working|blocked|done|unknown`. It is used only to annotate locators (e.g. a dead-pane mark) and for Enter-to-focus (`pane.focus` / `agent.focus`). "Task state NEVER comes from here" (`src/herdr.rs` lines 1–9).
4. **Where herdr's status comes from.** herdr classifies agent state from the terminal: "Agent state detection via terminal tail pattern matching. Each pane's live bottom-of-buffer text is read periodically and matched against known agent output patterns" (herdr `src/detect/mod.rs` line 1). For Claude Code and Codex, the hook integration now reports only session identity (herdr `CHANGELOG.md` 0.6.7, line 591). herdr's `src/integration/assets/claude/herdr-agent-state.sh` exits unless `hook_event_name == "SessionStart"`, then sends `pane_id`, `agent_session_id` and `transcript_path` over the socket.
5. **Liveness fields in the contract are producer-written.** `prompt_acknowledged`, `last_output_at` and `queued_input` are written by the producer; herdr's event stream is only "a cache-invalidation signal for these hints, not a work log" (`CONTRACT.md` §6). In practice the orchestrator agent must keep `last_output_at` fresh itself (skill invariant 6).
6. **Back-channel.** Pressing Enter in the composer first appends the immutable message record, then calls herdr `agent.prompt {target, text}`. On non-Unix platforms it runs the `herdr agent prompt` CLI instead. Finally it appends a `message_delivered` record, or a failure record (`src/message.rs` `deliver_with`; `src/herdr.rs` `prompt`). The envelope the orchestrator receives is plain text headed `[DAGR OPERATOR MESSAGE]` with `message_id`, `run`, `revision`, `target`, `starter` and `authority` lines (`skills/dagr-producer/SKILL.md` "Handle an operator message"). "Dagr enqueues one addressed Herdr message and stops; it has no scheduler, daemon, supervisor…" (`CONTRACT.md` §9).

**Consequence.** The quality of the graph depends entirely on the orchestrating LLM's diligence. The skill says: "Missing or wrong facts still produce a missing or wrong graph; there is no workflow engine to repair it" (`skills/dagr-producer/SKILL.md` intro). Every update rewrites the full document, which costs tokens, and the bounds above cap it at 16 MiB.

## Hook-feeding feasibility per Harness

What an equivalent model needs, and whether a hook can supply it without a terminal:

| Model element | Claude Code hooks | Codex hooks | Notes |
|---|---|---|---|
| Attempt start (session/turn) | `SessionStart` (`source`: startup/resume/clear/compact/fork), `UserPromptSubmit` | `SessionStart`, `UserPromptSubmit` (+ `turn_id`) | Both expose `session_id`, `transcript_path`, `cwd` ([CC common fields](https://code.claude.com/docs/en/hooks#common-input-fields); [Codex common fields](https://developers.openai.com/codex/hooks#common-input-fields)) |
| `working` + `last_output_at` | `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PostToolBatch`, `MessageDisplay` | `PreToolUse`, `PostToolUse` | A heartbeat is only per tool call or message, so long pure-thinking stretches are silent |
| `blocked` (needs human) | `PermissionRequest`, `Notification` (`permission_prompt`, `idle_prompt`, `agent_needs_input`, `elicitation_dialog`…), `Elicitation` | `PermissionRequest` | [CC Notification](https://code.claude.com/docs/en/hooks#notification) |
| Turn settled | `Stop` (with `last_assistant_message`, `background_tasks`, `session_crons`), `StopFailure` (API error) | `Stop` (with `last_assistant_message`) | Both carry the final text, which is a candidate for a `reported` envelope |
| **Interrupt** | **None.** "Stop … Does not run if the stoppage occurred due to a user interrupt" ([CC Stop](https://code.claude.com/docs/en/hooks#stop)) | **`Interrupt`** runs "when you interrupt an active turn on the main thread" (not for subagents) ([Codex Interrupt](https://developers.openai.com/codex/hooks#interrupt)) | The main gap for Claude Code: an interrupted Claude session looks "working" forever to a hook-only observer |
| Sub-attempts / fan-out | `SubagentStart` / `SubagentStop` (`agent_id`, `agent_type`, `agent_transcript_path`) | `SubagentStart` / `SubagentStop` | Maps naturally to child attempts |
| Task list (plan) | `TaskCreated` / `TaskCompleted` (`task_id`, `task_subject`, `task_description`) ([CC TaskCreated](https://code.claude.com/docs/en/hooks#taskcreated)) | none equivalent | Only Claude's *internal* todo items. No deps, gates or evidence |
| Session end / lost | `SessionEnd` (`reason`) | `SessionEnd` (main thread only) | A crash or kill still needs process-level detection |
| Transport to a daemon | `command`, **`http`** (POST JSON body), `mcp_tool`, `prompt`, `agent` ([CC handler fields](https://code.claude.com/docs/en/hooks#hook-handler-fields)); `async: true` for background | `command` and `mcp_tool` only; `prompt`/`agent` "parsed but skipped" ([Codex config shape](https://developers.openai.com/codex/hooks#config-shape)); `async` supported | Codex needs a tiny command shim (e.g. `curl`/socket) to reach a daemon |
| Enablement | Settings files / plugins | On by default; `[features] hooks = false` disables; non-managed hooks must be reviewed and trusted ([Codex](https://developers.openai.com/codex/hooks#turn-hooks-off)) | Project-local Codex hooks load only in trusted projects |

**Verdict.**
- **Yes for the Attempt and liveness layer:** start, working heartbeat, blocked, settled, subagents, end. No terminal is needed, because hooks receive JSON on stdin or as an HTTP body, and Claude Code hooks fire in `-p` mode too (async hooks are killed at `-p` teardown, per [CC async hooks](https://code.claude.com/docs/en/hooks#run-hooks-in-the-background)).
- **Caveats:**
  - Claude Code has no interrupt hook.
  - Heartbeat granularity is per tool call.
  - herdr, which has the most field experience here, *dropped* hook-derived state for both Claude Code and Codex in favour of screen detection plus PTY activity. Its reasons, in its changelog, are gaps in interrupt and permission-cancel coverage and stale `working` reports (herdr `CHANGELOG.md` lines 591, 708, 735, 746; line 497 for Devin: "hooks do not cover every permission cancellation and user interrupt transition").
- **No for the Task/DAG layer.** Deps, gates, criteria, policies and evidence grading are the orchestrator's plan, and no hook reports them. dagr gets them from the LLM writing JSON. An equivalent in Polaris needs either the orchestrating agent to write it (via a tool or MCP rather than a file) or Polaris-owned planning.
- **Better than hooks, for a GUI that owns the process:** structured protocol streams. Codex's app-server speaks JSON-RPC with `thread/started`, `turn/started`, `item/started`, `item/completed`, `turn/completed` and `turn/interrupt` ([Codex App Server](https://developers.openai.com/codex/app-server)). Its `turn/completed` "with final status when the model finishes or after a `turn/interrupt` cancellation" closes the interrupt gap. Claude's Agent SDK exposes the same hook events as in-process callbacks ([Agent SDK hooks](https://code.claude.com/docs/en/agent-sdk/hooks#available-hooks)). This is noted as a lead; it is not assessed in depth here.

## Licence and reuse assessment

- herdr-dagr: `license = "MIT OR Apache-2.0"` (`Cargo.toml`). `LICENSE-MIT` reads "Copyright (c) 2026 the herdr-dagr contributors", and `LICENSE-APACHE` is included. Contributions are dual-licensed by default (`README.md` §License). Authorship is effectively a single developer (git log: "Emre" 21 commits, "aemrebarut" 8; 29 commits total). `publish = false`, so the crate is not on crates.io.
- herdr: Apache-2.0 (herdr `LICENSE`).
- **Reuse options for Polaris:**
  - (a) *Copy the contract's concepts.* Schema ideas are not copyrightable in any practical sense, and the licence is permissive anyway.
  - (b) *Vendor or port `src/model.rs` / `src/check.rs`* (Rust, serde-only deps) as a validator for a Polaris-native run model. Allowed with notice retention.
  - (c) *Emit dagr-compatible `run.json`* from the Polaris Daemon so a user's existing `dagr view` pane works as a secondary viewer. This is cheap interop, but ties Polaris to the herdr locator shape (`{pane: "wX:pN"}`).
- The TUI renderer (crossterm) is not reusable in GPUI. Its *visual grammar* is a useful reference for an Orchestrator graph view: `git log --graph` rows, `↩` re-entry, dotted futures, `N→1 ⋈` joins, evidence glyphs `◆◇≈!`.

## Implications for Polaris's Agent Session model

(Glossary per `CONTEXT.md` in the polaris repo: Harness, Agent Session, Daemon, Orchestrator.)

1. **Agent Session ≈ dagr Attempt, not Task.** An Agent Session is "one conversation with one Harness on one Host". That is exactly an Attempt: it has an actor, a model, a volatile locator, start and end times, liveness and an outcome. dagr's lesson is to keep a stable **work item** above it, so a retry, send-back or fresh session becomes a *new* Agent Session linked by a typed `cause` instead of mutating history. Polaris has no word for the work item yet; the map should decide whether it needs one ("Task"). Note that dagr's "run" collides with CONTEXT.md's *avoid* list for Agent Session.
2. **Split the two layers by who is authoritative.**
   - *Mechanical layer:* session start/turns/tool heartbeat/blocked/settled/interrupted/lost. The Daemon owns it and derives it from the Harness protocol stream and hooks, never from an LLM.
   - *Intent layer:* tasks, deps, gates, criteria, futures. The orchestrating agent or the user authors it. Its evidence tiers grade the *claim*.
   
   dagr has only the intent path and leans on the LLM for both layers. Polaris can do strictly better on the first.
3. **Adopt evidence tiers and `settled_unverified` verbatim.** For example, a `Stop` hook with no structured envelope yields `settled_unverified` (heuristic), not `done`. This is cheap and prevents UI over-claiming.
4. **Adopt the liveness triple as Daemon-computed fields.** `prompt_acknowledged` comes from `UserPromptSubmit` or the app-server turn start; `last_output_at` from any stream item; `queued_input` from the Client's own composer. For Claude Code, interrupt detection needs the SDK/stream path or process observation, because the hooks will not report it.
5. **Operator messages with explicit authority** (`recommend_and_return` vs `may_decide_and_continue`), journaled before delivery and correlated by id on resolution. This maps directly onto the Orchestrator's "steer" action. Polaris delivers through the Harness API (e.g. Codex `turn/steer`) instead of terminal input injection.
6. **Transport:** replace "rewrite the whole JSON file and mtime-poll it" with a Daemon-owned append-only event log plus a projection pushed to Clients. dagr's own contract already treats `events` as append-only and state as a projection, so this is a natural fit.

## Open questions

- Does Polaris need a first-class **Task/work-item** above Agent Session (dagr's Task), or is the DAG an optional overlay the orchestrating agent authors? This decides whether to model deps, gates and policies at all in v1.
- How would the orchestrating agent write intent in Polaris: an MCP tool served by the Daemon (validated per call, like `dagr check`), or a file as in dagr?
- Claude Code interrupt detection: is the Agent SDK / `stream-json` stream sufficient, or does Polaris need PTY/process observation as herdr does? (Not verified here; worth a spike.)
- Should Polaris emit a dagr-compatible `run.json` for interop with herdr users, or is that scope creep?
- The Codex app-server protocol and the Claude Agent SDK streaming shape were only skimmed. They deserve their own research ticket if Polaris drives Harnesses via those rather than a PTY.
