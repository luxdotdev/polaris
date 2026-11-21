import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describeSetting, HostSessionDefaults, type SettingValue } from "@polaris/protocol";
import { Option, Schema } from "effect";
import { polarisHome } from "../paths.ts";
import {
  checkRegistry,
  groups,
  groupDefaults,
  schemaFor,
  settingKeys,
  type Group,
} from "./registry.ts";
import { isPolarisEndpoint } from "../traces/detection.ts";

const Saved = Schema.Struct({
  values: Schema.Record(Schema.String, Schema.Json),
  /** Original JSON also preserves fields a newer or older build may not understand. */
  legacy: Schema.Record(Schema.String, Schema.Json),
});

type Saved = typeof Saved.Type;

const decode = Schema.decodeUnknownSync(Schema.fromJsonString(Saved));

checkRegistry();

const listeners = new Map<string, Set<(keys: ReadonlyArray<string>) => void>>();

export const hostSettingsPath = () => join(polarisHome(), "host-settings.json");

export const storeForLegacy = (path: string) => join(dirname(path), "host-settings.json");

const persist = (path: string, saved: Saved) => {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const partial = `${path}.${crypto.randomUUID()}.part`;

  try {
    writeFileSync(partial, JSON.stringify(saved, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    renameSync(partial, path);
  } finally {
    rmSync(partial, { force: true });
  }
};

const migrateFields = (name: Group, original: Schema.JsonObject) => {
  const values: Record<string, Schema.Json> = {};

  for (const field of Object.keys(groups[name].schema.fields)) {
    const key = `${name}.${field}`;
    const fieldSchema = schemaFor(key)!;
    const value = Schema.decodeUnknownOption(fieldSchema)(original[field]);

    if (Option.isSome(value))
      values[key] = Schema.encodeSync(Schema.toCodecJson(fieldSchema))(value.value);
  }

  return values;
};

const migrate = (path: string, override?: { group: Group | "traces"; path: string }): Saved => {
  const values: Record<string, Schema.Json> = {};
  const legacy: Record<string, Schema.Json> = {};

  for (const [name, group] of Object.entries(groups)) {
    const source = override?.group === name ? override.path : join(dirname(path), group.file);

    if (!existsSync(source)) continue;

    const text = readFileSync(source, "utf8");
    const original = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.JsonObject))(text);
    legacy[group.file] = Option.isSome(original) ? original.value : text;

    if (Option.isNone(original)) continue;

    // SAFETY: name is a key from Object.entries(groups).
    Object.assign(values, migrateFields(name as Group, original.value));
  }

  const traces =
    override?.group === "traces" ? override.path : join(dirname(path), "trace-settings.json");

  if (existsSync(traces)) {
    const text = readFileSync(traces, "utf8");
    const original = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.JsonObject))(text);
    legacy["trace-settings.json"] = Option.isSome(original) ? original.value : text;

    const traceSchema = schemaFor("traces.workspaces")!;
    const parsed = Option.flatMap(original, Schema.decodeUnknownOption(traceSchema));

    if (Option.isSome(parsed))
      values["traces.workspaces"] = Schema.encodeSync(Schema.toCodecJson(traceSchema))(
        parsed.value
      );
  }

  const saved = { values, legacy };
  persist(path, saved);

  return saved;
};

const load = (path: string, override?: { group: Group | "traces"; path: string }) => {
  return existsSync(path) ? decode(readFileSync(path, "utf8")) : migrate(path, override);
};

const schema = (key: string) => {
  const found = schemaFor(key);

  if (found === undefined) throw new Error(`Unknown host setting: ${key}`);

  return found;
};

const view = (saved: Saved, key: string): SettingValue => {
  const description = describeSetting(key, schema(key));
  const overridden = Object.hasOwn(saved.values, key);

  const match = /^sessions\.defaults\.([a-z][a-z0-9-]*)\.(model|effort|permissionMode)$/.exec(key);

  if (match !== null) {
    const defaults = Schema.decodeUnknownSync(HostSessionDefaults)(
      saved.values["sessions.defaults"] ?? {}
    );

    const value = defaults[match[1]!];

    return {
      ...description,
      value:
        value === undefined
          ? description.default
          : value[
              Schema.decodeUnknownSync(Schema.Literals(["model", "effort", "permissionMode"]))(
                match[2]
              )
            ],
      overridden: value !== undefined,
    };
  }

  return {
    ...description,
    value: Schema.encodeSync(Schema.toCodecJson(schema(key)))(
      Schema.decodeUnknownSync(schema(key))(overridden ? saved.values[key]! : description.default)
    ),
    overridden,
  };
};

const validate = (key: string, value: Schema.Json): Schema.Json => {
  const parsed = Schema.decodeUnknownSync(schema(key))(value);

  if (key === "traces.workspaces") {
    const workspaces = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.JsonObject))(
      parsed
    );

    for (const workspace of Object.values(workspaces)) {
      const target = workspace.forwardTo;
      const endpoint = Schema.decodeUnknownOption(Schema.Struct({ url: Schema.String }))(target);

      if (Option.isSome(endpoint) && isPolarisEndpoint(endpoint.value.url))
        throw new Error("Choose a trace collector outside Polaris.");
    }
  }

  return Schema.encodeSync(Schema.toCodecJson(schema(key)))(parsed);
};

const notify = (path: string, keys: ReadonlyArray<string>) => {
  for (const listener of listeners.get(resolve(path)) ?? []) listener(keys);
};

export const hostSettings = (path = hostSettingsPath()) => ({
  list: () => {
    const saved = load(path);

    return settingKeys(saved.values).map((key) => view(saved, key));
  },
  describe: (key: string) => describeSetting(key, schema(key)),
  get: (key: string) => view(load(path), key),
  set: (key: string, value: Schema.Json, ifUnset = false) => {
    const parsed = validate(key, value);
    const saved = load(path);

    if (!ifUnset || !view(saved, key).overridden) {
      const values = { ...saved.values };

      const match = /^sessions\.defaults\.([a-z][a-z0-9-]*)\.(model|effort|permissionMode)$/.exec(
        key
      );

      if (match === null) values[key] = parsed;
      else {
        const defaults = Schema.decodeUnknownSync(HostSessionDefaults)(
          values["sessions.defaults"] ?? {}
        );

        values["sessions.defaults"] = Schema.decodeUnknownSync(Schema.Json)({
          ...defaults,
          [match[1]!]: {
            model: null,
            effort: null,
            permissionMode: "supervised",
            ...defaults[match[1]!],
            [match[2]!]: parsed,
          },
        });
      }

      persist(path, { ...saved, values });
      notify(path, [key]);
    }

    return view(load(path), key);
  },
});

/** Legacy APIs delegate here, preserving their codecs and file-path injection for tests. */
export const readGroup = <G extends Group>(
  path: string,
  group: G
): (typeof groups)[G]["schema"]["Type"] => {
  const saved = load(storeForLegacy(path), { group, path });

  const fields = Object.fromEntries(
    Object.keys(groups[group].schema.fields).flatMap((field) => {
      const value = view(saved, `${group}.${field}`).value;
      const optional = groupDefaults(group)[field] === undefined;

      return optional && value === null ? [] : [[field, value]];
    })
  );

  // SAFETY: the selected group's Schema decodes exactly the group's public type.
  return Schema.decodeUnknownSync(groups[group].schema)(fields);
};

export const writeGroup = (
  path: string,
  group: Group,
  value: (typeof groups)[Group]["schema"]["Type"]
) => {
  const decoded = Schema.decodeUnknownSync(groups[group].schema)(value);

  const parsed = Schema.decodeUnknownSync(Schema.JsonObject)(
    Schema.encodeSync(Schema.toCodecJson(groups[group].schema))(decoded)
  );

  const storePath = storeForLegacy(path);
  const saved = load(storePath, { group, path });
  const next = { ...saved.values };
  const keys = Object.keys(groups[group].schema.fields).map((field) => `${group}.${field}`);

  for (const field of Object.keys(groups[group].schema.fields)) {
    const key = `${group}.${field}`;
    next[key] = validate(key, parsed[field] ?? null);
  }

  persist(storePath, { ...saved, values: next });
  notify(storePath, keys);
};

export const subscribeSettings = (
  path: string,
  listener: (keys: ReadonlyArray<string>) => void
) => {
  const key = resolve(path);
  const subscribers = listeners.get(key) ?? new Set();
  subscribers.add(listener);
  listeners.set(key, subscribers);

  return () => {
    subscribers.delete(listener);

    if (subscribers.size === 0) listeners.delete(key);
  };
};

export const readTraces = (path: string) => {
  const saved = load(storeForLegacy(path), { group: "traces", path });

  return saved.values["traces.workspaces"] ?? {};
};

export const writeTraces = (path: string, value: Schema.Json) => {
  load(storeForLegacy(path), { group: "traces", path });
  hostSettings(storeForLegacy(path)).set("traces.workspaces", value);
};
