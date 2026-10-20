/**
 * Auto-archive (ENG-384): the Daemon archives a Dormant Agent Session once it
 * has gone `afterDays` without activity. Settings reads and changes it with
 * `sessions.autoArchive` and `sessions.setAutoArchive`.
 */
import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";
import { Unsupported } from "./errors.ts";
import { FileError } from "./files.ts";

/** The Host default when nothing is saved. */
export const DEFAULT_AUTO_ARCHIVE_DAYS = 7;

export class AutoArchiveSettings extends Schema.Class<AutoArchiveSettings>("AutoArchiveSettings")({
  /** Days a Dormant session goes without activity before it is archived; null never archives. */
  afterDays: Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))),
}) {}

/** When this Host archives Dormant sessions (capability `sessions.auto-archive`). */
export const GetAutoArchiveSettings = Rpc.make("sessions.autoArchive", {
  payload: {},
  success: AutoArchiveSettings,
  error: Unsupported,
});

/** Replaces the auto-archive settings; the Host sweeps with them at once. */
export const SetAutoArchiveSettings = Rpc.make("sessions.setAutoArchive", {
  payload: { settings: AutoArchiveSettings },
  error: Schema.Union([Unsupported, FileError]),
});

export class AutoArchiveRpcs extends RpcGroup.make(
  GetAutoArchiveSettings,
  SetAutoArchiveSettings
) {}
