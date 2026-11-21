/** Compact Settings commands use the same catalogue and payload schemas as the CLI. */
import {
  commands,
  SettingsListInput,
  SettingsQueryInput,
  SettingsChangeInput,
  type SessionId,
  type NotFound,
  type SettingsError,
  type NotGranted,
} from "@polaris/protocol";
import { Effect, Schema, Predicate } from "effect";
import type { settingsAccessAt } from "../../settings/rpc.ts";
import type { SessionTools } from "../sessions/index.ts";
import { rejection } from "./shared.ts";
import { text } from "./session.ts";
import { commandTool } from "./commands.ts";

export type SettingsTools = Effect.Success<ReturnType<typeof settingsAccessAt>>;

const catalog = commands.filter((command) => command.name.startsWith("settings."));

const description =
  "List, describe, read or change Host and Client settings. Changes require a change settings Grant Approval. Only the user can change userOnly settings. Client changes need a connected Desktop App and offer Undo.";

export const settingsTool = (caller: SessionId, sessions: SessionTools) =>
  commandTool("settings", description, catalog, (command, payload) =>
    Effect.gen(function* () {
      const access = sessions.settings;

      if (access === undefined)
        return yield* rejection(
          "E-UNAVAILABLE",
          "Settings are unavailable",
          "Use the Desktop App."
        );
      let result: Effect.Effect<unknown, NotFound | SettingsError | NotGranted>;

      if (command.name === "settings.list") {
        const input = Schema.decodeUnknownSync(SettingsListInput)(payload);
        result = access.list(input.scope, caller);
      } else if (command.name === "settings.set") {
        const input = Schema.decodeUnknownSync(SettingsChangeInput)(payload);
        result = access.set(input, { kind: "agentSession", sessionId: caller }, false);
      } else {
        const input = Schema.decodeUnknownSync(SettingsQueryInput)(payload);
        result = access.get(input.key, input.scope, caller);
      }

      const value = yield* result.pipe(
        Effect.mapError((error) =>
          rejection(
            Predicate.isTagged(error, "NotGranted") ? "NotGranted" : "E-SETTINGS",
            "reason" in error ? (error.reason ?? error.message) : error.message,
            "Check the setting and its Grant."
          )
        )
      );

      return text([JSON.stringify(value)]);
    })
  );
