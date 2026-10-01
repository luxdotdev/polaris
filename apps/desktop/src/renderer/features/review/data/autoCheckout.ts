/**
 * Opening a pull request in Review checks it out once, on the last Host used for its
 * repository or else the first connected one (ENG-185: the Risk Summary runs when a Review
 * opens, and it needs the checkout). Choosing another Host, updating and removing are the
 * checkout chip's (`../checkout`).
 */
import type { ReviewCheckoutId, ReviewSubject, WorkspaceId } from "@polaris/protocol";
import { Data } from "effect";
import type { OpenPull } from "../../../../shared/api.ts";
import type { PullDetailView } from "../../../../shared/github.ts";
import { Commands } from "../../../commands.ts";
import { send } from "../../session/dispatch.ts";
import { rememberHost, repoName } from "../checkout/store.ts";
import type { CheckoutPlace } from "./source.ts";

const asked = new Set<string>();

const Subjects = Data.taggedEnum<ReviewSubject>();

export const newCheckoutId = (): ReviewCheckoutId =>
  // SAFETY: ReviewCheckoutId is a branded string the Client chooses.
  crypto.randomUUID() as ReviewCheckoutId;

/** `github.com`, or the GitHub Enterprise host the pull request lives on. */
const codeHost = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return "github.com";
  }
};

export const openCheckout = (place: CheckoutPlace, pull: OpenPull, detail: PullDetailView) =>
  send(
    place.hostKey,
    Commands.OpenReviewCheckout({
      checkoutId: newCheckoutId(),
      // SAFETY: the PR list matched this Workspace id on this Host.
      workspaceId: place.workspaceId as WorkspaceId,
      subject: Subjects.PullRequest({
        pullRequest: { repo: { host: codeHost(detail.url), ...pull.repo }, number: pull.number },
        baseRef: detail.baseRefName,
      }),
      head: detail.headRefOid,
      base: detail.baseRefOid,
    }),
    "Couldn’t check out this pull request"
  );

/** Checks the pull request out once per launch; false when it already asked. */
export const checkOutOnce = (place: CheckoutPlace, pull: OpenPull, detail: PullDetailView) => {
  const key = `${pull.repo.owner}/${pull.repo.name}#${pull.number}`.toLowerCase();

  if (asked.has(key)) return false;

  asked.add(key);
  rememberHost(repoName(pull.repo), place.hostKey);
  void openCheckout(place, pull, detail);

  return true;
};
