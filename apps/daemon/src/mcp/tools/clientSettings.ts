/** Client Settings use the authenticated tool binding's session, never an input session id. */
import { type SessionId } from "@polaris/protocol";
import { Effect, Schema } from "effect";
import type { ClientSettings } from "../../clientSettings/index.ts";
import type { SessionTools } from "../sessions/index.ts";
import { sessionTool } from "./session.ts";
import { rejection } from "./shared.ts";

export type ClientSettingsTools = Pick<ClientSettings["Service"], "list" | "get" | "set">;

export const clientSettingsTools = (sessionId: SessionId, sessions: SessionTools) => {
  const run = <A>(
    call: (settings: ClientSettingsTools) => Effect.Effect<A, { message: string }>
  ) => {
    const settings = sessions.clientSettings;

    return (
      settings === undefined ? Effect.fail({ message: "no Client connected" }) : call(settings)
    ).pipe(
      Effect.map((value) => ({
        content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
      })),
      Effect.mapError((error) =>
        rejection(
          "E-CLIENT-SETTINGS",
          error.message,
          "Connect a Desktop App and use a listed Client Setting and its type."
        )
      )
    );
  };

  return [
    sessionTool(
      "clientSettings.list",
      "List the connected Client's device-local settings, descriptions, types, defaults and current values. Targets the Client showing this agent session, else the most recently active Client. Fails with no Client connected.",
      Schema.Record(Schema.String, Schema.Never),
      () => run((s) => s.list(sessionId))
    ),
    sessionTool(
      "clientSettings.describe",
      "Describe a Client Setting's type and default.",
      Schema.Struct({ key: Schema.String }),
      ({ key }) => run((s) => s.get(key, sessionId))
    ),
    sessionTool(
      "clientSettings.get",
      "Read a Client Setting on the Client showing this session, else the most recently active Client.",
      Schema.Struct({ key: Schema.String }),
      ({ key }) => run((s) => s.get(key, sessionId))
    ),
    sessionTool(
      "clientSettings.set",
      "Change a device-local Client Setting. The Desktop App applies it with an Undo toast. No connected Client fails immediately; nothing is queued.",
      Schema.Struct({ key: Schema.String, value: Schema.Json }),
      ({ key, value }) => run((s) => s.set(key, value, sessionId))
    ),
  ];
};
