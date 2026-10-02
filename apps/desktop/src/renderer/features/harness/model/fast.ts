import type { ModelChoice } from "./models.ts";

export const fastToggle = (
  available: boolean,
  blocked: string | undefined,
  choice: ModelChoice,
  onModel: (choice: ModelChoice) => void
): (() => void) | undefined => {
  if (!available || blocked !== undefined) return undefined;

  return () =>
    onModel({ ...choice, serviceTier: choice.serviceTier === "priority" ? "default" : "priority" });
};
