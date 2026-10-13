/**
 * Asking for reviews and merging, as the account routed to the repository (ENG-228,
 * ENG-229): the pull request's merge state and reviewers in one query, a reviewer search,
 * review requests added and removed, the merge or auto-merge, and the head branch deleted
 * afterwards (and restored) when nothing keeps it. Merges queue behind the account's other
 * mutations.
 */
import { Effect } from "effect";
import { GITHUB_HOST, hostOf, type PullRef, type RepoRef } from "../../shared/github.ts";
import type {
  BranchOutcome,
  MergeMethod,
  MergeResult,
  PullActionsView,
  ReviewerView,
} from "../../shared/githubActions.ts";
import {
  BranchData,
  branchPath,
  disableAutoMerge,
  enableAutoMerge,
  Ignored,
  MergePullData,
  mergePull,
  PullActionsData,
  pullActions,
  reviewerSearch,
  ReviewerSearchData,
} from "./actionQueries.ts";
import { branchKeep, mergeView, needsProtectionCheck, reviewersView } from "./actionViews.ts";
import type { Client } from "./client.ts";
import { GitHubInvalidAction, GitHubNotFound } from "./errors.ts";
import type { Reviews } from "./reviews.ts";
import type { Json } from "./transport.ts";

export interface ReviewerChange {
  readonly pull: PullRef;
  /** Logins. */
  readonly users: ReadonlyArray<string>;
  /** Team slugs, in the repository's organization. */
  readonly teams: ReadonlyArray<string>;
}

export interface MergeInput {
  readonly pull: PullRef;
  readonly pullId: string;
  readonly method: MergeMethod;
  /** Ignored for a rebase, which keeps the commits as they are. */
  readonly title: string;
  readonly body: string;
  /** The head the user saw: GitHub refuses the merge if the branch moved since. */
  readonly expectedHeadOid: string;
  readonly deleteBranch: boolean;
}

export interface AutoMergeInput extends Omit<MergeInput, "deleteBranch"> {
  readonly enable: boolean;
}

export interface BranchRestore {
  /** The repository the branch lived in, `owner/name` (a fork's for a fork). */
  readonly repo: string;
  readonly host?: string;
  readonly name: string;
  readonly sha: string;
}

const invalid = (message: string) => Effect.fail(new GitHubInvalidAction({ message }));

const nameOf = (repo: RepoRef) => `${repo.owner}/${repo.name}`;

const UPPER: Readonly<Record<MergeMethod, string>> = {
  merge: "MERGE",
  squash: "SQUASH",
  rebase: "REBASE",
};

/** The commit message GitHub takes for a method: none for a rebase. */
const messageInput = (input: MergeInput | AutoMergeInput): { readonly [k: string]: Json } =>
  input.method === "rebase" ? {} : { commitHeadline: input.title, commitBody: input.body };

export interface PullActionsInput {
  readonly client: Client;
  readonly reviews: Pick<Reviews, "accountFor" | "mutate">;
}

export const newPullActions = ({ client, reviews }: PullActionsInput) => {
  const { accountFor, mutate } = reviews;

  /** Whether a branch rule protects `branch`; null when GitHub can't say. */
  const branchProtected = (accountId: number, repo: string, branch: string) =>
    client
      .rest(accountId, BranchData, {
        method: "GET",
        path: `/repos/${repo}/branches/${branchPath(branch)}`,
        etag: null,
        body: null,
      })
      .pipe(
        Effect.map((result) => (result.status === "ok" ? result.value.protected : null)),
        Effect.catchTag("GitHubNotFound", () => Effect.succeed(null))
      );

  /** The pull request's merge state and reviewers, as GitHub says them now. */
  const fetchState = (pull: PullRef) =>
    Effect.gen(function* () {
      const accountId = yield* accountFor(pull);

      const data = yield* client.graphql(
        accountId,
        PullActionsData,
        pullActions({ owner: pull.repo.owner, name: pull.repo.name, number: pull.number })
      );

      const repo = data.repository;
      const pr = repo?.pullRequest ?? null;

      if (repo === null || pr === null) {
        return yield* Effect.fail(
          new GitHubNotFound({ message: `No pull request #${pull.number}.` })
        );
      }

      const head = pr.headRepository?.nameWithOwner ?? repo.nameWithOwner;

      const protectedBranch = needsProtectionCheck(repo, pr)
        ? yield* branchProtected(accountId, head, pr.headRefName)
        : null;

      return { accountId, viewer: data.viewer.login, repo, pr, head, protectedBranch };
    });

  const actions = (pull: PullRef) =>
    Effect.map(fetchState(pull), (s): PullActionsView => ({
      merge: mergeView(s.viewer, s.repo, s.pr, hostOf(pull.repo), s.protectedBranch),
      reviewers: reviewersView(s.repo, s.pr),
    }));

  /** Collaborators and teams matching `query`, users first. */
  const search = (pull: PullRef, query: string) =>
    Effect.gen(function* () {
      const accountId = yield* accountFor(pull);

      const data = yield* client.graphql(
        accountId,
        ReviewerSearchData,
        reviewerSearch({ owner: pull.repo.owner, name: pull.repo.name, q: query.trim() })
      );

      const users: ReadonlyArray<ReviewerView> = (data.repository?.assignableUsers.nodes ?? []).map(
        (u) => ({ kind: "user", login: u.login, name: u.name })
      );

      const teams: ReadonlyArray<ReviewerView> = (data.repository?.owner.teams?.nodes ?? []).map(
        (t) => ({ kind: "team", login: t.slug, name: t.name })
      );

      return [...users, ...teams];
    });

  const changeRequests = (method: "POST" | "DELETE", change: ReviewerChange) =>
    Effect.gen(function* () {
      if (change.users.length === 0 && change.teams.length === 0)
        return yield* invalid("Pick someone to ask first.");

      const accountId = yield* accountFor(change.pull);

      yield* client.rest(accountId, Ignored, {
        method,
        path: `/repos/${nameOf(change.pull.repo)}/pulls/${change.pull.number}/requested_reviewers`,
        etag: null,
        body: { reviewers: [...change.users], team_reviewers: [...change.teams] },
      });
    });

  const deleteBranch = (accountId: number, repo: string, name: string) =>
    client.rest(accountId, Ignored, {
      method: "DELETE",
      path: `/repos/${repo}/git/refs/heads/${branchPath(name)}`,
      etag: null,
      body: null,
    });

  type State = Effect.Success<ReturnType<typeof fetchState>>;

  /** The head branch after the merge: deleted when asked and nothing keeps it. */
  const branchAfter = (state: State, asked: boolean) =>
    Effect.gen(function* () {
      const { pr, head } = state;
      const name = pr.headRefName;
      const keep = branchKeep(state.repo, pr, state.protectedBranch);
      const deleted = { kind: "deleted", name, sha: pr.headRefOid, repo: head } as const;

      if (keep === "auto") return { ...deleted, byGitHub: true } satisfies BranchOutcome;

      if (keep !== null) return { kind: "kept", name, reason: keep } satisfies BranchOutcome;

      if (!asked) return { kind: "kept", name, reason: "asked" } satisfies BranchOutcome;

      return yield* deleteBranch(state.accountId, head, name).pipe(
        Effect.as<BranchOutcome>({ ...deleted, byGitHub: false }),
        Effect.catch((error) =>
          Effect.succeed<BranchOutcome>({ kind: "failed", name, message: error.message })
        )
      );
    });

  const merge = (input: MergeInput) =>
    Effect.gen(function* () {
      const state = yield* fetchState(input.pull);
      const view = mergeView(state.viewer, state.repo, state.pr, "", state.protectedBranch);

      if (!view.viewerCanMerge)
        return yield* invalid(`${state.viewer} can't merge into ${state.repo.nameWithOwner}.`);

      if (!view.methods.includes(input.method))
        return yield* invalid(`${state.repo.nameWithOwner} doesn't allow ${input.method} merges.`);

      if (view.headRefOid !== input.expectedHeadOid)
        return yield* invalid("New commits arrived since you looked. Review them first.");

      const merged = yield* mutate(
        state.accountId,
        MergePullData,
        mergePull({
          input: {
            pullRequestId: input.pullId,
            mergeMethod: UPPER[input.method],
            expectedHeadOid: input.expectedHeadOid,
            ...messageInput(input),
          },
        })
      );

      return {
        method: input.method,
        mergedAt: merged.mergePullRequest.pullRequest.mergedAt,
        branch: yield* branchAfter(state, input.deleteBranch),
      } satisfies MergeResult;
    });

  /** Turns auto-merge on (GitHub merges once checks and reviews allow) or off. */
  const autoMerge = (input: AutoMergeInput) =>
    Effect.gen(function* () {
      const accountId = yield* accountFor(input.pull);

      if (!input.enable) {
        yield* mutate(
          accountId,
          Ignored,
          disableAutoMerge({ input: { pullRequestId: input.pullId } })
        );

        return;
      }

      yield* mutate(
        accountId,
        Ignored,
        enableAutoMerge({
          input: {
            pullRequestId: input.pullId,
            mergeMethod: UPPER[input.method],
            expectedHeadOid: input.expectedHeadOid,
            ...messageInput(input),
          },
        })
      );
    });

  /** Puts a deleted head branch back where it pointed. */
  const restoreBranch = (input: BranchRestore) =>
    Effect.gen(function* () {
      const [owner = "", name = ""] = input.repo.split("/");
      const onGitHub = input.host === undefined || input.host === GITHUB_HOST;

      const repo: RepoRef = onGitHub
        ? { owner, name }
        : { host: input.host ?? GITHUB_HOST, owner, name };

      const accountId = yield* accountFor({ repo, number: 1 });

      yield* client.rest(accountId, Ignored, {
        method: "POST",
        path: `/repos/${input.repo}/git/refs`,
        etag: null,
        body: { ref: `refs/heads/${input.name}`, sha: input.sha },
      });
    });

  return {
    actions,
    search,
    request: (change: ReviewerChange) => changeRequests("POST", change),
    unrequest: (change: ReviewerChange) => changeRequests("DELETE", change),
    merge,
    autoMerge,
    restoreBranch,
  };
};

export type PullActions = ReturnType<typeof newPullActions>;
