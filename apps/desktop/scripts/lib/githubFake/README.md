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
- `acme/widgets` (mona WRITE, hubot READ): #42 requests mona (two threads, one outdated), #43 is mona's draft and requests hubot, #44 requests nobody.
- `mona/dotfiles` #7 requests mona; `hubot/scripts` #3 requests hubot.
- `lockedorg` restricts OAuth Apps: `lockedorg/vault` is a 404 / `NOT_FOUND` for everyone.

## What it answers

- `POST /login/device/code`, `POST /login/oauth/access_token` (device and refresh grants, with `authorization_pending`, `slow_down`, `access_denied`, `expired_token`, `bad_refresh_token`).
- `GET /user`; `GET /repos/{o}/{r}/pulls` with ETags (a 304 doesn't count against the limit); `POST /repos/{o}/{r}/pulls`.
- `POST /graphql` by `operationName`: the operations in `src/main/github/queries.ts` (it doesn't parse GraphQL). Mutations refuse what GitHub refuses: a second pending review, approving or requesting changes on your own pull request, Request changes without a body, a path not in the pull request.

## Moving the world

In-process: `approveDevice(userCode, login)`, `denyDevice`, `expireAccessTokens`, `revoke(login)`, `merge|close|push(repo, number)` (a push makes line threads outdated and Viewed files "changed since viewed"), `requestReview(repo, number, login)`, `restrictOrg(org, on)`, `failNext(status)`. Over HTTP, `POST /_fake/<approve|deny|expire|merge|close|push|request-review|restrict|fail>` with a JSON body. `fake.requests` logs every call (kind, path or operation, status) for assertions.
