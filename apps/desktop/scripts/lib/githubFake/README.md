# GitHub fake

An in-memory GitHub for tests and the smoke: OAuth (device flow, expiring tokens that rotate on refresh), REST and GraphQL, with per-user rate-limit headers. No real network, no real accounts. Its fixtures (`fixtures/world.json`) and responses follow the shapes in GitHub's documentation and published GraphQL schema (`docs/research/github-review-apis.md`); they were written from those, not recorded from live traffic.

```ts
import { createGitHubFake } from "../scripts/lib/githubFake/index.ts";

const fake = createGitHubFake({ now: () => clock });   // in-process: pass `fake.fetch` as the client's fetch
const served = await fake.serve();                       // or over HTTP: POLARIS_GITHUB_{WEB,API}_URL=served.url
```

## GitHub Enterprise

`createGitHubEnterpriseFake()` is a GitHub Enterprise Server: REST only under `/api/v3`, GraphQL at `/api/graphql` (github.com's paths answer 404, so a client on the wrong paths fails loudly), OAuth at `/login/…` with its own client ID (`FAKE_GHE_CLIENT_ID`), `verification_uri` at `https://ghe.acme.test/login/device`, and its own world (`fixtures/ghe.json`): `mona-ent` with user id 1001 (the same as github.com's mona), `platform/api` #12 requesting mona-ent, and `secure`, an org that restricts OAuth Apps. Serve it and set `POLARIS_GITHUB_HOST_URLS={"ghe.acme.test":"<url>"}` so the app reaches it as `https://ghe.acme.test`.

## The world

- Users `mona` (1001), `hubot` (2002), `octocat` (3003).
- `acme/widgets` (mona WRITE, hubot READ, octocat ADMIN): #42 requests mona (two threads, one outdated), #43 is mona's draft and requests hubot, #44 requests nobody.
- `mona/dotfiles` #7 requests mona; `hubot/scripts` #3 requests hubot.
- Teams: `acme/platform` (hubot, octocat) and `acme/docs` (mona).
- Every repository allows all three merge methods, its default branch is `main`, nothing is protected and auto-merge is off until a test says otherwise (`merging.ts`).
- `lockedorg` restricts OAuth Apps: `lockedorg/vault` is a 404 / `NOT_FOUND` for everyone.

`fake.seedStacks()` (HTTP `POST /_fake/seed-stacks`) adds `fixtures/stacks.json`: acme/platform's GitHub stack #635 (#61 → #64 on `nightly`; #62 asks mona's review) and acme/infra's chain #11 → #12 with no GitHub stack (inferred), plus #13 on top from a fork (never stacked).

## What it answers

- `POST /login/device/code`, `POST /login/oauth/access_token` (device and refresh grants, with `authorization_pending`, `slow_down`, `access_denied`, `expired_token`, `bad_refresh_token`).
- `GET /user`; `GET /repos/{o}/{r}/pulls` with ETags (a 304 doesn't count against the limit); `POST /repos/{o}/{r}/pulls`.
- Stacks (`stack`, `stackEntry`) only when the query names them, as on github.com; checks as `commits(last: 1) { … statusCheckRollup }`.
- Reviewers and merging (`merging.ts`, `mergeGraphql.ts`): `PullActions` (with `mergeable` / `mergeStateStatus` worked out from draft, conflicts, the base's branch rule, approvals and checks), `ReviewerSearch`, `MergePullRequest` and auto-merge on and off, refusing below write access, a disallowed method, a moved head or a blocked pull request; `POST|DELETE /repos/{o}/{r}/pulls/{n}/requested_reviewers` (403 below triage, 422 for the author or a non-collaborator), `GET /repos/{o}/{r}/branches/{name}`, `DELETE /repos/{o}/{r}/git/refs/heads/{name}` (422 for the default or a protected branch) and `POST /repos/{o}/{r}/git/refs`.
- `POST /graphql` by `operationName`: the operations in `src/main/github/queries.ts` (it doesn't parse GraphQL). Mutations refuse what GitHub refuses: a second pending review, approving or requesting changes on your own pull request, Request changes without a body, a path not in the pull request.

## Moving the world

In-process: `approveDevice(userCode, login)`, `denyDevice`, `expireAccessTokens`, `revoke(login)`, `merge|close|push(repo, number)` (a push makes line threads outdated and Viewed files "changed since viewed"), `requestReview(repo, number, login)`, `restrictOrg(org, on)`, `failNext(status)`, and for merging `setRepo(repo, settings)`, `protectBranch(repo, branch, { requiredApprovals, requiredChecks })`, `setChecks(repo, number, { passing, failing, pending })` (merges a pull request with auto-merge on once nothing blocks it), `setConflicting` and `setDraft`. Over HTTP, `POST /_fake/<approve|deny|expire|merge|close|push|request-review|restrict|fail>` with a JSON body. `fake.requests` logs every call (kind, path or operation, status) for assertions.

`fake.seedOverview()` adds the brief's Suzuka Markdown format (realistic table subset in `fixtures/suzuka.md`), an inline bot thread, a submitted approval, a human top-level comment and a timed CI check. `PullOverview` independently paginates all four connections. `AddIssueComment` records top-level comments, and `PublishDescription` updates the fake PR body. The Electron smoke exercises the three new action IPCs and publication hash readback against this fixture.
