# Reviewer

The Agent layer of a Risk Summary (CONTEXT.md: Reviewer, Risk Summary, Risk Finding), and the module that runs whole Risk Summaries: the Rules (`../rules/`), then the Reviewer, then the cost line and the end. Decisions: Linear ENG-185, ENG-222 (the Reviewer), ENG-225 (Verdicts, `.polaris/review.md`), ENG-229 (cost line). Verdicts themselves are decided in `../engine/review.ts` and stored in `../store/review.ts`.

## Interface (`index.ts`)

- `Reviewer` (`ReviewerLive(options)`): `run`, `ask`, `settings`, `setSettings`. Served by `ReviewerRpcs.ts`: `review.runRiskSummary`, `review.askFinding`, `review.reviewerSettings`, `review.setReviewerSettings`.
- `ReviewerSessions` and `ReviewerPolicyLive`: the Reviewer's sessions, and the Engine's `ApprovalPolicy` that answers their approvals. Provide one `ReviewerSessions` to both (see `../transport/serve.ts`).
- `automaticRun`: what starts a summary without a Client asking.

## A Risk Summary

1. **Range** (`range.ts`). A pull request reads its Review Checkout: `mergeBase..head`, Rules in `history` mode, cached under `(repoKey, mergeBase, head)`. With `since` (the head reviewed before), the interdiff (`ReviewCheckoutGit.interdiff`) gives the base, Rules run in `snapshot` mode, and the key carries `since`; when the interdiff can't be built, a full summary runs with its reason as the note. Agent Session Turns diff the first Turn's before-checkpoint to the last one's after-checkpoint, keyed by the Workspace path.
2. **Cache.** An existing summary for the key is answered unless `refresh` is set or it failed. Starting is serialised, so two Clients opening the same Review share one run.
3. **Start.** `RiskSummaryStarted` with the resolved Reviewer (or the agent layer `skipped` with the Rules-only note); the call returns, and the rest runs in the module's scope.
4. **Rules** (`recordRulesLayer`), so the Reviewer sees their Findings.
5. **Reviewer** (below), then `RiskFindingsRecorded` and the layer's end.
6. **End.** `RiskSummaryEnded` with the `ReviewerRun` (its session), the cost and any note; `failed` only when both layers failed. A pull request's checkout then records the head as reviewed (`Engine.checkoutReviewed`).

**When it runs.** The Client calls `review.runRiskSummary` when a Review opens (with the PR's `ReviewContext`, since the Daemon has no GitHub token), and the cache makes that idempotent. The Daemon runs one on its own (`automaticRun`) when Turns are accepted (`TurnsAccepted`: the session through that Turn) and when a reviewed checkout moves to a new head (`ReviewCheckoutChanged`, ready, `head ≠ reviewedHead`: only the new changes).

## The Reviewer's session

- **An ordinary Agent Session** started through the Engine (`session.ts`): placement `ReviewCheckout` (or the Workspace for an Agent Session's Review), permission mode `supervised`, titled "Reviewer · Pull request #12" (or "Reviewer · <session title>"). It shows in the Orchestrator, its Usage counts like any session's, and follow-ups continue it. "Only the new changes" continues the previous summary's session, which already knows the change.
- **Read-only** (`policy.ts`): the Supervisor asks `ApprovalPolicy` before an approval reaches Needs You, so the Reviewer's approvals never interrupt the user. Allowed: reading and searching (`cat`, `rg`, `grep`, `find` without `-exec`/`-delete`, `sed -n Np`, …), read-only git (`diff`, `log`, `show`, `blame`, `grep`, …; no `-c`, `--output` or external diff), and tests, lint and typecheck (`bun|npm|pnpm|yarn` `test`/`lint`/`typecheck`/`check` scripts, `cargo test|check|clippy`, `go test|vet`, `pytest`, `tsc`, …). Pipes are allowed between allowed commands; `;`, `&`, redirections and substitutions never are. File changes and other tools are denied; questions are answered "decide from the code". The command line is read from where each driver puts it (Claude: `detail`, Codex: `title`). Codex's `supervised` sandbox is also read-only with no network; Claude has no sandbox, so the allow-list is the guard.
- **Context** (`prompt.ts`): what the Reviewer may do; the PR's title and description, or the session's prompts; `.polaris/review.md` as committed at head, then `~/.polaris/review/<host>/<owner>/<name>.md` (`instructions.ts`; front-matter `ignore:` globs drop files from the diff it is shown); the Rules' Findings (not to be repeated); the diff (up to 240k characters, the rest listed to read with git); the output contract.
- **Output** (`output.ts`): one fenced JSON document matching `ReviewerOutput` (its JSON Schema is in the prompt), decoded with Effect Schema; prose is never read. A reply that doesn't decode gets one repair Turn. Each Finding must overlap a hunk of the diff on its side (`diff.ts`), or it is dropped and counted in the layer's note. Identity: `agent`, the path, the flagged code and two lines either side, whitespace-normalised.
- **Follow-ups** (`ask.ts`): `review.askFinding` registers the session with the policy (after a restart too), sends the question, answers with the Turn's id once recorded, and after the Turn records what the reply changed: new Findings, revised ones (by id, its own only) and withdrawals (`RiskFindingResolved`, `withdrawn`).

## Settings (`settings.ts`)

`~/.polaris/reviewer-settings.json`: `{ default, workspaces }`, written atomically. Resolution: the Workspace's override, else the default, else the first ready of Claude Code `claude-opus-5-5` `high` and Codex `gpt-6.1-sol` (from `Availability`), else none: the agent layer is skipped and the summary's note says "Rules only…".

## Cost and Plan Limits (`cost.ts`)

The cost line is the Reviewer session's Usage since the summary started (`UsageIndex.query` by session, after a refresh): input, cache and output tokens, and the Harness-reported cost where there is one (null otherwise; the Client may estimate). When the Reviewer's Harness has a Plan Limit at `warning` or `reached`, the summary's note says so; the review still runs, with no automatic downgrade.

## Performance

Nothing runs until a summary is asked for: the module holds one store subscription (filtered to `TurnsAccepted` and `ReviewCheckoutChanged`), no timers or watchers. A run costs the Rules (see `../rules/README.md`), two `git diff`s and a `git show` per Finding, and the Harness.

## Tests

`bun test src/reviewer`: the policy's allow and deny lists, diff ranges and the reply's decoding and validation, identities across line shifts, instructions and their front-matter, settings resolution and persistence, the Plan Limit note, and end to end on the real Engine, store and Review Checkout git over a local code host with a fake Harness answering like the bench Reviewer: a pull request reviewed in its own session (approvals answered by policy, none recorded), the cache, a follow-up withdrawing a Finding, new commits reviewed on their own in the same session, and Rules only without a Reviewer. The bench Harness (`../harness/bench/review.ts`) answers any Reviewer prompt with schema output, so benchmarks and the dev Desktop App run whole Risk Summaries without tokens.
