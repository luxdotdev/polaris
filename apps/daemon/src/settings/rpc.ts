import { START_LIMIT_KEY, sessionStartLimitSetting } from "./sessionStartLimit.ts";
import { holdsUserAccess } from "../userAccess/index.ts";
import {
  SettingsError,
  type SessionId,
  type SettingValue,
  NotFound,
  SettingsRpcs,
  AutoArchiveSettings,
  IdleCompactionSettings,
  SuggestedReplySettings,
} from "@polaris/protocol";
import { Effect, Option, Schema } from "effect";
import { authorizeSetting } from "./authority.ts";
import { ClientSettings } from "../clientSettings/index.ts";
import { actorOf, type Actor } from "../transport/actor.ts";
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
export const settingsAccessAt = (path: () => string) =>
  Effect.gen(function* () {
    const engine = yield* Effect.serviceOption(Engine);
    const relay = yield* Effect.serviceOption(ClientSettings);
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

    const hostList = attempt("*", () => hostSettings(path()).list()).pipe(
      Effect.flatMap((values) =>
        Effect.map(budget.get, (limit) =>
          values.map((value) => (value.key === START_LIMIT_KEY ? limit : value))
        )
      )
    );

    const client = <A>(
      call: (service: ClientSettings["Service"]) => Effect.Effect<A, { message: string }>
    ) =>
      (Option.isSome(relay)
        ? call(relay.value)
        : Effect.fail({ message: "no Client connected" })
      ).pipe(
        Effect.mapError((error) => new SettingsError({ key: "client", message: error.message }))
      );

    const scoped = (values: ReadonlyArray<SettingValue>, scope: "host" | "client") =>
      values.map((value) => ({ ...value, scope }));

    const read = (key: string, scope: "host" | "client" = "host", caller?: SessionId) =>
      scope === "client" ? client((service) => service.get(key, caller)) : get(key);

    const list = Effect.fnUntraced(function* (scope?: "host" | "client", caller?: SessionId) {
      if (scope === "host") return scoped(yield* hostList, "host");

      if (scope === "client")
        return scoped(yield* client((service) => service.list(caller)), "client");
      const host = scoped(yield* hostList, "host");

      const local = yield* client((service) => service.list(caller)).pipe(
        Effect.catchTag("SettingsError", () => Effect.succeed([]))
      );

      return [...host, ...scoped(local, "client")];
    });

    const write = Effect.fnUntraced(function* (
      input: { key: string; value: Schema.Json; scope?: "host" | "client"; ifUnset?: boolean },
      actor: Actor,
      user: boolean
    ) {
      const { key, value, ifUnset } = input;
      const scope = input.scope ?? "host";
      const caller = actor.kind === "agentSession" ? actor.sessionId : undefined;
      const before = yield* read(key, scope, caller);
      yield* authorizeSetting(
        actor,
        before,
        scope === "host" ? "settings.set" : "clientSettings.set",
        Option.getOrUndefined(engine)
      );

      if (scope === "client")
        return { ...(yield* client((service) => service.set(key, value, caller))), scope };

      return {
        ...(yield* key === START_LIMIT_KEY
          ? budget.set(value, user, ifUnset)
          : set(key, value, ifUnset)),
        scope,
      };
    });

    return { list, get: read, set: write };
  });

export const settingsRpcHandlersAt = (path: () => string) =>
  SettingsRpcs.middleware(ConnectionBlobs).toLayer(
    Effect.map(settingsAccessAt(path), (access) => ({
      "settings.list": ({ scope }, { client }) => {
        const actor = actorOf(client);

        return access.list(scope, actor.kind === "agentSession" ? actor.sessionId : undefined);
      },
      "settings.describe": ({ key, scope }, { client }) => {
        const actor = actorOf(client);

        return access.get(key, scope, actor.kind === "agentSession" ? actor.sessionId : undefined);
      },
      "settings.get": ({ key, scope }, { client }) => {
        const actor = actorOf(client);

        return access.get(key, scope, actor.kind === "agentSession" ? actor.sessionId : undefined);
      },
      "settings.set": (input, { client }) =>
        access.set(input, actorOf(client), holdsUserAccess(client.annotations)),
    }))
  );

export const SettingsRpcHandlers = settingsRpcHandlersAt(hostSettingsPath);
