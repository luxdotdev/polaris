/**
 * The price table the Client estimates with. The Client fetches the price
 * lists itself (never a Host, which may have no network) and caches them in a
 * file; before its first fetch, and offline, it uses the snapshot it ships with.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Clock, Context, Effect, Layer, Option, Ref, Schema } from "effect";
import snapshot from "./prices.snapshot.json" with { type: "json" };
import { buildPriceTable, LITELLM_URL, MODELS_DEV_URL, PriceTable } from "./prices.ts";

export class PriceListError extends Schema.TaggedError<PriceListError>()("PriceListError", {
  url: Schema.String,
  message: Schema.String,
}) {}

export interface PriceBookOptions {
  /** Where the fetched table is cached, e.g. in the Desktop App's user data directory. */
  readonly cacheFile: string;
  /** Fetches a URL's body; defaults to `fetch` with a 30 s timeout. */
  readonly fetchText?: (url: string) => Promise<string>;
  /** `refreshIfStale` refetches a table older than this (default a day). */
  readonly maxAgeMs?: number;
}

/** Fewer priced Models than this is a broken download, not a price list. */
const MIN_MODELS = 100;

const PriceTableJson = Schema.fromJsonString(PriceTable);

const decodeCached = Schema.decodeUnknownOption(PriceTableJson);

const encodeTable = Schema.encodeSync(PriceTableJson);

/** The table shipped with the Client (`bun run --cwd packages/client prices` refreshes it). */
export const bundledPrices = (): PriceTable => Schema.decodeUnknownSync(PriceTable)(snapshot);

const defaultFetch = async (url: string) => {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  return response.text();
};

export class PriceBook extends Context.Service<
  PriceBook,
  {
    /** The newest table available: the cached fetch, else the bundled snapshot. */
    readonly current: Effect.Effect<PriceTable>;
    /** Fetches both lists now and caches the result. */
    readonly refresh: Effect.Effect<PriceTable, PriceListError>;
    /** `refresh` when the table is older than `maxAgeMs`; keeps the current one if that fails. */
    readonly refreshIfStale: Effect.Effect<PriceTable>;
  }
>()("polaris/client/PriceBook") {
  static readonly layer = (options: PriceBookOptions) =>
    Layer.effect(PriceBook, makePriceBook(options));
}

const makePriceBook = Effect.fnUntraced(function* (options: PriceBookOptions) {
  const fetchText = options.fetchText ?? defaultFetch;
  const maxAgeMs = options.maxAgeMs ?? 24 * 3_600_000;

  const cached = yield* Effect.promise(() =>
    readFile(options.cacheFile, "utf8").then(
      (text) => Option.getOrNull(decodeCached(text)),
      () => null
    )
  );

  const table = yield* Ref.make(cached ?? bundledPrices());

  const get = (url: string) =>
    Effect.tryPromise({
      try: () => fetchText(url),
      catch: (cause) => new PriceListError({ url, message: String(cause) }),
    });

  const refresh = Effect.gen(function* () {
    const [liteLlm, modelsDev] = yield* Effect.all(
      [get(LITELLM_URL), get(MODELS_DEV_URL).pipe(Effect.orElseSucceed(() => "{}"))],
      { concurrency: 2 }
    );

    const fetchedAt = new Date(yield* Clock.currentTimeMillis).toISOString();
    const next = buildPriceTable(liteLlm, modelsDev, fetchedAt);

    if (Object.keys(next.models).length < MIN_MODELS)
      return yield* new PriceListError({
        url: LITELLM_URL,
        message: "no usable prices in the list",
      });

    yield* Effect.promise(async () => {
      await mkdir(dirname(options.cacheFile), { recursive: true });
      const partial = `${options.cacheFile}.partial`;
      await writeFile(partial, encodeTable(next));
      await rename(partial, options.cacheFile);
    });

    yield* Ref.set(table, next);

    return next;
  }).pipe(Effect.withSpan("PriceBook.refresh"));

  const refreshIfStale = Effect.gen(function* () {
    const current = yield* Ref.get(table);
    const age = (yield* Clock.currentTimeMillis) - Date.parse(current.fetchedAt);

    return age < maxAgeMs ? current : yield* refresh.pipe(Effect.orElseSucceed(() => current));
  });

  return PriceBook.of({ current: Ref.get(table), refresh, refreshIfStale });
});
