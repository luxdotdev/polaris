import {
  CommandId,
  ConstellationFinding,
  ConstellationGraphSlice,
  ConstellationRejected,
  type ConstellationCommand,
  type ConstellationResult,
  type ConstellationId,
} from "@polaris/protocol";
import { Effect, Schema } from "effect";
import type { SessionBinding } from "../binding.ts";

export interface ConstellationCommands {
  readonly command: (
    binding: SessionBinding,
    id: CommandId,
    command: ConstellationCommand
  ) => Effect.Effect<ConstellationResult, ConstellationRejected>;
  readonly status: (
    binding: SessionBinding,
    id: ConstellationId,
    json: boolean
  ) => Effect.Effect<ConstellationResult, ConstellationRejected>;
  /** Resolve friendly names against the caller's Constellation and Host catalog. */
  readonly resolve: (
    binding: SessionBinding,
    id: ConstellationId,
    kind: "attempt" | "session" | "host" | "model",
    name: string
  ) => Effect.Effect<string, ConstellationRejected>;
}

export interface McpToolResult {
  readonly content: Array<{ type: "text"; text: string }>;
  readonly isError?: boolean;
  readonly structuredContent?: {
    readonly findings: ReadonlyArray<ConstellationFinding>;
    readonly graph: ConstellationRejected["graph"];
    readonly revision: number;
  };
}

export interface BoundTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: ReturnType<typeof Schema.toJsonSchemaDocument>["schema"];
  readonly call: (input: typeof Schema.Json.Type) => Promise<McpToolResult>;
}

export const rejection = (code: string, message: string, fix: string) =>
  new ConstellationRejected({
    findings: [new ConstellationFinding({ code, message, fix })],
    graph: null,
    revision: 0,
  });

export const graphSlice = (result: ConstellationResult) =>
  result.constellation === null
    ? null
    : new ConstellationGraphSlice({
        constellationId: result.constellation.id,
        revision: result.revision,
        tasks: result.constellation.tasks,
        attempts: result.constellation.attempts,
        projections: result.projections,
      });

const resultText = (
  result: ConstellationResult,
  json: boolean,
  summary?: string,
  next?: string
): McpToolResult => ({
  content: [
    {
      type: "text",
      text: `${summary ?? result.summary}\nRevision: ${result.revision}\n${json ? `${JSON.stringify({ constellation: result.constellation, projections: result.projections, proposals: result.proposals })}\n` : ""}Next: ${next ?? result.next}`,
    },
  ],
});

export const errorResult = (error: ConstellationRejected): McpToolResult => ({
  isError: true,
  structuredContent: { findings: error.findings, graph: error.graph, revision: error.revision },
  content: [
    {
      type: "text",
      text: [
        ...error.findings.map(
          (finding) => `${finding.code}: ${finding.message}\nFix: ${finding.fix}`
        ),
        `Revision: ${error.revision}`,
        "Next: Apply these fixes and retry; read status if the graph changed.",
      ].join("\n"),
    },
  ],
});

const jsonSchema = (schema: Schema.Constraint) => {
  const document = Schema.toJsonSchemaDocument(schema);

  return { ...document.schema, $defs: document.definitions };
};

export const toolFactory = (
  read: () => Effect.Effect<ConstellationResult, ConstellationRejected>
) => {
  const contextualize = (error: ConstellationRejected) => {
    if (error.graph !== null || error.revision !== 0) return Effect.succeed(errorResult(error));

    return read().pipe(
      Effect.map((current) =>
        errorResult(
          new ConstellationRejected({
            findings: error.findings,
            graph: graphSlice(current),
            revision: current.revision,
          })
        )
      ),
      Effect.catchTag("ConstellationRejected", () => Effect.succeed(errorResult(error)))
    );
  };

  return <S extends Schema.Decoder<unknown>>(
    name: string,
    description: string,
    schema: S,
    execute: (input: S["Type"]) => Effect.Effect<ConstellationResult, ConstellationRejected>,
    options: {
      readonly json?: (input: S["Type"]) => boolean;
      readonly summary?: string;
      readonly next?: string;
    } = {}
  ): BoundTool => ({
    name,
    description,
    inputSchema: jsonSchema(schema),
    call: (input) =>
      Effect.runPromise(
        Schema.decodeUnknownEffect(schema)(input, { onExcessProperty: "error" }).pipe(
          Effect.mapError(() =>
            rejection(
              "E-INPUT",
              `Invalid input for ${name}`,
              "Use the fields in this tool's input schema."
            )
          ),
          Effect.flatMap((decoded) =>
            execute(decoded).pipe(
              Effect.map((result) =>
                resultText(result, options.json?.(decoded) ?? false, options.summary, options.next)
              )
            )
          ),
          Effect.catchTag("ConstellationRejected", contextualize)
        )
      ),
  });
};
