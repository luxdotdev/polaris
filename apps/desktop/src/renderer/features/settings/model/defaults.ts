/**
 * Settings → Harnesses' defaults as the Harness picker reads them: the saved
 * Model for each Harness the user hasn't picked one for on this page. A
 * Harness with no saved Model keeps the picker's own default (`defaultChoice`).
 */
import type { SessionDefaults } from "../../../../shared/api.ts";

export interface SavedChoice {
  readonly model: string | null;
  readonly effort: string | null;
}

export const withSavedModels = <
  Picks extends Readonly<Partial<Record<string, SavedChoice | null>>>,
>(
  picked: Picks,
  defaults: SessionDefaults
): Picks => {
  const saved = Object.entries(defaults).flatMap(([kind, d]) =>
    d.model === null || picked[kind] !== undefined
      ? []
      : [[kind, { model: d.model, effort: d.effort }] as const]
  );

  return saved.length === 0 ? picked : { ...Object.fromEntries(saved), ...picked };
};
