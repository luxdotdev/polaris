---
status: accepted
fixes: a "finished a turn" banner could fire just before the Turn the Harness starts on a background task's report (ENG-377)
---

# Turn notifications wait out a settle

## Context

A turn notification fires when the user's Turn completes: its session Idle with no background
tasks left (`apps/desktop/src/main/notifications/turnPlan.ts`). A Turn the Harness starts when
background tasks report continues the user's Turn and must not notify on its own.

The Claude Code driver reports the last task's end before the continuation starts.
`background_tasks_changed` (the level signal) arrives as the task finishes, and becomes
`SessionBackgroundTasksChanged { tasks: [] }` while the session is Idle
(`apps/daemon/src/harness/claude/backgroundTasks.ts`). The driver only starts the
continuation (`continueOnReports` in `ClaudeDriver.ts`) when the parent model run begins: its
`requesting` status, or its first message. Reports that arrive during a Turn are also queued
for the next parent run, so a Turn can end with no tasks live and be continued right after.
For that gap the session looks settled on the Host stream. The planner fired on it: the banner
came early, before the continuation, and carried the reply from before the continuation.

The Daemon knows, at that moment, that reports are waiting for a parent run, but no event says
so. Adding one would change the wire for a gap of about a second.

## Decision

The Desktop App counts a settle only once it has held for `SETTLE_MS` (3 s) on its own clock. A
Turn that starts within that time (a continuation, or the Daemon's repair Turn for a Reviewer)
cancels it, and the next settle starts the wait again. The main process plans again when the
wait runs out (`TurnPlan.recheckInMs`), so a timer runs only while a settle is pending. The
banner then carries the reply as it stands at completion.

## Consequences

- Every turn notification arrives about 3 s after the session settles.
- A continuation that starts more than 3 s after the last task ends still gets an early banner,
  and its own completion stays quiet. A Daemon event for "reports pending" would close that gap.
- No Daemon or protocol change.
