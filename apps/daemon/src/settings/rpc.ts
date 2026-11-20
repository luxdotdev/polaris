import {
  SettingsError,
  SettingsRpcs,
  AutoArchiveSettings,
  IdleCompactionSettings,
  SuggestedReplySettings,
} from "@polaris/protocol";
import { Effect, Option, Schema } from "effect";
import { Engine } from "../engine/Engine.ts";
import { ConnectionBlobs } from "../transport/rpcs.ts";
import { hostSettings, hostSettingsPath, readGroup } from "./index.ts";
import { dirname, join } from "node:path";
import { groups, type Group } from "./registry.ts";

const attempt = <A>(key: string, run: () => A) =>
  Effect.try({
    try: run,
    catch: (cause) => new SettingsError({ key, message: String(cause) }),
  });

/** The production layer supplies Engine so changes re-arm its existing schedules. */
export const settingsRpcHandlersAt = (path: () => string) =>
  SettingsRpcs.middleware(ConnectionBlobs).toLayer(
    Effect.gen(function* () {
      const engine = yield* Effect.serviceOption(Engine);

      const set = Effect.fnUntraced(function* (key: string, value: Schema.Json, ifUnset?: boolean) {
        const store = hostSettings(path());
        const previous = yield* attempt(key, () => store.get(key));

        if (ifUnset === true && previous.overridden) return previous;

        if (Option.isNone(engine)) return yield* attempt(key, () => store.set(key, value));

        const patch = (group: Group) =>
          attempt(key, () => ({
            ...Schema.decodeUnknownSync(Schema.JsonObject)(
              Schema.encodeSync(Schema.toCodecJson(groups[group].schema))(
                readGroup(join(dirname(path()), groups[group].file), group)
              )
            ),
            [key.slice(group.length + 1)]: value,
          }));

        if (key.startsWith("sessions.autoArchive.")) {
          const next = yield* patch("sessions.autoArchive");

          const settings = yield* attempt(key, () =>
            Schema.decodeUnknownSync(AutoArchiveSettings)(next)
          );

          yield* engine.value
            .setAutoArchiveSettings(settings)
            .pipe(Effect.mapError((error) => new SettingsError({ key, message: error.message })));
        } else if (key.startsWith("sessions.idleCompaction.")) {
          const next = yield* patch("sessions.idleCompaction");

          const settings = yield* attempt(key, () =>
            Schema.decodeUnknownSync(IdleCompactionSettings)(next)
          );

          yield* engine.value
            .setIdleCompactionSettings(settings)
            .pipe(Effect.mapError((error) => new SettingsError({ key, message: error.message })));
        } else if (key.startsWith("sessions.suggestedReplies.")) {
          const next = yield* patch("sessions.suggestedReplies");

          const settings = yield* attempt(key, () =>
            Schema.decodeUnknownSync(SuggestedReplySettings)(next)
          );

          yield* engine.value.suggestedReplies
            .set(settings)
            .pipe(Effect.mapError((error) => new SettingsError({ key, message: error.message })));
        } else return yield* attempt(key, () => store.set(key, value));

        return yield* attempt(key, () => store.get(key));
      });

      return {
        "settings.list": () => attempt("*", () => hostSettings(path()).list()),
        "settings.describe": ({ key }) => attempt(key, () => hostSettings(path()).describe(key)),
        "settings.get": ({ key }) => attempt(key, () => hostSettings(path()).get(key)),
        "settings.set": ({ key, value, ifUnset }) => set(key, value, ifUnset),
      };
    })
  );

export const SettingsRpcHandlers = settingsRpcHandlersAt(hostSettingsPath);
