import * as P from "@polaris/protocol";
import type { HostView } from "../../../../shared/api.ts";
import type { HostModel } from "../../../store/hostModel.ts";
import type { LanguageScopeOption } from "./contracts.ts";
import type { RegisteredLanguageCheckout } from "./integrationContracts.ts";

export const registeredCheckouts = (
  hosts: ReadonlyArray<HostView>,
  models: Readonly<Record<string, HostModel>>
) =>
  hosts.flatMap((host) => {
    const model = models[host.key];

    if (!model || !host.status.host) return [];
    const entries: Array<RegisteredLanguageCheckout> = [];

    for (const workspace of model.workspaces.values()) {
      entries.push({
        key: `${host.key}:workspace:${workspace.id}`,
        label: `${host.label} · ${workspace.name} · ${workspace.path}`,
        hostKey: host.key,
        checkout: P.LanguageCheckout.cases.Workspace.make({
          workspaceId: workspace.id,
          path: workspace.path,
        }),
      });
    }

    for (const worktree of model.worktrees.values()) {
      if (!model.workspaces.has(worktree.workspaceId)) continue;
      entries.push({
        key: `${host.key}:worktree:${worktree.id}`,
        label: `${host.label} · worktree · ${worktree.branch ?? worktree.path}`,
        hostKey: host.key,
        checkout: P.LanguageCheckout.cases.Worktree.make({
          workspaceId: worktree.workspaceId,
          worktreeId: worktree.id,
          path: worktree.path,
        }),
      });
    }

    for (const review of model.reviewCheckouts.values()) {
      if (!model.workspaces.has(review.workspaceId)) continue;
      entries.push({
        key: `${host.key}:review:${review.id}`,
        label: `${host.label} · review checkout · ${review.path}`,
        hostKey: host.key,
        checkout: P.LanguageCheckout.cases.ReviewCheckout.make({
          workspaceId: review.workspaceId,
          reviewCheckoutId: review.id,
          path: review.path,
        }),
      });
    }

    return entries;
  });

export const registeredScopes = (
  hosts: ReadonlyArray<HostView>,
  selected: RegisteredLanguageCheckout | null,
  language: P.LanguageSyntaxId
): ReadonlyArray<LanguageScopeOption> => {
  const scopes: Array<LanguageScopeOption> = [
    { key: "app", label: "App defaults", scope: P.LanguageSettingsScope.cases.App.make({}) },
    {
      key: "language",
      label: `${language} defaults`,
      scope: P.LanguageSettingsScope.cases.Language.make({ language }),
    },
  ];

  for (const host of hosts) {
    if (!host.status.host) continue;
    const hostId = host.status.host.hostId;
    scopes.push({
      key: `host:${host.key}`,
      label: `Host · ${host.label}`,
      scope: P.LanguageSettingsScope.cases.Host.make({ hostId }),
    });

    if (selected?.hostKey !== host.key) continue;
    const workspaceId = selected.checkout.workspaceId;
    scopes.push(
      {
        key: `workspace:${host.key}:${workspaceId}`,
        label: `Workspace · ${selected.label}`,
        scope: P.LanguageSettingsScope.cases.Workspace.make({
          hostId,
          workspaceId,
          language: null,
        }),
      },
      {
        key: `workspace-language:${host.key}:${workspaceId}`,
        label: `Workspace · ${language}`,
        scope: P.LanguageSettingsScope.cases.Workspace.make({ hostId, workspaceId, language }),
      }
    );
  }

  return scopes;
};
