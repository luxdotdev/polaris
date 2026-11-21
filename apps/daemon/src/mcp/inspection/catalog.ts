import type { DesktopSnapshot, SessionId } from "@polaris/protocol";
import { Effect, Schema } from "effect";
import { sessionTool, text } from "../tools/session.ts";
import { rejection, type BoundTool, type ConstellationCommands } from "../tools/shared.ts";
import type { InspectionError } from "./relay.ts";

export interface InspectionTools {
  readonly enabled: Effect.Effect<boolean>;
  readonly logs: (
    lines: number,
    stream: "stdout" | "stderr"
  ) => Effect.Effect<string, InspectionError>;
  readonly snapshot: (sessionId: SessionId) => Effect.Effect<DesktopSnapshot, InspectionError>;
}

const inspections = new WeakMap<ConstellationCommands, InspectionTools>();

export const attachInspectionTools = (commands: ConstellationCommands, tools: InspectionTools) => {
  inspections.set(commands, tools);
};

const off = () =>
  rejection(
    "E-DEVELOPER-MODE",
    "Developer Mode is off",
    "The user can turn on Developer Mode in Settings."
  );

/** Check again at invocation and after a pending read, including calls from a cached catalog. */
const read = (tools: InspectionTools, effect: Effect.Effect<string, InspectionError>) =>
  Effect.gen(function* () {
    if (!(yield* tools.enabled)) return yield* off();

    const result = yield* effect.pipe(
      Effect.mapError((error) =>
        rejection(
          "E-INSPECTION",
          error.message,
          "Check the connected Desktop App or Daemon logs and try again."
        )
      )
    );

    if (!(yield* tools.enabled)) return yield* off();
    const body = result;

    return text([
      body.length > 15800 ? `${body.slice(0, 15800)}\n… snapshot truncated.` : body,
      "Next: Inspect the relevant view or recent log lines.",
    ]);
  });

export const inspectionTools = async (
  commands: ConstellationCommands,
  caller: SessionId
): Promise<ReadonlyArray<BoundTool>> => {
  const tools = inspections.get(commands);

  if (tools === undefined || !(await Effect.runPromise(tools.enabled))) return [];

  return [
    sessionTool(
      "daemon_logs",
      "Read recent Daemon service log lines on this Host. Developer Mode only; stdout is the default. Self-Traces use the existing traces tool with scope self; Daemon Sources use data_sources/query.",
      Schema.Struct({
        lines: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 200 }))),
        stream: Schema.optionalKey(Schema.Literals(["stdout", "stderr"])),
      }),
      ({ lines, stream }) => read(tools, tools.logs(lines ?? 50, stream ?? "stdout"))
    ),
    sessionTool(
      "desktop_view",
      "Read a fresh renderer snapshot of the connected Desktop App's current view and window structure. Includes visible UI text and controls, excluding input values. Developer Mode only. With multiple Desktop Apps, uses the last connected app.",
      Schema.Record(Schema.String, Schema.Never),
      () =>
        read(
          tools,
          Effect.map(tools.snapshot(caller), (snapshot) => JSON.stringify(snapshot, null, 2))
        )
    ),
  ].map((tool) => ({ ...tool, annotations: { readOnlyHint: true, openWorldHint: false } }));
};
