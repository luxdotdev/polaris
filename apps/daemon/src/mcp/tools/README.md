# Constellation tools

`index.ts` builds a role-bound catalog over the owning Daemon's `Constellations.command/status/resolve`. `mcp/tools.ts` is H's stable import facade. The adapter fills authenticated session, Constellation and worker Attempt identities; caller-supplied identity or authority fields fail input validation. E reauthorizes the current role under its commit lock. No adapter decides graph changes, probes Git, provisions workers, grants approvals or schedules timers.

Lead catalog: `plan`, `dispatch`, `review`, `answer`, `message`, `status`, `set_state`, `read_worker`. Worker catalog: `block`, `progress`, `ask`, `claim`, `propose`, `message`, `status`. Every catalog ends with `wait_for_command`, `notify` and the history tools `sessions`, `search_history` and `read_history`. A Gate runs in the Lead's Agent Session with a Worker attachment for its Gate Attempt; the Lead attachment still provides review and orchestration tools.

Use short Task ids in plan, dispatch, review and messages. Review and Lead messages also accept worker session names; resolution stays within the current graph's Attempts. Review needs the latest **Attempt revision**; plan edit/cancel need the **Task revision**. A result's **Revision** is the graph revision. Worker placement is exactly one of `{ "host": "local", "selection": { "harness": "codex", "model": "Sol" } }` for new work or `{ "session": "helper" }` for an existing session. Dispatch and send-back share this schema. New placement also accepts optional base, branch and worktree. HandOver resolves model names in selection.

```json
{
  "task": "A1",
  "revision": 1,
  "action": {
    "_tag": "SendBack",
    "reason": "Add archive cleanup and its regression test",
    "worker": { "session": "accept" },
    "mergeConflictBase": null
  }
}
```

`review` also exposes Accept, Stop and HandUp. Accept requires the exact claimed mergedHead and receipts, and merges that head into the Lead's branch unless it is already there. HandUp requests the user's Claim review; Approve is deliberately absent from the Lead schema. E keeps questions addressed to the user and approval authority with the user.

```json
{
  "action": {
    "_tag": "Question",
    "task": "A1",
    "questionId": "base",
    "text": "Use the current main head"
  }
}
```

Proposal answers use proposalId, accept and reason. Worker messages use the peer's short Task id. `status` returns the readable graph outline, Claims, questions and readiness; `json: true` also returns graph/projections in the text. Other successes return a short mutation summary. Every result ends in `Next: …` after `Revision: …`.

Session tools (`session.ts`, over `../sessions/`) read Agent Sessions rather than the graph. `read_worker {task, turns?, since?}` is Lead-only (cross-session reading stays with the Lead): it resolves a Task id or worker name to its Attempt's session and returns that session's latest Turns as compact text (prompts, replies, commands with output tails, file changes), at most 16k characters, newest Turn kept first; `since` pages back from a Turn number. It reads workers on the Lead's Host only; a remote worker is `E-NOT-HERE`. `wait_for_command {task?, timeoutSeconds?}` holds the call until the session's background commands (or the one named) leave its `backgroundTasks`, woken by the session's own commits, and returns each one's exit and output tail, or what still runs after the timeout (at most 50s, under Codex's 60s MCP tool timeout). `notify {title, body?, requestId?}` records `SessionNotified` (capability `session.notify`), which the Desktop App shows as a banner and the Daemon pushes to Linked Devices (`../../push/`); keyed like the mutating tools, and at most one per session every 30 seconds (`E-RATE`). Polaris records its own (`automatic`) when a Constellation needs the user (`../../constellation/attention.ts`); an agent's `notify` within 30 seconds of one about its session, or of an approval or question it opened, is folded into it (`Collapsed`) rather than sent twice. It never changes Session State. The history tools (`history.ts`, over `../sessions/history.ts`) are on every binding and read every session on this Host, so an agent recovers what compaction dropped and draws on past sessions without reading Harness logs. `search_history {query, scope?, session?, limit?}` matches Turns whose prompt, reply, steer, command and output, tool call, file change or plan holds every word of `query` (case-insensitive, no regex, so a pattern can't stall the Daemon), newest first, and returns at most 50 one-line snippets with their Turn numbers; it reads at most 2,000 Turns and says when it stopped. Earlier `search_history`/`read_history` calls aren't searched, since they echo their own matches. `scope` is `session` (the caller's, or the one `session` names), `workspace` or `host`. `read_history {session?, turns?, since?}` renders like `read_worker`; `sessions {scope?, query?, limit?}` lists sessions newest first. A session is named by id, a unique id prefix of at least 6 characters, or its exact title. `mcpHttp` attaches the Daemon's session tools to the commands it serves, so Claude's in-process catalog over the same commands gets them too.

Every tool but `status`, `read_worker`, `wait_for_command` and the history tools takes an optional `requestId`, so a retried call never acts twice (`idempotency.ts`). With a key, the command id is a hash of the session, tool, key and input, and the store's command receipts deduplicate it for good, across Daemon restarts. Without one, an identical call from the same session within five minutes of one that wasn't rejected reuses that call's id (a Harness retrying after a timeout); the same input later, or after a rejection, acts again. A duplicate returns the current result.

Errors set MCP `isError: true`. Text includes every `{code, message, fix}` and the next action. MCP `structuredContent` retains `{ findings, graph, revision }`, including E's relevant graph slice and all findings from an atomic batch. Local input failures enrich that slice from authorized status when available; unavailable/revoked bindings retain revision 0 and no graph. The same envelope travels over stateless HTTP and Claude's in-process SDK server.

`eval.test.ts` exercises the real Constellations service, SQLite store, Session decider, H startup/attachments, token revocation and bench Harness. It plans three worker Tasks plus a dependent Gate, dispatches the workers, records their scripted command output, sends one Claim back, merges and accepts the replacements, then runs and accepts the Gate in the Lead's session. It reads a worker with read_worker once its first Turn ran, and records 24 tool calls and four intentional errors (early Gate, dirty Claim, stale review, revoked tools). The fixture provisions scratch Git repositories and prepared Attempts through E's runtime boundary. The bench's command output is scripted evidence, not a vendor model or a real `bun test` execution; the eval measures tool behavior and ordering, not autonomous model performance. No real Host, GitHub, SSH or user home is involved.
