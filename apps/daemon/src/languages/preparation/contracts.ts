import { Schema } from "effect";
import {
  LanguageWorkspaceEdit,
  LanguageRequestFence,
  LanguagePositionEncoding,
  LanguageEditProposal,
  LanguageDocumentText,
  LanguageCounter,
  LanguageUri,
} from "@polaris/protocol";

export const HostDelivery = Schema.Struct({
  edit: LanguageWorkspaceEdit,
  fence: LanguageRequestFence,
  origin: LanguageEditProposal.fields.origin,
  label: LanguageEditProposal.fields.label,
  encoding: LanguagePositionEncoding,
});

export type HostDelivery = typeof HostDelivery.Type;

export const HostDocument = Schema.Struct({ version: LanguageCounter, text: LanguageDocumentText });

export type HostDocument = typeof HostDocument.Type;

export const HostAcknowledgedBuffer = Schema.Struct({
  uri: LanguageUri,
  version: LanguageCounter,
  text: LanguageDocumentText,
  draftRevision: LanguageCounter,
});

export type HostAcknowledgedBuffer = typeof HostAcknowledgedBuffer.Type;

/** All callbacks are trusted Host ports; delivery lookup must resolve an independent provenance ledger. */
export interface PreparationPort {
  readonly delivery: (id: string, signal: AbortSignal) => Promise<HostDelivery>;
  readonly validate: (id: string, delivery: HostDelivery, signal: AbortSignal) => Promise<void>;
  readonly acknowledgedBuffer?: (
    uri: string,
    delivery: HostDelivery,
    document: HostDocument,
    signal: AbortSignal
  ) => Promise<HostAcknowledgedBuffer | null>;
  readonly document: (uri: string, delivery: HostDelivery) => Promise<HostDocument | null>;
}

export const preparationLimits = {
  paths: 1024,
  textBytes: 8 * 1024 * 1024,
  fileBytes: 1024 * 1024,
  expiryMs: 60000,
};

export const requireActive = (signal: AbortSignal) => {
  if (signal.aborted) throw new Error("Proposal preparation was cancelled.");
};
