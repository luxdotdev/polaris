import * as P from "@polaris/protocol";
import { serverProposalCurrent, type PreparedLanguageEdit } from "./preparation.ts";
import type { LanguageBuffer, LanguageProvider } from "./types.ts";
import { decodePreparedProposal } from "./proposalCodec.ts";

export interface ServerEditIntent {
  readonly context: P.LanguageContextIdentity;
  readonly proposal: PreparedLanguageEdit;
  readonly kind: "legacy" | "tree";
  readonly treeNegotiated: boolean;
  readonly providers: readonly LanguageProvider[];
  readonly buffers: readonly LanguageBuffer[];
  readonly current: () => boolean;
  readonly offer: ((proposal: PreparedLanguageEdit) => void | Promise<void>) | null;
}

/** Server requests only offer an authoritative preview; a response never implies acceptance. */
export const offerServerEdit = async (intent: ServerEditIntent) => {
  const refusal = (failureReason: string) => ({ applied: false, failureReason });

  try {
    const proposal = decodePreparedProposal(intent.proposal);
    const tree = "format" in proposal;
    const resources = proposal.edit.documentChanges?.some((change) => "kind" in change) ?? false;

    if (
      (intent.kind === "tree" && (!tree || !intent.treeNegotiated)) ||
      (intent.kind === "legacy" && (tree || resources))
    )
      return refusal("Resource edits require negotiated tree-v2 handling.");

    if (
      proposal.origin !== "server-apply-edit" ||
      !intent.current() ||
      !serverProposalCurrent(intent.context, proposal, intent.providers, intent.buffers)
    )
      return refusal("The originating language context or document changed.");

    if (intent.offer === null) return refusal("The edit preview coordinator is unavailable.");
    await intent.offer(proposal);

    return refusal(
      intent.current()
        ? "Edits require user acceptance."
        : "The originating language context changed."
    );
  } catch {
    return refusal("The edit preview could not be prepared. No edits were applied.");
  }
};
