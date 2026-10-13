import type { PermissionMode } from "@polaris/protocol";

const RANK: Record<PermissionMode, number> = {
  supervised: 0,
  "auto-edits": 1,
  auto: 2,
  "full-access": 3,
};

/** A worker never runs with a broader permission mode than its Lead; it may only narrow. */
export const exceedsCeiling = (mode: PermissionMode, ceiling: PermissionMode) =>
  RANK[mode] > RANK[ceiling];
