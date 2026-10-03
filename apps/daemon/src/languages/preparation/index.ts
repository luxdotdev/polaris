import { randomUUID } from "node:crypto";
import { Context, Layer, Schema } from "effect";
import {
  LanguageEditProposal,
  LanguageTreeEditProposal,
  languageTreeLimits,
} from "@polaris/protocol";
import { HostDelivery, preparationLimits, requireActive } from "./contracts.ts";
import type { PreparationPort } from "./contracts.ts";
import { acknowledgedDocument } from "./acknowledgment.ts";
import { editPaths, checkRanges } from "./edit.ts";
import { collectSnapshots, recheckSnapshots } from "./snapshots.ts";

export type {
  PreparationPort,
  HostDelivery,
  HostDocument,
  HostAcknowledgedBuffer,
} from "./contracts.ts";

export { acknowledgedBufferReader } from "./bufferAcknowledgments.ts";

export type { BufferAcknowledgmentReadPort } from "./bufferAcknowledgments.ts";

function requireSnapshot<T>(snapshot: T | undefined): asserts snapshot is T {
  if (snapshot === undefined) throw new Error("Acknowledged document has no captured snapshot.");
}

/** Constructor injects trusted Host authority/provenance; read accepts only an opaque Host delivery id. */
export const makeProposalPreparation = (port: PreparationPort) => ({
  async read(id: string, signal = new AbortController().signal) {
    requireActive(signal);
    const raw = await port.delivery(id, signal);

    if (Buffer.byteLength(JSON.stringify(raw) ?? "") > languageTreeLimits.proposalBytes)
      throw new Error("Delivered edit exceeds proposal budget.");
    const delivery = Schema.decodeUnknownSync(HostDelivery)(raw);
    await port.validate(id, delivery, signal);
    requireActive(signal);
    const paths = editPaths(delivery);

    if (paths.resources.size > languageTreeLimits.resources)
      throw new Error("Resource path budget exceeded.");

    const captured = await collectSnapshots(delivery, paths, signal, () =>
      port.validate(id, delivery, signal)
    );

    await port.validate(id, delivery, signal);
    const documents: { uri: string; version: number; text: string }[] = [];

    let textBytes = captured.snapshots.reduce(
      (total, snapshot) => total + Buffer.byteLength(snapshot.diskText ?? ""),
      0
    );

    const acknowledgments = new Map<string, Awaited<ReturnType<typeof acknowledgedDocument>>>();

    for (const [uri, edits] of paths.text) {
      const acknowledged = await acknowledgedDocument(port, delivery, uri, signal);
      await port.validate(id, delivery, signal);
      acknowledgments.set(uri, acknowledged);
      const { document, buffer } = acknowledged;
      const index = captured.snapshots.findIndex((snapshot) => snapshot.uri === uri);
      const snapshot = captured.snapshots[index];

      requireSnapshot(snapshot);
      captured.snapshots[index] = { ...snapshot, buffer };

      textBytes += Buffer.byteLength(document?.text ?? "");

      if (textBytes > preparationLimits.textBytes)
        throw new Error("Acknowledged text budget exceeded.");

      if (document !== null) documents.push({ uri, ...document });
      // Ordered resource edits are range-checked against the reconciled Client inventory before acceptance.

      if (paths.resources.size === 0)
        checkRanges(document?.text ?? snapshot.diskText ?? "", edits, delivery.encoding);
    }

    await port.validate(id, delivery, signal);
    await recheckSnapshots(delivery, captured, signal, () => port.validate(id, delivery, signal));

    for (const [uri, expected] of acknowledgments) {
      if (
        JSON.stringify(await acknowledgedDocument(port, delivery, uri, signal)) !==
        JSON.stringify(expected)
      )
        throw new Error("Authenticated document acknowledgment changed during preparation.");
    }

    await port.validate(id, delivery, signal);
    requireActive(signal);

    const common = {
      proposalId: randomUUID(),
      fence: delivery.fence,
      origin: delivery.origin,
      label: delivery.label,
      edit: delivery.edit,
      snapshots: captured.snapshots,
      expiresAt: Date.now() + preparationLimits.expiryMs,
    };

    const proposal =
      paths.resources.size === 0
        ? Schema.decodeUnknownSync(LanguageEditProposal)(common)
        : Schema.decodeUnknownSync(LanguageTreeEditProposal)({
            ...common,
            format: 2,
            resourceSnapshots: captured.resourceSnapshots,
          });

    if (Buffer.byteLength(JSON.stringify(proposal)) > languageTreeLimits.proposalBytes)
      throw new Error("Prepared proposal exceeds encoded budget.");

    return { proposal, documents };
  },
});

export class ProposalPreparation extends Context.Service<
  ProposalPreparation,
  {
    read: (
      port: PreparationPort,
      id: string,
      signal: AbortSignal
    ) => ReturnType<ReturnType<typeof makeProposalPreparation>["read"]>;
  }
>()("polaris/languages/ProposalPreparation") {
  static layer = Layer.succeed(ProposalPreparation)({
    read: (port, id, signal) => makeProposalPreparation(port).read(id, signal),
  });
}
