/**
 * Model prices for Usage estimates, normalized from two MIT-licensed lists:
 * LiteLLM's `model_prices_and_context_window.json` first, models.dev for
 * Models LiteLLM lacks. Rates are USD per token.
 */
import { Option, Schema } from "effect";
import { fastMultiplier } from "./fast-multipliers.ts";

export const LITELLM_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";

export const MODELS_DEV_URL = "https://models.dev/api.json";

/** What one token of each kind costs. Reasoning is billed as output, so it has no rate of its own. */
export class Rates extends Schema.Class<Rates>("Rates")({
  input: Schema.Number,
  output: Schema.Number,
  cacheRead: Schema.Number,
  /** A five-minute cache write. */
  cacheWrite: Schema.Number,
  /** A one-hour cache write. */
  cacheWrite1h: Schema.Number,
}) {}

export class ModelPrice extends Schema.Class<ModelPrice>("ModelPrice")({
  base: Rates,
  /** A request whose prompt is longer than `above` is priced entirely at `rates`. */
  longContext: Schema.NullOr(Schema.Struct({ above: Schema.Int, rates: Rates })),
  /** Fast mode / priority processing, when the list prices it. */
  fast: Schema.NullOr(Rates),
  source: Schema.Literals(["litellm", "models.dev"]),
}) {}

export class PriceTable extends Schema.Class<PriceTable>("PriceTable")({
  /** When these prices were fetched: estimates show it. */
  fetchedAt: Schema.String,
  models: Schema.Record(Schema.String, ModelPrice),
}) {}

// ── LiteLLM ─────────────────────────────────────────────────────────────────

const Rate = Schema.optionalKey(Schema.NullOr(Schema.Number));

const LiteLlmEntry = Schema.Struct({
  input_cost_per_token: Rate,
  output_cost_per_token: Rate,
  cache_read_input_token_cost: Rate,
  cache_creation_input_token_cost: Rate,
  cache_creation_input_token_cost_above_1hr: Rate,
  input_cost_per_token_above_200k_tokens: Rate,
  output_cost_per_token_above_200k_tokens: Rate,
  cache_read_input_token_cost_above_200k_tokens: Rate,
  cache_creation_input_token_cost_above_200k_tokens: Rate,
  cache_creation_input_token_cost_above_1hr_above_200k_tokens: Rate,
  input_cost_per_token_above_272k_tokens: Rate,
  output_cost_per_token_above_272k_tokens: Rate,
  cache_read_input_token_cost_above_272k_tokens: Rate,
  cache_creation_input_token_cost_above_272k_tokens: Rate,
  input_cost_per_token_priority: Rate,
  output_cost_per_token_priority: Rate,
  cache_read_input_token_cost_priority: Rate,
  cache_creation_input_token_cost_priority: Rate,
});

type LiteLlmEntry = typeof LiteLlmEntry.Type;

const decodeLiteLlm = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown))
);

const decodeLiteLlmEntry = Schema.decodeUnknownOption(LiteLlmEntry);

/** ccusage's defaults where a list omits a cache rate: writes 1.25× input, reads 0.1× input, 1-hour writes 2× input. */
const rates = (p: {
  input: number;
  output: number;
  cacheRead?: number | null | undefined;
  cacheWrite?: number | null | undefined;
  cacheWrite1h?: number | null | undefined;
}) =>
  new Rates({
    input: p.input,
    output: p.output,
    cacheRead: p.cacheRead ?? p.input * 0.1,
    cacheWrite: p.cacheWrite ?? p.input * 1.25,
    cacheWrite1h: p.cacheWrite1h ?? p.input * 2,
  });

const liteLlmLongContext = (e: LiteLlmEntry, base: Rates): ModelPrice["longContext"] => {
  if (e.input_cost_per_token_above_272k_tokens != null)
    return {
      above: 272_000,
      rates: rates({
        input: e.input_cost_per_token_above_272k_tokens,
        output: e.output_cost_per_token_above_272k_tokens ?? base.output,
        cacheRead: e.cache_read_input_token_cost_above_272k_tokens ?? base.cacheRead,
        cacheWrite: e.cache_creation_input_token_cost_above_272k_tokens ?? base.cacheWrite,
      }),
    };

  if (e.input_cost_per_token_above_200k_tokens != null)
    return {
      above: 200_000,
      rates: rates({
        input: e.input_cost_per_token_above_200k_tokens,
        output: e.output_cost_per_token_above_200k_tokens ?? base.output,
        cacheRead: e.cache_read_input_token_cost_above_200k_tokens ?? base.cacheRead,
        cacheWrite: e.cache_creation_input_token_cost_above_200k_tokens ?? base.cacheWrite,
        cacheWrite1h: e.cache_creation_input_token_cost_above_1hr_above_200k_tokens,
      }),
    };

  return null;
};

const liteLlmFast = (e: LiteLlmEntry, base: Rates): Rates | null =>
  e.input_cost_per_token_priority == null
    ? null
    : rates({
        input: e.input_cost_per_token_priority,
        output: e.output_cost_per_token_priority ?? base.output,
        cacheRead: e.cache_read_input_token_cost_priority ?? base.cacheRead,
        cacheWrite: e.cache_creation_input_token_cost_priority ?? base.cacheWrite,
      });

const fromLiteLlmEntry = (e: LiteLlmEntry): ModelPrice | null => {
  if (e.input_cost_per_token == null || e.output_cost_per_token == null) return null;

  const base = rates({
    input: e.input_cost_per_token,
    output: e.output_cost_per_token,
    cacheRead: e.cache_read_input_token_cost,
    cacheWrite: e.cache_creation_input_token_cost,
    cacheWrite1h: e.cache_creation_input_token_cost_above_1hr,
  });

  return new ModelPrice({
    base,
    longContext: liteLlmLongContext(e, base),
    fast: liteLlmFast(e, base),
    source: "litellm",
  });
};

/**
 * LiteLLM's entries by Model id. Provider-prefixed keys (`bedrock/…`,
 * `openrouter/…`) are left out: a Harness names a Model the way its vendor does.
 */
export const parseLiteLlm = (json: string): Map<string, ModelPrice> => {
  const entries = Option.getOrElse(decodeLiteLlm(json), () => ({}));
  const models = new Map<string, ModelPrice>();

  for (const [id, value] of Object.entries(entries)) {
    if (id.includes("/")) continue;
    const price = Option.flatMapNullishOr(decodeLiteLlmEntry(value), fromLiteLlmEntry);

    if (Option.isSome(price)) models.set(id, price.value);
  }

  return models;
};

// ── models.dev ──────────────────────────────────────────────────────────────

const PerMillion = Schema.optionalKey(Schema.NullOr(Schema.Number));

const ModelsDevCost = Schema.Struct({
  input: Schema.Number,
  output: Schema.Number,
  cache_read: PerMillion,
  cache_write: PerMillion,
  context_over_200k: Schema.optionalKey(
    Schema.NullOr(
      Schema.Struct({
        input: Schema.Number,
        output: Schema.Number,
        cache_read: PerMillion,
        cache_write: PerMillion,
      })
    )
  ),
  tiers: Schema.optionalKey(
    Schema.NullOr(
      Schema.Array(
        Schema.Struct({
          input: Schema.Number,
          output: Schema.Number,
          cache_read: PerMillion,
          cache_write: PerMillion,
          tier: Schema.Struct({ type: Schema.String, size: Schema.Number }),
        })
      )
    )
  ),
});

type ModelsDevCost = typeof ModelsDevCost.Type;

const ModelsDev = Schema.fromJsonString(
  Schema.Record(
    Schema.String,
    Schema.Struct({
      models: Schema.Record(
        Schema.String,
        Schema.Struct({ cost: Schema.optionalKey(Schema.NullOr(Schema.Unknown)) })
      ),
    })
  )
);

const decodeModelsDev = Schema.decodeUnknownOption(ModelsDev);

const decodeModelsDevCost = Schema.decodeUnknownOption(ModelsDevCost);

const perToken = (value: number | null | undefined) => (value == null ? null : value / 1e6);

const modelsDevRates = (c: {
  input: number;
  output: number;
  cache_read?: number | null | undefined;
  cache_write?: number | null | undefined;
}) =>
  rates({
    input: c.input / 1e6,
    output: c.output / 1e6,
    cacheRead: perToken(c.cache_read),
    cacheWrite: perToken(c.cache_write),
  });

const modelsDevLongContext = (cost: ModelsDevCost): ModelPrice["longContext"] => {
  const tier = cost.tiers?.find((t) => t.tier.type === "context");

  if (tier) return { above: tier.tier.size, rates: modelsDevRates(tier) };

  if (cost.context_over_200k)
    return { above: 200_000, rates: modelsDevRates(cost.context_over_200k) };

  return null;
};

/** Model vendors come first, so a Model id resolves to its maker's price rather than a reseller's. */
const VENDORS = [
  "anthropic",
  "openai",
  "google",
  "xai",
  "deepseek",
  "mistral",
  "moonshotai",
  "zai",
];

/** models.dev's Models by id, the first provider listing a Model winning (vendors first). */
export const parseModelsDev = (json: string): Map<string, ModelPrice> => {
  const providers: typeof ModelsDev.Type = Option.getOrElse(decodeModelsDev(json), () => ({}));

  const order = Object.keys(providers).sort(
    (a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0)
  );

  const models = new Map<string, ModelPrice>();

  for (const provider of order) {
    for (const [id, model] of Object.entries(providers[provider]?.models ?? {})) {
      if (models.has(id) || id.includes("/")) continue;
      const cost = decodeModelsDevCost(model.cost);

      if (Option.isNone(cost)) continue;

      models.set(
        id,
        new ModelPrice({
          base: modelsDevRates(cost.value),
          longContext: modelsDevLongContext(cost.value),
          fast: null,
          source: "models.dev",
        })
      );
    }
  }

  return models;
};

const rank = (provider: string) => {
  const at = VENDORS.indexOf(provider);

  return at === -1 ? VENDORS.length : at;
};

/** The table estimates use: LiteLLM's prices, then models.dev's for the Models LiteLLM lacks. */
export const buildPriceTable = (
  liteLlmJson: string,
  modelsDevJson: string,
  fetchedAt: string
): PriceTable => {
  const models = parseLiteLlm(liteLlmJson);

  for (const [id, price] of parseModelsDev(modelsDevJson))
    if (!models.has(id)) models.set(id, price);

  return new PriceTable({ fetchedAt, models: Object.fromEntries(models) });
};

// ── Lookup ──────────────────────────────────────────────────────────────────

/** Rates for one Model id as a Harness reports it; null when no list prices it (never guessed). */
export interface ResolvedPrice {
  readonly rates: Rates;
  readonly longContext: ModelPrice["longContext"];
}

const scale = (r: Rates, by: number) =>
  new Rates({
    input: r.input * by,
    output: r.output * by,
    cacheRead: r.cacheRead * by,
    cacheWrite: r.cacheWrite * by,
    cacheWrite1h: r.cacheWrite1h * by,
  });

const lookup = (table: PriceTable, id: string): ModelPrice | null => {
  const direct = table.models[id];

  if (direct) return direct;
  // `anthropic/claude-…` as a multi-provider Harness names it.
  const slash = id.indexOf("/");

  return slash === -1 ? null : (table.models[id.slice(slash + 1)] ?? null);
};

/**
 * `<model>-fast` is fast mode (Claude) or the priority tier (Codex): the list's
 * own priority rates, else the base rates times a known multiplier.
 */
export const resolvePrice = (table: PriceTable, model: string): ResolvedPrice | null => {
  const exact = lookup(table, model);

  if (exact) return { rates: exact.base, longContext: exact.longContext };

  if (!model.endsWith("-fast")) return null;
  const baseId = model.slice(0, -"-fast".length);
  const base = lookup(table, baseId);

  if (!base) return null;
  const multiplier = fastMultiplier(baseId);
  const fast = base.fast ?? (multiplier === null ? null : scale(base.base, multiplier));

  if (!fast) return null;
  // Long fast requests: the long-context rates, raised as much as fast raises the base ones.
  const ratio = base.base.input === 0 ? 1 : fast.input / base.base.input;

  const longContext = base.longContext && {
    above: base.longContext.above,
    rates: scale(base.longContext.rates, ratio),
  };

  return { rates: fast, longContext };
};
