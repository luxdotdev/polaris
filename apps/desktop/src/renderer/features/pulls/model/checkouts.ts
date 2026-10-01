/**
 * Review Checkouts by pull request, from every Host's snapshot: the PR list's "checked out"
 * and where its cached Risk Summary lives. The newest checkout of a pull request wins.
 */
import { repoKey, type ReviewCheckout } from "@polaris/protocol";
import { Predicate } from "effect";
import type { HostModel } from "../../../store/hostModel.ts";
import { pullKey } from "./risk.ts";

export interface FoundCheckout {
  readonly hostKey: string;
  readonly checkout: ReviewCheckout;
  /** `repoKey` of its repository (`github.com/owner/name`), as Risk Summaries are keyed. */
  readonly repo: string;
}

export const checkoutsByPull = (
  models: Readonly<Record<string, HostModel>>
): ReadonlyMap<string, FoundCheckout> => {
  const found = new Map<string, FoundCheckout>();

  for (const [hostKey, model] of Object.entries(models)) {
    for (const checkout of model.reviewCheckouts.values()) {
      const { subject } = checkout;

      if (!Predicate.isTagged(subject, "PullRequest") || checkout.state === "removing") continue;

      const { repo, number } = subject.pullRequest;
      const key = pullKey(repo.owner, repo.name, number);
      const seen = found.get(key);

      if (seen !== undefined && seen.checkout.updatedAt >= checkout.updatedAt) continue;
      found.set(key, { hostKey, checkout, repo: repoKey(repo) });
    }
  }

  return found;
};
