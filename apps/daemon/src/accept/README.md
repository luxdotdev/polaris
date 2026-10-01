# Accepting an Agent Session's work

ENG-224: the user accepts a session's Turns through one, and the work ends in a commit, a push and a pull request. The Daemon commits and pushes (it has the repository and the Host's git credentials); the Desktop App opens the pull request as the routed GitHub account and links it with `LinkPullRequest`.

| File | What |
|---|---|
| `AcceptRpcs.ts` | `session.acceptPlan`, `session.draftAccept`, `session.commitAccepted`, `session.pushAccepted` (capability `session.accept`). Committing is refused until the Turns are accepted, while a Turn is in flight, or when they're already committed. |
| `turns.ts` | The Turns an accept works on: all of the session's from the store, those not yet committed through the one named, and their checkpoint commits. |
| `commit.ts` | Commits each Turn's own change (before- to after-checkpoint) through a scratch index built from HEAD, with the user's `git commit` (identity, signing, hooks). File by file: a three-way patch keeps the user's own uncommitted edits out; a file it can't apply to (HEAD doesn't have it, or the edits overlap) is taken whole as the Turn left it. The working tree is never touched. A new branch is created from HEAD and checked out in place (`symbolic-ref`), and removed again if committing fails before the first commit. Committed Turns get `refs/polaris/committed/<session>/<turn>`. |
| `branch.ts` | The current branch, the push remote (the branch's, else `origin`, else the only one), the default branch (`refs/remotes/<remote>/HEAD`, else `main`/`master`), branch-name checks and diff stats. |
| `push.ts` | `git push -u` with the Host's credentials, never prompting. |
| `draft.ts` | The commit message and pull request text: the session's Harness answers JSON in one Turn of a fresh native session (its prompts and replies as a Fork's preamble, plus the diff stat; approvals are denied), 90 s at most; otherwise a template from the Turns' prompts, with a note saying why. |
| `revert.ts`, `reactor.ts` | `AcceptTurns` with `revertLaterTurns`: files the later Turns changed go back to the accepted Turn's after-checkpoint, then `TurnsReverted`. |

The bench Harness answers the draft prompt (`../harness/bench/accept.ts`), so the smoke runs the Harness's path without tokens.
