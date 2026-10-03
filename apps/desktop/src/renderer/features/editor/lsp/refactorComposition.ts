import * as P from "@polaris/protocol";
import type { AuthenticatedLanguageIdentity } from "./lifecycle.ts";
import { bindLanguageProposals } from "./bindings.ts";
import {
  bindLanguagePreparation,
  type PrepareLanguageEdit,
  type PreparedLanguageEdit,
} from "./preparation.ts";
import { sameFence } from "./requests.ts";
import { decodePreparedProposal } from "./proposalCodec.ts";

/** Structural public RefactorController port; composition never constructs or stores a controller. */
export interface RefactorConsumer {
  readonly hostKey: string;
  readonly offer: (proposal: P.LanguageTreeEditProposal) => Promise<void>;
  readonly applyAction: (proposal: P.LanguageTreeEditProposal) => Promise<void>;
}

/** Composition returns independently owned current context; proposal coordinates grant no authority. */
export interface EditorRefactorAuthority {
  readonly hostKey: string;
  readonly identity: AuthenticatedLanguageIdentity;
  readonly context: P.LanguageContextIdentity;
  readonly token: object;
  readonly signal: AbortSignal;
}

export interface EditorRefactorPorts {
  readonly authority: (context: P.LanguageContextIdentity) => EditorRefactorAuthority | null;
  readonly controller: (
    hostKey: string,
    checkoutPath: string,
    context: P.LanguageContextIdentity
  ) => RefactorConsumer | null;
  readonly prepare: PrepareLanguageEdit | null;
  /** R1's checked text-only promoter; resources must arrive already decoded as format2. */
  readonly promoteTextProposal: (proposal: P.LanguageEditProposal) => P.LanguageTreeEditProposal;
}

const sameContext = (left: P.LanguageContextIdentity, right: P.LanguageContextIdentity) =>
  sameFence(
    { context: left, requiredSequence: 0, documents: [] },
    { context: right, requiredSequence: 0, documents: [] }
  );

/** Bind to existing R1 controllers; their ports retain sole inventory, durable receipt and undo authority. */
export const bindEditorRefactors = (ports: EditorRefactorPorts) => {
  let disposed = false;

  const target = (context: P.LanguageContextIdentity) => {
    const authority = ports.authority(context);

    if (
      disposed ||
      authority === null ||
      authority.signal.aborted ||
      !Number.isSafeInteger(authority.identity.connectionEpoch) ||
      authority.identity.connectionEpoch <= 0 ||
      authority.identity.hostId !== context.hostId ||
      authority.identity.clientId !== context.clientId ||
      !sameContext(authority.context, context)
    )
      throw new Error("The authenticated edit context is unavailable.");

    const controller = ports.controller(authority.hostKey, context.checkout.path, context);

    if (controller === null || controller.hostKey !== authority.hostKey)
      throw new Error("The edit preview coordinator is unavailable.");

    return { authority, controller };
  };

  const current = (context: P.LanguageContextIdentity, previous: ReturnType<typeof target>) => {
    const next = target(context);

    if (
      next.authority.token !== previous.authority.token ||
      next.authority.signal !== previous.authority.signal ||
      next.authority.identity.connectionEpoch !== previous.authority.identity.connectionEpoch ||
      next.controller !== previous.controller
    )
      throw new Error("The authenticated edit context changed.");
  };

  const unprepare = bindLanguagePreparation(async (input) => {
    const captured = target(input.request.fence.context);

    if (ports.prepare === null || input.signal.aborted)
      throw new Error("Authoritative edit preparation is unavailable.");

    const proposal = await ports.prepare(input);
    current(input.request.fence.context, captured);

    if (input.signal.aborted) throw new Error("Edit preparation was cancelled.");

    return proposal;
  });

  const unproposals = bindLanguageProposals({
    edit: async (input: PreparedLanguageEdit) => {
      const proposal = decodePreparedProposal(input);
      const captured = target(proposal.fence.context);

      if (proposal.expiresAt <= Date.now()) throw new Error("The edit proposal expired.");
      const tree = "format" in proposal ? proposal : ports.promoteTextProposal(proposal);
      current(proposal.fence.context, captured);

      if (tree.origin === "server-apply-edit") await captured.controller.offer(tree);
      else await captured.controller.applyAction(tree);

      current(proposal.fence.context, captured);
    },
  });

  return () => {
    disposed = true;
    unprepare();
    unproposals();
  };
};
