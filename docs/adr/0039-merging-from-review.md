---
status: accepted
implements: reviewer requests and merging in Review (owner ask, 2026-10-13)
---

# Merging from Review: GitHub decides, Polaris cleans up only what it made

The owner wants to ask for reviews and merge from the pull request header,
for pull requests they reviewed and for their own, and to have the branch
deleted afterwards.

## GitHub decides whether it can merge

Merge is offered from one GraphQL read (`PullActions`): the viewer's
permission, the allowed methods and the viewer's default, `mergeable` and
`mergeStateStatus`, the review decision, the head commit's checks, and
auto-merge. Polaris doesn't evaluate branch rules itself. It names a block
when GitHub's answer allows it (draft, conflicts, behind, failing or running
checks, changes requested, approval required) and says "branch rule" when
GitHub says only `BLOCKED`. Failing checks block only when GitHub blocks;
otherwise the popover says "not required".

Without write access the button is hidden, not dimmed. The merge itself
re-reads that state and refuses when the head moved (`expectedHeadOid`), so a
merge never takes commits the reviewer didn't see.

## The head branch is deleted by Polaris, after the merge

The merge mutation can't delete the branch, so Polaris deletes it over REST
once GitHub has merged. It skips the delete when:

- the branch is the base repository's default branch, or the fork's;
- a branch rule protects it (one REST read, only when nothing else already
  keeps it);
- it lives in a fork the account can't write to;
- it is already gone;
- the repository deletes it itself (`deleteBranchOnMerge`).

The toast offers "Restore branch", which recreates the ref at the merged
head.

## Local cleanup goes through the Daemon's existing commands

Polaris cleans up only what it made, with commands that already exist, so the
Daemon, the protocol and the spec are unchanged:

- **The Review Checkout**: `RemoveReviewCheckout` with reason `merged`. The
  Daemon still refuses a checkout with edits or local commits.
- **The accepted Agent Session that opened the pull request**:
  `ArchiveSession`. It removes only the worktree that session created and
  deletes the branch only if git sees it merged, so a squash or rebase merge
  keeps it. The checkbox says so and that it can't be undone.

Branches and worktrees the user made outside Polaris are never offered.
Auto-merge runs no follow-ups. The checkout watch already removes a merged
pull request's checkout on the next poll, and the session is archived when
`github.checkouts` reports the merge.

## Remembered per account on this Mac

The follow-up checkboxes and the method last used in each repository are kept
in `localStorage`, per GitHub login. Archiving is asked each time. A merged
pull request leaves the queue at once: this Mac hides it until GitHub's lists
drop it. The queue then moves on as it does after a review, from any group,
Mine and Reviewed included.
