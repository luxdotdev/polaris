import { expect, test } from "bun:test";
import * as P from "@polaris/protocol";
import type { LanguageApi } from "../../../../shared/api.ts";
import { EditorLanguageObservations } from "./observations.ts";
import { EditorProviderFixture } from "./fixture.testing.ts";

const scope = {
  hostKey: "fixture",
  identity: { hostId: P.HostId.make("fixture"), clientId: "client", connectionEpoch: 1 },
  checkout: P.LanguageCheckout.cases.Workspace.make({
    workspaceId: P.WorkspaceId.make("fixture"),
    path: "/fixture",
  }),
};

const settings = P.LanguageEffectiveSettings.make({
  revision: 0,
  formatOnSave: true,
  formatter: P.LanguageFormatterSelection.cases.None.make({}),
  providers: [],
  settings: {},
  origins: {},
});

test("concurrent files share one observation, while checkout, Client, epoch and provider settings remain isolated", async () => {
  const observations = new EditorLanguageObservations();
  const service = new EditorProviderFixture(scope.identity.hostId);
  let discoveries = 0;

  const api: LanguageApi = {
    ...service.api,
    request: (method, input) => {
      if (method === "languages.discover") discoveries++;

      return service.api.request(method, input);
    },
  };

  await Promise.all(
    ["a.ts", "b.ts"].map((path) =>
      observations.discover(api, scope, `/fixture/${path}`, "typescript", settings)
    )
  );
  expect(discoveries).toBe(1);

  for (const input of [
    { ...scope, identity: { ...scope.identity, clientId: "other" } },
    { ...scope, identity: { ...scope.identity, connectionEpoch: 2 } },
    {
      ...scope,
      checkout: P.LanguageCheckout.cases.Workspace.make({
        workspaceId: P.WorkspaceId.make("other"),
        path: "/other",
      }),
    },
  ])
    await observations.discover(api, input, `${input.checkout.path}/b.ts`, "typescript", settings);
  await observations.discover(
    api,
    scope,
    "/fixture/b.ts",
    "typescript",
    P.LanguageEffectiveSettings.make({
      ...settings,
      revision: 1,
      settings: {
        executableOverrides: {
          fixture: { executable: "/fixture/tool", argv: [], environment: {} },
        },
      },
    })
  );
  expect(discoveries).toBe(5);
});

test("invalidation rejects a pending old observation and cannot overwrite a fresh discovery", async () => {
  const observations = new EditorLanguageObservations();
  const service = new EditorProviderFixture(scope.identity.hostId);
  let release = () => {};

  const held = new Promise<void>((resolve) => {
    release = resolve;
  });

  let discoveries = 0;

  const api: LanguageApi = {
    ...service.api,
    request: async (method, input) => {
      if (method === "languages.discover" && ++discoveries === 1) await held;

      return service.api.request(method, input);
    },
  };

  const old = observations.discover(api, scope, "/fixture/a.ts", "typescript", settings);

  const rejected = old.then(
    () => false,
    (error: Error) => error.message.includes("observations changed")
  );

  observations.invalidate();
  const fresh = await observations.discover(api, scope, "/fixture/b.ts", "typescript", settings);
  release();

  expect(await rejected).toBe(true);
  expect(await observations.discover(api, scope, "/fixture/c.ts", "typescript", settings)).toBe(
    fresh
  );
  expect(discoveries).toBe(2);
});
