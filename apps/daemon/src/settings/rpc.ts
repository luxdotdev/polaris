import { START_LIMIT_KEY, sessionStartLimitSetting } from "./sessionStartLimit.ts";
import { holdsUserAccess } from "../userAccess/index.ts";
import {
  SettingsError,
  NotFound,
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
import { groups, schemaFor, type Group } from "./registry.ts";

const attempt = <A>(key: string, run: () => A): Effect.Effect<A, NotFound | SettingsError> => {
  if (key !== "*" && schemaFor(key) === undefined)
    return Effect.fail(new NotFound({ what: "host setting", id: key }));

  return Effect.try({
    try: run,
    catch: (cause) => new SettingsError({ key, message: String(cause) }),
  });
};

/** The production layer supplies Engine so changes re-arm its existing schedules. */
export const settingsRpcHandlersAt = (path: () => string) =>
  SettingsRpcs.middleware(ConnectionBlobs).toLayer(
    Effect.gen(function* () {
      const engine = yield* Effect.serviceOption(Engine);
      const budget = sessionStartLimitSetting(Option.getOrUndefined(engine));

      const get = (key: string) =>
        key === START_LIMIT_KEY ? budget.get : attempt(key, () => hostSettings(path()).get(key));

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
        "settings.list": () =>
          attempt("*", () => hostSettings(path()).list()).pipe(
            Effect.flatMap((values) =>
              Effect.map(budget.get, (limit) =>
                values.map((value) => (value.key === START_LIMIT_KEY ? limit : value))
              )
            )
          ),
        "settings.describe": ({ key }) => attempt(key, () => hostSettings(path()).describe(key)),
        "settings.get": ({ key }) => get(key),
        "settings.set": ({ key, value, ifUnset }, { client }) =>
          key === START_LIMIT_KEY
            ? budget.set(value, holdsUserAccess(client.annotations), ifUnset)
            : set(key, value, ifUnset),
      };
    })
  );

export const SettingsRpcHandlers = settingsRpcHandlersAt(hostSettingsPath);
