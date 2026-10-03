import { randomUUID } from "node:crypto";
import { fingerprint } from "../../files/edits/journal.ts";
import type { Journal } from "../../files/edits/trees/journal.ts";
import { LanguageBroker } from "../runtime/service.ts";
import { ProposalProvenance } from "../preparation/provenanceService.ts";
import { LanguageAcquisitionAuthority } from "./acquisitionAuthority.ts";
import { denied } from "./authority.ts";
import * as P from "@polaris/protocol";
import { Context, Effect, Layer, Schema } from "effect";
import type { Owner } from "../../files/edits/trees/index.ts";

export type ResourceRecoveryIntent = "get" | "recover" | "undo" | "cancel";

/** Private connection-bound Client access; implementations must read R1's durable group, never trust payload flags. */
export class LanguageResourceReceiptAuthority extends Context.Service<
  LanguageResourceReceiptAuthority,
  {
    proposal: (
      principal: P.LanguageConnectionIdentity,
      acceptance: P.LanguageTreeEditAcceptance
    ) => Effect.Effect<P.LanguageTreeEditProposal, P.LanguageError>;
    verify: (
      principal: P.LanguageConnectionIdentity,
      proposal: P.LanguageTreeEditProposal,
      drafts: P.LanguageTreeDraftReceipt,
      operationId: string,
      phase?: "prepare" | "moving"
    ) => Effect.Effect<number, P.LanguageError>;
    recovery: (
      principal: P.LanguageConnectionIdentity,
      owner: Owner,
      operationId: string,
      intent: ResourceRecoveryIntent,
      outcome: P.LanguageTreeOperationOutcome,
      authority: NonNullable<Journal["authority"]>
    ) => Effect.Effect<number, P.LanguageError>;
  }
>()("polaris/languages/LanguageResourceReceiptAuthority") {
  static readonly layer = Layer.effect(
    LanguageResourceReceiptAuthority,
    Effect.gen(function* () {
      const owners = yield* LanguageAcquisitionAuthority;

      return resourceReceiptAuthority(
        yield* LanguageBroker,
        yield* ProposalProvenance,
        owners.owns
      );
    })
  );

  static readonly unavailableLayer = Layer.succeed(LanguageResourceReceiptAuthority)({
    proposal: () => Effect.fail(unavailableResourceReceipt()),
    verify: () => Effect.fail(unavailableResourceReceipt()),
    recovery: () => Effect.fail(unavailableResourceReceipt()),
  });
}

export const unavailableResourceReceipt = () =>
  new P.LanguageError({
    reason: "not-ready",
    message: "Authenticated durable refactor group authority is unavailable",
    retryable: false,
  });

export function resourceReceiptAuthority(
  broker: Pick<LanguageBroker["Service"], "challengeReceipt" | "challengeRecoveryReceipt">,
  provenance: Pick<ProposalProvenance["Service"], "verify">,
  current: (principal: P.LanguageConnectionIdentity) => boolean
): LanguageResourceReceiptAuthority["Service"] {
  const challenge = (
    principal: P.LanguageConnectionIdentity,
    context: P.LanguageContextIdentity,
    input: P.LanguageResourceReceiptChallenge
  ) =>
    Effect.gen(function* () {
      if (
        !current(principal) ||
        principal.hostId !== context.hostId ||
        principal.clientId !== context.clientId
      )
        return yield* Effect.fail(denied());

      const response = yield* Effect.tryPromise({
        try: (signal) =>
          Effect.runPromise(
            Schema.is(P.LanguageResourceReceiptChallenge.cases.Recover)(input)
              ? broker.challengeRecoveryReceipt(principal.clientId, context, input, signal)
              : broker.challengeReceipt(principal.clientId, context, input, signal),
            {
              signal,
            }
          ),
        catch: () => unavailableResourceReceipt(),
      });

      if (!current(principal)) return yield* Effect.fail(denied());

      return response;
    });

  return LanguageResourceReceiptAuthority.of({
    proposal: (principal, acceptance) =>
      Effect.gen(function* () {
        const response = yield* challenge(
          principal,
          acceptance.fence.context,
          P.LanguageResourceReceiptChallenge.cases.Resolve.make({
            nonce: randomUUID(),
            operationId: acceptance.operationId,
            acceptance,
          })
        );

        const proposal = response.proposal;

        if (proposal === undefined || response.previewFingerprint !== fingerprint(proposal))
          return yield* Effect.fail(denied());
        yield* provenance.verify(principal, proposal);

        return proposal;
      }),
    verify: (principal, proposal, drafts, operationId, phase = "prepare") =>
      Effect.gen(function* () {
        yield* provenance.verify(principal, proposal);

        const response = yield* challenge(
          principal,
          proposal.fence.context,
          P.LanguageResourceReceiptChallenge.cases.Verify.make({
            nonce: randomUUID(),
            operationId,
            proposal,
            drafts,
            phase,
          })
        );

        if (
          response.groupId !== drafts.groupId ||
          response.previewFingerprint !== fingerprint(proposal) ||
          response.hostReceiptRevision !== null ||
          response.proposal !== undefined
        )
          return yield* Effect.fail(denied());
        yield* provenance.verify(principal, proposal);

        return response.localRevision;
      }),
    recovery: (principal, owner, operationId, intent, outcome, authority) =>
      Effect.gen(function* () {
        if (intent === "get") return 0;

        if (outcome.draftGroupId === null || fingerprint(owner) !== fingerprint(outcome.owner))
          return yield* Effect.fail(denied());

        const response = yield* challenge(
          principal,
          authority.context,
          P.LanguageResourceReceiptChallenge.cases.Recover.make({
            nonce: randomUUID(),
            operationId,
            proposalId: outcome.proposalId,
            groupId: outcome.draftGroupId,
            previewFingerprint: authority.previewFingerprint,
            hostReceiptRevision: outcome.receiptRevision,
            intent,
          })
        );

        if (
          response.groupId !== outcome.draftGroupId ||
          response.previewFingerprint !== authority.previewFingerprint ||
          response.hostReceiptRevision !== outcome.receiptRevision ||
          response.proposal !== undefined
        )
          return yield* Effect.fail(denied());

        return response.localRevision;
      }),
  });
}
