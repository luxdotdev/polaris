---
status: accepted (ENG-1020)
---

# Commands are annotated Daemon RPCs

## Context

Agents, a `polaris` CLI and the SDK all need to drive a Daemon: start Agent Sessions, send
Turns, read and change settings. Built by hand, three surfaces drift apart in names,
arguments and what each is allowed to do. `DaemonRpcs` already carries every operation with
an Effect Schema, and `packages/protocol/src/grants.ts` already maps each to a Grant.

## Decision

An RPC in `DaemonRpcs` becomes a **command** only when it is annotated with a name
(`session.start`), a one-line description, its Grant and examples. Everything else stays
internal. The CLI (`polaris <noun> <verb>`, its `--help`), the agent tools and the SDK docs
are generated from the annotations; a check fails on a command without a description or a
Grant.

Agents get two compact MCP tools, `sessions` and `settings`, with a verb argument, rather
than one tool per command: every tool costs context in every Turn. The rest is reachable
through the CLI from Bash.

## Considered options

- A separate command catalogue beside `DaemonRpcs`: a second schema to keep in step.
- Every RPC exposed: internal plumbing in agents' context, and no place for descriptions.

## Consequences

- A new command is an annotation, not new code in three places.
- Renaming a command is a breaking CLI change; names are chosen once.
