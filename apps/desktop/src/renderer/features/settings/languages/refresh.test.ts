import { expect, test } from "bun:test";
import * as P from "@polaris/protocol";
import type { HostView } from "../../../../shared/api.ts";
import { createIntegrationFixture } from "./integration.fixture.ts";
import type {
  LanguageIntegrationOptions,
  RegisteredLanguageCheckout,
} from "./integrationContracts.ts";
import { refreshConfirmedLanguageSettings } from "./refresh.ts";

const registry = () => {
  const f = createIntegrationFixture();
  const identity = f.host.status.host;

  if (!identity) throw new Error("Missing fake Host identity");

  const other: HostView = {
    ...f.host,
    key: "other",
    status: {
      ...f.host.status,
      host: P.HostInfo.make({
        hostId: P.HostId.make("other"),
        hostname: identity.hostname,
        platform: identity.platform,
        daemonVersion: identity.daemonVersion,
        homeDir: identity.homeDir,
        startedAt: identity.startedAt,
      }),
    },
  };

  const unconfirmed: HostView = {
    ...f.host,
    key: "unconfirmed",
    status: { ...f.host.status, host: null },
  };

  const checkout = (hostKey: string, id: string, key: string): RegisteredLanguageCheckout => ({
    key,
    label: key,
    hostKey,
    checkout: P.LanguageCheckout.cases.Workspace.make({
      workspaceId: P.WorkspaceId.make(id),
      path: `/fake/${key}`,
    }),
  });

  const calls: Array<string> = [];

  const options: LanguageIntegrationOptions = {
    api: f.api,
    hosts: [f.host, other, unconfirmed],
    selected: null,
    language: "python",
    recover: async () => ({ ok: true, value: undefined }),
    checkouts: [
      checkout(f.host.key, "a", "main"),
      checkout(f.host.key, "a", "worktree"),
      checkout(f.host.key, "b", "second"),
      checkout(other.key, "a", "other"),
      checkout("unconfirmed", "a", "unconfirmed"),
      checkout("missing", "a", "missing"),
    ],
    refreshLanguageSettings: (host, workspace) => calls.push(`${host}:${workspace}`),
  };

  return { options, calls, hostId: identity.hostId, hostKey: f.host.key };
};

test("confirmed global/Host/Workspace scope refreshes deduplicate registered matching targets", () => {
  const f = registry();
  const global = [`${f.hostKey}:a`, `${f.hostKey}:b`, "other:a"];

  for (const scope of [
    P.LanguageSettingsScope.cases.App.make({}),
    P.LanguageSettingsScope.cases.Language.make({ language: "python" }),
  ]) {
    refreshConfirmedLanguageSettings(f.options, scope);
    expect(f.calls.splice(0)).toEqual(global);
  }

  refreshConfirmedLanguageSettings(
    f.options,
    P.LanguageSettingsScope.cases.Host.make({ hostId: f.hostId })
  );
  expect(f.calls.splice(0)).toEqual(global.slice(0, 2));
  refreshConfirmedLanguageSettings(
    f.options,
    P.LanguageSettingsScope.cases.Workspace.make({
      hostId: f.hostId,
      workspaceId: P.WorkspaceId.make("a"),
      language: "python",
    })
  );
  expect(f.calls.splice(0)).toEqual([`${f.hostKey}:a`]);
  refreshConfirmedLanguageSettings(
    f.options,
    P.LanguageSettingsScope.cases.Workspace.make({
      hostId: f.hostId,
      workspaceId: P.WorkspaceId.make("unrelated"),
      language: null,
    })
  );
  expect(f.calls).toEqual([]);
  const { refreshLanguageSettings: _refresh, ...absent } = f.options;
  expect(() =>
    refreshConfirmedLanguageSettings(absent, P.LanguageSettingsScope.cases.App.make({}))
  ).not.toThrow();
});
