---
status: accepted
implements: the Review queue's Reviewed group (owner ask, 2026-10-13)
---

# A reviewed pull request is placed from GitHub's record, bridged by this Mac

The owner wants a pull request to leave Review requested once they submit a
review, sit in a Reviewed group (closed by default, at the bottom), and come
back when new commits land. Polaris then opens the next pull request of the
same group, or a done pane when it was the last.

## GitHub's record is the truth

"Reviewed at this commit" is already on GitHub: the viewer's latest submitted
review and its commit. The PR search asks for it on every row
(`reviews(last: 1, author: $login, states: [APPROVED, CHANGES_REQUESTED,
COMMENTED])`), so it survives restarts, other Macs and reviews submitted on
github.com, and costs no extra request. The Daemon never sees GitHub
(ENG-185), so nothing here touches commands, events or the spec.

A fourth search per account, `reviewed-by:@me -author:@me
-review-requested:@me`, finds reviewed pull requests outside watched
repositories (GitHub drops the request once you review, so they would vanish).
It runs on the same cadence as the other three (only when a watched
repository changed, or every ten minutes), so an idle app sends nothing new.

## This Mac bridges the gap

GitHub's search index lags a review by seconds to a minute, and the list may
not search again for ten minutes. So a submit records `{ commit, submittedAt }`
from the mutation's answer in `localStorage` (with a snapshot of the row) and
forces one poll. A row only counts as fresh once GitHub's own record is at
least as new as this Mac's; until then it stays in Reviewed. A pull request no
list has yet is shown from the snapshot for 15 minutes.

## Back to Review requested

A fresh row returns when its head differs from the reviewed commit ("3 new
commits", from `github.pull.compare`, asked once per pair), or when GitHub asks
the viewer by name again (`reviewRequests`, read live). A team's request
doesn't count: a member's review may leave it standing, which would pin the
pull request in Review requested.

## Left for later

The PR list, Needs You's Reviews group, the top bar's count and review-request
notifications still follow GitHub's review-requested search; only the queue
places by review. Any open pull request the viewer once reviewed comes back on
new commits, however old the review.
