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
import type { HostModel } from "../../../store/hostModel.ts";
import { asPlain } from "../../../store/plain.ts";
import type { AppStore } from "../../../store/store.ts";
import type { ConstellationClient, Outcome } from "../client.ts";
import { merged } from "../model/fold.ts";
import { applyEnvelopes, emptyConstellations, type Proposal } from "../model/index.ts";

type Event = DomainEvent;

const E = DomainEvent.cases;

const ok = (summary: string): Outcome => ({ ok: true, summary });

/** An accepted proposal becomes a Task at its first revision. */
const taskFrom = (t: Proposal["task"]) =>
  new Task({
    id: t.id,
    title: t.title,
    kind: t.kind,
    deps: t.deps,
    area: t.area,
    brief: t.brief,
    criteria: t.criteria,
    suggested: t.suggested,
    group: t.group,
    revision: 1,
    canceled: false,
  });

const tier = (receipts: ReadonlyArray<CheckReceipt>): EvidenceTier => {
  if (receipts.length === 0) return "asserted";

  return receipts.some((x) => Predicate.isTagged(x, "Verified")) ? "verified" : "reported";
};

const rerunSetups = (
  sessions: HostModel["sessions"],
  constellationId: string,
  tasks: ReadonlySet<string>
): HostModel["sessions"] =>
  new Map(
    [...sessions].map(([id, entry]) => {
      const run = entry.session.worktreeSetup;

      if (run == null || run.constellationId !== constellationId || !tasks.has(run.taskId))
        return [id, entry];
      const at = new Date().toISOString();

      return [
        id,
        {
          ...entry,
          session: {
            ...asPlain(entry.session),
            state: "dormant",
            lastError: null,
            worktreeSetup: {
              ...asPlain(run),
              id: `${run.id}-again`,
              status: "running",
              output: "",
              exitCode: null,
              startedAt: at,
              endedAt: null,
            },
          },
        },
      ];
    })
  );

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
              task: taskFrom(proposal.task),
            })
          : E.ProposalDeclined.make({ ...graph, proposalId, reason }),
      ]);

      return ok(accept ? "Proposal accepted" : "Proposal declined");
    },
    dispatch: async (_hostKey, input) => {
      // The worker Sessions' setup runs again: a failed one goes back to running.
      const ids = new Set<string>((input.tasks ?? []).map((t) => t.taskId));

      store.setState((s) => ({
        hostModels: Object.fromEntries(
          Object.entries(s.hostModels).map(([key, model]) => [
            key,
            { ...model, sessions: rerunSetups(model.sessions, input.constellationId, ids) },
          ])
        ),
      }));

      return ok("Dispatched");
    },
    message: async () => ok("Sent; the lead sees it in its next digest"),
    setState: async () => ok("State changed"),
  };
};
