/**
 * Attachment cleanup (ENG-180): when a Host deletes what it staged, as a
 * default and per Workspace, and how much it holds. Settings reads and changes
 * it with `attachments.settings`, `attachments.setSettings` and `attachments.clear`.
 */
import { Schema } from "effect";
import { Rpc } from "effect/rpc";
import { Unsupported } from "./errors.ts";
import { FileError } from "./files.ts";
import { WorkspaceId } from "./ids.ts";

/**
 * `on-archive` deletes a session's attachments when it is archived (the
 * default); `after-days` deletes them `days` after they were staged; `never`
 * keeps them until cleared.
 */
export const AttachmentCleanup = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("on-archive") }),
  Schema.Struct({
    kind: Schema.Literal("after-days"),
    days: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  }),
  Schema.Struct({ kind: Schema.Literal("never") }),
]);

export type AttachmentCleanup = typeof AttachmentCleanup.Type;

export class AttachmentSettings extends Schema.Class<AttachmentSettings>("AttachmentSettings")({
  default: AttachmentCleanup,
  /** Per-Workspace overrides of `default`, by Workspace id. */
  workspaces: Schema.Record(Schema.String, AttachmentCleanup),
}) {}

/** What is staged: bytes and files. */
export class StagedAmount extends Schema.Class<StagedAmount>("StagedAmount")({
  bytes: Schema.Int,
  files: Schema.Int,
}) {}

export class AttachmentUsage extends Schema.Class<AttachmentUsage>("AttachmentUsage")({
  total: StagedAmount,
  /** By Workspace id; Workspaces with nothing staged are left out. */
  workspaces: Schema.Record(Schema.String, StagedAmount),
}) {}

/** The Host's cleanup settings and what it has staged (capability `attachments.settings`). */
export const GetAttachmentSettings = Rpc.make("attachments.settings", {
  payload: {},
  success: Schema.Struct({ settings: AttachmentSettings, usage: AttachmentUsage }),
  error: Schema.Union([Unsupported, FileError]),
});

/** Replaces the cleanup settings; they apply from the next sweep or archive. */
export const SetAttachmentSettings = Rpc.make("attachments.setSettings", {
  payload: { settings: AttachmentSettings },
  error: Schema.Union([Unsupported, FileError]),
});

/** Deletes staged attachments now, all of them or one Workspace's; answers what it removed. */
export const ClearAttachments = Rpc.make("attachments.clear", {
  payload: { workspaceId: Schema.NullOr(WorkspaceId) },
  success: StagedAmount,
  error: Schema.Union([Unsupported, FileError]),
});
