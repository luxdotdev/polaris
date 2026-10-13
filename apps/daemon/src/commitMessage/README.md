# Commit messages

`commit.suggestMessage` drafts a message for what the Commit box would commit: the
index. Its contract is `packages/protocol/src/commitMessage.ts`; Clients negotiate
`commit.suggest-message`. The request names the directory `git.commit` commits in
(`cwd`), a Harness (`claude` or `codex`), Model and effort.

The Daemon reads the staged diff itself on the Host, so it works the same for
remote Hosts. It refuses `not-a-repository` and `nothing-staged` before any Harness
runs. The diff is read up to `DIFF_BUDGET` bytes, then git is killed; the prompt
then says how many files were cut or left out, and `Suggested.truncated` is true.
`git diff --cached --stat` always names every file. Up to 15 recent subjects
(no merges) are the style examples; an unborn branch has none.

`Delta` carries provisional Harness text. `Suggested` carries the sole final
`{subject, body}`, tidied: one subject line, no trailing period, a trimmed body.
The Client puts `commitMessageText(message)` into the Commit box as one undoable edit.
Nothing here writes the index, HEAD, files or events, so the spec doesn't cover it.

It reuses the inline proposal runners (`../inline/claude.ts`, `../inline/codex.ts`):
Claude Code `-p` with `--tools ""` (the diff is in the prompt) and the same
isolation flags; Codex app-server with an ephemeral, read-only thread and
`outputSchema`. Cancellation kills the process; a Harness that runs past
`SUGGEST_TIMEOUT` fails `timed-out`.

Errors the UI acts on come from the Host's Harness availability: `harness-missing`
(not installed or too old) and `needs-sign-in`. A cached refusal is probed once
more before it's returned, and a Harness failure is re-probed to tell a sign-out
from any other `harness-failed`.

With `POLARIS_BENCH_HARNESS=1`, `benchMessage` replaces the vendor process: it
answers `Update <first staged file>`, or follows a `model` of
`bench:{"message":{...},"delayMs":100,"fail":"why"}`.
Focused checks: `bun test apps/daemon/src/commitMessage packages/protocol/src/commitMessage.test.ts`.
