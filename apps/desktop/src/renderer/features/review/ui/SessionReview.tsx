/**
 * An Agent Session's Turns in Review (Paper R2 223-0): the Turns since the last accept,
 * each its own section with a divider, or one Turn picked in the header.
 */
import { harnessHue } from "@polaris/ui";
import { useState } from "react";
import type { SessionSubject } from "../../../routes/review.ts";
import { useApp } from "../../../shell/hooks.ts";
import { useSession } from "../../session/hooks.ts";
import { pendingTurns, sessionSource, type TurnInfo, type TurnPick } from "../data/source.ts";
import { useReviewDiff } from "../data/useReviewDiff.ts";
import { reviewSlots, subjectKey } from "../surface.ts";
import { ReviewBody } from "./ReviewBody.tsx";
import { SessionHeader } from "./SubjectHeader.tsx";

const ALL: TurnPick = { kind: "all" };

export const SessionReview = ({ subject }: { readonly subject: SessionSubject }) => {
  const { hostKey, sessionId } = subject;
  const model = useSession(hostKey, sessionId);
  const host = useApp((s) => s.hosts.find((h) => h.key === hostKey));
  const workspaces = useApp((s) => s.hostModels[hostKey]?.workspaces);
  const [pick, setPick] = useState<TurnPick>(ALL);
  const { session } = model;
  const turns: ReadonlyArray<TurnInfo> = model.turns.map((t) => t.turn);
  const source = session === null ? null : sessionSource(hostKey, session, turns, pick);
  const diff = useReviewDiff(source);
  const pending = pendingTurns(turns, session?.acceptedThroughIndex ?? null);
  const slotProps = { subject, checkout: null };
  const { CheckoutChip, PrimaryAction } = reviewSlots.current;

  const workspace =
    session === null ? undefined : (workspaces?.get(session.workspaceId)?.name ?? undefined);

  const caption = [
    session === null ? null : harnessHue(session.harness).name,
    session?.state ?? null,
    workspace === undefined ? null : `${workspace} on ${host?.label ?? hostKey}`,
    pending.length === 0
      ? null
      : `${pending.length} ${pending.length === 1 ? "turn" : "turns"} since your last review`,
  ]
    .filter((part) => part !== null)
    .join(" · ");

  return (
    <section data-testid="session-review" className="flex min-h-0 flex-1 flex-col">
      <SessionHeader
        title={session?.title ?? "Agent session"}
        harness={session?.harness ?? ""}
        caption={caption}
        pending={pending}
        pick={pick}
        onPick={setPick}
        actions={
          <>
            <CheckoutChip {...slotProps} />
            <PrimaryAction {...slotProps} />
          </>
        }
      />
      <ReviewBody
        subjectKey={subjectKey(subject)}
        slotProps={slotProps}
        diff={diff}
        pullViewed={null}
        placeholder={
          session !== null && turns.length === 0
            ? { title: "No turns yet", fact: "This session hasn’t changed anything to review" }
            : null
        }
      />
    </section>
  );
};
