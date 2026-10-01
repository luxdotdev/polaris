# GitHub client (main process)

The Desktop App calls GitHub itself; the Daemon never sees a GitHub token (ENG-185). Decisions: ENG-219 (research, `docs/research/github-review-apis.md`), ENG-226 (the OAuth App, client id `Ov23lix8h2ldBZFwXqek`), ENG-228 (merge/close cleanup), ENG-229 (review requests).

## Modules

| File | What |
|---|---|
| `index.ts` | The `GitHub` service and its layer: everything below wired together, the poll loop forked in its scope. |
| `ipc.ts` | The `github.*` requests and feeds behind the typed bridge (inputs in `shared/githubContract.ts`, views in `shared/github.ts`). |
| `electron.ts` | `safeStorage` (async API) as the keychain, endpoints from the environment, window focus → poll rate. The only file that imports Electron. |
| `transport.ts` | One HTTP call (REST, GraphQL, OAuth): statuses → tagged errors, `x-ratelimit-*` → the budget, bodies decoded with Effect Schema. |
| `credentials.ts`, `client.ts` | Access tokens per account. Refreshed 30 minutes before the 8-hour expiry and after a 401, serialized per account (each refresh rotates both tokens), the new pair written before use. A failed refresh signs the account out. |
| `store.ts` | `<userData>/github/accounts.json` (logins, order, owner and Workspace routing; nothing secret) and `tokens/<id>.bin`, one sealed record per account, keyed by GitHub's numeric user id. |
| `accounts.ts`, `deviceFlow.ts` | The device flow (`repo read:org`), several accounts, order, removal, routing preferences. |
| `routing.ts` | Repository → account: the Workspace's override, the owner's mapping, then the first account whose `viewerPermission` isn't null. An org repository nobody sees is `blocked`, with the request-access and SSO links; it is checked again after 30 minutes or on `github.recheck`, never on every poll. |
| `pulls.ts`, `poller.ts`, `budget.ts` | The PR list. Every minute while a window is focused (five otherwise): an ETag'd `GET /repos/{o}/{r}/pulls` per watched repository (a 304 is free), then three GraphQL searches per account (review requested, mine, other open in its repositories) only when one changed, or every ten minutes for requests elsewhere. Background polling stops at 25% of each hourly limit, or when under 10% remains for anyone. |
| `reviews.ts`, `views.ts` | A pull request's files (with `viewerViewedState`) and threads (current, outdated or file anchors), the pending review (found or created by the first comment, `threads` with `line`/`side`/`startLine`/`startSide` or `subjectType: FILE`), replies, resolve, edit, submit (Approve / Request changes / Comment), discard, Viewed marks. Mutations are serialized per account a second apart; Viewed toggles collapse to the latest wish. |
| `checkouts.ts` | Review Checkouts' pull requests, one `nodes` query per account per poll: open, merged or closed, and the head. |
| `create.ts` | Opens a pull request as the routed account (an accepted Agent Session's work). |

## The renderer's surface

Requests: `github.signIn.start|cancel`, `github.accounts.remove|reorder`, `github.routing.setOwner|setWorkspace`, `github.watch` (every Workspace's remotes), `github.refresh`, `github.recheck`, `github.pull.detail|create`, `github.review.addThread|reply|resolve|editComment|submit|discard`, `github.files.setViewed`, `github.checkouts.watch`. Feeds: `github.accounts`, `github.pulls`, `github.checkouts`. `parseGitHubRemote` and `parsePullUrl` ("Review PR by URL") are pure helpers in `shared/github.ts`.

Who acts on what it reports: the renderer's `features/pulls` sends `github.watch` from every git Workspace's remotes and shows `github.pulls` (rows carry `additions`/`deletions` for the Changes lane) as the PR list and Needs You's Reviews group; `notifications/reviews.ts` in main follows `pulls` and `accounts` directly for one notification per new entry in `requested`; whoever owns Review Checkouts removes one when `github.checkouts` says merged or closed (a closed one can reopen, so removal may wait).

## Testing

`*.test.ts` here run the real service on the in-process fake (`scripts/lib/githubFake`, see its README) with a TestClock and an in-memory keychain (`github.testing.ts`). The smoke (`scripts/lib/githubFlow.ts`) serves the fake on 127.0.0.1 and points the app at it with `POLARIS_GITHUB_WEB_URL` / `POLARIS_GITHUB_API_URL`, launched with `--use-mock-keychain`. Nothing here touches the real GitHub.
