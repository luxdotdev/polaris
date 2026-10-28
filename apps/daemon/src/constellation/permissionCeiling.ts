import type { PermissionMode } from "@polaris/protocol";

/** `plan` and `supervised` both ask before every edit, so neither is broader than the other. */
const RANK: Record<PermissionMode, number> = {
  plan: 0,
  supervised: 0,
  "auto-edits": 1,
  auto: 2,
  "full-access": 3,
};

/** A worker never runs with a broader permission mode than its Lead; it may only narrow. */
/** A worker builds, so a planning Lead's ceiling starts it supervised (the same rank). */
export const workerMode = (ceiling: PermissionMode | null): PermissionMode =>
  ceiling === null || ceiling === "plan" ? "supervised" : ceiling;

export const exceedsCeiling = (mode: PermissionMode, ceiling: PermissionMode) =>
  RANK[mode] > RANK[ceiling];
