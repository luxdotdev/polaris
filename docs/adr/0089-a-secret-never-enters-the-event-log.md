---
status: accepted
---

# A secret never enters the event log

## Context

An agent mid-Turn sometimes needs a value only the user has, such as an auth key. Asking in chat
puts it in the model's context, the provider's logs and the transcript. T3 Code solves this with a
Secret Request (`pingdotgg/t3code@da8cc59`, MIT): a `request_secret` tool, a masked card, and an
owner-only file the agent's commands read.

Polaris's approvals already carry user answers, but `ApprovalResolved.decision` (with
`Answer.text`) is committed to `state.sqlite` forever and replayed to every Client. A secret sent
as an `Answer` would live on disk and in every feed.

## Decision

**A Secret Request is an approval of kind `"secret"`; its value travels on its own RPC and only a
valueless `Provided` decision is committed.**

- **Request.** A `request_secret` tool joins `notify` in the Polaris MCP tools every Claude and
  Codex session gets (not read-only sessions). Input: `label`, `reason`, optional `placeholder`,
  `timeoutMs` (default 10 min, at most 1 h), and `delivery` (only `"file"` for now; the field leaves
  room for refs Polaris's own tools resolve). It commits `ApprovalRequested` with kind `"secret"`,
  so Needs You, pushes, first-Client-wins and recovery come with it. The call blocks until an
  answer or the timeout; its description tells the agent to do the work that doesn't need the
  secret first.
- **Answer.** The Client sends `secret.provide{sessionId, requestId, value}` with the value as
  `Schema.Redacted`, like `voice.setKey` (ADR 0079). The Daemon writes the file, then commits
  `ApprovalResolved` with `Provided`, which has no value. Decline is the ordinary `Deny`.
- **Delivery.** The file is `~/.polaris/secrets/sessions/<session>/<random>`, `<session>` being
  the session id's bytes in hex so a Client-chosen id can't name a path outside the store: directory 0700,
  file 0600, written to a temp file and renamed. The tool returns its path and never the value. It
  is readable any number of times by that Agent Session's later Turns; a Fork asks again.
- **Lifetime.** Fixed 24 h, or until the Agent Session is archived or removed. One timer per live
  secret plus a sweep at startup: no polling, so an idle Daemon with no secrets never wakes.
- **Timeout, Stop, restart.** A timed-out request is withdrawn (`ApprovalWithdrawn`), the session
  returns to Working and the tool returns `timed_out`. The agent carries on with what it can and
  ends its Turn if it is blocked. Stop and restart withdraw it as for any approval. A value arriving
  after withdrawal is rejected and discarded.
- **Redaction.** Before an item is committed or streamed, the Daemon replaces the exact value of
  every live secret on the Host with `[secret]`; any agent running as the Daemon's user could
  read another session's file. Approval text and Turn errors are redacted too; a streamed delta
  only when the whole secret falls inside it, since the completed item is redacted in full.
- **Clients.** The Desktop App and Mobile App answer. Extensions skip the kind. A push names only
  the label and opens the card; it has no quick action.

## Consequences

- The approvals spec gains the `Provided` decision and a timeout withdrawal; `polaris.qnt`, its
  README mapping and the model-based tests change with it.
- The value is plaintext on the Host's disk for up to 24 h. Any process running as the Daemon's
  user can read it; "this agent's commands" is a convention, not a sandbox.
- The Harness keeps its own transcript; if the agent prints the file, Polaris can't redact that
  copy.
- Codex's MCP `tool_timeout_sec` for the Polaris server must exceed the 1 h maximum.
- The Live Activity's Needs You takeover can't offer Approve and Deny for a secret; it opens the
  card instead.

## Considered options

- **Reuse `Answer`.** Rejected: the value would be committed and replayed.
- **A separate Secret Request concept** with its own events and states. Rejected: it repeats
  every approval mechanism.
- **Environment variable.** Rejected: the environment is fixed when the Harness opens, and it
  leaks into every child process.
- **Return the value from the tool.** Rejected: it puts the secret in the model's context.
