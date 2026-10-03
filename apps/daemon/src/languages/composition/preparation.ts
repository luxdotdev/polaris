import { randomUUID } from "node:crypto";
import { LanguageError, LanguageRuntime } from "@polaris/protocol";
import { Effect, Schema } from "effect";
import { fingerprint } from "../../files/edits/journal.ts";
import { ProposalPreparation } from "../preparation/index.ts";
import { HostDelivery } from "../preparation/contracts.ts";
import type { EditFeatureIntent } from "../runtime/featureEvidence.ts";
import { LanguageBroker, languageOperation } from "../runtime/service.ts";
import type { ProposalProvenance } from "../preparation/provenanceService.ts";
import type { LanguageAcquisitionAuthority } from "./acquisitionAuthority.ts";
import type { ExecutionTrustService } from "../trust/index.ts";
import { featureProposalValidator } from "./proposalValidator.ts";
import type { RequestAuthority } from "./authority.ts";
import { denied } from "./authority.ts";

export interface PreparationIntent extends EditFeatureIntent {
  readonly label: string;
}

/** A request-private delivery is minted only after the broker verifies its recorded provider result. */
export const prepareFeatureEdit = (
  broker: LanguageBroker["Service"],
  auth: RequestAuthority,
  owners: LanguageAcquisitionAuthority["Service"],
  trust: ExecutionTrustService["Service"],
  provenance: ProposalProvenance["Service"],
  intent: PreparationIntent
) =>
  Effect.gen(function* () {
    const preparation = yield* ProposalPreparation;
    const owns = () => owners.owns(auth.principal);
    const fence = intent.request.fence;
    const resources = intent.edit.documentChanges?.some((change) => "kind" in change) === true;
    const retained = featureProposalValidator(broker, auth, owners, trust, fence, resources);

    const validate = Effect.gen(function* () {
      yield* auth.checkout(intent.request.fence.context.checkout);

      if (!owns() || auth.lost()) return yield* Effect.fail(denied());

      if (resources && !auth.supports("languages.resources.tree-v2"))
        return yield* Effect.fail(
          new LanguageError({
            reason: "unsupported-capability",
            message: "Resource preparation requires negotiated tree support",
            retryable: false,
          })
        );
      yield* broker.verifyFeatureEdit(auth.principal.clientId, intent);
      yield* auth.check;

      if (!owns()) return yield* Effect.fail(denied());
    });

    yield* validate;
    const snapshot = yield* broker.snapshot(auth.principal.clientId, intent.request.fence.context);

    if (!Schema.is(LanguageRuntime.cases.Ready)(snapshot.runtime))
      return yield* Effect.fail(
        new LanguageError({
          reason: "stale-document",
          message: "Provider is unavailable",
          retryable: false,
        })
      );

    const delivery = Schema.decodeUnknownSync(HostDelivery)({
      edit: intent.edit,
      fence: intent.request.fence,
      origin: intent.origin,
      label: intent.label,
      encoding: snapshot.runtime.capabilities.positionEncoding,
    });

    const id = randomUUID();
    const hash = fingerprint(delivery);
    const expiresAt = Date.now() + 15000;
    const current = () => !auth.lost() && owns();

    return yield* languageOperation(async (signal) => {
      const prepared = await preparation.read(
        {
          delivery: async (requested, active) => {
            if (requested !== id || active.aborted) throw denied();
            await Effect.runPromise(validate, { signal: active });

            return delivery;
          },
          validate: async (requested, value, active) => {
            if (
              requested !== id ||
              fingerprint(value) !== hash ||
              Date.now() >= expiresAt ||
              active.aborted
            )
              throw denied();
            await Effect.runPromise(validate, { signal: active });
          },
          document: (uri, value) =>
            Effect.runPromise(
              broker.readPreparationDocument(auth.principal, current, value.fence, uri),
              { signal }
            ),
          acknowledgedBuffer: (uri, value, _document, active) =>
            Effect.runPromise(
              broker.readAcknowledgedBuffer(auth.principal, current, value.fence, uri),
              { signal: active }
            ),
        },
        id,
        signal
      );

      await Effect.runPromise(validate, { signal });

      await Effect.runPromise(provenance.record(auth.principal, prepared.proposal, retained), {
        signal,
      });

      return prepared.proposal;
    });
  }).pipe(
    Effect.timeout(15000),
    Effect.catchTag("TimeoutError", () =>
      Effect.fail(
        new LanguageError({
          reason: "timeout",
          message: "Edit preparation timed out",
          retryable: true,
        })
      )
    ),
    Effect.provide(ProposalPreparation.layer)
  );
