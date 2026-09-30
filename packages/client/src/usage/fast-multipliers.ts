// Portions adapted from ccusage/ccusage@0dd85c1 (MIT): rust/crates/ccusage-core/src/fast-multiplier-overrides.json, pricing.rs
/**
 * How much more fast mode (Claude) or the priority tier (Codex) costs than the
 * standard rate, for Models whose price list doesn't carry priority rates.
 */

const EXACT = new Map([
  ["gpt-5.6-sol", 2],
  ["gpt-5.6-terra", 2],
  ["gpt-5.6-luna", 2],
  ["gpt-5.5", 2.5],
  ["gpt-5.4", 2],
  ["gpt-5.3-codex", 2],
  ["gpt-6-astra", 2],
]);

/** Matched against the id's end, dots as dashes, so dated ids (`claude-opus-4-6-20260101`) match too. */
const FAMILIES: ReadonlyArray<readonly [string, number]> = [
  ["claude-opus-4-6", 6],
  ["claude-opus-4-7", 6],
  ["claude-opus-4-8", 2],
];

const matchesFamily = (id: string, family: string) => {
  const at = id.lastIndexOf(family);

  if (at === -1) return false;
  const rest = id.slice(at + family.length);

  return rest === "" || rest.startsWith("-");
};

/** The multiplier over standard rates, or null when unknown (the fast Usage then has no price). */
export const fastMultiplier = (model: string): number | null => {
  const exact = EXACT.get(model);

  if (exact !== undefined) return exact;
  const normalized = model.replaceAll(/[.@]/g, "-");

  return FAMILIES.find(([family]) => matchesFamily(normalized, family))?.[1] ?? null;
};
