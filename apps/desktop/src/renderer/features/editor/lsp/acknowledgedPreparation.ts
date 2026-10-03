import type * as P from "@polaris/protocol";
import type { EditorRefactorPorts } from "./refactorComposition.ts";
import type { PrepareLanguageEdit, PreparedLanguageEdit } from "./preparation.ts";
import { sameFence } from "./requests.ts";

export type CurrentPreparationDocument = {
  readonly uri: string;
  readonly buffer: (typeof P.LanguageEditSnapshot.Type)["buffer"];
};

export type PreparationTuple = NonNullable<CurrentPreparationDocument["buffer"]> & {
  readonly uri: string;
};

export interface PreparationAcknowledgment {
  readonly context: P.LanguageContextIdentity;
  readonly uri: string;
  readonly version: number;
  readonly draftRevision: number;
  readonly acceptedSequence: number;
}

export interface EditorPreparationTransport {
  readonly acknowledge: (
    fence: P.LanguageRequestFence,
    buffer: PreparationTuple
  ) => Promise<PreparationAcknowledgment>;
  readonly prepare: (input: Parameters<PrepareLanguageEdit>[0]) => Promise<PreparedLanguageEdit>;
}

export interface AcknowledgedPreparationPorts {
  readonly authority: EditorRefactorPorts["authority"];
  readonly transport: (hostKey: string) => EditorPreparationTransport | null;
  /** R1 current inventory owns text/version/durable revision; never infer one revision from another. */
  readonly inventory: (
    hostKey: string,
    checkoutPath: string
  ) => Promise<readonly CurrentPreparationDocument[]>;
}

const tuples = (
  fence: P.LanguageRequestFence,
  inventory: readonly CurrentPreparationDocument[]
): readonly PreparationTuple[] => {
  if (inventory.length > 1024) throw new Error("Preparation inventory exceeds its bound.");

  return fence.documents.map((document) => {
    const matches = inventory.filter((item) => item.uri === document.uri);
    const buffer = matches.length === 1 ? matches[0]?.buffer : null;

    if (buffer === null || buffer === undefined || buffer.version !== document.version)
      throw new Error("The acknowledged Editor document is unavailable.");

    return Object.freeze({ ...buffer, uri: document.uri });
  });
};

/** Acknowledge original fenced tuples before Host preparation; never extend or rewrite its captured fence. */
export const createAcknowledgedPreparation =
  (ports: AcknowledgedPreparationPorts): PrepareLanguageEdit =>
  async (input) => {
    const context = input.request.fence.context;
    const authority = ports.authority(context);

    if (authority === null || authority.signal.aborted || input.signal.aborted)
      throw new Error("Authenticated edit preparation is unavailable.");

    const transport = ports.transport(authority.hostKey);

    if (transport === null) throw new Error("Authoritative edit preparation is unavailable.");

    const current = () => {
      const next = ports.authority(context);

      if (
        input.signal.aborted ||
        authority.signal.aborted ||
        next === null ||
        next.token !== authority.token ||
        next.signal !== authority.signal ||
        next.identity.connectionEpoch !== authority.identity.connectionEpoch ||
        next.identity.hostId !== context.hostId ||
        next.identity.clientId !== context.clientId ||
        !sameFence(
          { context, requiredSequence: 0, documents: [] },
          { context: next.context, requiredSequence: 0, documents: [] }
        ) ||
        ports.transport(authority.hostKey) !== transport
      )
        throw new Error("The acknowledged Editor context changed.");
    };

    current();

    const snapshot = tuples(
      input.request.fence,
      await ports.inventory(authority.hostKey, context.checkout.path)
    );

    current();

    const unchanged = async () => {
      current();

      const latest = tuples(
        input.request.fence,
        await ports.inventory(authority.hostKey, context.checkout.path)
      );

      current();

      if (JSON.stringify(latest) !== JSON.stringify(snapshot))
        throw new Error("The acknowledged Editor draft changed.");
    };

    for (const buffer of snapshot) {
      const receipt = await transport.acknowledge(input.request.fence, buffer);
      current();

      if (
        receipt.uri !== buffer.uri ||
        receipt.version !== buffer.version ||
        receipt.draftRevision !== buffer.draftRevision ||
        !sameContext(context, receipt.context) ||
        receipt.acceptedSequence < input.request.fence.requiredSequence
      )
        throw new Error("The Host buffer acknowledgment changed.");

      await unchanged();
    }

    const proposal = await transport.prepare(input);
    await unchanged();

    return proposal;
  };

const sameContext = (left: P.LanguageContextIdentity, right: P.LanguageContextIdentity) =>
  sameFence(
    { context: left, requiredSequence: 0, documents: [] },
    { context: right, requiredSequence: 0, documents: [] }
  );
