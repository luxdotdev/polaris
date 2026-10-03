import type { OptionalLanguageActions } from "./integrationContracts.ts";
import { expect, test } from "bun:test";
import * as P from "@polaris/protocol";
import { createLanguageSettingsAdapter } from "./adapter.ts";
import { createIntegrationFixture } from "./integration.fixture.ts";
import { updateMarkdownPolicy } from "./policy.ts";
import { effectivePreferences } from "./preferences.ts";

const setup = (
  refresh?: import("./integrationContracts.ts").LanguageIntegrationOptions["refreshLanguageSettings"]
) => {
  const fixture = createIntegrationFixture();

  const optional: OptionalLanguageActions = {};

  if (refresh) optional.refreshLanguageSettings = refresh;

  const adapter = createLanguageSettingsAdapter({
    api: fixture.api,
    hosts: [fixture.host],
    language: "python",
    selected: {
      key: "worktree",
      label: "Fixture worktree",
      hostKey: fixture.host.key,
      checkout: fixture.discovery.checkout,
    },
    ...optional,
    recover: async () => ({ ok: true, value: undefined }),
  });

  return {
    ...fixture,
    adapter,
    signal: new AbortController().signal,
    scope: P.LanguageSettingsScope.cases.App.make({}),
  };
};

test("actual typed adapter preserves full private custom configuration and CAS, rejects stale save", async () => {
  const f = setup();
  const loaded = await f.adapter.load(f.scope, f.signal);

  if (!loaded.ok) throw new Error(loaded.message);

  const record = {
    ...loaded.value.record,
    settings: {
      formatOnSave: false,
      executableOverrides: {
        pyright: {
          executable: "/fixture/pyright",
          argv: ["--stdio", "literal argument"],
          environment: { PRIVATE_FIXTURE: "not-real" },
        },
      },
      providers: [],
    },
  };

  expect((await f.adapter.save(record, f.signal)).ok).toBe(true);
  expect((await f.adapter.save(record, f.signal)).ok).toBe(false);
  const current = await f.adapter.load(f.scope, f.signal);

  if (!current.ok) throw new Error(current.message);
  expect(current.value.record.revision).toBe(1);
  expect(current.value.record.settings).toEqual(record.settings);
  expect(current.value.effective.formatOnSave).toBe(false);
});

test("foreign preference scope and cancelled late load cannot restore mutation authority", async () => {
  const f = setup();
  f.control.foreign = true;
  expect((await f.adapter.load(f.scope, f.signal)).ok).toBe(false);
  f.control.foreign = false;
  f.control.hold = true;
  const controller = new AbortController();
  const pending = f.adapter.load(f.scope, controller.signal);
  await Promise.resolve();
  controller.abort();
  f.control.release();
  expect((await pending).ok).toBe(false);
  expect(
    (
      await f.adapter.save(
        P.LanguageSettingsRecord.make({ scope: f.scope, revision: 0, settings: {} }),
        f.signal
      )
    ).ok
  ).toBe(false);
});

test("catalog and prerequisite facts do not grant managed artifact installation", async () => {
  const f = setup();
  const loaded = await f.adapter.load(f.scope, f.signal);

  if (!loaded.ok) throw new Error(loaded.message);
  expect(loaded.value.hosts[0]?.tools[0]?.actions).toEqual({});
  expect(loaded.value.hosts[0]?.discovery?.checkout).toEqual(f.discovery.checkout);
  expect(
    (
      await f.adapter.act(
        {
          kind: "install",
          hostKey: f.host.key,
          toolId: "fixture-tool",
          version: "1.0.0",
          intent: "manual",
        },
        f.signal
      )
    ).ok
  ).toBe(false);
  expect(f.control.calls).not.toContain("languages.install");
});

test("explicit empty provider override and None formatter survive precedence with default-on saving", () => {
  const app = P.LanguageSettingsRecord.make({
    scope: P.LanguageSettingsScope.cases.App.make({}),
    revision: 2,
    settings: { providers: ["pyright"], formatOnSave: false },
  });

  const language = P.LanguageSettingsRecord.make({
    scope: P.LanguageSettingsScope.cases.Language.make({ language: "python" }),
    revision: 3,
    settings: {
      providers: [],
      formatter: P.LanguageFormatterSelection.cases.None.make({}),
      formatOnSave: true,
    },
  });

  const effective = effectivePreferences([app, language]);
  expect(effective.providers).toEqual([]);
  expect(effective.formatOnSave).toBe(true);
  expect(effective.revision).toBe(5);
  expect(effective.origins.providers).toEqual(language.scope);
  expect(effectivePreferences([]).formatOnSave).toBe(true);
});

test("policy grant and revoke refresh exact Host/Workspace; failure and cancelled outcome never refresh", async () => {
  const f = setup();
  const refreshed: Array<string> = [];

  const hook = {
    refreshMarkdownPolicy: (host: string, ws: P.WorkspaceId) => refreshed.push(`${host}:${ws}`),
  };

  const policy = P.LanguagePreviewPolicy.make({
    ...P.LANGUAGE_EDITOR_DEFAULTS,
    hostId: f.discovery.trust.scope.hostId,
    workspaceId: f.discovery.checkout.workspaceId,
  });

  for (const externalImages of ["allow", "deny"] as const)
    expect(
      (await updateMarkdownPolicy(f.api, hook, f.host.key, { ...policy, externalImages }, f.signal))
        .ok
    ).toBe(true);
  expect(refreshed).toEqual([
    `${f.host.key}:${policy.workspaceId}`,
    `${f.host.key}:${policy.workspaceId}`,
  ]);
  f.control.fail = true;
  expect((await updateMarkdownPolicy(f.api, hook, f.host.key, policy, f.signal)).ok).toBe(false);
  f.control.fail = false;
  f.control.hold = true;
  const controller = new AbortController();
  const pending = updateMarkdownPolicy(f.api, hook, f.host.key, policy, controller.signal);
  await Promise.resolve();
  controller.abort();
  f.control.release();
  expect((await pending).ok).toBe(false);
  expect(refreshed).toHaveLength(2);
});

test("first encounter feedback names actual language and Host, fences foreign and stale progress", async () => {
  const { LanguageInstallFeedback } = await import("./feedback.ts");
  const f = setup();
  const notices: Array<string> = [];

  const feedback = new LanguageInstallFeedback((title, message) =>
    notices.push(`${title}: ${message}`)
  );

  const source = {
    hostId: f.discovery.trust.scope.hostId,
    hostName: "Fake Linux VM",
    languageName: "Python",
    toolId: "fixture-tool",
  };

  const progress = P.LanguageInstallProgress.make({
    hostId: source.hostId,
    toolId: source.toolId,
    version: "1.0.0",
    jobId: "fake-job",
    sequence: 2,
    phase: "verifying",
    downloadedBytes: 10,
    totalBytes: 10,
    message: "Fake artifact verification",
    activeVersion: null,
  });

  feedback.progress(source, progress);
  feedback.progress(source, { ...progress, sequence: 1 });
  feedback.progress(source, { ...progress, hostId: P.HostId.make("foreign") });
  expect(notices).toEqual([
    "Python · Fake Linux VM: verifying · 1.0.0 · Fake artifact verification",
  ]);
  feedback.progress(source, {
    ...progress,
    sequence: 3,
    phase: "failed",
    message: "Offline download failed",
    activeVersion: "0.9.0",
  });
  expect(notices[1]).toContain("failed");
  expect(notices.join(" ")).not.toContain("ready");
  feedback.dispose();
});

test("C1 main preference persistence retains other Settings fields and enforces exact scope revision", async () => {
  const { LanguagePreferences } = await import("../../../../main/languages/settings.ts");
  const { createLanguageBridge } = await import("../../../../main/languages/index.ts");
  const { Settings } = await import("../../../../main/settings.ts");
  let persisted = Settings.make({ theme: "light" });

  const preferences = new LanguagePreferences(
    () => persisted,
    (value) => {
      persisted = value;
    }
  );

  const bridge = createLanguageBridge({ preferences, lookup: () => null });

  try {
    const adapter = createLanguageSettingsAdapter({
      api: bridge,
      hosts: [],
      selected: null,
      language: "python",
      recover: async () => ({ ok: true, value: undefined }),
    });

    const scope = P.LanguageSettingsScope.cases.App.make({});
    const signal = new AbortController().signal;
    const loaded = await adapter.load(scope, signal);

    if (!loaded.ok) throw new Error(loaded.message);

    const updated = {
      ...loaded.value.record,
      settings: { formatOnSave: false, providers: ["custom"] },
    };

    expect((await adapter.save(updated, signal)).ok).toBe(true);
    expect(persisted.theme).toBe("light");
    expect(preferences.get(scope).settings).toEqual(updated.settings);
    expect(() => preferences.set(scope, 0, {})).toThrow();
    const reloaded = await adapter.load(scope, signal);

    if (!reloaded.ok) throw new Error(reloaded.message);
    expect(reloaded.value.record.revision).toBe(1);
  } finally {
    bridge.dispose();
  }
});

test("policy acknowledgement refresh disposes affected media URLs while unrelated Host/Workspace remains open", async () => {
  const { PreviewMediaPool } = await import("../../editor/markdown/media.ts");
  const f = setup();

  const policy = P.LanguagePreviewPolicy.make({
    ...P.LANGUAGE_EDITOR_DEFAULTS,
    hostId: f.discovery.trust.scope.hostId,
    workspaceId: f.discovery.checkout.workspaceId,
    externalImages: "allow",
  });

  const mediaApi: import("../../../../shared/api.ts").LanguageApi = {
    request: async () => ({ ok: true, value: { mimeType: "image/png", bytes: 3, base64: "AQID" } }),
    subscribe: () => () => {},
  };

  const created: Array<string> = [];
  const revoked: Array<string> = [];

  const urls = {
    create: () => {
      const url = `blob:${created.length}`;
      created.push(url);

      return url;
    },
    revoke: (url: string) => revoked.push(url),
  };

  const affectedDocument = {
    hostKey: f.host.key,
    hostId: policy.hostId,
    checkout: f.discovery.checkout,
    path: `${f.discovery.checkout.path}/readme.md`,
  };

  const unrelatedDocument = {
    ...affectedDocument,
    hostKey: "unrelated-host",
    hostId: P.HostId.make("unrelated"),
    checkout: P.LanguageCheckout.cases.Workspace.make({
      workspaceId: P.WorkspaceId.make("unrelated-workspace"),
      path: "/unrelated",
    }),
    path: "/unrelated/readme.md",
  };

  const affected = new PreviewMediaPool(mediaApi, affectedDocument, policy, urls);

  const unrelated = new PreviewMediaPool(
    mediaApi,
    unrelatedDocument,
    {
      ...policy,
      hostId: unrelatedDocument.hostId,
      workspaceId: unrelatedDocument.checkout.workspaceId,
    },
    urls
  );

  try {
    const first = await affected.acquire("image.png");
    const second = await unrelated.acquire("image.png");
    expect(created).toHaveLength(2);

    const hook = {
      refreshMarkdownPolicy: (hostKey: string, workspaceId: P.WorkspaceId) => {
        if (hostKey === affectedDocument.hostKey && workspaceId === policy.workspaceId)
          affected.dispose();
      },
    };

    expect(
      (
        await updateMarkdownPolicy(
          f.api,
          hook,
          f.host.key,
          { ...policy, externalImages: "deny" },
          f.signal
        )
      ).ok
    ).toBe(true);
    expect(revoked).toEqual([first.url]);
    expect(affected.acquire("image.png")).rejects.toThrow("closed");
    const stillOpen = await unrelated.acquire("second.png");
    expect(revoked).not.toContain(second.url);
    stillOpen.release();
  } finally {
    affected.dispose();
    unrelated.dispose();
  }

  expect(new Set(revoked)).toEqual(new Set(created));
});

test("editing App defaults reads full selected context hierarchy and saves only the App CAS record", async () => {
  const f = setup();
  const hostId = f.discovery.trust.scope.hostId;
  const workspaceId = f.discovery.checkout.workspaceId;

  const scopes = [
    f.scope,
    P.LanguageSettingsScope.cases.Language.make({ language: "python" }),
    P.LanguageSettingsScope.cases.Host.make({ hostId }),
    P.LanguageSettingsScope.cases.Workspace.make({ hostId, workspaceId, language: null }),
    P.LanguageSettingsScope.cases.Workspace.make({ hostId, workspaceId, language: "python" }),
  ];

  const patches: ReadonlyArray<P.LanguageSettingsPatch> = [
    { providers: ["app"], formatOnSave: true },
    { providers: ["language"] },
    { providers: ["host"], interpreter: "/host/python" },
    { sdk: "/workspace/sdk", formatOnSave: false },
    { providers: [], interpreter: "/nested/.venv/python" },
  ];

  const unrelated = P.LanguageSettingsRecord.make({
    scope: P.LanguageSettingsScope.cases.Workspace.make({
      hostId,
      workspaceId: P.WorkspaceId.make("unrelated"),
      language: "python",
    }),
    revision: 99,
    settings: { interpreter: "/unrelated/python", providers: ["unrelated"] },
  });

  f.records.set(JSON.stringify(unrelated.scope), unrelated);

  for (const [i, scope] of scopes.entries())
    f.records.set(
      JSON.stringify(scope),
      P.LanguageSettingsRecord.make({ scope, revision: i + 1, settings: patches[i] ?? {} })
    );
  const retained = scopes.slice(1).map((scope) => f.records.get(JSON.stringify(scope)));
  const loaded = await f.adapter.load(f.scope, f.signal);

  if (!loaded.ok) throw new Error(loaded.message);
  expect(loaded.value.record.scope).toEqual(f.scope);
  expect(loaded.value.record.revision).toBe(1);
  expect(loaded.value.effective.providers).toEqual([]);
  expect(loaded.value.effective.settings.interpreter).toBe("/nested/.venv/python");
  expect(loaded.value.effective.settings.sdk).toBe("/workspace/sdk");
  expect(loaded.value.effective.formatOnSave).toBe(false);
  expect(loaded.value.effective.origins.interpreter).toEqual(scopes[4]);
  expect(loaded.value.effective.revision).toBe(15);
  expect(
    (
      await f.adapter.save(
        {
          ...loaded.value.record,
          settings: { ...loaded.value.record.settings, formatOnSave: false },
        },
        f.signal
      )
    ).ok
  ).toBe(true);
  expect(scopes.slice(1).map((scope) => f.records.get(JSON.stringify(scope)))).toEqual(retained);
  expect(f.records.get(JSON.stringify(unrelated.scope))).toEqual(unrelated);
  expect(f.records.get(JSON.stringify(f.scope))?.revision).toBe(2);
});

test("no checkout folds selected language defaults and old Hosts remain truthful without tool readiness", async () => {
  const f = setup();
  const languageScope = P.LanguageSettingsScope.cases.Language.make({ language: "python" });
  f.records.set(
    JSON.stringify(languageScope),
    P.LanguageSettingsRecord.make({
      scope: languageScope,
      revision: 1,
      settings: { interpreter: "/language/python", formatOnSave: false },
    })
  );

  const adapter = createLanguageSettingsAdapter({
    api: f.api,
    hosts: [{ ...f.host, status: { ...f.host.status, capabilities: [] } }],
    selected: null,
    language: "python",
    recover: async () => ({ ok: true, value: undefined }),
  });

  const result = await adapter.load(f.scope, f.signal);

  if (!result.ok) throw new Error(result.message);
  expect(result.value.record.settings).toEqual({});
  expect(result.value.effective.settings.interpreter).toBe("/language/python");
  expect(result.value.effective.formatOnSave).toBe(false);
  expect(result.value.hosts[0]?.capability).toBe("unsupported");
  expect(result.value.hosts[0]?.recovery).toBe("upgrade");
  expect(result.value.hosts[0]?.tools).toEqual([]);
  expect(f.control.calls).not.toContain("languages.catalog");
});

test("accepted M2 runtime refresh hook remounts only confirmed matching Host/Workspace policy", async () => {
  const { refreshMarkdownPolicy } = await import("../../editor/runtime/actions.ts");
  const { editorStore } = await import("../../editor/runtime/store.ts");
  const { workspaceKey } = await import("../../editor/model/drafts.ts");
  const f = setup();

  const policyReply = await f.api.request("languages.preview.policy.get", {
    hostKey: f.host.key,
    workspaceId: f.discovery.checkout.workspaceId,
  });

  if (!policyReply.ok) throw new Error("Missing fake policy");
  const policy = policyReply.value;
  const affected = workspaceKey(f.host.key, policy.workspaceId);
  const otherHost = workspaceKey("unrelated-host", policy.workspaceId);
  const otherWorkspace = workspaceKey(f.host.key, "unrelated-workspace");
  const previous = editorStore.getState().previewEpochs;

  editorStore.setState({ previewEpochs: { [affected]: 2, [otherHost]: 7, [otherWorkspace]: 11 } });

  try {
    for (const externalImages of ["allow", "deny"] as const) {
      const result = await updateMarkdownPolicy(
        f.api,
        { refreshMarkdownPolicy },
        f.host.key,
        { ...policy, externalImages },
        f.signal
      );

      expect(result.ok).toBe(true);
    }

    expect(editorStore.getState().previewEpochs).toEqual({
      [affected]: 4,
      [otherHost]: 7,
      [otherWorkspace]: 11,
    });
    f.control.fail = true;
    expect(
      (
        await updateMarkdownPolicy(
          f.api,
          { refreshMarkdownPolicy },
          f.host.key,
          { ...policy, externalImages: "allow" },
          f.signal
        )
      ).ok
    ).toBe(false);
    expect(editorStore.getState().previewEpochs[affected]).toBe(4);
    f.control.fail = false;
    f.control.foreignPolicy = true;
    expect(
      (
        await updateMarkdownPolicy(
          f.api,
          { refreshMarkdownPolicy },
          f.host.key,
          { ...policy, externalImages: "allow" },
          f.signal
        )
      ).ok
    ).toBe(false);
    f.control.foreignPolicy = false;
    f.control.hold = true;
    const controller = new AbortController();

    const pending = updateMarkdownPolicy(
      f.api,
      { refreshMarkdownPolicy },
      f.host.key,
      { ...policy, externalImages: "allow" },
      controller.signal
    );

    await Promise.resolve();
    controller.abort();
    f.control.release();
    expect((await pending).ok).toBe(false);
    expect(editorStore.getState().previewEpochs).toEqual({
      [affected]: 4,
      [otherHost]: 7,
      [otherWorkspace]: 11,
    });
  } finally {
    editorStore.setState({ previewEpochs: previous });
  }
});

test("policy-only fake hold keeps exact resolver while replacement Settings reads complete", async () => {
  const f = setup();

  const policy = P.LanguagePreviewPolicy.make({
    ...P.LANGUAGE_EDITOR_DEFAULTS,
    hostId: f.discovery.trust.scope.hostId,
    workspaceId: f.discovery.checkout.workspaceId,
  });

  f.control.hold = true;
  f.control.holdPolicyOnly = true;

  try {
    const pending = f.api.request("languages.preview.policy.set", { hostKey: f.host.key, policy });
    await Promise.resolve();
    expect(f.control.policyPending).toBe(true);
    const resolver = f.control.releasePolicy;

    const read = await f.api.request("languages.settings.get", {
      hostKey: f.host.key,
      scope: f.scope,
    });

    expect(read.ok).toBe(true);
    expect(f.control.releasePolicy).toBe(resolver);
    expect(f.control.policyCompletions).toBe(0);
    resolver();
    expect((await pending).ok).toBe(true);
    expect(f.control.policyCompletions).toBe(1);
  } finally {
    f.control.hold = false;
    f.control.holdPolicyOnly = false;
    f.control.releasePolicy();
  }
});

test("trust mutations require exact scope, next revision and trusted value acknowledgement", async () => {
  const f = setup();

  for (const flag of ["foreignTrust", "staleTrust", "wrongTrustValue"] as const) {
    const loaded = await f.adapter.load(f.scope, f.signal);
    const trust = loaded.ok ? loaded.value.hosts[0]?.discovery?.trust : null;

    if (!trust) throw new Error("Missing fake trust");
    f.control[flag] = true;
    expect(
      (
        await f.adapter.act(
          { kind: "trust", hostKey: f.host.key, trust, trusted: !trust.trusted },
          f.signal
        )
      ).ok
    ).toBe(false);
    f.control[flag] = false;
  }
});

test("confirmed CAS and trust refresh matching Editor scope; failed/cancelled/foreign acknowledgements do not", async () => {
  const calls: Array<string> = [];
  const f = setup((host, workspace) => calls.push(`${host}:${workspace}`));
  const read = () => f.adapter.load(f.scope, f.signal);
  const loaded = await read();

  if (!loaded.ok) throw new Error("Missing fake Settings");
  expect(calls).toHaveLength(0);
  expect(
    (await f.adapter.save({ ...loaded.value.record, settings: { formatOnSave: false } }, f.signal))
      .ok
  ).toBe(true);
  expect(calls).toEqual([`${f.host.key}:${f.discovery.checkout.workspaceId}`]);
  const beforeFailure = await read();

  if (!beforeFailure.ok) throw new Error("Missing Settings before failed CAS");
  f.control.fail = true;
  const failed = await f.adapter.save(beforeFailure.value.record, f.signal);
  expect(failed.ok).toBe(false);
  expect(calls).toHaveLength(1);
  f.control.fail = false;
  const current = await read();
  const trust = current.ok ? current.value.hosts[0]?.discovery?.trust : null;

  if (!trust) throw new Error("Missing fake trust");
  f.control.foreignTrust = true;
  expect(
    (
      await f.adapter.act(
        { kind: "trust", hostKey: f.host.key, trust, trusted: !trust.trusted },
        f.signal
      )
    ).ok
  ).toBe(false);
  expect(calls).toHaveLength(1);
  f.control.foreignTrust = false;
  await read();
  expect(
    (
      await f.adapter.act(
        { kind: "trust", hostKey: f.host.key, trust, trusted: !trust.trusted },
        f.signal
      )
    ).ok
  ).toBe(true);
  expect(calls).toHaveLength(2);
  const fresh = await read();

  if (!fresh.ok) throw new Error("Missing fresh Settings");
  f.control.hold = true;
  const controller = new AbortController();

  const pending = f.adapter.save(
    { ...fresh.value.record, settings: { formatOnSave: true } },
    controller.signal
  );

  await Promise.resolve();
  controller.abort();
  f.control.release();
  expect((await pending).ok).toBe(false);
  expect(calls).toHaveLength(2);
});

test("foreign CAS acknowledgement and cancelled late trust acknowledgement never refresh Editor", async () => {
  const calls: Array<string> = [];
  const f = setup((host, workspace) => calls.push(`${host}:${workspace}`));
  const loaded = await f.adapter.load(f.scope, f.signal);

  if (!loaded.ok) throw new Error("Missing fake Settings");
  f.control.foreignSave = true;
  expect((await f.adapter.save(loaded.value.record, f.signal)).ok).toBe(false);
  expect(calls).toEqual([]);
  f.control.foreignSave = false;
  const fresh = await f.adapter.load(f.scope, f.signal);
  const trust = fresh.ok ? fresh.value.hosts[0]?.discovery?.trust : null;

  if (!trust) throw new Error("Missing fake trust");
  f.control.hold = true;
  const controller = new AbortController();

  const pending = f.adapter.act(
    { kind: "trust", hostKey: f.host.key, trust, trusted: !trust.trusted },
    controller.signal
  );

  await Promise.resolve();
  controller.abort();
  f.control.release();
  expect((await pending).ok).toBe(false);
  expect(calls).toEqual([]);
});

test("explicit trust is available before prerequisite observations or discovery can succeed", async () => {
  for (const unavailable of ["failAvailability", "failDiscovery"] as const) {
    const f = setup();
    f.control[unavailable] = true;
    f.control.untrusted = true;
    const loaded = await f.adapter.load(f.scope, f.signal);

    if (!loaded.ok) throw new Error(loaded.message);
    const host = loaded.value.hosts[0];

    if (!host?.trust) throw new Error("Missing independent trust observation");
    expect(host.discovery).toBeNull();
    expect(host.trust.trusted).toBe(false);
    expect(host.canSetTrust).toBe(true);
    expect(f.control.calls).not.toContain("languages.trust.set");
    expect(
      (
        await f.adapter.act(
          { kind: "trust", hostKey: host.key, trust: host.trust, trusted: true },
          f.signal
        )
      ).ok
    ).toBe(true);
    expect(f.control.calls.filter((method) => method === "languages.trust.set")).toHaveLength(1);
  }
});

test("failed or foreign independent trust observations cannot authorize a grant", async () => {
  for (const invalid of ["failReadTrust", "foreignReadTrust"] as const) {
    const f = setup();
    f.control[invalid] = true;
    f.control.failAvailability = true;
    const loaded = await f.adapter.load(f.scope, f.signal);

    if (!loaded.ok) throw new Error(loaded.message);
    const host = loaded.value.hosts[0];
    expect(host?.canSetTrust).toBe(false);
    expect(
      (
        await f.adapter.act(
          { kind: "trust", hostKey: f.host.key, trust: f.discovery.trust, trusted: true },
          f.signal
        )
      ).ok
    ).toBe(false);
    expect(f.control.calls).not.toContain("languages.trust.set");
  }
});
