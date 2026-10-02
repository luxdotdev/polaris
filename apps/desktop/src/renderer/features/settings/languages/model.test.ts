import { test, expect } from "bun:test";
import { SettingsOperations } from "./operations.ts";
import { parseCustomServer } from "./CustomServers.tsx";
import { fixtureSnapshot, fixtureScopes } from "./fixture.ts";
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
