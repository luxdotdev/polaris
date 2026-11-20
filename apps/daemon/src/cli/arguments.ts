import { Schema } from "effect";
import { type AnnotatedCommand } from "@polaris/protocol";

export class UsageError extends Error {}

export const commandFields = (command: AnnotatedCommand) =>
  Schema.decodeUnknownSync(
    Schema.Struct({
      properties: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
      required: Schema.optionalKey(Schema.Array(Schema.String)),
    })
  )(
    Schema.toJsonSchemaDocument(command.payloadSchema, { referencePolicy: () => undefined }).schema
  );

export const flagName = (key: string) => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

const stringSchema = Schema.Struct({ type: Schema.Literal("string") });

const nullSchema = Schema.Struct({ type: Schema.Literal("null") });

const unionSchema = Schema.Struct({ anyOf: Schema.Array(Schema.Unknown) });

type JsonSchemaField = NonNullable<ReturnType<typeof commandFields>["properties"]>[string];

export type CommandValue = AnnotatedCommand["payloadSchema"]["Type"];

interface CommandArguments {
  [key: string]: Schema.Json;
}

const parseValue = (raw: string, field: JsonSchemaField): Schema.Json => {
  const alternatives = Schema.is(unionSchema)(field) ? field.anyOf : [field];

  if (
    alternatives.some(Schema.is(stringSchema)) &&
    !(raw === "null" && alternatives.some(Schema.is(nullSchema)))
  )
    return raw;

  try {
    return Schema.decodeUnknownSync(Schema.Json)(JSON.parse(raw));
  } catch {
    return raw;
  }
};

const readFlag = (args: ReadonlyArray<string>, index: number) => {
  const raw = args[index]!;
  const equal = raw.indexOf("=");

  if (equal >= 0) return { name: raw.slice(2, equal), value: raw.slice(equal + 1), next: index };
  const value = args[index + 1];

  if (value === undefined || value.startsWith("--")) throw new UsageError(`${raw} needs a value`);

  return { name: raw.slice(2), value, next: index + 1 };
};

const assignArgument = (
  command: AnnotatedCommand,
  values: CommandArguments,
  fields: NonNullable<ReturnType<typeof commandFields>["properties"]>,
  args: ReadonlyArray<string>,
  index: number,
  position: number,
  literal: boolean
) => {
  const raw = args[index]!;

  if (!literal && raw.startsWith("--")) {
    const flag = readFlag(args, index);

    if (flag.name === "host")
      throw new UsageError("--host is not yet supported; run polaris on that host.");
    const key = Object.keys(fields).find((key) => key === flag.name || flagName(key) === flag.name);

    if (key === undefined) throw new UsageError(`Unknown flag --${flag.name}`);
    values[key] = parseValue(flag.value, fields[key]);

    return { index: flag.next, position };
  }

  const key = command.positional?.[position];

  if (key === undefined) throw new UsageError(`Unexpected argument: ${raw}`);

  if (Object.hasOwn(values, key) && !Object.hasOwn(command.defaults ?? {}, key))
    throw new UsageError(`${key} was supplied twice`);
  values[key] = parseValue(raw, fields[key]);

  return { index, position: position + 1 };
};

export const parseCommandArguments = (
  command: AnnotatedCommand,
  args: ReadonlyArray<string>,
  uuid: () => string = () => crypto.randomUUID()
) => {
  const fields = commandFields(command).properties ?? {};
  const values: CommandArguments = Object.fromEntries(Object.entries(command.defaults ?? {}));

  for (const key of command.generated ?? []) values[key] = uuid();
  let json = false;
  let position = 0;
  let literal = false;

  for (let i = 0; i < args.length; i++) {
    const raw = args[i]!;

    if (!literal && raw === "--") {
      literal = true;
      continue;
    }

    if (!literal && raw === "--json") {
      json = true;
      continue;
    }

    const next = assignArgument(command, values, fields, args, i, position, literal);
    i = next.index;
    position = next.position;
  }

  return { values, json };
};

export const decodeCommandPayload = (command: AnnotatedCommand, input: CommandValue) => {
  try {
    return Schema.decodeUnknownSync(command.payloadSchema)(input);
  } catch (error) {
    throw new UsageError(String(error));
  }
};
