/**
 * Runtime schemas for the Agent Client Protocol (ACP v1) messages the driver
 * reads. Types come from `@agentclientprotocol/sdk` (type-only: no runtime is
 * loaded); each schema is checked against its SDK type at compile time, so an
 * SDK upgrade that renames or retypes a field the driver relies on fails
 * `bun run typecheck`. Unknown fields are ignored on decode.
 */
import type * as Acp from "@agentclientprotocol/sdk";
import { Option, Predicate, Schema } from "effect";

/** The ACP major version the driver speaks. */
export const PROTOCOL_VERSION = 1;

/** JSON-RPC error codes ACP defines. */
export const ErrorCode = {
  methodNotFound: -32601,
  invalidParams: -32602,
  authRequired: -32000,
} as const;

const OptionalNullableString = Schema.optional(Schema.NullOr(Schema.String));

export const RpcId = Schema.Union([Schema.String, Schema.Number]);

export type RpcId = typeof RpcId.Type;

/** A received payload, as `JSON.parse` left it; each handler decodes its own. */
export const RpcPayload = Schema.Unknown;

export type RpcPayload = typeof RpcPayload.Type;

/** One JSON-RPC message as it arrives on the wire. */
export const RpcMessage = Schema.Struct({
  id: Schema.optional(Schema.NullOr(RpcId)),
  method: Schema.optional(Schema.String),
  params: Schema.optional(RpcPayload),
  result: Schema.optional(RpcPayload),
  error: Schema.optional(
    Schema.Struct({
      code: Schema.Number,
      message: Schema.String,
      data: Schema.optional(RpcPayload),
    })
  ),
});

// ---------------------------------------------------------------------------
// initialize

const Capability = Schema.optional(Schema.NullOr(Schema.Struct({})));

export const InitializeResponse = Schema.Struct({
  protocolVersion: Schema.Number,
  agentCapabilities: Schema.optional(
    Schema.Struct({
      loadSession: Schema.optional(Schema.Boolean),
      promptCapabilities: Schema.optional(
        Schema.Struct({
          image: Schema.optional(Schema.Boolean),
          embeddedContext: Schema.optional(Schema.Boolean),
        })
      ),
      sessionCapabilities: Schema.optional(
        Schema.Struct({ resume: Capability, close: Capability })
      ),
    })
  ),
  agentInfo: Schema.optional(
    Schema.NullOr(Schema.Struct({ name: Schema.String, version: Schema.String }))
  ),
});

export type InitializeResponse = typeof InitializeResponse.Type;

// ---------------------------------------------------------------------------
// Sessions, modes and config options

const SelectOption = Schema.Struct({
  value: Schema.String,
  name: Schema.String,
  description: OptionalNullableString,
});

const SelectGroup = Schema.Struct({
  group: Schema.String,
  name: Schema.String,
  options: Schema.Array(SelectOption),
});

/** A session config option; boolean options carry no choices and are only kept for their id. */
export const ConfigOption = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  category: OptionalNullableString,
  type: Schema.String,
  currentValue: Schema.Union([Schema.String, Schema.Boolean]),
  options: Schema.optional(Schema.Union([Schema.Array(SelectOption), Schema.Array(SelectGroup)])),
});

export type ConfigOption = typeof ConfigOption.Type;

export const ModeState = Schema.Struct({
  currentModeId: Schema.String,
  availableModes: Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String })),
});

export type ModeState = typeof ModeState.Type;

const SessionSetup = {
  modes: Schema.optional(Schema.NullOr(ModeState)),
  configOptions: Schema.optional(Schema.NullOr(Schema.Array(ConfigOption))),
};

export const NewSessionResponse = Schema.Struct({ sessionId: Schema.String, ...SessionSetup });

/** `session/load` and `session/resume` answer with the same setup, minus the id. */
export const LoadSessionResponse = Schema.Struct(SessionSetup);

export const SetConfigOptionResponse = Schema.Struct({
  configOptions: Schema.Array(ConfigOption),
});

export const PromptResponse = Schema.Struct({
  stopReason: Schema.String,
});

// ---------------------------------------------------------------------------
// session/update

const TextBlock = Schema.Struct({ type: Schema.Literal("text"), text: Schema.String });

/** Any content block; only text is read, the rest is shown by its type. */
export const ContentBlock = Schema.Union([
  TextBlock,
  Schema.Struct({ type: Schema.String, uri: OptionalNullableString }),
]);

export type ContentBlock = typeof ContentBlock.Type;

export const ToolCallContent = Schema.Union([
  Schema.Struct({ type: Schema.Literal("content"), content: ContentBlock }),
  Schema.Struct({
    type: Schema.Literal("diff"),
    path: Schema.String,
    oldText: OptionalNullableString,
    newText: Schema.String,
  }),
  Schema.Struct({ type: Schema.Literal("terminal"), terminalId: Schema.String }),
]);

export type ToolCallContent = typeof ToolCallContent.Type;

export const ToolKind = Schema.Literals([
  "read",
  "edit",
  "delete",
  "move",
  "search",
  "execute",
  "think",
  "fetch",
  "switch_mode",
  "other",
]);

export type ToolKind = typeof ToolKind.Type;

export const ToolCallStatus = Schema.Literals(["pending", "in_progress", "completed", "failed"]);

export type ToolCallStatus = typeof ToolCallStatus.Type;

const Location = Schema.Struct({ path: Schema.String });

/** `tool_call` and `tool_call_update` alike: every field but the id is optional in an update. */
export const ToolCallFields = Schema.Struct({
  toolCallId: Schema.String,
  title: OptionalNullableString,
  name: OptionalNullableString,
  kind: Schema.optional(Schema.NullOr(ToolKind)),
  status: Schema.optional(Schema.NullOr(ToolCallStatus)),
  content: Schema.optional(Schema.NullOr(Schema.Array(ToolCallContent))),
  locations: Schema.optional(Schema.NullOr(Schema.Array(Location))),
  rawInput: Schema.optional(Schema.Unknown),
  rawOutput: Schema.optional(Schema.Unknown),
});

export type ToolCallFields = typeof ToolCallFields.Type;

/** The shell command in a tool call's raw input, where the Harness puts one there. */
const ShellInput = Schema.Struct({
  command: Schema.Union([Schema.String, Schema.Array(Schema.String)]),
});

/** An exit code in a tool call's raw output, under either spelling Harnesses use. */
const ExitOutput = Schema.Struct({
  exit_code: Schema.optional(Schema.Int),
  exitCode: Schema.optional(Schema.Int),
});

const decodeShellInput = Schema.decodeUnknownOption(ShellInput);

const decodeExitOutput = Schema.decodeUnknownOption(ExitOutput);

export const shellCommand = (fields: ToolCallFields): string | null =>
  Option.match(decodeShellInput(fields.rawInput), {
    onNone: () => null,
    onSome: ({ command }) => (Predicate.isString(command) ? command : command.join(" ")),
  });

export const exitCode = (fields: ToolCallFields): number | null =>
  Option.match(decodeExitOutput(fields.rawOutput), {
    onNone: () => null,
    onSome: (output) => output.exit_code ?? output.exitCode ?? null,
  });

export const PlanEntry = Schema.Struct({
  content: Schema.String,
  status: Schema.Literals(["pending", "in_progress", "completed"]),
});

export type PlanEntry = typeof PlanEntry.Type;

const Chunk = { content: ContentBlock, messageId: OptionalNullableString };

export const SessionUpdate = Schema.Union([
  Schema.Struct({ sessionUpdate: Schema.Literal("agent_message_chunk"), ...Chunk }),
  Schema.Struct({ sessionUpdate: Schema.Literal("agent_thought_chunk"), ...Chunk }),
  Schema.Struct({ sessionUpdate: Schema.Literal("user_message_chunk"), ...Chunk }),
  Schema.Struct({ sessionUpdate: Schema.Literal("tool_call"), ...ToolCallFields.fields }),
  Schema.Struct({ sessionUpdate: Schema.Literal("tool_call_update"), ...ToolCallFields.fields }),
  Schema.Struct({ sessionUpdate: Schema.Literal("plan"), entries: Schema.Array(PlanEntry) }),
  Schema.Struct({
    sessionUpdate: Schema.Literal("current_mode_update"),
    currentModeId: Schema.String,
  }),
  Schema.Struct({
    sessionUpdate: Schema.Literal("config_option_update"),
    configOptions: Schema.Array(ConfigOption),
  }),
  Schema.Struct({
    sessionUpdate: Schema.Literal("session_info_update"),
    title: OptionalNullableString,
  }),
  /** How full the context window is: `used` tokens of `size`. */
  Schema.Struct({
    sessionUpdate: Schema.Literal("usage_update"),
    used: Schema.Number,
    size: Schema.Number,
  }),
  Schema.Struct({
    sessionUpdate: Schema.Literal("notice"),
    severity: Schema.String,
    title: Schema.String,
    description: OptionalNullableString,
  }),
]);

export type SessionUpdate = typeof SessionUpdate.Type;

export const SessionNotification = Schema.Struct({
  sessionId: Schema.String,
  /** Decoded apart: updates this driver doesn't read (commands) are skipped. */
  update: Schema.Unknown,
});

/** The commands the agent offers in this session; ACP agents read `/name args` in a prompt. */
export const AvailableCommandsUpdate = Schema.Struct({
  sessionUpdate: Schema.Literal("available_commands_update"),
  availableCommands: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      description: Schema.String,
      input: Schema.optional(Schema.NullOr(Schema.Struct({ hint: Schema.String }))),
    })
  ),
});

// ---------------------------------------------------------------------------
// session/request_permission

export const PermissionOption = Schema.Struct({
  optionId: Schema.String,
  name: Schema.String,
  kind: Schema.Literals(["allow_once", "allow_always", "reject_once", "reject_always"]),
});

export type PermissionOption = typeof PermissionOption.Type;

export const RequestPermissionParams = Schema.Struct({
  sessionId: Schema.String,
  toolCall: ToolCallFields,
  options: Schema.Array(PermissionOption),
});

export type RequestPermissionParams = typeof RequestPermissionParams.Type;

// ---------------------------------------------------------------------------
// What the driver sends, typed by the SDK.

export interface ClientParams {
  readonly initialize: Acp.InitializeRequest;
  readonly "session/new": Acp.NewSessionRequest;
  readonly "session/load": Acp.LoadSessionRequest;
  readonly "session/resume": Acp.ResumeSessionRequest;
  readonly "session/close": Acp.CloseSessionRequest;
  readonly "session/prompt": Acp.PromptRequest;
  readonly "session/cancel": Acp.CancelNotification;
  readonly "session/set_mode": Acp.SetSessionModeRequest;
  readonly "session/set_config_option": Acp.SetSessionConfigOptionRequest;
}

export type PermissionResponse = Acp.RequestPermissionResponse;

/** Methods the driver calls and awaits; `session/cancel` is a notification. */
export type RequestMethod = Exclude<keyof ClientParams, "session/cancel">;

// ---------------------------------------------------------------------------
// Compile-time checks: each SDK type must be assignable to what its schema decodes.

type Conforms<Sdk, S extends { readonly Type: unknown }> = [Sdk] extends [S["Type"]] ? true : false;

type Update<T extends Acp.SessionUpdate["sessionUpdate"]> = Extract<
  Acp.SessionUpdate,
  { sessionUpdate: T }
>;

const conforms = <_ extends true>() => undefined;

conforms<
  Conforms<Acp.NewSessionResponse["sessionId"], typeof NewSessionResponse.fields.sessionId>
>();

conforms<Conforms<Acp.SessionModeState, typeof ModeState>>();

conforms<Conforms<Acp.PermissionOption, typeof PermissionOption>>();

conforms<Conforms<Acp.ToolKind, typeof ToolKind>>();

conforms<Conforms<Update<"available_commands_update">, typeof AvailableCommandsUpdate>>();

conforms<Conforms<Acp.ToolCallStatus, typeof ToolCallStatus>>();

conforms<Conforms<Acp.StopReason, typeof PromptResponse.fields.stopReason>>();

conforms<Conforms<Omit<Acp.PlanEntry, "priority">, typeof PlanEntry>>();

conforms<Conforms<Omit<Acp.ToolCallUpdate, "_meta">, typeof ToolCallFields>>();

conforms<Conforms<Omit<Update<"tool_call">, "_meta" | "sessionUpdate">, typeof ToolCallFields>>();

conforms<Conforms<Acp.SessionConfigSelectOption["value"], typeof SelectOption.fields.value>>();

conforms<Conforms<Acp.SessionConfigOption["id"], typeof ConfigOption.fields.id>>();
