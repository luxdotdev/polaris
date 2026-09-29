#!/usr/bin/env bun
/**
 * Regenerates `generated/` from the installed `opencode` binary:
 *
 *   bun apps/daemon/src/harness/opencode/generate.ts [--opencode /path/to/opencode] [--doc doc.json]
 *
 * It starts `opencode serve` on loopback with throwaway XDG directories (so it
 * reads no config and no credentials), fetches the OpenAPI document from `/doc`,
 * and writes TypeScript types for the closure of the schemas and request bodies
 * the driver uses (oxfmt ignores `generated/`). After regenerating,
 * `bun run typecheck` fails wherever `protocol.ts` no longer matches.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

/** The component schemas the driver receives or validates. */
const ROOTS = [
  "Session",
  "SessionStatus",
  "Message",
  "Part",
  "Provider",
  "PermissionRequest",
  "PermissionRuleset",
  "QuestionRequest",
  "EventMessageUpdated",
  "EventMessagePartUpdated",
  "EventMessagePartDelta",
  "EventSessionStatus",
  "EventSessionIdle",
  "EventSessionError",
  "EventSessionUpdated",
  "EventPermissionAsked",
  "EventPermissionReplied",
  "EventQuestionAsked",
  "EventQuestionReplied",
  "EventQuestionRejected",
];

/** Request bodies the driver sends, by the type name they get. */
const BODIES = {
  SessionCreateBody: ["/session", "post"],
  SessionUpdateBody: ["/session/{sessionID}", "patch"],
  PromptAsyncBody: ["/session/{sessionID}/prompt_async", "post"],
  PermissionReplyBody: ["/permission/{requestID}/reply", "post"],
  QuestionReplyBody: ["/question/{requestID}/reply", "post"],
} as const satisfies Record<string, readonly [path: string, method: string]>;

/** Responses the driver reads, by the type name they get. */
const RESPONSES = {
  ConfigProvidersResponse: ["/config/providers", "get"],
} as const satisfies Record<string, readonly [path: string, method: string]>;

type JsonSchema = {
  readonly $ref?: string;
  readonly type?: string | ReadonlyArray<string>;
  readonly enum?: ReadonlyArray<unknown>;
  readonly const?: unknown;
  readonly anyOf?: ReadonlyArray<JsonSchema>;
  readonly oneOf?: ReadonlyArray<JsonSchema>;
  readonly allOf?: ReadonlyArray<JsonSchema>;
  readonly items?: JsonSchema;
  readonly properties?: Record<string, JsonSchema>;
  readonly required?: ReadonlyArray<string>;
  readonly additionalProperties?: boolean | JsonSchema;
};

type OpenApi = {
  readonly info: { readonly version: string };
  readonly paths: Record<string, Record<string, OperationObject>>;
  readonly components: { readonly schemas: Record<string, JsonSchema> };
};

type OperationObject = {
  readonly requestBody?: { readonly content: Record<string, { readonly schema: JsonSchema }> };
  readonly responses: Record<string, { readonly content?: Record<string, { schema: JsonSchema }> }>;
};

const typeName = (schemaName: string) => schemaName.replace(/[^A-Za-z0-9_]/g, "_");

const refName = (ref: string) => ref.replace("#/components/schemas/", "");

const key = (name: string) =>
  /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : JSON.stringify(name);

/** Emits a TypeScript type for a schema, collecting the `$ref`s it reaches. */
const emit = (schema: JsonSchema, refs: Set<string>): string => {
  if (schema.$ref) {
    const name = refName(schema.$ref);
    refs.add(name);

    return typeName(name);
  }

  if (schema.const !== undefined) return JSON.stringify(schema.const);

  if (schema.enum) return schema.enum.map((value) => JSON.stringify(value)).join(" | ");
  const union = schema.anyOf ?? schema.oneOf;

  if (union) return `(${union.map((member) => emit(member, refs)).join(" | ")})`;

  if (schema.allOf) return `(${schema.allOf.map((member) => emit(member, refs)).join(" & ")})`;

  const types = schema.type === undefined ? [] : [schema.type].flat();

  if (types.length > 1)
    return `(${types.map((type) => emit({ ...schema, type }, refs)).join(" | ")})`;

  switch (types[0]) {
    case "string":
      return "string";
    case "number":
    case "integer":
      return "number";
    case "boolean":
      return "boolean";
    case "null":
      return "null";
    case "array":
      return `Array<${schema.items ? emit(schema.items, refs) : "unknown"}>`;
    default:
      return emitObject(schema, refs);
  }
};

const emitObject = (schema: JsonSchema, refs: Set<string>): string => {
  const required = new Set(schema.required ?? []);

  const fields = Object.entries(schema.properties ?? {}).map(
    ([name, value]) => `${key(name)}${required.has(name) ? "" : "?"}: ${emit(value, refs)}`
  );

  const extra = schema.additionalProperties;

  if (extra !== undefined && extra !== true && extra !== false)
    fields.push(`[key: string]: ${emit(extra, refs)}`);
  else if (fields.length === 0) return "{ [key: string]: unknown }";

  return `{ ${fields.join("; ")} }`;
};

const args = process.argv.slice(2);

const flag = (name: string) => {
  const at = args.indexOf(name);

  return at >= 0 ? args[at + 1] : undefined;
};

const fetchDoc = async (opencode: string): Promise<OpenApi> => {
  const scratch = mkdtempSync(join(tmpdir(), "polaris-opencode-gen-"));
  const password = crypto.randomUUID();

  const proc = Bun.spawn([opencode, "serve", "--hostname", "127.0.0.1", "--port", "0"], {
    env: {
      ...process.env,
      XDG_DATA_HOME: join(scratch, "data"),
      XDG_CONFIG_HOME: join(scratch, "config"),
      XDG_STATE_HOME: join(scratch, "state"),
      XDG_CACHE_HOME: join(scratch, "cache"),
      OPENCODE_SERVER_PASSWORD: password,
    },
    stdout: "pipe",
    stderr: "ignore",
  });

  try {
    const reader = proc.stdout.getReader();
    let text = "";
    let url: string | undefined;

    while (url === undefined) {
      const chunk = await reader.read();

      if (chunk.done) throw new Error(`opencode serve exited before listening: ${text}`);
      text += new TextDecoder().decode(chunk.value);
      url = text.match(/listening on (http:\/\/\S+)/)?.[1];
    }

    const response = await fetch(`${url}/doc`, {
      headers: { authorization: `Basic ${btoa(`opencode:${password}`)}` },
    });

    const parsed: unknown = await response.json();

    // SAFETY: /doc is OpenCode's OpenAPI 3.1 document; each path and schema used is checked where it's read.
    return parsed as OpenApi;
  } finally {
    proc.kill();
    await proc.exited;
    rmSync(scratch, { recursive: true, force: true });
  }
};

const opencode = flag("--opencode") ?? Bun.which("opencode");

if (!opencode) throw new Error("opencode not found on PATH; pass --opencode /path/to/opencode");

const versionProc = Bun.spawn([opencode, "--version"], { stdout: "pipe", stderr: "ignore" });

const version = (await new Response(versionProc.stdout).text()).trim();

const docPath = flag("--doc");

const readDoc = async (path: string): Promise<OpenApi> => {
  const parsed: unknown = await Bun.file(path).json();

  // SAFETY: as in fetchDoc, a /doc saved to a file.
  return parsed as OpenApi;
};

const doc = docPath ? await readDoc(docPath) : await fetchDoc(opencode);

const refs = new Set<string>(ROOTS);

const lines: Array<string> = [];

const operation = (path: string, method: string): OperationObject => {
  const found = doc.paths[path]?.[method];

  if (!found) throw new Error(`${method.toUpperCase()} ${path} is not in /doc`);

  return found;
};

for (const [name, [path, method]] of Object.entries(BODIES)) {
  const body = operation(path, method).requestBody?.content["application/json"]?.schema;

  if (!body) throw new Error(`${method.toUpperCase()} ${path} has no JSON body`);
  lines.push(`export type ${name} = ${emit(body, refs)}`);
}

for (const [name, [path, method]] of Object.entries(RESPONSES)) {
  const body = operation(path, method).responses["200"]?.content?.["application/json"]?.schema;

  if (!body) throw new Error(`${method.toUpperCase()} ${path} has no JSON 200 response`);
  lines.push(`export type ${name} = ${emit(body, refs)}`);
}

const done = new Set<string>();

while (done.size < refs.size) {
  for (const name of [...refs].sort()) {
    if (done.has(name)) continue;
    done.add(name);
    const schema = doc.components.schemas[name];

    if (!schema) throw new Error(`schema ${name} is not in /doc`);
    lines.push(`export type ${typeName(name)} = ${emit(schema, refs)}`);
  }
}

const outDir = join(import.meta.dir, "generated");

await mkdir(outDir, { recursive: true });

await writeFile(
  join(outDir, "openapi.ts"),
  [
    `// Generated from anomalyco/opencode's /doc (MIT) by opencode ${version} with generate.ts. Do not edit.`,
    ...lines.sort(),
    "",
  ].join("\n")
);

await writeFile(
  join(outDir, "version.ts"),
  `// Generated by generate.ts. Do not edit.\n/** The \`opencode --version\` these types were generated from. */\nexport const GENERATED_FROM_OPENCODE_VERSION = ${JSON.stringify(version)}\n`
);

console.log(
  `generated ${done.size} schemas from opencode ${version} into ${relative(process.cwd(), outDir)}`
);
