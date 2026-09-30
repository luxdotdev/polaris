/**
 * Attachment cleanup (ENG-180): when a Host deletes what it staged, as a
 * default and per Workspace, and how much it holds. Settings reads and changes
 * it with `attachments.settings`, `attachments.setSettings` and `attachments.clear`.
 */
import { Schema } from "effect";

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
