import { Context, Effect, Layer } from "effect";
import { LanguageError } from "@polaris/protocol";
import {
  HostProposalEvidence,
  type PreparedProposal,
  type ProposalPrincipal,
} from "./provenance.ts";

const unavailable = () =>
  new LanguageError({
    reason: "stale-document",
    message: "Current Host proposal evidence unavailable",
    retryable: false,
  });

export class ProposalProvenance extends Context.Service<
  ProposalProvenance,
  {
    record: (
      principal: ProposalPrincipal,
      proposal: PreparedProposal,
      validate: () => Promise<void>
    ) => Effect.Effect<void, LanguageError>;
    verify: (
      principal: ProposalPrincipal,
      proposal: PreparedProposal
    ) => Effect.Effect<void, LanguageError>;
    revoke: (principal: ProposalPrincipal) => Effect.Effect<void>;
  }
>()("polaris/languages/ProposalProvenance") {
  static readonly layer = Layer.effect(
    ProposalProvenance,
    Effect.gen(function* () {
      const evidence = yield* Effect.acquireRelease(
        Effect.sync(() => new HostProposalEvidence()),
        (store) => Effect.sync(() => store.dispose())
      );

      return ProposalProvenance.of({
        record: Effect.fn("ProposalProvenance.record")(
          (
            principal: ProposalPrincipal,
            proposal: PreparedProposal,
            validate: () => Promise<void>
          ) =>
            Effect.tryPromise({
              try: (signal) => evidence.record(principal, proposal, validate, signal),
              catch: unavailable,
            })
        ),
        verify: Effect.fn("ProposalProvenance.verify")(
          (principal: ProposalPrincipal, proposal: PreparedProposal) =>
            Effect.tryPromise({
              try: () => evidence.verify(principal, proposal),
              catch: unavailable,
            })
        ),
        revoke: (principal) => Effect.sync(() => evidence.revoke(principal)),
      });
    })
  );
}
