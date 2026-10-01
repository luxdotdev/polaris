/**
 * Every Workspace on every Host as Settings lists them for per-Workspace overrides
 * (accept branch, Reviewer, GitHub account): keyed `hostKey/workspaceId`, hidden ones included.
 */
import { workspaceKeyOf } from "../../../../shared/acceptBranch.ts";
import type { HostView } from "../../../../shared/api.ts";
import type { HostModel } from "../../../store/hostModel.ts";

export interface WorkspaceOption {
  readonly key: string;
  readonly hostKey: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly hostLabel: string;
  readonly isGitRepo: boolean;
}

/** By name, then Host, so the same repo on two Hosts sits together. */
export const workspaceOptions = (
  hosts: ReadonlyArray<Pick<HostView, "key" | "label">>,
  models: Readonly<Record<string, Pick<HostModel, "workspaces">>>
): ReadonlyArray<WorkspaceOption> =>
  hosts
    .flatMap((host) =>
      [...(models[host.key]?.workspaces.values() ?? [])].map((w) => ({
        key: workspaceKeyOf(host.key, w.id),
        hostKey: host.key,
        workspaceId: w.id,
        name: w.name,
        hostLabel: host.label,
        isGitRepo: w.isGitRepo,
      }))
    )
    .toSorted((a, b) => a.name.localeCompare(b.name) || a.hostLabel.localeCompare(b.hostLabel));

/** "warehouse on Linux VM"; a key no Host lists any more keeps its id. */
export const workspaceLabel = (options: ReadonlyArray<WorkspaceOption>, key: string): string => {
  const found = options.find((o) => o.key === key);

  return found === undefined ? key : `${found.name} on ${found.hostLabel}`;
};
