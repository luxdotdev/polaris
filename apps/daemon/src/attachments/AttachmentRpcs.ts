/**
 * Handlers for `attachments.stage` (the Client sends the bytes as binary
 * side-chunks under `blobId`; they are written to the staging file as they
 * arrive, never collected in memory) and the cleanup settings Settings shows:
 * `attachments.settings`, `attachments.setSettings`, `attachments.clear`.
 */
import {
  AttachmentSettings,
  AttachmentUsage,
  ClearAttachments,
  FileError,
  GetAttachmentSettings,
  SetAttachmentSettings,
  StagedAmount,
  StageAttachment,
} from "@polaris/protocol";
import { Effect } from "effect";
import { RpcGroup } from "effect/rpc";
import { paths } from "../paths.ts";
import { AttachmentStore, BlobChannel, type ServiceError } from "../services.ts";
import { AttachmentMaintenance } from "./AttachmentStore.ts";

export class AttachmentRpcs extends RpcGroup.make(
  StageAttachment,
  GetAttachmentSettings,
  SetAttachmentSettings,
  ClearAttachments
) {}

const toFileError = (error: ServiceError) =>
  new FileError({ path: paths().staging, code: "ESTAGE", message: error.message });

export const handleStageAttachment = Effect.fn("attachments.stage")(function* ({
  blobId,
  ...rest
}: typeof StageAttachment.payloadSchema.Type) {
  const blobs = yield* BlobChannel;
  const store = yield* AttachmentStore;

  return yield* store
    .stage({ ...rest, bytes: blobs.takeStream(blobId) })
    .pipe(Effect.mapError(toFileError));
});

const handleSettings = Effect.fn("attachments.settings")(function* () {
  const maintenance = yield* AttachmentMaintenance;
  const settings = yield* maintenance.settings;
  const total = yield* maintenance.usage;
  const byWorkspace = yield* maintenance.usageByWorkspace;

  const workspaces = Object.fromEntries(
    Object.entries(byWorkspace).map(([id, usage]) => [id, StagedAmount.make(usage)])
  );

  return {
    settings: AttachmentSettings.make(settings),
    usage: AttachmentUsage.make({ total: StagedAmount.make(total), workspaces }),
  };
}, Effect.mapError(toFileError));

const handleSetSettings = Effect.fn("attachments.setSettings")(function* ({
  settings,
}: typeof SetAttachmentSettings.payloadSchema.Type) {
  const maintenance = yield* AttachmentMaintenance;

  yield* maintenance.setSettings({ default: settings.default, workspaces: settings.workspaces });
}, Effect.mapError(toFileError));

const handleClear = Effect.fn("attachments.clear")(function* ({
  workspaceId,
}: typeof ClearAttachments.payloadSchema.Type) {
  const maintenance = yield* AttachmentMaintenance;

  const cleared = yield* maintenance.clearNow(workspaceId === null ? {} : { workspaceId });

  return StagedAmount.make(cleared);
}, Effect.mapError(toFileError));

/** Requires `AttachmentStore` and `AttachmentMaintenance` (`AttachmentStoreLive()`), and `BlobChannel` per request. */
export const AttachmentRpcsLive = AttachmentRpcs.toLayer({
  "attachments.stage": handleStageAttachment,
  "attachments.settings": handleSettings,
  "attachments.setSettings": handleSetSettings,
  "attachments.clear": handleClear,
});
