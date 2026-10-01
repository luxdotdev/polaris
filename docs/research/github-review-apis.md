# Research: GitHub's OAuth device flow and the pull request APIs M2 needs

Linear: ENG-219 (map ENG-217). Researched 2026-10-01 against GitHub's own documentation (fetched as Markdown from `docs.github.com`) and GitHub's published GraphQL schema ([`schema.docs.graphql`](https://docs.github.com/public/fpt/schema.docs.graphql)), plus Electron's `safeStorage` docs and the Electron 44.4.5 type definitions installed in `apps/desktop`. Every claim links to its source. A few points come from third-party bug reports rather than GitHub's docs; they are marked as such.

Context, already decided: Polaris uses a **GitHub OAuth App with the device flow** (not a GitHub App, unless an organization forces it). The GitHub token lives in the **Desktop App**, kept by the macOS keychain, and the **Client calls GitHub itself**; the Daemon never sees it (ENG-185). This is separate from [ADR 0001](../adr/0001-polaris-never-touches-provider-credentials.md), which is about model provider credentials. M2 needs: a list of pull requests to review across the user's Workspaces, matched by git remote; pending reviews with line and multi-line comments, submitted as Approve / Request changes / Comment; per-file Viewed state; and knowing when a pull request is merged or closed so its Review Checkout can be cleaned up.

## TL;DR

- **Scopes: `repo read:org`.** `repo` is the only scope that reaches private repositories, and GitHub has no read-only code scope ("Currently, you can't scope source code access to read-only"). `repo` covers reading pull requests, writing reviews, comments, and Viewed state. `read:org` gives organization and team membership, which team review requests rely on. Don't request `workflow`, `notifications` (already implied by `repo` for the notifications API), `user` or `gist`.
- **Device flow:** `POST https://github.com/login/device/code` with `client_id` and `scope`, show the 8-character `user_code`, send the user to `https://github.com/login/device`, then poll `POST https://github.com/login/oauth/access_token` no faster than `interval` (5 s; a `slow_down` adds 5 s). The code lasts 15 minutes. **No client secret is needed** for the device flow or for refreshing its tokens, so none ships in the app.
- **OAuth Apps now issue expiring tokens.** "Expire user access tokens" is **on by default** for new OAuth Apps. Access tokens last 8 hours, refresh tokens 6 months; each refresh rotates both tokens and invalidates the old pair. The refresh must be single-flight in the main process. Non-expiring tokens are still revoked after a year without use.
- **Org restrictions are the main failure mode.** New organizations have OAuth app access restrictions **on by default**. A blocked app sees only the org's public data. Private repos return **404**, or a **403** saying the organization "has enabled OAuth App access restrictions" (observed by third parties). GitHub says app owners "cannot see whether their app is blocked". The user asks for approval at `https://github.com/settings/connections/applications/<client_id>` → **Request** next to the org. SAML SSO orgs also need an active SSO session at authorization time.
- **Rate limits are per user, shared with every app the user runs:** 5,000 REST requests and 5,000 GraphQL points per hour (10–15k under an Enterprise Cloud org), shared with the user's `gh`, their editor and the rest. Authorized **REST conditional requests that return `304` are free**. GraphQL is `POST` only, so it has no conditional requests. Search is limited to 30 requests per minute.
- **Pull request list:** one GraphQL `search(type: ISSUE)` per bucket, with `is:pr is:open archived:false` plus `user-review-requested:@me` / `review-requested:@me`, `author:@me`, or a set of `repo:` qualifiers built from the Workspaces' git remotes. Poll each repo cheaply with ETag'd `GET /repos/{o}/{r}/pulls?state=open`.
- **Reviews: GraphQL only.** `addPullRequestReview` (no `event` → PENDING, with `threads` for comments in one call), `addPullRequestReviewThread` (`line`/`side` plus `startLine`/`startSide` for ranges, `subjectType: FILE` for whole-file comments), `submitPullRequestReview` with `APPROVE` / `REQUEST_CHANGES` / `COMMENT`. Diff `position` is deprecated in both APIs.
- **Viewed state is GraphQL only:** `PullRequest.files { path viewerViewedState }` (`VIEWED`, `UNVIEWED`, `DISMISSED` = changed since viewed), and `markFileAsViewed` / `unmarkFileAsViewed(pullRequestId, path)`.
- **Merge and close:** `PullRequest.state` is `OPEN | CLOSED | MERGED`. Batch every Review Checkout's pull request into one `nodes(ids: [...])` query for about 1 point, or poll `GET /repos/{o}/{r}/pulls/{n}` with an ETag (free when nothing changed). Don't infer merges from local git: squash and rebase merges leave no trace in the head branch.

---

## 1. Registering the OAuth App (for "Register the Polaris GitHub OAuth App")

Source: [Creating an OAuth app](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app), [Authorizing OAuth apps](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps).

Where: GitHub → Settings → Developer settings → OAuth apps → **New OAuth App**. Register it under the organization that will own Polaris rather than a personal account if possible, so it survives a change of maintainer. "A user or organization can own up to 100 OAuth apps." Everything on the form is public, so don't put internal URLs in it.

| Field | Value | Why |
|---|---|---|
| Application name | `Polaris` | Shown on the consent page and in the user's Authorized OAuth Apps list. |
| Homepage URL | The Polaris website (or the repo URL until there is one) | Required; shown to users. |
| Application description | One line, e.g. "Review pull requests from the Polaris desktop app." | Optional; shown on the consent page. |
| Authorization callback URL | `http://127.0.0.1/callback` | The form **requires** one even though the device flow never redirects. A loopback URL is the right placeholder: it keeps open a later web flow with PKCE, where "the `redirect_uri` does not need to match the port specified in the callback URL". Use `127.0.0.1`, not `localhost`, as the docs recommend ([RFC 8252 §7.3](https://datatracker.ietf.org/doc/html/rfc8252#section-7.3)). Up to 10 callback URLs are allowed. |
| Wildcard matching on that callback | **Off** | Since 2026-08-03 wildcard matching is a per-callback setting. GitHub warns that it lets codes go to any subdomain or subpath and recommends turning it off when not needed. |
| **Enable Device Flow** | **Checked** | Without it, polling returns `device_flow_disabled`. |
| **Expire user access tokens** | **Checked** (the default) | 8-hour access tokens and 6-month refresh tokens. Leave it on; the Desktop App implements refresh from day one (§3). |
| Client secret | **Don't generate one, or keep it out of the app** | The device flow and its refresh need only `client_id`. GitHub: "Never include your app's client secret in client-side code or in code that runs on a user device." ([REST rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api#primary-rate-limit-for-oauth-apps)) |

Scopes aren't set at registration. The app requests them on each device-code call: `scope=repo read:org` (§2).

Record the **client ID** (it is not a secret and ships in the Desktop App). Users can review or revoke Polaris at `https://github.com/settings/connections/applications/<client_id>`, a link worth putting in Settings.

Optional features (Settings → Optional features) "are subject to change"; none are needed.

## 2. Minimum scopes

Source: [Scopes for OAuth apps](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps), [Authorizing OAuth apps (user side)](https://docs.github.com/en/apps/oauth-apps/using-oauth-apps/authorizing-oauth-apps).

| Need | Scope | Notes |
|---|---|---|
| Read and review **private** repositories (list PRs, read diffs, create and submit reviews, comments, Viewed state) | `repo` | "Grants full access to public and private repositories including read and write access to code…". It also lets the app manage org projects, invitations, team memberships and webhooks. There is no narrower option: "Currently, you can't scope source code access to read-only." |
| Public repositories only | `public_repo` | Not enough for M2; private work repos are the main case. |
| Organization and team membership (team review requests, listing the user's orgs to explain restrictions) | `read:org` | "Read-only access to organization membership, organization projects, and team membership." That `requestedReviewer` teams and `team-review-requested` searches need it is inferred from this description, not tested; confirm during implementation. |
| Notifications API (optional poll source, §6.4) | already covered by `repo` | The notifications endpoints "require the `notifications` or `repo` scopes" ([notifications](https://docs.github.com/en/rest/activity/notifications)). |
| Not needed | `workflow`, `user`, `gist`, `write:org`, `admin:*`, `offline_access` | Pushes from a Review Checkout use the Host's own git credentials, not this token. `offline_access` only forces expiring tokens on apps without that setting. |

Behaviour to handle:
- **Users can grant fewer scopes** than requested, and can change them later. Check the granted scopes (the `scope` field in the token response, or the `X-OAuth-Scopes` response header) and degrade or ask again.
- A token can't exceed what the user can do: scopes "do not grant any additional permission beyond that which the user already has."
- **10 tokens per user, app and scope combination**, and at most 10 created per hour. An eleventh token revokes the oldest unused one, or else the least recently used. Each Desktop App install holds one token pair per account, so this only matters for a sign-in loop. A loop past 10 per hour triggers a browser re-consent prompt.

## 3. The device flow, tokens and refresh

Source: [Authorizing OAuth apps § Device flow](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow), [§ Expiring access tokens](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#expiring-access-tokens), [§ Refreshing](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#refreshing-an-access-token-with-a-refresh-token).

1. `POST https://github.com/login/device/code` with `client_id` and `scope` (space-separated), and `Accept: application/json`. The response has `device_code` (40 characters), `user_code` (8 characters with a hyphen, e.g. `WDJB-MJHT`), `verification_uri` (`https://github.com/login/device`), `expires_in` (900) and `interval` (5).
2. Show the `user_code`, copy it to the clipboard, and open `verification_uri` in the user's browser. The user picks the GitHub account in the browser, so **the browser's signed-in account decides which account Polaris gets**.
3. Poll `POST https://github.com/login/oauth/access_token` with `client_id`, `device_code` and `grant_type=urn:ietf:params:oauth:grant-type:device_code`, no more often than `interval`. Errors:
   - `authorization_pending`: keep polling.
   - `slow_down`: +5 s; the response carries the new `interval`.
   - `expired_token`: the 15 minutes are up; start over.
   - `access_denied`: the user cancelled; the code is dead.
   - `device_flow_disabled`: the registration setting is off.
   - `incorrect_client_credentials`, `incorrect_device_code`, `unsupported_grant_type`.

   There is also "a rate limit of 50 submissions in an hour per application" for codes entered in the browser. That is per app, not per user, so it caps sign-ins across **all** Polaris users at 50 an hour; worth knowing if Polaris grows.
4. Success returns `access_token` (`gho_…`), `token_type=bearer` and `scope`. With expiring tokens it also returns `refresh_token` (`ghr_…`), `expires_in=28800` (8 h) and `refresh_token_expires_in=15897600` (about 6 months).
5. Right away, call `GET https://api.github.com/user` (or GraphQL `viewer { login id }`) to learn which account this is. GitHub: "you should use the token to revalidate the user's identity… you risk mixing user data if you do not validate the user's identity after every sign in."

**Refresh.** `POST https://github.com/login/oauth/access_token` with `client_id`, `grant_type=refresh_token` and `refresh_token`; `client_secret` is "Required unless the token was generated using the device flow". "Once you use a refresh token, that refresh token and the old access token will no longer work." The new token keeps the old scopes; scopes can't change during a refresh. An expired or invalid refresh token gives `bad_refresh_token`, and the user has to sign in again.
- *Implication:* refresh tokens are single-use. Two windows or renderers refreshing at once would lock one of them out. Keep tokens and refresh in the **main process**, behind a single in-flight promise per account. Write the new pair to storage before using it.
- Refresh ahead of time (say at 7 h 30 m, or when `expires_in` is nearly up), and also on a `401`.
- Also handle **revocation**: the user revokes the app, the token leaks into a public repo, a non-expiring token goes unused for a year, an enterprise owner revokes SSO authorizations, or the 10-token limit kicks in ([Token expiration and revocation](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/token-expiration-and-revocation)). All of them show up as `401` (`Bad credentials`) and mean "sign in again", never a retry loop.

## 4. Several accounts and storing tokens in the Desktop App

**Several accounts.** GitHub has no multi-account token. Each account goes through the device flow once and gets its own token pair. The browser's account picker decides which account is used; the web flow's `prompt=select_account` and `login=` hints don't exist for the device flow, so the UI should say "make sure you're signed in to the account you want in your browser". Key each stored pair by the account's numeric `id` from `/user` (logins can be renamed), and keep `login` and the avatar for display.

To route a repository to an account, try the accounts in the user's order and pick the first whose GraphQL `repository(owner:, name:) { viewerPermission }` is not null. Cache the choice per remote and let the user override it. Rate limits are per account (§5), so several accounts also spread the load.

**Storage.** Electron `safeStorage` ([docs](https://github.com/electron/electron/blob/main/docs/api/safe-storage.md), via Context7 `/electron/electron`; types checked in `apps/desktop/node_modules/electron/electron.d.ts`, Electron **44.4.5**):
- On macOS, "encryption keys are stored for your app in Keychain Access in a way that prevents other applications from loading them without user override", which protects against other users and other apps. Keep the encrypted blobs (one JSON per account: access token, refresh token, expiries, login, id, granted scopes) in the app's `userData` directory.
- **Use the async API.** Electron 44 has both `encryptString`/`decryptString` and `encryptStringAsync`/`decryptStringAsync`/`isAsyncEncryptionAvailable`. Current Electron docs say the synchronous API "was removed in Electron 46", and data it encrypted still decrypts with `decryptStringAsync`. `decryptStringAsync` returns `shouldReEncrypt` for key rotation; re-encrypt when it is set.
- **Code signing matters:** "Without a valid, consistent signature, macOS may not recognize different builds of your app as the same application, which can cause the Keychain to re-prompt the user for permission on every update." Unsigned dev builds will prompt.
- On Linux, if `getSelectedStorageBackend()` returns `basic_text`, items are "encrypted via hardcoded plaintext password", which is no protection. When a Linux Desktop App exists, refuse to store tokens in that case or warn the user.
- Tokens never reach the renderer or the Daemon. The renderer asks the main process over the typed IPC bridge for GitHub data, not for tokens.

## 5. Rate limits, conditional requests and GraphQL cost

Source: [Rate limits for the REST API](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api), [Rate limits and query limits for the GraphQL API](https://docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api), [Best practices for using the REST API](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api), [REST search](https://docs.github.com/en/rest/search/search).

**Primary limits, per user (not per app or install):**
- REST: 5,000 requests an hour. That bucket "is combined with any requests that another GitHub App or OAuth app makes on that user's behalf and any requests that the user makes with a personal access token". Polaris shares it with the user's `gh`, editor extensions and the rest.
- If the OAuth app is "owned or approved by a GitHub Enterprise Cloud organization" and the user is a member, the limit is 15,000 an hour. Even then, "requests made by a higher-limit app reduce the remaining budget available for lower-limit authentication methods."
- GraphQL: 5,000 points an hour per user, or 10,000 under Enterprise Cloud. It is a separate bucket from REST.
- Search: 30 requests per minute for issue and PR search (REST). A search returns at most 1,000 results and covers at most 4,000 repositories. A query may have at most 5 `AND`/`OR`/`NOT` operators and 256 characters, *not counting qualifiers*. Past 10,000 accessible repositories, a search has to be limited with `org:`/`user:`/`repo:` ([searching issues and PRs](https://docs.github.com/en/search-github/searching-on-github/searching-issues-and-pull-requests)).

**Secondary limits** (same for REST and GraphQL):
- At most 100 concurrent requests.
- 900 REST points or 2,000 GraphQL points a minute per endpoint; a `GET` is 1 point, a mutation or `POST` 5.
- 90 s of CPU time per 60 s, of which at most 60 s GraphQL.
- **80 content-creating requests a minute and 500 an hour.** Reviews and comments count.

The docs say to queue requests serially, wait at least 1 s between mutations, honour `retry-after`, and otherwise wait until `x-ratelimit-reset` (or at least a minute, then back off exponentially). "Continuing to make requests while you are rate limited may result in the banning of your integration." There is no way to see how much secondary limit remains.

**Conditional requests (the key to polling without a server):**
- "Making a conditional request does not count against your primary rate limit if a `304` response is returned and the request was made while correctly authorized." Send the saved `etag` back as `If-None-Match`, or `last-modified` as `If-Modified-Since`.
- 304s only happen if the request is identical every time ("Use the same parameters every time"), so avoid order-shifting sorts like `sort=updated` when paging. Narrower requests return 304 more often. Honour `x-poll-interval` when present.
- `GET /repos/{o}/{r}/pulls` and `GET /search/issues` both list `304 Not Modified` as a status.
- **GraphQL has no conditional requests.** It is a single `POST` endpoint, and "Conditional requests for unsafe methods, such as `POST`… are not supported unless otherwise noted."

**GraphQL cost:**
- Count every connection that might be fetched (assume each `first:` is full), divide by 100 and round; the minimum is 1. Ask for `rateLimit { cost remaining resetAt }` to measure.
- Every connection needs `first`/`last` of 1 to 100, and a call may touch at most 500,000 nodes.
- If the primary limit is exceeded, GraphQL still returns HTTP `200`, with an error and `x-ratelimit-remaining: 0`. Check the body, not only the status.

**A budget for M2** (one account, 20 repos across the Workspaces):
- A 60 s poll with one conditional `GET /repos/{o}/{r}/pulls?state=open&per_page=100` per repo is 20 requests a minute that cost nothing while nothing changes. Only repos that return `200` trigger GraphQL detail queries.
- The three search buckets (§6.1) once a minute are 3 GraphQL calls at about 1–2 points each, roughly 300 points an hour.
- Merge and close checks for every Review Checkout are one `nodes()` call a minute, about 60 points an hour.
- That is well inside the limits even with `gh` running alongside. Back off to a slower interval when the window isn't focused.

## 6. GraphQL and REST calls

All GraphQL calls go to `POST https://api.github.com/graphql` with `Authorization: Bearer <token>`. Field and argument names below are taken from the published schema ([`schema.docs.graphql`](https://docs.github.com/public/fpt/schema.docs.graphql); human-readable at [GraphQL reference](https://docs.github.com/en/graphql/reference)).

### 6.1 The pull request list

**Matching Workspaces to GitHub repos.** Parse each Workspace's `git remote -v` (the Daemon already reads git). The forms to handle are `git@github.com:OWNER/REPO(.git)`, `ssh://git@github.com/OWNER/REPO`, and `https://github.com/OWNER/REPO(.git)`. Keep both `origin` and `upstream`, since forks matter. Other hosts (GHES, `*.ghe.com`) are out of scope for M2.

Look each one up once with `repository(owner:, name:, followRenames: true) { id nameWithOwner isArchived viewerPermission }`. `followRenames` defaults to true, and `nameWithOwner` gives the canonical name after a rename or transfer. Store the repository node `id`, which survives renames.

**The three buckets** use [`search(type: ISSUE, query:, first:)`](https://docs.github.com/en/graphql/reference/queries#search). It returns `SearchResultItemConnection`, at most 1,000 results; use `... on PullRequest` inside. The qualifiers come from [Searching issues and pull requests](https://docs.github.com/en/search-github/searching-on-github/searching-issues-and-pull-requests):

| Bucket | Query |
|---|---|
| Review requested | `is:pr is:open archived:false user-review-requested:@me` (directly), or `review-requested:@me`, which also includes "review requests for that team" when a team the user is on is requested. A requested reviewer drops out of these results "after they review a pull request". To keep reviewed ones visible, `review-involves:@me` also covers past reviews. |
| Mine | `is:pr is:open archived:false author:@me` |
| Other open in my repos | `is:pr is:open archived:false repo:o1/r1 repo:o2/r2 … -author:@me` (the `repo:` qualifiers don't count toward the 256-character limit) |

Add `draft:false` to taste. Scope each query to the matched repos (`repo:`), or leave it global for "requested anywhere".

Per item, fetch what the list row shows:

```graphql
query PrList($q: String!) {
  search(type: ISSUE, query: $q, first: 50) {
    issueCount
    nodes {
      ... on PullRequest {
        id number title url isDraft state updatedAt
        headRefName headRefOid baseRefName isCrossRepository
        repository { id nameWithOwner }
        author { login avatarUrl }
        reviewDecision                     # APPROVED | CHANGES_REQUESTED | REVIEW_REQUIRED
        mergeStateStatus
        reviewRequests(first: 10) { nodes { requestedReviewer { ... on User { login } ... on Team { slug } } } }
        viewerLatestReview { state submittedAt }
      }
    }
  }
  rateLimit { cost remaining resetAt }
}
```

Cost: one search connection plus 50 `reviewRequests` connections is about 51 requests, so roughly **1 point**.

The alternative without search is to alias `repository(owner,name) { pullRequests(states: OPEN, first: 50, orderBy: {field: UPDATED_AT, direction: DESC}) { … } }` for each matched repo in one query. For 20 repos with nested `reviewRequests(first:10)` that is 20 + 1,000 requests, about 10 points. It avoids the 30-per-minute search limit and search lag.

**The poll trigger** is REST `GET /repos/{owner}/{repo}/pulls?state=open&per_page=100` with an ETag ([list pull requests](https://docs.github.com/en/rest/pulls/pulls#list-pull-requests)). Each item carries `requested_reviewers`, `requested_teams`, `draft`, `updated_at`, `head.sha` and so on. A `304` costs nothing; a `200` tells the Client which repo to refresh over GraphQL. The default sort, `created`, is stable, which keeps the 304s coming.

**Optional:** `GET /notifications` with `If-Modified-Since` "is optimized for polling", returns `X-Poll-Interval` (obey it), and carries `reason: review_requested`. It's a cheap global "something new" signal. GitHub's page has a note that these endpoints "only support authentication using a personal access token (classic)", while the same page says calls need the `notifications` or `repo` scope. Test it with an OAuth token before relying on it.

### 6.2 Pending reviews and comments

Use GraphQL mutations. The REST equivalents exist (`POST /repos/{o}/{r}/pulls/{n}/reviews` with no `event` creates a PENDING review; `POST …/reviews/{id}/events` submits it), but per-file Viewed state is GraphQL-only, so one API keeps it simple ([REST reviews](https://docs.github.com/en/rest/pulls/reviews)).

| Step | Mutation and input | Notes |
|---|---|---|
| Find an existing pending review (resume after a restart, or one started on github.com) | `pullRequest.reviews(states: [PENDING], first: 1) { nodes { id commit { oid } comments(first: 100) { … } } }` | A pending review is "only visible to you" until submitted ([reviewing proposed changes](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/reviewing-proposed-changes-in-a-pull-request)). |
| Create pending | `addPullRequestReview(input: { pullRequestId, commitOID?, body?, threads?: [DraftPullRequestReviewThread] })` with **no `event`** | `threads` takes `{ path, line, side, startLine?, startSide?, body }`, so a batch of comments costs one content-creating request instead of N. `comments` (diff `position`) is deprecated ("use the `threads` argument instead"). Set `commitOID` to the head OID the Review Checkout shows, so lines resolve against what the user saw. |
| Add a line comment | `addPullRequestReviewThread(input: { pullRequestReviewId (or pullRequestId), path, body, line, side: RIGHT })` | `line` is "the line of the blob". `side: RIGHT` is the head file (additions and context), `LEFT` the base file (deletions). |
| Add a multi-line comment | same, plus `startLine`, `startSide` | `line`/`side` mark the **end** of the range. On REST, `start_line`/`start_side` are required for multi-line comments. |
| Comment on a whole file | same with `subjectType: FILE` (no `line`) | `PullRequestReviewThreadSubjectType` is `LINE` or `FILE`. |
| Reply in a thread | `addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId, body, pullRequestReviewId? })` | Goes into the pending review when `pullRequestReviewId` is given. |
| Edit or delete pending | `updatePullRequestReviewComment`, `deletePullRequestReviewComment`, `updatePullRequestReview`, `deletePullRequestReview` | |
| Submit | `submitPullRequestReview(input: { pullRequestReviewId, event, body? })` with `event` one of `APPROVE`, `REQUEST_CHANGES`, `COMMENT` | `DISMISS` is in the enum too but is not a submit action. On REST, `body` is required for `REQUEST_CHANGES` and `COMMENT`; treat it the same way in GraphQL. **Authors cannot approve their own pull requests**, so hide Approve when `author == viewer`. |

Line rules: a line comment must land on a line that is in the pull request diff. REST says "the line of the blob in the pull request diff". Anywhere else, use `subjectType: FILE` or a top-level comment. `position` "is closing down" on REST ([review comments](https://docs.github.com/en/rest/pulls/comments#create-a-review-comment-for-a-pull-request)) and is deprecated in GraphQL. Use `line`/`side` everywhere.

**Reading threads and outdated positions** with `pullRequest.reviewThreads(first: 100)`. Each `PullRequestReviewThread` has:
- `path`, `diffSide`, `startDiffSide`
- `line` and `startLine`: the current position, `null` once outdated
- `originalLine` and `originalStartLine`: where the comment was first made
- `isOutdated`, `isResolved`, `subjectType`, `comments { … }`

Each `PullRequestReviewComment` has `commit`, `originalCommit`, `diffHunk`, `outdated`, `position` (nullable) and `originalPosition`.

To place an outdated thread, anchor it at `originalLine` in `originalCommit`. The Review Checkout has the git objects, so the Client (through the Daemon) can map that line forward with `git diff originalCommit..headRefOid -- path`, or show it in an "outdated" section with its `diffHunk`, as GitHub's own conversation view does ([commenting on a pull request](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/commenting-on-a-pull-request)).

Resolve threads with `resolveReviewThread` / `unresolveReviewThread`.

**Content limits:** comments and reviews count toward the 80-a-minute and 500-an-hour content limits and trigger notifications. Batch through `threads` on `addPullRequestReview`, and keep the 1 s gap between mutations.

### 6.3 Per-file Viewed state

From the schema:
- `PullRequest.files(first: 100, after:)` returns `PullRequestChangedFile { path additions deletions changeType viewerViewedState }`.
- `FileViewedState` is one of:
  - `VIEWED`: "The file has been marked as viewed."
  - `UNVIEWED`: "The file has not been marked as viewed."
  - `DISMISSED`: "The file has new changes since last viewed."

  GitHub unmarks a file "if the file changes after you view the file" ([reviewing proposed changes](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/reviewing-proposed-changes-in-a-pull-request#marking-a-file-as-viewed)).
- `markFileAsViewed(input: { pullRequestId, path })` and `unmarkFileAsViewed(input: { pullRequestId, path })`.

Notes:
- The state belongs to the viewer and syncs with github.com's "Viewed" checkbox and progress bar, so Polaris and the browser agree.
- The REST "list pull request files" endpoint has no viewed field and stops at 3,000 files.
- Each toggle is a mutation (5 secondary points). Debounce rapid toggles, and render optimistically while the mutation runs.

### 6.4 Detecting merge or close for Review Checkout cleanup

- `PullRequest.state: PullRequestState!` is `OPEN`, `CLOSED` ("closed without being merged") or `MERGED`. Also available: `merged`, `mergedAt`, `closed`, `closedAt`, `mergeCommit`, `headRefOid`.
- **The cheapest check is one GraphQL call for every Review Checkout:** `nodes(ids: [prId1, prId2, …]) { ... on PullRequest { id state headRefOid mergedAt closedAt } }`. It has no connections, so it costs about 1 point for up to 100 IDs.
- REST alternative: `GET /repos/{o}/{r}/pulls/{n}` with an ETag gives `state: open|closed` and `merged_at`, where merged means `state == closed && merged_at != null`. It is free when unchanged.
- **Use the API, not local git:** squash and rebase merges never make the head commit reachable from the base, so `git branch --merged` style checks miss them.
- Treat a changed `headRefOid` while `OPEN` as "new commits or a force-push": refresh the Review Checkout and expect threads to become outdated.
- A `CLOSED` pull request can be reopened, so cleanup should wait (or ask) rather than delete the worktree immediately.

## 7. Organization restrictions, SSO, and what the user sees

Source: [About OAuth app access restrictions](https://docs.github.com/en/organizations/managing-oauth-access-to-your-organizations-data/about-oauth-app-access-restrictions), [Requesting organization approval](https://docs.github.com/en/account-and-profile/setting-up-and-managing-your-personal-account-on-github/managing-your-membership-in-organizations/requesting-organization-approval-for-oauth-apps), [Approving OAuth apps](https://docs.github.com/en/organizations/managing-oauth-access-to-your-organizations-data/approving-oauth-apps-for-your-organization), [Limiting app access requests](https://docs.github.com/en/organizations/managing-programmatic-access-to-your-organization/limiting-oauth-app-and-github-app-access-requests-and-installations), [Troubleshooting the REST API](https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api), [About authentication with SSO](https://docs.github.com/en/enterprise-cloud@latest/authentication/authenticating-with-single-sign-on/about-authentication-with-single-sign-on).

**Behaviour:**
- "When you create a new organization, OAuth app access restrictions are enabled by default."
- With restrictions on, an unapproved app gets no "API access to private organization resources" and no create, update or delete on the org's public resources.
- "If the organization does not approve the application, then the application will only be able to access the organization's public resources." Without restrictions, the app automatically has access.
- GitHub-owned "privileged" apps (GitHub CLI, GitHub Desktop, VS Code…) bypass restrictions. That is why `gh` works where Polaris may not; users will ask.

**What the user sees while authorizing:** "When you authorize an OAuth app for your personal account, you'll also see how the authorization will affect each organization you're a member of", with a way to request approval for restricted orgs (or approve directly as an owner). For SAML SSO orgs, "you must have an active SAML session for each organization each time you authorize an OAuth app". Without one, the app can't reach that org until the user re-authorizes after visiting `https://github.com/orgs/<ORG>/sso`.

**What the API returns:**
- Private org resources usually come back as **404** ("GitHub uses a `404 Not Found` response instead of a `403 Forbidden` response to avoid confirming the existence of private repositories"). GitHub's troubleshooting list for OAuth tokens includes "The organization has not blocked OAuth app access… **App owners cannot see whether their app is blocked**".
- Some endpoints return **403** with the message *"Although you appear to have the correct authorization credentials, the `<org>` organization has enabled OAuth App access restrictions, meaning that data access to third-parties is limited."* That wording comes from third-party reports ([community discussion #24488](https://github.com/orgs/community/discussions/24488), [gitbutler#5190](https://github.com/gitbutlerapp/gitbutler/issues/5190), [vscode-pull-request-github#1114](https://github.com/Microsoft/vscode-pull-request-github/issues/1114)), not GitHub's docs. The discussion reports GraphQL mutations failing with `FORBIDDEN` where REST succeeded.
- In GraphQL, `repository(...)` comes back `null` with a `NOT_FOUND` error, and search silently leaves out the org's private PRs.
- For **SSO**, PATs get an `X-GitHub-SSO` header with an authorize URL or `partial-results; organizations=…` ([authenticating to the REST API](https://docs.github.com/en/rest/authentication/authenticating-to-the-rest-api#personal-access-tokens-and-saml-sso)). "Access tokens created by apps are automatically authorized for SAML SSO" once the user had an active session when authorizing.

**How the user requests approval:** they need to have authorized the app on their personal account first (the device flow does that). Then: Settings → Applications → **Authorized OAuth Apps** → Polaris → **Request access** next to the org → **Request approval from owners**. The deep link is `https://github.com/settings/connections/applications/<client_id>`. Owners get a notification, and approve under org Settings → Third-party Access → **OAuth app policy** → Review → **Grant access**. Orgs can turn off access requests, in which case the user has to ask an owner out of band.

**What Polaris should show** when a Workspace's remote resolves to a repo the token can't see, but the user's git clearly can reach it: a message along the lines of *"Polaris can't see `<org>/<repo>` with `<login>`. The `<org>` organization may restrict third-party apps, or need SSO."* Offer two actions: open the request-access page, and open `https://github.com/orgs/<org>/sso`. Never retry it on every poll; GitHub warns against repeated 404 polling.

**If an org refuses OAuth apps outright,** the fallback is a GitHub App with user-to-server tokens. GitHub Apps "aren't subject to organization application policies" but need installation on the org ([differences](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/differences-between-github-apps-and-oauth-apps)). Their user tokens also use the device flow and expire after 8 hours, so the Desktop App's token code carries over.

## 8. For the decision tickets

- **Scopes:** `repo read:org`. There is no read-only option. Reviewers need write anyway, and `repo` means full repo write for the token, which belongs in the consent copy.
- **Token lifetime:** keep "Expire user access tokens" on. Refresh is single-flight in the main process, needs no client secret, and the rotated pair is persisted before use.
- **Storage:** `safeStorage` async API, one encrypted record per account keyed by GitHub user `id`. Electron 44 still has the sync API, but it is gone in 46, so don't adopt it. The app must be code-signed for silent keychain access.
- **Polling, not webhooks:** OAuth Apps have no central webhooks and Polaris has no server. Use ETag'd REST for "did anything change", GraphQL for the details, and `nodes()` for Review Checkout state. Remember the budget is shared with the user's other tools.
- **Reviews in GraphQL:** pending review → `threads` → submit. Use `line`/`side` and `startLine`/`startSide`, never `position`. Viewed state exists only in GraphQL.
- **Org restrictions are on by default for new orgs** and invisible to the app owner. M2 needs a clear "request access / SSO" state per repo, and should expect users to compare Polaris with `gh`, which is privileged.
- **Device-flow cap:** 50 code submissions an hour **per app**, across all users. That is fine for now, but if Polaris grows past that sign-in rate, it needs a contact with GitHub or the loopback web flow with PKCE (the callback URL registered above allows it).
