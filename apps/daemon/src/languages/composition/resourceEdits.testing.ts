import * as P from "@polaris/protocol";
import { Effect } from "effect";
import { join } from "node:path";
import { fixture } from "../../files/edits/trees/testing.ts";
import { fingerprint } from "../../files/edits/journal.ts";
import { EventStore } from "../../store/EventStore.ts";
import { CurrentLanguageConnection } from "../../transport/currentLanguageConnection.ts";
import { HostProposalEvidence } from "../preparation/provenance.ts";
import { resourceEditHandlers } from "./resourceEdits.ts";
import { denied } from "./authority.ts";

export const resourceFixture = async (store: EventStore["Service"]) => {
  const f = await fixture();
  await Effect.runPromise(
    store.commit({
      commandId: null,
      decide: () =>
        Effect.succeed([
          P.DomainEvent.cases.WorkspaceRegistered.make({
            workspace: new P.Workspace({
              id: f.owner.checkout.workspaceId,
              path: f.root,
              name: "resources",
              isGitRepo: false,
              worktreeRoot: join(f.home, "worktrees"),
              hidden: false,
              registeredAt: new Date().toISOString(),
            }),
          }),
        ]),
    })
  );
  const request = await f.request(f.chain());

  const principal = P.LanguageConnectionIdentity.make({
    hostId: f.owner.hostId,
    clientId: f.owner.clientId,
  });

  let current: P.LanguageConnectionIdentity | null = principal;
  let valid = true;
  let verification = 0;
  let revision: number | null = null;
  let onVerify = async () => {};

  const evidence = new HostProposalEvidence();
  await evidence.record(principal, request.proposal, async () => {
    if (!valid || current !== principal) throw denied();
  });

  const handlers = resourceEditHandlers(
    { hostId: principal.hostId, journalRoot: join(f.home, "journal") },
    {
      owners: {
        owns: (value) => value === current,
        trustFence: () => () => {
          if (!valid) throw denied();
        },
      },
      trust: {
        require: () =>
          Effect.succeed({ checkout: f.owner.checkout, root: f.root, workspaceRoot: f.root }),
      },
      provenance: {
        record: () => Effect.die("unused"),
        revoke: () => Effect.void,
        verify: (value, proposal) =>
          Effect.tryPromise({ try: () => evidence.verify(value, proposal), catch: denied }),
      },
      receipts: {
        proposal: (value) =>
          value === current ? Effect.succeed(request.proposal) : Effect.fail(denied()),
        verify: (value, proposal, drafts, operationId) =>
          Effect.tryPromise({
            try: async () => {
              verification++;
              await onVerify();

              if (
                !valid ||
                value !== current ||
                fingerprint(proposal) !== fingerprint(request.proposal) ||
                fingerprint(drafts) !== fingerprint(request.drafts) ||
                operationId !== "operation"
              )
                throw denied();

              return 1;
            },
            catch: denied,
          }),
        recovery: (value, _owner, operationId, _intent, outcome) =>
          Effect.suspend(() =>
            value === current &&
            valid &&
            operationId === "operation" &&
            revision === outcome.receiptRevision
              ? Effect.succeed(1)
              : Effect.fail(denied())
          ),
      },
    }
  );

  const run = <A, E>(effect: Effect.Effect<A, E, EventStore | CurrentLanguageConnection>) =>
    Effect.runPromise(
      effect.pipe(
        Effect.provideService(EventStore, store),
        Effect.provideService(CurrentLanguageConnection, {
          current: () => current,
          supports: () => true,
        })
      )
    );

  return {
    ...f,
    ...request,
    handlers,
    run,
    principal,
    status: { checkout: f.owner.checkout, clientId: principal.clientId, operationId: "operation" },
    verifyCount: () => verification,
    revoke: () => {
      valid = false;
    },
    replace: () => {
      current = P.LanguageConnectionIdentity.make({ ...principal });
    },
    reconciled: (value: number) => {
      revision = value;
    },
    onVerify: (fn: () => Promise<void>) => {
      onVerify = fn;
    },
    cleanup: async () => {
      evidence.dispose();
      await f.cleanup();
    },
  };
};
