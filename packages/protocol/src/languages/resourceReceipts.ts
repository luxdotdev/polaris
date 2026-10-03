import { Schema } from "effect";
import { LanguageCounter, LanguageFingerprint, LanguageKey } from "./base.ts";
import {
  LanguageTreeDraftReceipt,
  LanguageTreeEditAcceptance,
  LanguageTreeEditProposal,
} from "./trees.ts";

const boundedReceipt = Schema.makeFilter(
  <A>(value: A) => new TextEncoder().encode(JSON.stringify(value)).byteLength <= 1048576
);

/** Host challenges travel only over the current context feed, and replies use its existing server response RPC. */
export const LanguageResourceReceiptChallenge = Schema.TaggedUnion({
  Resolve: { nonce: LanguageKey, operationId: LanguageKey, acceptance: LanguageTreeEditAcceptance },
  Verify: {
    nonce: LanguageKey,
    operationId: LanguageKey,
    proposal: LanguageTreeEditProposal,
    drafts: LanguageTreeDraftReceipt,
    phase: Schema.optionalKey(Schema.Literals(["prepare", "moving"])),
  },
  Recover: {
    nonce: LanguageKey,
    operationId: LanguageKey,
    proposalId: LanguageKey,
    groupId: LanguageKey,
    previewFingerprint: LanguageFingerprint,
    hostReceiptRevision: LanguageCounter,
    intent: Schema.Literals(["recover", "undo", "cancel"]),
  },
}).check(boundedReceipt);

export type LanguageResourceReceiptChallenge = typeof LanguageResourceReceiptChallenge.Type;

export const LanguageResourceReceiptResponse = Schema.Struct({
  nonce: LanguageKey,
  operationId: LanguageKey,
  groupId: LanguageKey,
  localRevision: LanguageCounter,
  previewFingerprint: LanguageFingerprint,
  hostReceiptRevision: Schema.NullOr(LanguageCounter),
  proposal: Schema.optionalKey(LanguageTreeEditProposal),
}).check(boundedReceipt);

export type LanguageResourceReceiptResponse = typeof LanguageResourceReceiptResponse.Type;
