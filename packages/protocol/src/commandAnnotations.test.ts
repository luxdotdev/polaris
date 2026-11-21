import { expect, test } from "bun:test";
import { Schema } from "effect";
import { Rpc, RpcGroup, RpcSchema } from "effect/rpc";
import { CommandAnnotation, compactCommandTool, defineCommands } from "./commandAnnotations.ts";
import { commands, DaemonRpcs } from "./rpc.ts";
import { accessFor } from "./grants.ts";

const definition = {
  name: "fake.show",
  description: "Show a value.",
  grant: "read" as const,
  examples: ["polaris fake show key"],
};

const fake = Rpc.make("fake.read", { payload: { key: Schema.String }, success: Schema.String });

test("a command missing its description or Grant fails catalogue construction", () => {
  expect(() =>
    defineCommands(
      RpcGroup.make(fake.annotate(CommandAnnotation, [{ ...definition, description: "" }]))
    )
  ).toThrow("description");
  const missingGrant = { ...definition };
  Reflect.deleteProperty(missingGrant, "grant");
  expect(() =>
    defineCommands(RpcGroup.make(fake.annotate(CommandAnnotation, [missingGrant])))
  ).toThrow("Grant");
});

test("served commands retain their annotations and existing Grant requirements", () => {
  const names = commands.map((command) => command.name);

  for (const required of [
    "approval.list",
    "host.list",
    "session.list",
    "session.send",
    "session.show",
    "session.start",
    "session.stop",
    "session.watch",
    "workspace.add",
    "workspace.list",
  ])
    expect(names).toContain(required);

  for (const command of commands) {
    if (command.name !== "host.list")
      expect(accessFor(command.rpcTag, command.dispatchTag ?? null).access).toBe(command.grant);
    const rpc = DaemonRpcs.requests.get(command.rpcTag);

    if (!rpc) throw new Error("RPC missing");
    expect(RpcSchema.isStreamSchema(rpc.successSchema)).toBe(command.mode !== undefined);
  }
});

test("compact MCP tool uses a verb and the fake command payload, with defaults optional", () => {
  const list = defineCommands(
    RpcGroup.make(
      fake.annotate(CommandAnnotation, [
        definition,
        {
          ...definition,
          name: "fake.set",
          description: "Set a value.",
          payloadSchema: Schema.Struct({ value: Schema.Boolean }),
        },
      ])
    )
  );

  const tool = compactCommandTool("fakes", "Read fake values.", list);
  expect(tool.name).toBe("fakes");
  expect(tool.inputSchema.properties.verb.enum).toEqual(["show", "set"]);
  expect(tool.inputSchema.oneOf[1]).toMatchObject({
    properties: { verb: { const: "set" }, value: { type: "boolean" } },
    required: ["verb", "value"],
  });
  expect(tool.description).toContain("show: Show a value.");
  expect(tool.inputSchema.oneOf[0]).toMatchObject({
    properties: { key: { type: "string" }, verb: { const: "show" } },
    required: ["verb", "key"],
    additionalProperties: false,
  });

  const defaulted = compactCommandTool("fakes", "Read.", [
    { ...list[0]!, defaults: { key: "default" } },
  ]);

  expect(defaulted.inputSchema.oneOf[0]?.required).toEqual(["verb"]);
});
