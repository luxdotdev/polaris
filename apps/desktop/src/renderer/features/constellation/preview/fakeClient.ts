/**
 * A stand-in for the Daemon in previews: each command becomes the events the decider would
 * commit, folded into the store, so the tab can be driven end to end without a Host.
 */
import {
  Attempt,
  AttemptCause,
  AttemptId,
  type CheckReceipt,
  DomainEvent,
  type EvidenceTier,
  Task,
} from "@polaris/protocol";
import { Match, Predicate } from "effect";
import type { AppStore } from "../../../store/store.ts";
import type { ConstellationClient, Outcome } from "../client.ts";
import { merged } from "../model/fold.ts";
import { applyEnvelopes, emptyConstellations } from "../model/index.ts";

type Event = DomainEvent;

const E = DomainEvent.cases;

const ok = (summary: string): Outcome => ({ ok: true, summary });

const tier = (receipts: ReadonlyArray<CheckReceipt>): EvidenceTier => {
  if (receipts.length === 0) return "asserted";

  return receipts.some((x) => Predicate.isTagged(x, "Verified")) ? "verified" : "reported";
};

export const fakeClient = (store: AppStore): ConstellationClient => {
  let sequence = 1000;

  const commit = (hostKey: string, events: ReadonlyArray<Event>) => {
    const at = new Date().toISOString();

    store.setState((s) => ({
      constellations: {
        ...s.constellations,
        [hostKey]: applyEnvelopes(
          s.constellations[hostKey] ?? emptyConstellations,
          events.map((event) => ({ sequence: (sequence += 1), occurredAt: at, event }))
        ),
      },
    }));
  };

  const record = (hostKey: string, id: string) =>
    store.getState().constellations[hostKey]?.byId.get(id);

  return {
    review: async (hostKey, input) => {
      const r = record(hostKey, input.constellationId);
      const a = r?.constellation.attempts.find((x) => x.id === input.attemptId);

      if (r === undefined || a === undefined)
        return { ok: false, message: "No such attempt", fix: null };

      if (a.revision !== input.revision)
        return {
          ok: false,
          message: `${a.taskId} changed since you opened it`,
          fix: "Review it again",
        };

      const graph = {
        constellationId: input.constellationId,
        revision: r.constellation.revision + 1,
      };

      const attempt = { ...graph, attemptId: a.id, attemptRevision: a.revision + 1 };

      const events = Match.value(input.action).pipe(
        Match.tagsExhaustive({
          Approve: () => [
            E.ClaimApproved.make({ ...attempt, by: "user", at: new Date().toISOString() }),
          ],
          HandUp: ({ reason }) => [
            E.ClaimHandedUp.make({ ...attempt, reason, at: new Date().toISOString() }),
          ],
          Accept: ({ mergedHead, receipts }): ReadonlyArray<Event> => [
            E.AttemptAccepted.make({ ...attempt, mergedHead, receipts, evidence: tier(receipts) }),
          ],
          SendBack: ({ reason }): ReadonlyArray<Event> => [
            E.AttemptRejected.make({ ...attempt, reason }),
            E.AttemptStarted.make({
              ...graph,
              attempt: new Attempt(
                merged(a, {
                  id: AttemptId.make(`${a.id}-next`),
                  revision: 1,
                  cause: AttemptCause.cases.SentBack.make({ ref: a.id }),
                  state: "working",
                  claim: null,
                  startedAt: new Date().toISOString(),
                  endedAt: null,
                })
              ),
            }),
          ],
          Stop: ({ reason }): ReadonlyArray<Event> => [
            E.AttemptSettled.make({ ...attempt, outcome: "lost", reason }),
          ],
        })
      );

      commit(hostKey, events);

      return ok(`${a.taskId} reviewed`);
    },
    answer: async (hostKey, input) => {
      const r = record(hostKey, input.constellationId);

      if (r === undefined || !Predicate.isTagged(input.action, "Proposal")) return ok("answered");
      const { proposalId, accept, reason } = input.action;
      const proposal = r.proposals.find((p) => p.proposalId === proposalId);

      const graph = {
        constellationId: input.constellationId,
        revision: r.constellation.revision + 1,
      };

      if (proposal === undefined) return ok("answered");

      commit(hostKey, [
        accept
          ? E.ProposalAccepted.make({
              ...graph,
              proposalId,
              task: new Task({ ...proposal.task, revision: 1, canceled: false }),
            })
          : E.ProposalDeclined.make({ ...graph, proposalId, reason }),
      ]);

      return ok(accept ? "Proposal accepted" : "Proposal declined");
    },
    message: async () => ok("Sent; the lead sees it in its next digest"),
    setState: async () => ok("State changed"),
  };
};
