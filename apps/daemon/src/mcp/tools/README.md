# Constellation tools

`index.ts` builds a role-bound catalog over the owning Daemon's `Constellations.command/status/resolve`. `mcp/tools.ts` is H's stable import facade. The adapter fills authenticated session, Constellation and worker Attempt identities; caller-supplied identity or authority fields fail input validation. E reauthorizes the current role under its commit lock. No adapter decides graph changes, probes Git, provisions workers, grants approvals or schedules timers.

Lead catalog: `plan`, `dispatch`, `review`, `answer`, `message`, `status`, `set_state`. Worker catalog: `progress`, `ask`, `claim`, `propose`, `message`, `status`. A Gate runs in the Lead's Agent Session with a Worker attachment for its Gate Attempt; the Lead attachment still provides review and orchestration tools.

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

`review` also exposes Accept, Stop and HandUp. Accept requires the exact claimed mergedHead and receipts. HandUp requests the user's Claim review; Approve is deliberately absent from the Lead schema. E keeps questions addressed to the user and approval authority with the user.

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

Errors set MCP `isError: true`. Text includes every `{code, message, fix}` and the next action. MCP `structuredContent` retains `{ findings, graph, revision }`, including E's relevant graph slice and all findings from an atomic batch. Local input failures enrich that slice from authorized status when available; unavailable/revoked bindings retain revision 0 and no graph. The same envelope travels over stateless HTTP and Claude's in-process SDK server.

`eval.test.ts` exercises the real Constellations service, SQLite store, Session decider, H startup/attachments, token revocation and bench Harness. It plans three worker Tasks plus a dependent Gate, dispatches the workers, records their scripted command output, sends one Claim back, merges and accepts the replacements, then runs and accepts the Gate in the Lead's session. It records 23 tool calls and four intentional errors (early Gate, dirty Claim, stale review, revoked tools). The fixture provisions scratch Git repositories and prepared Attempts through E's runtime boundary. The bench's command output is scripted evidence, not a vendor model or a real `bun test` execution; the eval measures tool behavior and ordering, not autonomous model performance. No real Host, GitHub, SSH or user home is involved.
