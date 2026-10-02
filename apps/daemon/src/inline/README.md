# Inline proposals

`inline.propose` is an ephemeral, cancellable stream through Codex or Claude Code.
Its contract is `packages/protocol/src/inline.ts`; Clients negotiate `inline.propose`.
The request names a registered Workspace, a file, the exact buffer (including
unsaved edits), half-open UTF-16 selection offsets, prompt, Harness, Model and effort.

`Delta` carries provisional Harness text. `Proposed` carries the sole final patch,
with ordered, non-overlapping replacement ranges confined to the selection and a
summary of at most 500 characters. Empty replacements are valid for questions.
Offsets cannot split a UTF-16 surrogate pair. `InlineError` is the RPC error channel.
`thoughtMs` measures elapsed request work; the Client formats it as “Thought for Ns”.

The Client applies an accepted proposal to its unchanged buffer as one undoable
edit, then saves through the ordinary file API. This module never writes that file,
creates a durable Agent Session, or commits events. It validates the real file path
against the Workspace, including symlinks. The implementation loads only on the first proposal request, and adds no idle
timer or watcher.

Codex uses a private app-server process, an ephemeral thread, schema-constrained
output and a verified read-only sandbox with network access disabled. Shell,
external MCP servers, plugins, web search and subagent tools are disabled. Requests
for tool execution or approvals are refused. Cancellation interrupts the Turn
and closes the process. Claude Code uses `-p`, `--json-schema`, streamed JSON,
restricted mode, only the `Read` tool, no MCP servers, no session persistence,
and disabled user/project hooks. Cancellation kills and reaps the print process.
Sign-in remains with the Harness; Polaris reads no provider credentials.

“Open as agent session” uses the existing `dispatch(StartSession)` command with
a Client-chosen SessionId, Workspace and picker values. Pass
`inlineSessionPrompt(request, patch)` as its prompt to preserve the selection and
proposal as source text. For a source pill, stage the selection as a text attachment
with `attachments.stage` (the new SessionId can be chosen before staging), then
include that AttachmentId in `StartSession.attachments`. The normal Engine decides
and persists the session.
There is no extra conversion RPC and no hidden durable proposal state to recover.

With `POLARIS_BENCH_HARNESS=1`, the stream uses `benchInline` instead of a vendor
process. `bench:{"patch":{...},"delayMs":100}` scripts output and cancellation.
Focused checks: `bun test apps/daemon/src/inline packages/protocol/src/inline.test.ts`.
They use fake Harnesses, temporary files and sockets, and an in-memory event store.

The adapters target the current bundled Codex app-server contract and Claude Code
CLI flags. Unsupported versions fail rather than retrying with weaker permissions.
Real authenticated Harness behavior is deliberately not exercised by these tests.
