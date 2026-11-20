import { readGroup, writeGroup } from "../settings/index.ts";
/**
 * The Host's Suggested Reply preference (ENG-884, ADR 0106), in
 * `~/.polaris/suggested-replies.json`: read by the RPCs, the Harness drivers and the
 * fallback writer, and resolved against the Harnesses ready on this Host.
 */
import { join } from "node:path";
import {
  AUTO_SUGGESTED_REPLY_FALLBACKS,
  FileError,
  HostHarnesses,
  ResolvedSuggestedReplyFallback,
  type SuggestedReplyFallback,
  SuggestedReplySettings,
} from "@polaris/protocol";
import { Context, Effect, Layer, Option, type Stream, SubscriptionRef } from "effect";
import { Availability } from "../harness/availability/Availability.ts";
import { paths } from "../paths.ts";

export const loadSuggestedReplySettings = (path: string) =>
  Effect.sync(() => readGroup(path, "sessions.suggestedReplies"));

const saveSettings = (path: string, settings: SuggestedReplySettings) =>
  Effect.try({
    try: () => writeGroup(path, "sessions.suggestedReplies", settings),
    catch: (cause) =>
      new FileError({
        path,
        code: "EIO",
        message: `Could not save host settings: ${String(cause)}`,
      }),
  });

const isReady = (harnesses: HostHarnesses, choice: SuggestedReplyFallback): boolean =>
  harnesses.harnesses.some((h) => h.harness === choice.harness && h.status === "ready");

/** The fallback the Daemon writes with: the chosen one, else the first ready automatic pick. */
export const resolveFallback = (
  settings: SuggestedReplySettings,
  harnesses: HostHarnesses
): ResolvedSuggestedReplyFallback =>
  settings.fallback === null
    ? ResolvedSuggestedReplyFallback.make({
        choice: AUTO_SUGGESTED_REPLY_FALLBACKS.find((c) => isReady(harnesses, c)) ?? null,
        source: "auto",
      })
    : ResolvedSuggestedReplyFallback.make({ choice: settings.fallback, source: "settings" });

const NO_HARNESSES = HostHarnesses.make({ harnesses: [], checkedAt: new Date(0).toISOString() });

const defaultPath = () => join(paths().root, "suggested-replies.json");

const make = (path: string) =>
  Effect.gen(function* () {
    const availability = yield* Effect.serviceOption(Availability);
    const ref = yield* SubscriptionRef.make(yield* loadSuggestedReplySettings(path));
    const current = SubscriptionRef.get(ref);

    const harnesses = Option.isSome(availability)
      ? availability.value.get(false)
      : Effect.succeed(NO_HARNESSES);

    return SuggestedReplyPreference.of({
      current,
      enabledNow: () => SubscriptionRef.getUnsafe(ref).enabled,
      // The ref replays its latest value, so a new subscriber starts from the current one.
      changes: SubscriptionRef.changes(ref),
      resolved: Effect.gen(function* () {
        const settings = yield* current;

        return { settings, resolved: resolveFallback(settings, yield* harnesses) };
      }),
      set: (settings) =>
        saveSettings(path, settings).pipe(Effect.andThen(SubscriptionRef.set(ref, settings))),
    });
  });

export class SuggestedReplyPreference extends Context.Service<
  SuggestedReplyPreference,
  {
    readonly current: Effect.Effect<SuggestedReplySettings>;
    /** For a driver's synchronous getter: whether Suggested Replies are on right now. */
    readonly enabledNow: () => boolean;
    /** The current preference, then each new one. */
    readonly changes: Stream.Stream<SuggestedReplySettings>;
    /** The preference and the fallback it resolves to on this Host now. */
    readonly resolved: Effect.Effect<{
      readonly settings: SuggestedReplySettings;
      readonly resolved: ResolvedSuggestedReplyFallback;
    }>;
    /** Saves the preference on the Host; `changes` follows at once. */
    readonly set: (settings: SuggestedReplySettings) => Effect.Effect<void, FileError>;
  }
>()("polaris/daemon/engine/SuggestedReplyPreference") {
  /** `path` defaults to `suggested-replies.json` in the Polaris home. */
  static readonly layer = (path?: string) =>
    Layer.effect(
      SuggestedReplyPreference,
      Effect.suspend(() => make(path ?? defaultPath()))
    );
}
