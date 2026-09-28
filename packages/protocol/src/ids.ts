import { Schema } from "effect"

export const HostId = Schema.String.pipe(Schema.brand("HostId"))
export type HostId = typeof HostId.Type

export const WorkspaceId = Schema.String.pipe(Schema.brand("WorkspaceId"))
export type WorkspaceId = typeof WorkspaceId.Type

export const SessionId = Schema.String.pipe(Schema.brand("SessionId"))
export type SessionId = typeof SessionId.Type

export const TurnId = Schema.String.pipe(Schema.brand("TurnId"))
export type TurnId = typeof TurnId.Type

export const WorktreeId = Schema.String.pipe(Schema.brand("WorktreeId"))
export type WorktreeId = typeof WorktreeId.Type

/** An approval or question a Harness is blocked on. */
export const RequestId = Schema.String.pipe(Schema.brand("RequestId"))
export type RequestId = typeof RequestId.Type

/** Chosen by the Client; the Daemon stores a receipt so a retried command is applied once. */
export const CommandId = Schema.String.pipe(Schema.brand("CommandId"))
export type CommandId = typeof CommandId.Type

export const AttachmentId = Schema.String.pipe(Schema.brand("AttachmentId"))
export type AttachmentId = typeof AttachmentId.Type

export const TerminalId = Schema.String.pipe(Schema.brand("TerminalId"))
export type TerminalId = typeof TerminalId.Type

/** Id of a binary side-chunk stream travelling beside the JSON frames. */
export const BlobId = Schema.String.pipe(Schema.brand("BlobId"))
export type BlobId = typeof BlobId.Type

/** Global, gapless event sequence on one Host. */
export const Sequence = Schema.Int.pipe(Schema.brand("Sequence"))
export type Sequence = typeof Sequence.Type
