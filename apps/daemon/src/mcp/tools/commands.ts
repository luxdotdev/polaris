/** Schema validation and tool discovery use the same annotated command catalogue. */
import {
  compactCommandTool,
  type AnnotatedCommand,
  type ConstellationRejected,
} from "@polaris/protocol";
import { Effect, Schema } from "effect";
import { rejection, type BoundTool, type McpToolResult } from "./shared.ts";
import { sessionTool } from "./session.ts";

export const commandTool = (
  name: string,
  description: string,
  catalog: ReadonlyArray<AnnotatedCommand>,
  run: (
    command: AnnotatedCommand,
    payload: Schema.Json
  ) => Effect.Effect<McpToolResult, ConstellationRejected>
): BoundTool => ({
  ...compactCommandTool(name, description, catalog),
  call: sessionTool(name, description, Schema.Record(Schema.String, Schema.Unknown), (input) =>
    Effect.gen(function* () {
      const command = catalog.find((command) => command.name.split(".")[1] === input.verb);

      const invalid = () =>
        rejection(
          "E-INPUT",
          `Invalid ${name} arguments`,
          "Use the command's verb, fields and types."
        );

      if (command === undefined) return yield* invalid();
      const { verb: _verb, ...values } = input;

      const decoded = yield* Schema.decodeUnknownEffect(command.payloadSchema)(
        Object.assign({}, command.defaults, values),
        { onExcessProperty: "error" }
      ).pipe(Effect.mapError(invalid));

      const payload = yield* Schema.decodeUnknownEffect(Schema.Json)(decoded).pipe(
        Effect.mapError(invalid)
      );

      return yield* run(command, payload);
    })
  ).call,
});
