/** What a Teammate's session feed leaves out: the owner's Secret Requests and their answers. */
import { type ApprovalRequest, SessionStreamItem } from "@polaris/protocol";
import { Predicate, Stream } from "effect";

const shown = (request: ApprovalRequest) => request.kind !== "secret";

/** Whether a Teammate sees `item`: never a Secret Request, nor a secret provided for one. */
const seen = (item: SessionStreamItem): boolean => {
  if (!Predicate.isTagged(item, "Event")) return true;
  const { event } = item.envelope;

  if (Predicate.isTagged(event, "ApprovalRequested")) return shown(event.request);

  return !(
    Predicate.isTagged(event, "ApprovalResolved") && Predicate.isTagged(event.decision, "Provided")
  );
};

const withoutSecrets = (item: SessionStreamItem): SessionStreamItem =>
  Predicate.isTagged(item, "Snapshot") && !item.pendingApprovals.every(shown)
    ? SessionStreamItem.cases.Snapshot.make({
        ...item,
        pendingApprovals: item.pendingApprovals.filter(shown),
      })
    : item;

/** A session feed as a Teammate reads it. */
export const teammateSessionFeed = <E, R>(items: Stream.Stream<SessionStreamItem, E, R>) =>
  items.pipe(Stream.filter(seen), Stream.map(withoutSecrets));
