# Co-author trailers

ENG-941: a Teammate whose Turn, or a Comment sent in a Turn, contributed to a commit gets
`Co-authored-by: <name> <commitEmail>`. Watching earns nothing. No git hooks are installed
(they would fight the repository's `core.hooksPath`).

| File | What |
|---|---|
| `trailers.ts` | Who contributed to some Turns (each Turn's sender, then its carried Comments' authors, once per person), the trailer lines (one per email, case-insensitively; none without an email), adding the missing ones to a message, and the agent's note. |
| `identities.ts` | `CommitIdentities`: a Teammate's name and commit email, from the Share they acted through (ended Shares too). The default knows no Shares; `identitiesFromShares` builds one from the Share store. |
| `session.ts` | `sessionTrailers`: the trailers for a session's Turns, reading each Turn's sender from its `TurnStarted` event. Reads nothing while the Host has never had a Share. |

Where the trailers go:

- **The agent's commits.** Each Turn of a session with contributors gets a note naming the current
  trailers after its prompt, in the Harness's input only (`engine/supervisor.ts`); the recorded
  prompt is unchanged.
- **Accept's commits** (`accept/AcceptRpcs.ts`): each commit gets the trailers of the Turns it holds
  that its message lacks. The draft's commit body and pull request text get them too.
- **A Constellation Accept's merge commit** (`constellation/merge.ts`): the worker session's
  trailers. A fast-forward makes no commit, so the worker's own commits carry them.

A solo session has no Teammate contributions, so nothing changes for it.
