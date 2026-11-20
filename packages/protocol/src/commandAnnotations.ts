import { Context, Schema } from "effect";
import type { CommandAccess } from "./grants.ts";

/** One RPC can expose several commands, such as projections of a Host snapshot. */
export interface CommandDefinition {
  readonly name: string;
  readonly description: string;
  readonly grant: CommandAccess;
  readonly examples: ReadonlyArray<string>;
  /** A public view of an existing payload; absent means the full RPC payload. */
  readonly payloadSchema?: Schema.Codec<unknown>;
  readonly defaults?: Schema.JsonObject;
  readonly generated?: ReadonlyArray<string>;
  readonly positional?: ReadonlyArray<string>;
  readonly stdin?: string;
  readonly dispatchTag?: string;
  readonly mode?: "snapshot" | "watch";
  readonly project?: "sessions" | "workspaces" | "approvals" | "host";
}

export const CommandAnnotation = Context.Reference<ReadonlyArray<CommandDefinition>>(
  "@polaris/protocol/CommandAnnotation",
  { defaultValue: () => [] }
);

export interface AnnotatedCommand extends CommandDefinition {
  readonly rpcTag: string;
  readonly payloadSchema: Schema.Codec<unknown>;
}

/** The only catalogue is the annotations on the served RPC group. */
export const defineCommands = (group: {
  readonly requests: ReadonlyMap<
    string,
    {
      readonly _tag: string;
      readonly annotations: Context.Context<never>;
      readonly payloadSchema: Schema.Top;
    }
  >;
}) => {
  const commands: Array<AnnotatedCommand> = [];
  const names = new Set<string>();

  for (const rpc of group.requests.values()) {
    for (const command of Context.get(rpc.annotations, CommandAnnotation)) {
      if (!command.description?.trim() || /[\r\n]/.test(command.description))
        throw new Error(`${command.name}: a command needs a one-line description`);

      if (!command.grant) throw new Error(`${command.name}: a command needs a Grant`);

      if (!/^[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*$/.test(command.name))
        throw new Error(`${command.name}: expected a dotted command name`);

      if (names.has(command.name)) throw new Error(`${command.name}: duplicate command`);
      names.add(command.name);
      commands.push({
        ...command,
        rpcTag: rpc._tag,
        // SAFETY: Daemon RPC payloads have no codec services; consumers decode at the boundary.
        payloadSchema: command.payloadSchema ?? (rpc.payloadSchema as Schema.Codec<unknown>),
      });
    }
  }

  return commands;
};

/** One MCP tool with a discriminated verb, generated from the same payload schemas. */
export const compactCommandTool = (
  name: string,
  description: string,
  commands: ReadonlyArray<AnnotatedCommand>
) => ({
  name,
  description: `${description}\n${commands.map((c) => `${c.name.split(".")[1]}: ${c.description}`).join("\n")}`,
  inputSchema: {
    type: "object",
    properties: {
      verb: { type: "string", enum: commands.map((command) => command.name.split(".")[1]) },
    },
    required: ["verb"],
    oneOf: commands.map((command) => {
      const document = Schema.toJsonSchemaDocument(command.payloadSchema, {
        referencePolicy: () => undefined,
      });

      const schema = Schema.decodeUnknownSync(
        Schema.Struct({
          properties: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
          required: Schema.optionalKey(Schema.Array(Schema.String)),
        })
      )(document.schema);

      const optional = new Set([
        ...Object.keys(command.defaults ?? {}),
        ...(command.generated ?? []),
      ]);

      return {
        ...document.schema,
        $defs: document.definitions,
        properties: { ...schema.properties, verb: { const: command.name.split(".")[1] } },
        required: ["verb", ...(schema.required ?? []).filter((key) => !optional.has(key))],
        additionalProperties: false,
      };
    }),
  },
});
