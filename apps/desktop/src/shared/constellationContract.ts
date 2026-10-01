/**
 * Constellation requests over IPC (C1-U2): each forwards the Daemon RPC of the same name on
 * the Host that owns the Constellation (the Lead's), with its payload unchanged.
 */
import {
  ConstellationAnswer,
  ConstellationDispatch,
  ConstellationMessage,
  ConstellationPlan,
  ConstellationReview,
  ConstellationSetState,
  ConstellationStatus,
} from "@polaris/protocol";
import { Schema } from "effect";

const HostKey = Schema.String.check(Schema.isMinLength(1));

const onHost = <F extends Schema.Struct.Fields>(fields: F) =>
  Schema.Struct({ hostKey: HostKey, ...fields });

export const ConstellationRequestInputs = {
  "constellation.plan": onHost(ConstellationPlan.payloadSchema.fields),
  "constellation.dispatch": onHost(ConstellationDispatch.payloadSchema.fields),
  "constellation.review": onHost(ConstellationReview.payloadSchema.fields),
  "constellation.answer": onHost(ConstellationAnswer.payloadSchema.fields),
  "constellation.message": onHost(ConstellationMessage.payloadSchema.fields),
  "constellation.set_state": onHost(ConstellationSetState.payloadSchema.fields),
  "constellation.status": onHost(ConstellationStatus.payloadSchema.fields),
} as const;

export type ConstellationMethod = keyof typeof ConstellationRequestInputs;
