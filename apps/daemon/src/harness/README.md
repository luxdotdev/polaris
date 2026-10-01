# Harnesses

One driver per Harness (`claude/`, `codex/`, `opencode/`, `acp/`, and `bench/` for benchmarks), each implementing `HarnessDriver.ts`; `registry.ts` loads them on first use. Each driver's README has its design and its event mapping.

## `harness.commands`: Skills and Slash Commands

`CommandLists.ts` answers `harness.commands` (`{ harness, cwd, refresh }`) through each driver's `listCommands(cwd)`. Every entry says how it runs (`run`):

- `text`: the Turn carries `/name args` (or `$name` for a Codex Skill, or a Codex prompt's `template`) and the Harness reads it.
- `harness`: the Turn carries it, and the driver turns it into the Harness's own call (Codex `/compact`, `/review`).
- `polaris`: the Client does `action` itself (`new-session`, `model`, `diff`, `usage`) and sends nothing.
- Commands only a Harness's terminal UI can run are not listed.

| Harness | Source | Cost |
|---|---|---|
| Claude Code | SDK `supportedCommands()` from a `claude` started in `cwd` with no prompt, classified against a table checked with 2.1.286 | ~0.75–0.9 s |
| Codex | app-server `skills/list` for `cwd`, `$CODEX_HOME/prompts`, and five built-ins | ~0.7 s |
| OpenCode | its server's `GET /command` for `cwd` | one request (plus the server's start if none runs) |
| ACP (Gemini, Copilot) | the latest `available_commands_update` a session in `cwd` sent | none |

Answers are cached per Harness and directory. **Nothing runs at idle**: no timers or watchers. An answer older than 60 s is served as is and read again in the background, once; `refresh` reads again before answering; concurrent askers share one listing, and a failed listing is never cached.
