import { expect, test } from "bun:test";
import * as P from "@polaris/protocol";
import { LanguageAccess, decodeLanguage, type LanguageTransport } from "./index.ts";

const hostId = P.HostId.make("context-host");

const checkout = P.LanguageCheckout.cases.Workspace.make({
  workspaceId: P.WorkspaceId.make("context-workspace"),
  path: "/fixture",
});

const settings = P.LanguageEffectiveSettings.make({
  revision: 0,
  formatOnSave: true,
  formatter: P.LanguageFormatterSelection.cases.None.make({}),
  providers: [],
  settings: {},
  origins: {},
});

const identity = P.LanguageContextIdentity.make({
  hostId,
  clientId: "client",
  contextId: "context",
  checkout,
  projectRoot: "/fixture",
  providerId: "typescript",
  configurationFingerprint: "a".repeat(64),
  generation: 1,
});

const initialAck = P.LanguageSyncAck.make({
  context: identity,
  acceptedSequence: 1,
  documents: [{ uri: "file:///fixture/a.ts", version: 1 }],
});

const snapshot = (
  context: P.LanguageContextIdentity,
  ack = P.LanguageSyncAck.make({
    context,
    acceptedSequence: 0,
    documents: [],
  })
) =>
  P.LanguageContextSnapshot.make({
    context,
    ack,
    limits: P.LanguageLimits.make({
      messageBytes: 1048576,
      queuedMessages: 256,
      outstandingRequests: 128,
      documents: 1024,
      diagnosticsPerDocument: 2000,
      logBytes: 65536,
      requestTimeoutMs: 30000,
    }),
    runtime: P.LanguageRuntime.cases.Starting.make({}),
  });

const acquire = {
  clientId: identity.clientId,
  contextId: identity.contextId,
  checkout,
  path: "/fixture/a.ts",
  providerId: identity.providerId,
  settings,
  interestId: "editor",
};

const fixture = (transition: LanguageTransport["invoke"]) =>
  new LanguageAccess({
    hostId,
    clientId: identity.clientId,
    capabilities: ["languages"],
    signal: new AbortController().signal,
    invoke: async (method, input, signal) => {
      if (method === "languages.context.acquire") return snapshot(identity, initialAck);

      if (method === "languages.request") {
        const request = decodeLanguage(P.LanguageFeatureRequest, input);

        return P.LanguageFeatureResult.make({
          requestId: request.requestId,
          fence: request.fence,
          result: null,
        });
      }

      return transition(method, input, signal);
    },
    watch: async function* () {},
    takeBlob: async () => new Uint8Array(),
  });

const feature = (access: LanguageAccess, ack: P.LanguageSyncAck) =>
  access.request("languages.request", {
    requestId: "hover",
    method: "textDocument/hover",
    params: {},
    deadline: 100,
    fence: {
      context: ack.context,
      requiredSequence: ack.acceptedSequence,
      documents: ack.documents,
    },
  });

const transitionMethods = ["languages.context.restart", "languages.context.configure"] as const;

const transition = (access: LanguageAccess, method: (typeof transitionMethods)[number]) =>
  access.request(method, { context: identity, settings });

for (const method of transitionMethods) {
  test(`${method} rejects foreign ownership coordinates and preserves context/ack`, async () => {
    const foreignCheckouts = [
      P.LanguageCheckout.cases.Workspace.make({ ...checkout, path: "/foreign" }),
      P.LanguageCheckout.cases.Workspace.make({
        ...checkout,
        workspaceId: P.WorkspaceId.make("foreign-workspace"),
      }),
    ];

    const foreign = [
      P.LanguageContextIdentity.make({ ...identity, generation: 2, contextId: "foreign-context" }),
      P.LanguageContextIdentity.make({ ...identity, generation: 2, providerId: "python" }),
      ...foreignCheckouts.map((value) =>
        P.LanguageContextIdentity.make({ ...identity, generation: 2, checkout: value })
      ),
    ];

    for (const context of foreign) {
      const access = fixture(async () => snapshot(context));
      await access.request("languages.context.acquire", acquire);
      const error = await transition(access, method).catch((value: Error) => value);
      expect(error).toMatchObject({ reason: "not-owner" });
      expect((await feature(access, initialAck)).fence.context).toEqual(identity);

      const foreignError = await feature(
        access,
        P.LanguageSyncAck.make({ context, acceptedSequence: 0, documents: [] })
      ).catch((value: Error) => value);

      expect(foreignError).toMatchObject({ reason: "not-owner" });
      access.dispose();
    }
  });

  test(`${method} accepts a current generation with changed configuration/project discovery`, async () => {
    const context = P.LanguageContextIdentity.make({
      ...identity,
      generation: 2,
      projectRoot: "/fixture/nested",
      configurationFingerprint: "b".repeat(64),
    });

    const next = snapshot(context);
    const access = fixture(async () => next);
    await access.request("languages.context.acquire", acquire);
    expect((await transition(access, method)).context).toEqual(context);
    expect((await feature(access, next.ack)).fence.context).toEqual(context);
    const stale = await feature(access, initialAck).catch((value: Error) => value);
    expect(stale).toMatchObject({ reason: "not-owner" });
    access.dispose();
  });
}

test("configure accepts an unchanged context without recreating its generation", async () => {
  const access = fixture(async () => snapshot(identity, initialAck));
  await access.request("languages.context.acquire", acquire);
  expect((await transition(access, "languages.context.configure")).context).toEqual(identity);
  expect((await feature(access, initialAck)).fence.context).toEqual(identity);
  access.dispose();
});

test("restart and configuration changes cannot reuse the old generation", async () => {
  for (const method of transitionMethods) {
    const reply =
      method === "languages.context.restart"
        ? identity
        : P.LanguageContextIdentity.make({
            ...identity,
            configurationFingerprint: "b".repeat(64),
          });

    const access = fixture(async () => snapshot(reply));
    await access.request("languages.context.acquire", acquire);
    const error = await transition(access, method).catch((value: Error) => value);
    expect(error).toMatchObject({ reason: "stale-generation" });
    expect((await feature(access, initialAck)).fence.context).toEqual(identity);
    access.dispose();
  }
});

for (const firstMethod of transitionMethods) {
  for (const secondMethod of transitionMethods) {
    test(`${firstMethod} then ${secondMethod} rejects out-of-order transition completion`, async () => {
      const complete: Array<(value: typeof P.LanguageContextSnapshot.Type) => void> = [];
      const access = fixture(() => new Promise((resolve) => complete.push(resolve)));
      await access.request("languages.context.acquire", acquire);
      const older = transition(access, firstMethod).catch((value: Error) => value);
      const newer = transition(access, secondMethod);
      await Bun.sleep(0);

      const latest = snapshot(
        P.LanguageContextIdentity.make({
          ...identity,
          generation: 3,
          configurationFingerprint: "c".repeat(64),
        })
      );

      complete[1]?.(latest);
      expect((await newer).context).toEqual(latest.context);
      complete[0]?.(snapshot(P.LanguageContextIdentity.make({ ...identity, generation: 2 })));
      expect(await older).toMatchObject({ reason: "stale-generation" });
      expect((await feature(access, latest.ack)).fence.context).toEqual(latest.context);
      access.dispose();
    });
  }
}

test("superseded completion is rejected even while the latest transition is pending", async () => {
  const complete: Array<(value: typeof P.LanguageContextSnapshot.Type) => void> = [];
  const access = fixture(() => new Promise((resolve) => complete.push(resolve)));
  await access.request("languages.context.acquire", acquire);
  const older = transition(access, "languages.context.restart").catch((value: Error) => value);
  const newer = transition(access, "languages.context.configure");
  await Bun.sleep(0);
  complete[0]?.(snapshot(P.LanguageContextIdentity.make({ ...identity, generation: 2 })));
  expect(await older).toMatchObject({ reason: "stale-generation" });
  expect((await feature(access, initialAck)).fence.context).toEqual(identity);
  const latest = snapshot(P.LanguageContextIdentity.make({ ...identity, generation: 3 }));
  complete[1]?.(latest);
  expect((await newer).context).toEqual(latest.context);
  expect((await feature(access, latest.ack)).fence.context).toEqual(latest.context);
  access.dispose();
});

test("concurrent acquisition of the same current context retains both interests", async () => {
  const released: string[] = [];

  const access = fixture(async (method, input) => {
    if (method === "languages.context.release")
      released.push(decodeLanguage(P.ReleaseLanguageContext.payloadSchema, input).interestId);
  });

  await Promise.all([
    access.request("languages.context.acquire", acquire),
    access.request("languages.context.acquire", { ...acquire, interestId: "second-editor" }),
  ]);
  access.dispose();
  await Bun.sleep(0);
  expect(released.sort()).toEqual(["editor", "second-editor"]);
});

test("a lower generation cannot replace the currently owned restarted context", async () => {
  const newer = snapshot(P.LanguageContextIdentity.make({ ...identity, generation: 3 }));
  let calls = 0;

  const access = fixture(async () =>
    calls++ === 0 ? newer : snapshot(P.LanguageContextIdentity.make({ ...identity, generation: 2 }))
  );

  await access.request("languages.context.acquire", acquire);
  await transition(access, "languages.context.restart");

  const error = await access
    .request("languages.context.configure", { context: newer.context, settings })
    .catch((value: Error) => value);

  expect(error).toMatchObject({ reason: "stale-generation" });
  expect((await feature(access, newer.ack)).fence.context).toEqual(newer.context);
  access.dispose();
});

test("last-interest release invalidates a pending transition before reacquisition", async () => {
  let complete: ((value: typeof P.LanguageContextSnapshot.Type) => void) | undefined;

  const access = fixture((method) =>
    method === "languages.context.restart"
      ? new Promise((resolve) => {
          complete = resolve;
        })
      : Promise.resolve()
  );

  await access.request("languages.context.acquire", acquire);
  const pending = transition(access, "languages.context.restart").catch((value: Error) => value);
  await Bun.sleep(0);
  await access.request("languages.context.release", {
    context: identity,
    interestId: acquire.interestId,
  });
  await access.request("languages.context.acquire", acquire);
  complete?.(snapshot(P.LanguageContextIdentity.make({ ...identity, generation: 2 })));
  expect(await pending).toMatchObject({ reason: "stale-generation" });
  expect((await feature(access, initialAck)).fence.context).toEqual(identity);
  access.dispose();
});
