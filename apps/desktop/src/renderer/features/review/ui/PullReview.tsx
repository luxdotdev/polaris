/**
 * A pull request in Review: its detail from GitHub, its diff from the Review Checkout
 * (checked out on first open where a Workspace holds the repository), and Viewed synced
 * with GitHub.
 */
import type { ReviewCheckoutBlocker } from "@polaris/protocol";
import { Match } from "effect";
import { useEffect } from "react";
import type { HostView } from "../../../../shared/api.ts";
import type { PullSubject } from "../../../routes/review.ts";
import { useApp } from "../../../shell/hooks.ts";
import { placeToOpen } from "../checkout/model/hosts.ts";
import { usePlaces } from "../checkout/useCheckout.ts";
import { checkoutMemory, repoName, useCheckoutMemory } from "../checkout/store.ts";
import { checkOutOnce } from "../data/autoCheckout.ts";
import { usePullDetail } from "../data/pullDetail.ts";
import { type CheckoutWait, pullSource } from "../data/source.ts";
import { useReviewDiff } from "../data/useReviewDiff.ts";
import { reviewSlots, subjectKey } from "../surface.ts";
import { type Placeholder, ReviewBody } from "./ReviewBody.tsx";
import { PullHeader } from "./SubjectHeader.tsx";

const labelOf = (hosts: ReadonlyArray<HostView>, hostKey: string) =>
  hosts.find((h) => h.key === hostKey)?.label ?? hostKey;

const blockerText = (blocker: ReviewCheckoutBlocker | undefined) =>
  blocker === undefined
    ? "Its host couldn’t fetch the pull request"
    : Match.value(blocker).pipe(
        Match.tagsExhaustive({
          FetchFailed: ({ message }) => message,
          ShallowClone: () => "This host’s clone is shallow: fetch its full history to review here",
          Dirty: () => "The checkout has local edits",
          LocalCommits: () => "The checkout has local commits",
          InUse: () => "A session or terminal is working in the checkout",
        })
      );

const placeholderOf = (wait: CheckoutWait, hosts: ReadonlyArray<HostView>): Placeholder => {
  if (wait.kind === "fetching") {
    return {
      title: `Checking out on ${labelOf(hosts, wait.hostKey)}`,
      fact: "Fetching the pull request with this host’s git credentials",
    };
  }

  if (wait.kind === "failed") {
    return {
      title: "The review checkout is blocked",
      fact: blockerText(wait.checkout.blocked?.blocker),
    };
  }

  return wait.hosts.length === 0
    ? {
        title: "No workspace has this repository",
        fact: "Open a folder with it on a host to check it out there",
      }
    : {
        title: "Waiting for a host",
        fact: `${labelOf(hosts, wait.hosts[0]?.hostKey ?? "")} checks it out once it’s connected`,
      };
};

export const PullReview = ({ subject }: { readonly subject: PullSubject }) => {
  const { pull } = subject;
  const detail = usePullDetail(pull);
  const models = useApp((s) => s.hostModels);
  const hosts = useApp((s) => s.hosts);
  const places = usePlaces(pull);
  const lastHost = useCheckoutMemory((s) => s.lastHost[repoName(pull.repo)] ?? null);
  const state = pullSource(pull, models, places, lastHost);
  const diff = useReviewDiff(state.kind === "ready" ? state.source : null);
  const loaded = detail.kind === "ok" ? detail.detail : null;
  const waitingForNone = state.kind === "waiting" && state.wait.kind === "none";

  useEffect(() => {
    // A merged or closed pull request, or one whose checkout was just removed, isn't checked out again.
    if (!waitingForNone || loaded === null || loaded.state !== "open") return;

    const connected = (key: string) =>
      hosts.some((h) => h.key === key && h.status.state === "connected");

    const place = placeToOpen(
      places,
      checkoutMemory.getState().lastHost[repoName(pull.repo)] ?? null,
      connected
    );

    if (place !== null) checkOutOnce(place, pull, loaded);
  }, [waitingForNone, loaded, places, hosts, pull]);

  const key = subjectKey(subject);

  const slotProps = {
    subject,
    checkout:
      state.kind === "ready" ? { hostKey: state.source.hostKey, checkout: state.checkout } : null,
  };

  const { CheckoutChip, PrimaryAction } = reviewSlots.current;
  const name = `${pull.repo.owner}/${pull.repo.name}`;

  return (
    <section
      data-testid="pull-review"
      data-pull={pull.pullId ?? ""}
      className="flex min-h-0 flex-1 flex-col"
    >
      <PullHeader
        name={name}
        number={pull.number}
        detail={loaded}
        actions={
          <>
            <CheckoutChip {...slotProps} />
            <PrimaryAction {...slotProps} />
          </>
        }
      />
      <ReviewBody
        subjectKey={key}
        slotProps={slotProps}
        diff={diff}
        pullViewed={{
          pull: { repo: pull.repo, number: pull.number },
          pullId: loaded?.id ?? pull.pullId ?? "",
          files: loaded?.files ?? [],
        }}
        placeholder={state.kind === "waiting" ? placeholderOf(state.wait, hosts) : null}
      />
    </section>
  );
};
