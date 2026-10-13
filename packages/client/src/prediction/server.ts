/**
 * The model server behind a completion endpoint: which server it is (llama-server, LM Studio,
 * Ollama) and the recovery its own API offers. Runs on whichever side owns the endpoint.
 */
import {
  PredictionEndpointUrl,
  PredictionError,
  type PredictionServerAction,
  type PredictionServerReport,
  type PredictionServerRequest,
} from "@polaris/protocol";
import { Option, Schema, SchemaGetter } from "effect";

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

type Endpoint = PredictionServerRequest["endpoint"];

const IDENTIFY_MS = 1500;

/** Reloading a model reads it from disk again; a large one takes a while. */
const ACTION_MS = 120_000;

const LlamaProps = Schema.Struct({ default_generation_settings: Schema.Unknown });

const LlamaSlots = Schema.Array(Schema.Struct({ id: Schema.Int }));

const LoadConfig = Schema.Struct({
  context_length: Schema.optionalKey(Schema.Number),
  eval_batch_size: Schema.optionalKey(Schema.Number),
  flash_attention: Schema.optionalKey(Schema.Boolean),
  num_experts: Schema.optionalKey(Schema.Number),
  offload_kv_cache_to_gpu: Schema.optionalKey(Schema.Boolean),
});

const LmStudioModels = Schema.Struct({
  models: Schema.Array(
    Schema.Struct({
      key: Schema.String,
      loaded_instances: Schema.Array(
        Schema.Struct({ id: Schema.String, config: Schema.optional(LoadConfig) })
      ),
    })
  ),
});

/** How llama-server, LM Studio and Ollama word a refusal, each read as just its message. */
const ServerMessages: ReadonlyArray<Schema.Decoder<string>> = [
  Schema.Struct({ error: Schema.Struct({ message: Schema.String }) }).pipe(
    Schema.decodeTo(Schema.String, {
      decode: SchemaGetter.transform((value) => value.error.message),
      encode: SchemaGetter.transform((message) => ({ error: { message } })),
    })
  ),
  Schema.Struct({ error: Schema.String }).pipe(
    Schema.decodeTo(Schema.String, {
      decode: SchemaGetter.transform((value) => value.error),
      encode: SchemaGetter.transform((error) => ({ error })),
    })
  ),
  Schema.Struct({ message: Schema.String }).pipe(
    Schema.decodeTo(Schema.String, {
      decode: SchemaGetter.transform((value) => value.message),
      encode: SchemaGetter.transform((message) => ({ message })),
    })
  ),
];

type JsonBody = Readonly<Record<string, string | number | boolean>>;

const failed = (message: string) => new PredictionError({ reason: "endpoint-failed", message });

const baseUrl = (url: string) => url.replace(/\/(?:v1|api)\/?$/, "").replace(/\/$/, "");

/** The endpoint guard: literal private addresses only, as for completion itself. */
const base = (endpoint: Endpoint) => {
  if (Option.isNone(Schema.decodeUnknownOption(PredictionEndpointUrl)(endpoint.url)))
    throw new PredictionError({
      reason: "invalid-request",
      message: "Model servers are reached on private addresses only",
    });

  return baseUrl(endpoint.url);
};

const OPTIONS = { redirect: "error", credentials: "omit" } as const;

const get = (fetcher: Fetch, url: string) =>
  fetcher(url, { ...OPTIONS, method: "GET", signal: AbortSignal.timeout(IDENTIFY_MS) });

const send = (fetcher: Fetch, url: string, body: JsonBody) =>
  fetcher(url, {
    ...OPTIONS,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(ACTION_MS),
  });

/** A JSON body decoded as `schema`, or none for any failure or other shape. */
const read = async <A>(
  fetcher: Fetch,
  url: string,
  schema: Schema.Decoder<A>
): Promise<Option.Option<A>> => {
  try {
    const response = await get(fetcher, url);

    if (!response.ok) {
      await response.body?.cancel();

      return Option.none();
    }

    return Schema.decodeUnknownOption(schema)(await response.json());
  } catch {
    return Option.none();
  }
};

/** The server's own words for a refusal, else its status. */
const refusal = async (response: Response) => {
  const text = await response.text().catch(() => "");

  try {
    const json: unknown = JSON.parse(text);

    for (const schema of ServerMessages) {
      const message = Schema.decodeUnknownOption(schema)(json);

      if (Option.isSome(message)) return message.value;
    }
  } catch {
    // Not JSON: the text itself, if short enough to say.
  }

  const plain = text.trim();

  return plain.length > 0 && plain.length <= 300 ? plain : `HTTP ${response.status}`;
};

const post = async (fetcher: Fetch, url: string, body: JsonBody) => {
  const response = await send(fetcher, url, body).catch((cause: unknown) => {
    throw failed(cause instanceof Error ? cause.message : "The model server didn't answer");
  });

  if (!response.ok) throw failed(await refusal(response));
  await response.body?.cancel();
};

const lmStudioInstance = (models: typeof LmStudioModels.Type, model: string) => {
  for (const entry of models.models) {
    const instance = entry.loaded_instances.find((item) => item.id === model);

    if (instance !== undefined) return { key: entry.key, instance };

    if (entry.key === model && entry.loaded_instances[0] !== undefined)
      return { key: entry.key, instance: entry.loaded_instances[0] };
  }

  return null;
};

const report = (
  kind: PredictionServerReport["kind"],
  actions: ReadonlyArray<PredictionServerAction>
): PredictionServerReport => ({ kind, actions, outcome: null });

/** Which server answers, by the API only it has: llama-server's /props, LM Studio's /api/v1. */
export const identifyServer = async (
  endpoint: Endpoint,
  model: string,
  fetcher: Fetch = fetch
): Promise<PredictionServerReport> => {
  const root = base(endpoint);

  if (endpoint.kind === "ollama") return report("ollama", ["reload-model"]);

  if (Option.isSome(await read(fetcher, `${root}/props`, LlamaProps))) {
    // `--no-slots` turns the slots API off; without it there is no cache to clear.
    const slots = await read(fetcher, `${root}/slots`, LlamaSlots);

    return report("llama-server", Option.isSome(slots) ? ["clear-cache"] : []);
  }

  const lmStudio = await read(fetcher, `${root}/api/v1/models`, LmStudioModels);

  if (Option.isSome(lmStudio))
    return report(
      "lm-studio",
      lmStudioInstance(lmStudio.value, model) === null ? [] : ["reload-model"]
    );

  return report("unknown", []);
};

const clearCache = async (root: string, fetcher: Fetch) => {
  const slots = await read(fetcher, `${root}/slots`, LlamaSlots);

  if (Option.isNone(slots)) throw failed("This llama-server doesn't offer its slots API");

  for (const slot of slots.value) await post(fetcher, `${root}/slots/${slot.id}?action=erase`, {});
  const count = slots.value.length;

  return `Cleared the prompt cache in ${count} ${count === 1 ? "slot" : "slots"}`;
};

const reloadOllama = async (root: string, model: string, fetcher: Fetch) => {
  await post(fetcher, `${root}/api/generate`, { model, keep_alive: 0 });
  await post(fetcher, `${root}/api/generate`, { model, stream: false });

  return `Reloaded ${model}`;
};

const reloadLmStudio = async (root: string, model: string, fetcher: Fetch) => {
  const listed = await read(fetcher, `${root}/api/v1/models`, LmStudioModels);
  const found = Option.isSome(listed) ? lmStudioInstance(listed.value, model) : null;

  if (found === null) throw failed(`LM Studio hasn't loaded ${model}`);
  await post(fetcher, `${root}/api/v1/models/unload`, { instance_id: found.instance.id });
  // Load it as it was: the same context length and offload settings.
  await post(fetcher, `${root}/api/v1/models/load`, { model: found.key, ...found.instance.config });

  return `Reloaded ${model}`;
};

/** Runs one recovery action; the outcome says what happened, a failure keeps the server's words. */
export const runServerAction = async (
  request: PredictionServerRequest,
  fetcher: Fetch = fetch
): Promise<PredictionServerReport> => {
  const identified = await identifyServer(request.endpoint, request.model, fetcher);

  if (request.action === null) return identified;

  if (!identified.actions.includes(request.action))
    throw new PredictionError({
      reason: "unavailable",
      message: "This model server doesn't offer that",
    });
  const root = base(request.endpoint);
  let outcome: string;

  if (request.action === "clear-cache") outcome = await clearCache(root, fetcher);
  else if (identified.kind === "ollama") outcome = await reloadOllama(root, request.model, fetcher);
  else outcome = await reloadLmStudio(root, request.model, fetcher);

  return { ...identified, outcome };
};
