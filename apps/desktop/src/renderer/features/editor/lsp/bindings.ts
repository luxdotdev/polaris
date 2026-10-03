import type * as P from "@polaris/protocol";
import type { LanguageIdentityLookup } from "./lifecycle.ts";
import type { CompletionProposal } from "./codemirror.ts";
import type { PreparedLanguageEdit } from "./preparation.ts";
import type { CodeActions } from "./payloads.ts";
import type { LanguageBuffer, LanguageProvider } from "./types.ts";

let identityRegistration: { readonly lookup: LanguageIdentityLookup } | null = null;

export const identityLookup: LanguageIdentityLookup = (hostKey) =>
  identityRegistration?.lookup(hostKey) ?? null;

export const refreshers = new Set<() => void>();

/** G2 binds only independently authenticated Main/session identity, never an acquisition echo. */
export const bindLanguageIdentity = (lookup: LanguageIdentityLookup) => {
  const registration = { lookup };
  identityRegistration = registration;

  for (const refresh of refreshers) refresh();

  return () => {
    if (identityRegistration === registration) {
      identityRegistration = null;

      for (const refresh of refreshers) refresh();
    }
  };
};

export let completionProposal: ((proposal: CompletionProposal) => void) | null = null;

export let editProposal: ((proposal: PreparedLanguageEdit) => void | Promise<void>) | null = null;

export interface LanguageActionProposal {
  readonly action: NonNullable<typeof CodeActions.Type>[number];
  readonly request: P.LanguageFeatureRequest;
  readonly result: P.LanguageFeatureResult;
  readonly provider: LanguageProvider;
  readonly buffer: LanguageBuffer;
}

export let actionProposal: ((proposal: LanguageActionProposal) => void) | null = null;

let proposalRegistration: object | null = null;

/** R1 supplies the sole refactor/durable preview authority after its exact accepted handoff. */
export const bindLanguageProposals = (handlers: {
  completion?: (proposal: CompletionProposal) => void;
  edit: (proposal: PreparedLanguageEdit) => void | Promise<void>;
  action?: (proposal: LanguageActionProposal) => void;
}) => {
  const registration = { handlers };
  proposalRegistration = registration;
  completionProposal = handlers.completion ?? null;
  editProposal = handlers.edit;
  actionProposal = handlers.action ?? null;

  return () => {
    if (proposalRegistration !== registration) return;
    proposalRegistration = null;
    completionProposal = null;
    editProposal = null;
    actionProposal = null;
  };
};

export type ResourceReceiptHandler = (
  hostKey: string,
  context: P.LanguageContextIdentity,
  challenge: typeof P.LanguageResourceReceiptChallenge.Type
) => Promise<typeof P.LanguageResourceReceiptResponse.Type>;

export let resourceReceiptHandler: ResourceReceiptHandler | null = null;

/** Startup binds the same private R1 coordinator used for preview, persistence and recovery. */
export const bindLanguageResourceReceipts = (handler: ResourceReceiptHandler) => {
  resourceReceiptHandler = handler;

  return () => {
    if (resourceReceiptHandler === handler) resourceReceiptHandler = null;
  };
};
