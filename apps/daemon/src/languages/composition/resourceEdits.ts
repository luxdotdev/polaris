import * as P from "@polaris/protocol";
import { Context, Effect, Layer, Schema } from "effect";
import { createTreeEditCoordinator, type Owner } from "../../files/edits/trees/index.ts";
import { fingerprint } from "../../files/edits/journal.ts";
import { ProposalProvenance } from "../preparation/provenanceService.ts";
import { ExecutionTrustService } from "../trust/index.ts";
import { LanguageAcquisitionAuthority } from "./acquisitionAuthority.ts";
import { denied, requestAuthority, type RequestAuthority } from "./authority.ts";
import { LanguageResourceReceiptAuthority } from "./resourceEditsAuthority.ts";

interface ResourceServices {
  readonly owners: Pick<LanguageAcquisitionAuthority["Service"], "owns" | "trustFence">;
  readonly trust: Pick<ExecutionTrustService["Service"], "require">;
  readonly provenance: ProposalProvenance["Service"];
  readonly receipts: LanguageResourceReceiptAuthority["Service"];
}

export interface ResourceEditOptions {
  readonly hostId: P.HostId;
  /** Canonical private Daemon directory on the resource filesystem, outside every checkout. */
  readonly journalRoot: string;
}

const unknownOperation = () =>
  new P.LanguageError({
    reason: "not-ready",
    message: "Resource outcome is unknown; reconcile status without replaying acceptance",
    retryable: false,
  });

const resourceOperation = <A>(operation: (signal: AbortSignal) => Promise<A>) =>
  Effect.tryPromise({
    try: operation,
    catch: (cause) =>
      Schema.is(P.LanguageError)(cause)
        ? cause
        : new P.LanguageError({
            reason: "recovery-required",
            message: "Resource outcome is unavailable; reconcile durable status before recovery",
            retryable: false,
          }),
  });

/** Uses the existing X2 journal for regular files and trees; no payload creates proposal authority. */
export function resourceEditHandlers(options: ResourceEditOptions, services: ResourceServices) {
  const authenticate = (auth: RequestAuthority, owner: Owner, signal: AbortSignal) =>
    Effect.gen(function* () {
      yield* auth.check;

      if (
        signal.aborted ||
        owner.hostId !== auth.principal.hostId ||
        owner.clientId !== auth.principal.clientId ||
        !auth.supports("languages.resources.tree-v2")
      )
        return yield* Effect.fail(denied());
      yield* auth.checkout(owner.checkout);
      yield* auth.check;
    });

  const ownerFor = (auth: RequestAuthority, checkout: P.LanguageCheckout): Owner => ({
    hostId: auth.principal.hostId,
    clientId: auth.principal.clientId,
    checkout,
  });

  const coordinator = (
    auth: RequestAuthority,
    owner: Owner,
    signal: AbortSignal,
    expectedRevision?: number
  ) => {
    let draftRevision: number | undefined;
    let recoveryRevision: number | undefined;

    const trustCurrent = services.owners.trustFence({
      hostId: owner.hostId,
      workspaceId: owner.checkout.workspaceId,
    });

    const current = () => {
      if (signal.aborted || auth.lost()) throw denied();
      trustCurrent();
    };

    const run = <A>(effect: Effect.Effect<A, P.LanguageError>) =>
      Effect.runPromise(effect, { signal });

    return createTreeEditCoordinator({
      journalRoot: options.journalRoot,
      authorize: async (claimed, proposal, acceptance, drafts, phase = "prepare") => {
        current();
        await run(authenticate(auth, claimed, signal));
        await run(auth.coordinates(proposal.fence.context));

        if (!services.owners.owns(auth.principal)) throw denied();
        await run(services.trust.require(claimed.checkout));
        await run(services.provenance.verify(auth.principal, proposal));

        if (acceptance.decision === "accept") {
          if (drafts === null) throw denied();

          const revision = await run(
            services.receipts.verify(
              auth.principal,
              proposal,
              drafts,
              acceptance.operationId,
              phase
            )
          );

          if (draftRevision !== undefined && draftRevision !== revision) throw denied();
          draftRevision = revision;
        }

        current();
        await run(authenticate(auth, claimed, signal));
        await run(services.provenance.verify(auth.principal, proposal));
        current();
      },
      authorizeRecovery: async (claimed, operationId, intent, outcome, authority) => {
        current();
        await run(authenticate(auth, claimed, signal));

        if (outcome !== undefined && intent !== "get") {
          if (outcome.receiptRevision !== expectedRevision || authority === undefined)
            throw denied();
          await run(services.trust.require(claimed.checkout));

          const revision = await run(
            services.receipts.recovery(
              auth.principal,
              claimed,
              operationId,
              intent,
              outcome,
              authority
            )
          );

          if (recoveryRevision !== undefined && recoveryRevision !== revision) throw denied();
          recoveryRevision = revision;
        }

        current();
        await run(authenticate(auth, claimed, signal));
        current();
      },
    });
  };

  const treeDecide = (input: P.LanguageTreeEditDecision) =>
    Effect.gen(function* () {
      const decision = yield* Effect.try({
        try: () => Schema.decodeUnknownSync(P.LanguageTreeEditDecision)(input),
        catch: denied,
      });

      const auth = yield* requestAuthority(options.hostId);
      const owner = ownerFor(auth, decision.acceptance.fence.context.checkout);
      yield* auth.coordinates(decision.acceptance.fence.context);

      return yield* resourceOperation(async (signal) => {
        await Effect.runPromise(authenticate(auth, owner, signal), { signal });

        const proposal = Schema.decodeUnknownSync(P.LanguageTreeEditProposal)(
          await Effect.runPromise(services.receipts.proposal(auth.principal, decision.acceptance), {
            signal,
          })
        );

        if (
          proposal.proposalId !== decision.acceptance.proposalId ||
          fingerprint(proposal.fence) !== fingerprint(decision.acceptance.fence) ||
          fingerprint(proposal.snapshots) !== fingerprint(decision.acceptance.snapshots) ||
          fingerprint(proposal.resourceSnapshots) !==
            fingerprint(decision.acceptance.resourceSnapshots)
        )
          throw denied();

        const result = await coordinator(auth, owner, signal).accept(
          owner,
          proposal,
          decision.acceptance,
          decision.drafts,
          signal
        );

        await Effect.runPromise(authenticate(auth, owner, signal), { signal });

        return result;
      });
    });

  const treeGet = (input: typeof P.GetLanguageTreeOperation.payloadSchema.Type) =>
    Effect.gen(function* () {
      const auth = yield* requestAuthority(options.hostId);

      if (input.clientId !== auth.principal.clientId) return yield* Effect.fail(denied());
      const owner = ownerFor(auth, input.checkout);

      return yield* resourceOperation(async (signal) => {
        await Effect.runPromise(authenticate(auth, owner, signal), { signal });
        const result = await coordinator(auth, owner, signal).get(owner, input.operationId);
        await Effect.runPromise(authenticate(auth, owner, signal), { signal });

        if (result === null) throw unknownOperation();

        return result;
      });
    });

  const treeRecover = (input: typeof P.RecoverLanguageTreeOperation.payloadSchema.Type) =>
    Effect.gen(function* () {
      const auth = yield* requestAuthority(options.hostId);

      if (input.clientId !== auth.principal.clientId) return yield* Effect.fail(denied());
      const owner = ownerFor(auth, input.checkout);

      return yield* resourceOperation(async (signal) => {
        await Effect.runPromise(authenticate(auth, owner, signal), { signal });

        const result = await coordinator(
          auth,
          owner,
          signal,
          input.expectedReceiptRevision
        ).recover(owner, input.operationId, input.expectedReceiptRevision, input.intent);

        await Effect.runPromise(authenticate(auth, owner, signal), { signal });

        return result;
      });
    });

  return { treeDecide, treeGet, treeRecover };
}

export class LanguageResourceEdits extends Context.Service<
  LanguageResourceEdits,
  ReturnType<typeof resourceEditHandlers>
>()("polaris/languages/LanguageResourceEdits") {
  static layer(options: ResourceEditOptions) {
    return Layer.effect(
      LanguageResourceEdits,
      Effect.gen(function* () {
        return LanguageResourceEdits.of(
          resourceEditHandlers(options, {
            owners: yield* LanguageAcquisitionAuthority,
            trust: yield* ExecutionTrustService,
            provenance: yield* ProposalProvenance,
            receipts: yield* LanguageResourceReceiptAuthority,
          })
        );
      })
    );
  }
}
