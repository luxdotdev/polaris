import { randomUUID } from "node:crypto";
import {
  LanguageError,
  LanguagePreparedEditProposal,
  decodeLanguageResourceProposal,
} from "@polaris/protocol";
import { Effect, Schema } from "effect";
import { fingerprint } from "../../files/edits/journal.ts";
import { ProposalPreparation } from "../preparation/index.ts";
import { HostDelivery } from "../preparation/contracts.ts";
import type { PrepareServerEdit } from "../runtime/serverPreparation.ts";
import { languageOperation } from "../runtime/service.ts";
import type { ExecutionTrustService } from "../trust/index.ts";
import type { LanguageAcquisitionAuthority } from "./acquisitionAuthority.ts";
import type { ProposalProvenance } from "../preparation/provenanceService.ts";
import { serverProposalValidator } from "./proposalValidator.ts";
import { denied } from "./authority.ts";

/** The callback is reachable only from the owning broker's actual provider connection. */
export const prepareServerEdit =
  (
    owners: LanguageAcquisitionAuthority["Service"],
    trust: ExecutionTrustService["Service"],
    provenance: ProposalProvenance["Service"]
  ): PrepareServerEdit =>
  async (edit, proposal, access) => {
    const auth = owners.authority(access.request);
    const guard = owners.guard(access.request, trust);
    const current = () => !auth.lost() && owners.owns(auth.principal) && access.request.isCurrent();
    const encoding = access.encoding();
    const fence = proposal.fence;

    if (encoding === null || proposal.origin !== "server-apply-edit") throw denied();

    const resources = edit.documentChanges?.some((change) => "kind" in change) === true;
    const retained = serverProposalValidator(access, auth, owners, trust, fence, resources);

    const delivery = Schema.decodeUnknownSync(HostDelivery)({
      edit,
      fence: proposal.fence,
      origin: proposal.origin,
      label: proposal.label,
      encoding,
    });

    const id = randomUUID();
    const hash = fingerprint(delivery);

    const operation = Effect.gen(function* () {
      const preparation = yield* ProposalPreparation;

      return yield* languageOperation(async (signal) => {
        const validate = async (requested: string, value: HostDelivery, active: AbortSignal) => {
          if (
            requested !== id ||
            fingerprint(value) !== hash ||
            active.aborted ||
            Date.now() >= proposal.expiresAt
          )
            throw denied();

          access.fence(proposal.fence);

          if (resources && !auth.supports("languages.resources.tree-v2")) throw denied();
          await guard.validate(active);
          access.fence(proposal.fence);
          guard.assertCurrent();

          if (!current() || (resources && !auth.supports("languages.resources.tree-v2")))
            throw denied();
        };

        const prepared = await preparation.read(
          {
            delivery: async (requested, active) => {
              await validate(requested, delivery, active);

              return delivery;
            },
            validate,
            document: async (uri, value) =>
              access.document(auth.principal, current, value.fence, uri),
            acknowledgedBuffer: async (uri, value) =>
              access.acknowledgment(auth.principal, current, value.fence, uri),
          },
          id,
          signal
        );

        await validate(id, delivery, signal);

        const result = decodeLanguageResourceProposal(
          Schema.encodeSync(LanguagePreparedEditProposal)({
            ...prepared.proposal,
            proposalId: proposal.proposalId,
            expiresAt: proposal.expiresAt,
          })
        );

        await Effect.runPromise(provenance.record(auth.principal, result, retained), { signal });

        return result;
      });
    }).pipe(
      Effect.timeout(10000),
      Effect.catchTag("TimeoutError", () =>
        Effect.fail(
          new LanguageError({
            reason: "timeout",
            message: "Server edit preparation timed out",
            retryable: true,
          })
        )
      ),
      Effect.provide(ProposalPreparation.layer)
    );

    return Effect.runPromise(operation, { signal: access.request.signal });
  };
