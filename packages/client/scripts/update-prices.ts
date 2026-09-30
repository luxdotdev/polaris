/**
 * Refreshes the price snapshot the Client ships with, for estimates before its
 * first fetch and offline:
 *
 *   bun run --cwd packages/client prices
 */
import { join } from "node:path";
import { Schema } from "effect";
import { buildPriceTable, LITELLM_URL, MODELS_DEV_URL, PriceTable } from "../src/usage/prices.ts";

const get = async (url: string) => {
  const response = await fetch(url);

  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);

  return response.text();
};

const [liteLlm, modelsDev] = await Promise.all([get(LITELLM_URL), get(MODELS_DEV_URL)]);

const table = buildPriceTable(liteLlm, modelsDev, new Date().toISOString());

const out = join(import.meta.dir, "..", "src", "usage", "prices.snapshot.json");

const encoded = Schema.encodeSync(PriceTable)(table);

await Bun.write(out, `${JSON.stringify(encoded)}\n`);

console.log(`${Object.keys(table.models).length} Models priced; wrote ${out}`);
