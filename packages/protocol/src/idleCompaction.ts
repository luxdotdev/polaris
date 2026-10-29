/**
 * Idle compaction (ENG-562): the Daemon compacts an Agent Session that has sat Idle for
 * `IDLE_COMPACTION_AFTER_MS` with at least `minTokens` in its context window, while the
 * Harness's one-hour prompt cache is still warm. One setting for every Host: the Desktop App
 * keeps it and writes it to each with `sessions.setIdleCompaction`.
 */
import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";
import { Unsupported } from "./errors.ts";
import { FileError } from "./files.ts";

/** Fixed: five minutes inside the one-hour prompt cache, as Claude Code does. */
export const IDLE_COMPACTION_AFTER_MS = 55 * 60 * 1000;

/** The prompt cache's lifetime: past it compacting is no cheaper, so the Daemon lets it be. */
export const PROMPT_CACHE_TTL_MS = 60 * 60 * 1000;

export const DEFAULT_IDLE_COMPACTION_MIN_TOKENS = 200_000;

/** The lowest threshold Settings offers; below it a summary saves little. */
export const MIN_IDLE_COMPACTION_TOKENS = 50_000;

/** The transcript's line for an idle compaction, in Claude Code's words. */
export const IDLE_COMPACTION_NOTE = "Compacted while idle, before the prompt cache expired";

export class IdleCompactionSettings extends Schema.Class<IdleCompactionSettings>(
  "IdleCompactionSettings"
)({
  enabled: Schema.Boolean,
  /** The context tokens a session must hold for it to be compacted. */
  minTokens: Schema.Int.check(Schema.isGreaterThanOrEqualTo(MIN_IDLE_COMPACTION_TOKENS)),
}) {}

export const DEFAULT_IDLE_COMPACTION = IdleCompactionSettings.make({
  enabled: true,
  minTokens: DEFAULT_IDLE_COMPACTION_MIN_TOKENS,
});

/** This Host's copy of the setting (capability `sessions.idle-compaction`). */
export const GetIdleCompactionSettings = Rpc.make("sessions.idleCompaction", {
  payload: {},
  success: IdleCompactionSettings,
  error: Unsupported,
});

/** Replaces the Host's copy; its timers follow at once. */
export const SetIdleCompactionSettings = Rpc.make("sessions.setIdleCompaction", {
  payload: { settings: IdleCompactionSettings },
  error: Schema.Union([Unsupported, FileError]),
});

export class IdleCompactionRpcs extends RpcGroup.make(
  GetIdleCompactionSettings,
  SetIdleCompactionSettings
) {}
