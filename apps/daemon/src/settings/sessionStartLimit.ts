/** The described Host budget is backed by the Engine's durable event, never a second file value. */
import { describeSetting, SessionStartLimit, SettingValue, SettingsError } from "@polaris/protocol";
import { Effect, Schema } from "effect";
import type { Engine } from "../engine/Engine.ts";
import { schemaFor } from "./registry.ts";

export const START_LIMIT_KEY = "sessions.startLimit";

export const sessionStartLimitSetting = (engine: Engine["Service"] | undefined) => {
  const get = Effect.map(
    engine?.sessionStartLimitSetting ?? Effect.succeed({ value: 5, overridden: false }),
    (state) =>
      SettingValue.make({
        ...describeSetting(START_LIMIT_KEY, schemaFor(START_LIMIT_KEY)!),
        value: state.value,
        overridden: state.overridden,
      })
  );

  const set = Effect.fnUntraced(function* (value: Schema.Json, user: boolean, ifUnset?: boolean) {
    if (!user)
      return yield* new SettingsError({
        key: START_LIMIT_KEY,
        message: "Only the user can change the session start limit.",
      });

    if (engine === undefined)
      return yield* new SettingsError({
        key: START_LIMIT_KEY,
        message: "Session budgets are unavailable on this Host.",
      });
    const before = yield* get;

    if (ifUnset === true && before.overridden) return before;

    const limit = yield* Schema.decodeUnknownEffect(SessionStartLimit)(value).pipe(
      Effect.mapError(
        () =>
          new SettingsError({
            key: START_LIMIT_KEY,
            message: "The start limit must be a non-negative integer.",
          })
      )
    );

    yield* engine
      .setSessionStartLimit(null, limit, ifUnset)
      .pipe(
        Effect.mapError(
          (error) => new SettingsError({ key: START_LIMIT_KEY, message: error.message })
        )
      );

    return yield* get;
  });

  return { get, set };
};
