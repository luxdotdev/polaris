/**
 * Building commands in the renderer. `Data.taggedEnum` constructors keep the
 * tags checked without pulling Effect Schema into the renderer bundle; the
 * main process validates every command against the protocol's Schema anyway.
 */
import type {
  ApprovalDecision,
  Command,
  CommandId,
  ReviewSubject,
  SessionId,
  SessionPlacement,
} from "@polaris/protocol";
import { Data } from "effect";

export const Commands = Data.taggedEnum<Command>();

export const Placement = Data.taggedEnum<SessionPlacement>();

export const Decisions = Data.taggedEnum<ApprovalDecision>();

/** A Review's subject as the protocol carries it (a pull request, or an Agent Session's Turns). */
export const Subjects = Data.taggedEnum<ReviewSubject>();

/** Client-generated, so a retried dispatch is applied once (the Daemon keeps receipts). */
export const newCommandId = (): CommandId =>
  // SAFETY: CommandId is a branded string; any unique string is a valid one.
  crypto.randomUUID() as CommandId;

export const newSessionId = (): SessionId =>
  // SAFETY: SessionId is a branded string chosen by the Client that starts the session.
  crypto.randomUUID() as SessionId;
