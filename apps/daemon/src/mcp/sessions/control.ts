/** Session actions from the authenticated MCP binding, always on this Host (ADR 0119). */
import {
  Command,
  CommandId,
  CommandRejected,
  type AgentSession,
  type HarnessKind,
  ModelId,
  type PermissionMode,
  ReasoningEffort,
  SessionId,
  SessionPlacement,
} from "@polaris/protocol";
import { Effect, Schema, Struct } from "effect";
import type { Engine } from "../../engine/Engine.ts";
import type { EventStore } from "../../store/EventStore.ts";

const startFields = Struct.omit(Command.cases.StartSession.fields, [
  "_tag",
  "origin",
  "reviewSubject",
]);

export const StartInput = Schema.Struct({
  ...startFields,
  verb: Schema.Literal("start"),
  sessionId: Schema.optionalKey(startFields.sessionId),
  workspaceId: Schema.optionalKey(startFields.workspaceId),
  harness: Schema.optionalKey(startFields.harness),
  model: Schema.optionalKey(startFields.model),
  permissionMode: Schema.optionalKey(startFields.permissionMode),
  effort: Schema.optionalKey(Schema.NullOr(ReasoningEffort)),
  placement: Schema.optionalKey(startFields.placement),
  attachments: Schema.optionalKey(startFields.attachments),
});

export const SendInput = Schema.Struct({
  ...Struct.omit(Command.cases.SendTurn.fields, ["_tag"]),
  verb: Schema.Literal("send"),
  attachments: Schema.optionalKey(Command.cases.SendTurn.fields.attachments),
});

export const StopInput = Schema.Struct({
  ...Struct.omit(Command.cases.Interrupt.fields, ["_tag"]),
  verb: Schema.Literal("stop"),
});

export const SessionControlInput = Schema.Union([StartInput, SendInput, StopInput]);

export type SessionControlInput = typeof SessionControlInput.Type;

export interface SessionDefaults {
  readonly model: string | null;
  readonly effort: ReasoningEffort | null;
  readonly permissionMode: PermissionMode;
}

export type SessionDefaultsFor = (harness: HarnessKind) => SessionDefaults;

export const safeSessionDefaults: SessionDefaultsFor = () => ({
  model: null,
  effort: null,
  permissionMode: "supervised",
});

const startCommand = (
  record: AgentSession,
  input: typeof StartInput.Type,
  defaults: SessionDefaultsFor
): Command => {
  const harness = input.harness ?? record.harness;
  const selected = defaults(harness);
  const model = input.model === undefined ? selected.model : input.model;

  return Command.cases.StartSession.make({
    sessionId: input.sessionId ?? SessionId.make(`session_${crypto.randomUUID()}`),
    workspaceId: input.workspaceId ?? record.workspaceId,
    harness,
    placement: input.placement ?? SessionPlacement.cases.InPlace.make({}),
    permissionMode: input.permissionMode ?? selected.permissionMode,
    model: model === null ? null : ModelId.make(model),
    effort: input.effort === undefined ? selected.effort : input.effort,
    serviceTier: input.serviceTier ?? null,
    prompt: input.prompt,
    attachments: input.attachments ?? [],
  });
};

export const sessionControl =
  (
    store: EventStore["Service"],
    engine: Engine["Service"],
    defaults: SessionDefaultsFor = safeSessionDefaults
  ) =>
  (caller: SessionId, input: SessionControlInput) =>
    Effect.gen(function* () {
      const commandId = CommandId.make(crypto.randomUUID());
      const record = (yield* store.model).sessions.get(caller);

      if (record === undefined)
        return yield* new CommandRejected({
          commandId,
          reason: "This session is not on this Host.",
        });
      let command: Command;

      if (input.verb === "start") command = startCommand(record.session, input, defaults);
      else if (input.verb === "send")
        command = Command.cases.SendTurn.make({
          sessionId: input.sessionId,
          prompt: input.prompt,
          attachments: input.attachments ?? [],
        });
      else command = Command.cases.Interrupt.make({ sessionId: input.sessionId });
      yield* engine.dispatch({
        commandId,
        command,
        deviceLabel: "Session tools",
        agentSessionId: caller,
      });

      return `Session ${"sessionId" in command ? command.sessionId : ""}: ${input.verb} accepted.`;
    });
