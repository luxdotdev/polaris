import {
  languageFenceSatisfied,
  type LanguageRequestFence,
  type LanguageError,
} from "@polaris/protocol";
import { Effect } from "effect";
import type { ExecutionTrustService } from "../trust/index.ts";
import type { LanguageAcquisitionAuthority } from "./acquisitionAuthority.ts";
import type { LanguageBroker } from "../runtime/service.ts";
import type { ServerPreparationAccess } from "../runtime/serverPreparation.ts";
import { denied, type RequestAuthority } from "./authority.ts";

/** Retained evidence captures only authority and document coordinates, never an edit or RPC signal. */
export const proposalValidator = (
  auth: RequestAuthority,
  owners: LanguageAcquisitionAuthority["Service"],
  trust: ExecutionTrustService["Service"],
  fence: LanguageRequestFence,
  documentFence: () => Effect.Effect<void, LanguageError>,
  resources: boolean
) => {
  const trustCurrent = owners.trustFence({
    hostId: auth.principal.hostId,
    workspaceId: fence.context.checkout.workspaceId,
  });

  const current = Effect.try({
    try: () => {
      if (
        auth.lost() ||
        !owners.owns(auth.principal) ||
        (resources && !auth.supports("languages.resources.tree-v2"))
      )
        throw denied();
      trustCurrent();
    },
    catch: denied,
  });

  const validate = Effect.gen(function* () {
    yield* current;
    yield* auth.coordinates(fence.context);
    yield* auth.checkout(fence.context.checkout);
    yield* current;
    yield* trust.require(fence.context.checkout);
    yield* current;
    yield* auth.checkout(fence.context.checkout);
    yield* current;
    yield* documentFence();
    yield* current;
  }).pipe(
    Effect.timeout(5000),
    Effect.catchTag("TimeoutError", () => Effect.fail(denied()))
  );

  return () => Effect.runPromise(validate);
};

export const featureProposalValidator = (
  broker: LanguageBroker["Service"],
  auth: RequestAuthority,
  owners: LanguageAcquisitionAuthority["Service"],
  trust: ExecutionTrustService["Service"],
  fence: LanguageRequestFence,
  resources: boolean
) =>
  proposalValidator(
    auth,
    owners,
    trust,
    fence,
    () =>
      broker
        .snapshot(auth.principal.clientId, fence.context)
        .pipe(
          Effect.flatMap((value) =>
            languageFenceSatisfied(fence, value.ack) ? Effect.void : Effect.fail(denied())
          )
        ),
    resources
  );

export const serverProposalValidator = (
  access: ServerPreparationAccess,
  auth: RequestAuthority,
  owners: LanguageAcquisitionAuthority["Service"],
  trust: ExecutionTrustService["Service"],
  fence: LanguageRequestFence,
  resources: boolean
) =>
  proposalValidator(
    auth,
    owners,
    trust,
    fence,
    () => Effect.try({ try: () => access.fence(fence), catch: denied }),
    resources
  );
