# Research: GitHub's stacked pull requests, as Review reads them

Researched 2026-10-01 for the stack chip in Review (brief `STACK`). Sources: GitHub's published GraphQL schema ([`schema.docs.graphql`](https://docs.github.com/public/fpt/schema.docs.graphql), fetched that day), [About stacked pull requests](https://docs.github.com/en/pull-requests/get-started/about-stacked-prs), [REST API endpoints for stacked pull requests](https://docs.github.com/en/rest/pulls/stacks), [Stacked pull requests APIs and webhooks](https://docs.github.com/en/pull-requests/reference/stacked-pull-requests-apis-and-webhooks), and the [changelog of 2026-07-30](https://github.blog/changelog/2026-07-30-stacked-pull-requests-are-now-in-public-preview/).

## TL;DR

- **GitHub has native stacks, in public preview since 2026-07-30, and exposes them.** GraphQL has read-only fields on `PullRequest`; REST has a Stacks API that can also write. Polaris only reads, so **GraphQL is enough**, inside the queries it already sends.
- **GraphQL** (from the schema):
  - `PullRequest.stack: PullRequestStack` and `PullRequest.stackEntry: PullRequestStackEntry`. Both are null when the pull request isn't in a stack.
  - `PullRequestStack { number: Int!, size: Int!, baseRefName: String!, entries(first, after…): PullRequestStackEntryConnection! }`. `baseRefName` is the trunk the whole stack targets.
  - `PullRequestStackEntry { position: Int!, pullRequest: PullRequest, stack }`. "1 is the closest to the base branch, 2 is stacked on top of 1, etc."
- **REST** (for reference): `stack` on every pull request resource (number, size, position, base); `GET /repos/{o}/{r}/stacks[?pull_request=N]`, `GET …/stacks/{number}`, plus create, add and unstack. API version `2026-03-10`.
- **Scopes:** reading a stack is reading the pull request, so `repo` (which we already ask for) covers it. There are no stack mutations in GraphQL.
- **Limits:** "Stacked pull requests require all branches to be in the same repository. Cross-fork stacks are not supported." Merging a stack through the API uses the asynchronous merge API; Polaris doesn't merge.
- **GitHub Enterprise Server:** the fields are in GitHub.com's schema. A GHES whose version predates the preview would reject a query that names them, and that would fail the whole query. So Polaris asks for stacks only on github.com, and infers them on Enterprise hosts.

## What Polaris does with it

1. On github.com, the pull request list's search and the pull request detail query ask for `stack { number size baseRefName entries(first: 20) { … } }` and `stackEntry { position }`. Each entry carries what the stack popover shows: number, title, head branch, state, draft, `+/−`, and the checks rollup. One query, no request per hover.
2. **Fallback**, for repositories without a GitHub stack and for Enterprise hosts: infer a stack from the open pull requests Polaris already lists. The rules are in DESIGN.md (Review → Stacks):
   - A pull request's base is another open pull request's head, in the same repository and not from a fork.
   - The chain runs down to the first base that isn't a pull request head; that base is the trunk.
   - A branch point (two pull requests on one base) or a cycle isn't called a stack.
3. Reviewing layer N compares it with its own base (layer N−1's head), as GitHub's diff does. The Review Checkout's merge base is computed against that base branch, never the trunk.
