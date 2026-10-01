/**
 * Which Risk Summary an open Review asks for. A pull request's runs on its Review Checkout
 * once its head is fetched and GitHub has answered (the Reviewer gets the PR's title and
 * text); after the checkout moves to new commits it asks for only those (`since`). An
 * Agent Session's covers its Turns since the last accept.
 */
import { Subjects } from "../../../commands.ts";
import { useApp } from "../../../shell/hooks.ts";
import { useComments } from "../../comments/index.ts";
import { type ReviewSlotProps, subjectKey as keyOf } from "../../review/index.ts";
import type { RiskRequest } from "./riskStore.ts";

/** The head each subject was first summarised at, and the one before its latest move. */
const heads = new Map<string, { readonly head: string; readonly since: string | null }>();

/** `since` for a checkout at `head`: null at first, then the head it moved from. */
export const sinceFor = (key: string, head: string): string | null => {
  const seen = heads.get(key);

  if (seen === undefined) {
    heads.set(key, { head, since: null });

    return null;
  }

  if (seen.head === head) return seen.since;
  heads.set(key, { head, since: seen.head });

  return seen.head;
};

const usePullRequest = (props: ReviewSlotProps): RiskRequest | null => {
  const key = keyOf(props.subject);
  const pull = useComments((s) => s.pulls[key]);
  const checkout = props.checkout;
  const head = checkout?.checkout.head ?? null;

  if (checkout === null || head === null || pull === undefined || !pull.settled) return null;

  return {
    hostKey: checkout.hostKey,
    workspaceId: checkout.checkout.workspaceId,
    subject: checkout.checkout.subject,
    checkoutId: checkout.checkout.id,
    since: sinceFor(key, head),
    context: pull.detail === null ? null : { title: pull.detail.title, body: pull.detail.body },
  };
};

const NO_SESSION = { hostKey: "", sessionId: "" };

const useSessionRequest = (props: ReviewSlotProps): RiskRequest | null => {
  const { hostKey, sessionId } = props.subject.kind === "session" ? props.subject : NO_SESSION;

  const session = useApp((s) => {
    for (const model of s.hostModels[hostKey]?.sessions.values() ?? []) {
      if (model.session.id === sessionId) return model.session;
    }

    return undefined;
  });

  if (props.subject.kind !== "session" || session === undefined || session.turnCount === 0) {
    return null;
  }

  return {
    hostKey,
    workspaceId: session.workspaceId,
    subject: Subjects.SessionTurns({
      sessionId: session.id,
      firstTurnId: null,
      lastTurnId: null,
    }),
    checkoutId: null,
    since: null,
    context: null,
  };
};

export const useRiskRequest = (props: ReviewSlotProps): RiskRequest | null => {
  const pull = usePullRequest(props);
  const session = useSessionRequest(props);

  return props.subject.kind === "pull" ? pull : session;
};

/** Whether the subject's Host can run Risk Summaries (capability `review.risk-summary`). */
export const useCanSummarise = (props: ReviewSlotProps) => {
  const hostKey =
    props.subject.kind === "session" ? props.subject.hostKey : (props.checkout?.hostKey ?? null);

  const host = useApp((s) => s.hosts.find((h) => h.key === hostKey));

  return {
    ok:
      hostKey === null ||
      host === undefined ||
      host.status.capabilities.includes("review.risk-summary"),
    host: host?.label ?? hostKey ?? "",
  };
};
