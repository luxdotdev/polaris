/**
 * The commits a Review Checkout's update would bring: GitHub's comparison of the commit the
 * checkout holds with the pull request's head (Paper R4's "2 new commits on …"). A rewritten
 * branch compares as `diverged`.
 */
import { Effect } from "effect";
import type { CompareView, PullCompare } from "../../shared/github.ts";
import type { Client } from "./client.ts";
import { GitHubNoAccount, GitHubRequestError } from "./errors.ts";
import type { Routing } from "./routing.ts";
import { Comparison } from "./wire.ts";

/** Commits listed, newest first; the count covers the rest. */
export const COMMITS_SHOWN = 20;

const headline = (message: string) => message.split("\n")[0] ?? "";

export const toCompareView = (comparison: Comparison): CompareView => ({
  status:
    comparison.status === "diverged" ||
    comparison.status === "behind" ||
    comparison.status === "identical"
      ? comparison.status
      : "ahead",
  total: comparison.total_commits,
  commits: comparison.commits
    .slice(-COMMITS_SHOWN)
    .reverse()
    .map((c) => ({
      oid: c.sha,
      headline: headline(c.commit.message),
      date: c.commit.committer?.date ?? null,
    })),
});

export const newCompare = (client: Client, routing: Routing) => (input: PullCompare) =>
  Effect.gen(function* () {
    const access = yield* routing.resolve(input.repo, null);
    const name = `${input.repo.owner}/${input.repo.name}`;

    if (access.accountId === null) {
      return yield* Effect.fail(
        new GitHubNoAccount({ repo: name, message: `No GitHub account can see ${name}.` })
      );
    }

    const result = yield* client.rest(access.accountId, Comparison, {
      method: "GET",
      path: `/repos/${input.repo.owner}/${input.repo.name}/compare/${input.base}...${input.head}`,
      etag: null,
      body: null,
    });

    if (result.status !== "ok") {
      return yield* Effect.fail(new GitHubRequestError({ status: 304, message: "unexpected 304" }));
    }

    return toCompareView(result.value);
  });
