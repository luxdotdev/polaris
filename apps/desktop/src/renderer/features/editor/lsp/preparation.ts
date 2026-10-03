import * as P from "@polaris/protocol";
import { Schema } from "effect";
import type { LanguageProvider, LanguageBuffer } from "./types.ts";
import { sameFence } from "./requests.ts";
import { decodePreparedProposal } from "./proposalCodec.ts";

export interface EditPreparationInput {
  readonly request: P.LanguageFeatureRequest;
  readonly result: P.LanguageFeatureResult;
  readonly origin: "rename" | "code-action";
  readonly label: string;
  readonly edit: P.LanguageWorkspaceEdit;
  readonly signal: AbortSignal;
}

export type PreparedLanguageEdit = P.LanguageEditProposal | P.LanguageTreeEditProposal;

export type PrepareLanguageEdit = (input: EditPreparationInput) => Promise<PreparedLanguageEdit>;

let prepare: { readonly port: PrepareLanguageEdit } | null = null;

/** A retained result cannot become a new intent after its acknowledged draft changes. */
export const featureIntentCurrent = (
  request: P.LanguageFeatureRequest,
  result: P.LanguageFeatureResult,
  provider: LanguageProvider,
  buffer: LanguageBuffer
): boolean =>
  request.requestId === result.requestId &&
  sameFence(request.fence, result.fence) &&
  P.languageFenceSatisfied(request.fence, provider.ack) &&
  sameFence(
    { context: provider.context, requiredSequence: 0, documents: [] },
    { context: request.fence.context, requiredSequence: 0, documents: [] }
  ) &&
  request.fence.documents.some(
    (document) => document.uri === buffer.uri && document.version === buffer.version
  );

/** G2 binds authoritative snapshot/proposal preparation; this module never creates authority fields. */
export const bindLanguagePreparation = (port: PrepareLanguageEdit) => {
  const registration = { port };
  prepare = registration;

  return () => {
    if (prepare === registration) prepare = null;
  };
};

export const prepareLanguageEdit = async (
  input: EditPreparationInput,
  current: () => boolean
): Promise<PreparedLanguageEdit | null> => {
  const registration = prepare;

  if (registration === null || input.signal.aborted || !current()) return null;
  const request = Schema.decodeUnknownSync(P.LanguageFeatureRequest)(input.request);
  const result = Schema.decodeUnknownSync(P.LanguageFeatureResult)(input.result);

  if (request.requestId !== result.requestId || !sameFence(request.fence, result.fence))
    return null;
  const edit = Schema.decodeUnknownSync(P.LanguageWorkspaceEdit)(input.edit);
  const proposed = await registration.port({ ...input, request, result, edit });

  if (prepare !== registration || input.signal.aborted || !current()) return null;
  const proposal = decodePreparedProposal(proposed);

  if (
    proposal.origin !== input.origin ||
    proposal.expiresAt <= Date.now() ||
    !sameFence(proposal.fence, request.fence)
  )
    return null;
  const resource = edit.documentChanges?.some((change) => "kind" in change) ?? false;

  if (resource && !("format" in proposal)) return null;

  return proposal;
};

/** Server intent remains fenced by the acquired context and every currently retained draft. */
export const serverProposalCurrent = (
  context: P.LanguageContextIdentity,
  proposal: PreparedLanguageEdit,
  providers: readonly LanguageProvider[],
  buffers: readonly LanguageBuffer[]
): boolean =>
  proposal.expiresAt > Date.now() &&
  providers.some(
    (provider) =>
      P.languageFenceSatisfied(proposal.fence, provider.ack) &&
      P.languageFenceSatisfied({ context, requiredSequence: 0, documents: [] }, provider.ack)
  ) &&
  proposal.fence.documents.every((document) =>
    buffers.some((buffer) => buffer.uri === document.uri && buffer.version === document.version)
  );

export const serverEditCurrent = (
  context: P.LanguageContextIdentity,
  proposal: P.LanguageEditProposal,
  providers: readonly LanguageProvider[],
  buffers: readonly LanguageBuffer[]
): boolean =>
  !(proposal.edit.documentChanges?.some((change) => "kind" in change) ?? false) &&
  serverProposalCurrent(context, proposal, providers, buffers);
