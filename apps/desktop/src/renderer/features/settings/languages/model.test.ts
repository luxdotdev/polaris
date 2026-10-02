import { test, expect } from "bun:test";
import { SettingsOperations } from "./operations.ts";
import { parseCustomServer } from "./CustomServers.tsx";
import {
  acceptSettingsFacts,
  currentSettingsFacts,
  discardSettingsDraft,
  initialSettingsView,
  settingsRevisionConflict,
} from "./viewState.ts";
import { fixtureSnapshot, fixtureScopes, createFixture } from "./fixture.ts";
import { toolAction, trustMatchesCheckout } from "./toolState.ts";
import * as P from "@polaris/protocol";

const draft = {
  id: "custom",
  executable: "/fixture/server",
  argv: '["--stdio","argument with spaces"]',
  environment: '{"FAKE_SECRET":"not-real"}',
  rootMarkers: '["pyproject.toml"]',
  workingDirectory: "",
  filePatterns: '["*.py"]',
  documentLanguageId: "python",
  initializationOptions: '{"features":{"enabled":true}}',
  settings: '{"severity":"warning"}',
};

test("custom stdio configuration preserves structured arguments and private environment", () => {
  const server = parseCustomServer(draft);
  expect(server.launch.argv).toEqual(["--stdio", "argument with spaces"]);
  expect(server.launch.environment).toEqual({ FAKE_SECRET: "not-real" });
  expect(server.workingDirectory).toBeNull();
  expect(() => parseCustomServer({ ...draft, environment: '{"BAD-NAME":"secret"}' })).toThrow();
  expect(() => parseCustomServer({ ...draft, initializationOptions: "[]" })).toThrow();
  expect(() => parseCustomServer({ ...draft, argv: '"shell command"' })).toThrow();
});

test("Host actions fail closed on blocked, unsupported and disconnected facts", () => {
  const snapshot = fixtureSnapshot(P.LanguageSettingsScope.cases.App.make({}));

  for (const i of [1, 2, 3, 4, 9, 10, 11]) {
    const host = snapshot.hosts[i];

    if (!host || !host.tools[0]) throw new Error("Missing fixture");
    expect(toolAction(host, host.tools[0])).toBeNull();
  }

  for (const [i, label] of [
    [5, "Install"],
    [6, "Retry"],
    [7, "Cancel installation"],
    [8, "Update"],
  ] as const) {
    const host = snapshot.hosts[i];

    if (!host || !host.tools[0]) throw new Error("Missing fixture");
    expect(toolAction(host, host.tools[0])?.label).toBe(label);
  }

  expect(fixtureScopes.length).toBe(5);
});

test("cancelled and superseded operations cannot accept stale results or errors", async () => {
  const operations = new SettingsOperations();
  let release: (value: string) => void = () => {};

  let signal: AbortSignal | undefined;
  const accepted: Array<string> = [];
  let failures = 0;

  const pending = operations.run(
    (s) => {
      signal = s;

      return new Promise<string>((resolve) => {
        release = resolve;
      });
    },
    (v) => accepted.push(v),
    () => {
      failures += 1;
    }
  );

  await operations.run(
    async () => "current",
    (v) => accepted.push(v),
    () => {
      failures += 1;
    }
  );
  release("stale");
  await pending;
  expect(signal?.aborted).toBe(true);
  expect(accepted).toEqual(["current"]);
  let reject: () => void = () => {};

  const cancelled = operations.run(
    () =>
      new Promise<string>((_, fail) => {
        reject = () => fail(new Error("private environment"));
      }),
    (v) => accepted.push(v),
    () => {
      failures += 1;
    }
  );

  operations.cancel();
  reject();
  await cancelled;
  expect(failures).toBe(0);
});

test("trust binds the actual Host and distinguishes Worktree inheritance from Review Checkout grants", () => {
  const hosts = fixtureSnapshot(P.LanguageSettingsScope.cases.App.make({})).hosts;
  const worktree = hosts[0];
  const review = hosts[12];

  if (!worktree?.discovery || !review?.discovery) throw new Error("Missing fixture");
  expect(trustMatchesCheckout(worktree)).toBe(true);
  expect(trustMatchesCheckout(review)).toBe(true);
  expect(
    trustMatchesCheckout({
      ...review,
      discovery: { ...review.discovery, trust: worktree.discovery.trust },
    })
  ).toBe(false);
  expect(trustMatchesCheckout({ ...worktree, id: P.HostId.make("foreign-host") })).toBe(false);
});

test("replacement adapter authority requires a current validated snapshot, not last-known facts", () => {
  const snapshot = fixtureSnapshot(P.LanguageSettingsScope.cases.App.make({}));
  const first = createFixture().adapter;
  const replacement = createFixture().adapter;
  const key = JSON.stringify(snapshot.record.scope);
  const view = acceptSettingsFacts(initialSettingsView(), snapshot, first, key, 0);
  expect(currentSettingsFacts(view, first, key, 0)).toBe(snapshot);
  expect(currentSettingsFacts(view, replacement, key, 0)).toBeNull();
  expect(currentSettingsFacts(view, first, key, 1)).toBeNull();
  expect(currentSettingsFacts({ ...view, valid: false }, first, key, 0)).toBeNull();

  const loaded = acceptSettingsFacts(
    { ...view, draft: { interpreter: "/fixture/keep" } },
    snapshot,
    replacement,
    key,
    1
  );

  expect(loaded.draft.interpreter).toBe("/fixture/keep");
  expect(currentSettingsFacts(loaded, replacement, key, 1)).toBe(snapshot);
});

test("confirmation refresh retains cancelled-save draft and fences changed authoritative revisions", () => {
  const snapshot = fixtureSnapshot(P.LanguageSettingsScope.cases.App.make({}));
  const adapter = createFixture().adapter;
  const key = JSON.stringify(snapshot.record.scope);
  const initial = acceptSettingsFacts(initialSettingsView(), snapshot, adapter, key, 0);
  const dirty = { ...initial, draft: { interpreter: "/fixture/draft" }, valid: false };
  const unchanged = acceptSettingsFacts(dirty, snapshot, adapter, key, 1);
  expect(unchanged.draft).toEqual(dirty.draft);
  expect(settingsRevisionConflict(unchanged)).toBe(false);

  const updated = {
    ...snapshot,
    record: P.LanguageSettingsRecord.make({
      ...snapshot.record,
      revision: 1,
      settings: { interpreter: "/fixture/other" },
    }),
  };

  const conflicted = acceptSettingsFacts(dirty, updated, adapter, key, 1);
  expect(conflicted.draft).toEqual(dirty.draft);
  expect(conflicted.baseline?.revision).toBe(0);
  expect(conflicted.snapshot?.record.revision).toBe(1);
  expect(settingsRevisionConflict(conflicted)).toBe(true);
  const discarded = discardSettingsDraft(conflicted);
  expect(discarded.draft.interpreter).toBe("/fixture/other");
  expect(settingsRevisionConflict(discarded)).toBe(false);
});

test("confirmed saves compare validated values independently of JSON object property order", () => {
  const adapter = createFixture().adapter;
  const snapshot = fixtureSnapshot(P.LanguageSettingsScope.cases.App.make({}));
  const key = JSON.stringify(snapshot.record.scope);
  const initial = acceptSettingsFacts(initialSettingsView(), snapshot, adapter, key, 0);
  const draft = { sdk: "/fixture/sdk", providers: ["pyright"], interpreter: "/fixture/python" };

  const record = P.LanguageSettingsRecord.make({
    ...snapshot.record,
    revision: 1,
    settings: { interpreter: "/fixture/python", providers: ["pyright"], sdk: "/fixture/sdk" },
  });

  const confirmed = acceptSettingsFacts(
    { ...initial, draft, acknowledged: { adapter, settings: draft } },
    { ...snapshot, record },
    adapter,
    key,
    1
  );

  expect(settingsRevisionConflict(confirmed)).toBe(false);
  expect(confirmed.baseline?.revision).toBe(1);
  expect(confirmed.draft).toEqual(record.settings);
});
