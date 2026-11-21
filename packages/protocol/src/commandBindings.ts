import { Schema, Struct } from "effect";
import { Command } from "./commands.ts";
import { COMMAND_GRANTS } from "./grants.ts";
import type { CommandDefinition } from "./commandAnnotations.ts";

export const dispatchCommands: ReadonlyArray<CommandDefinition> = [
  {
    name: "session.setStartLimit",
    description: "Set a session's start budget (user only).",
    grant: "client",
    examples: ["polaris session setStartLimit ses_123 --limit 10"],
    payloadSchema: Schema.Struct(Struct.omit(Command.cases.SetSessionStartLimit.fields, ["_tag"])),
    positional: ["sessionId"],
    dispatchTag: "SetSessionStartLimit",
  },
  {
    name: "session.send",
    description: "Send a turn to an agent session.",
    grant: COMMAND_GRANTS.SendTurn,
    examples: ['polaris session send ses_123 "Continue"'],
    payloadSchema: Schema.Struct(Struct.omit(Command.cases.SendTurn.fields, ["_tag"])),
    defaults: { attachments: [] },
    positional: ["sessionId", "prompt"],
    dispatchTag: "SendTurn",
  },
  {
    name: "session.stop",
    description: "Interrupt an agent session's current turn.",
    grant: COMMAND_GRANTS.Interrupt,
    examples: ["polaris session stop ses_123"],
    payloadSchema: Schema.Struct(Struct.omit(Command.cases.Interrupt.fields, ["_tag"])),
    positional: ["sessionId"],
    dispatchTag: "Interrupt",
  },
  {
    name: "workspace.add",
    description: "Register a workspace on this host.",
    grant: COMMAND_GRANTS.RegisterWorkspace,
    examples: ["polaris workspace add /path/to/repository"],
    payloadSchema: Schema.Struct(Struct.omit(Command.cases.RegisterWorkspace.fields, ["_tag"])),
    defaults: { name: null },
    positional: ["path"],
    dispatchTag: "RegisterWorkspace",
  },
];

export const hostCommands: ReadonlyArray<CommandDefinition> = [
  {
    name: "session.list",
    description: "List agent sessions on this host.",
    grant: "read",
    examples: ["polaris session list --json"],
    defaults: { afterSequence: null },
    mode: "snapshot",
    project: "sessions",
  },
  {
    name: "workspace.list",
    description: "List workspaces on this host.",
    grant: "read",
    examples: ["polaris workspace list"],
    defaults: { afterSequence: null },
    mode: "snapshot",
    project: "workspaces",
  },
  {
    name: "approval.list",
    description: "List pending approvals on this host.",
    grant: "read",
    examples: ["polaris approval list"],
    defaults: { afterSequence: null },
    mode: "snapshot",
    project: "approvals",
  },
];

export const sessionCommands: ReadonlyArray<CommandDefinition> = [
  {
    name: "session.show",
    description: "Show an agent session and its recent turns.",
    grant: "read",
    examples: ["polaris session show ses_123"],
    defaults: { afterSequence: null, turnLimit: 20 },
    positional: ["sessionId"],
    mode: "snapshot",
  },
  {
    name: "session.watch",
    description: "Watch an agent session's live feed.",
    grant: "read",
    examples: ["polaris session watch ses_123 --json"],
    defaults: { afterSequence: null, turnLimit: 20 },
    positional: ["sessionId"],
    mode: "watch",
  },
];

export const localHostCommands: ReadonlyArray<CommandDefinition> = [
  {
    name: "host.list",
    description: "Show this local host.",
    grant: "read",
    examples: ["polaris host list"],
    project: "host",
    payloadSchema: Schema.Struct({}),
  },
];
