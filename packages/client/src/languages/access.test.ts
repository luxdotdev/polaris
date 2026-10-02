import { expect, test } from "bun:test";
import * as P from "@polaris/protocol";
import { LanguageAccess, type LanguageTransport, decodeLanguage, abortable } from "./index.ts";
import { LanguageDocuments, type LanguageOpenSnapshot } from "./documents.ts";

const hostId = P.HostId.make("host-a");

const workspaceId = P.WorkspaceId.make("workspace-a");

const checkout = P.LanguageCheckout.cases.Workspace.make({ workspaceId, path: "/fixture" });

const settings = P.LanguageEffectiveSettings.make({
  revision: 0,
  formatOnSave: true,
  formatter: P.LanguageFormatterSelection.cases.None.make({}),
  providers: [],
  settings: {},
  origins: {},
});

const acquire = {
  clientId: "client-a",
  contextId: "context-a",
  checkout,
  path: "/fixture/a.ts",
  providerId: "typescript",
  settings,
  interestId: "editor-a",
};

const context = (generation: number) =>
  P.LanguageContextIdentity.make({
    hostId,
    clientId: "client-a",
    contextId: "context-a",
    checkout,
    projectRoot: "/fixture",
    providerId: "typescript",
    configurationFingerprint: "a".repeat(64),
    generation,
  });

const limits = P.LanguageLimits.make({
  messageBytes: 1048576,
  queuedMessages: 256,
  outstandingRequests: 128,
  documents: 1024,
  diagnosticsPerDocument: 2000,
  logBytes: 65536,
  requestTimeoutMs: 30000,
});

const fake = (
  invoke: LanguageTransport["invoke"],
  capabilities: LanguageTransport["capabilities"] = ["languages"]
) => {
  const controller = new AbortController();

  const access = new LanguageAccess({
    hostId,
    clientId: "client-a",
    capabilities,
    signal: controller.signal,
    invoke,
    watch: async function* () {},
    takeBlob: async () => new Uint8Array(),
  });

  return { access, controller };
};

test("old and partial peers refuse unsupported methods without calling transport", async () => {
  let calls = 0;

  const invoke = async () => {
    calls++;

    return {};
  };

  await rejected(fake(invoke, []).access.request("languages.catalog", {}), {
    reason: "unsupported-capability",
  });
  await rejected(
    fake(invoke, ["languages.install"]).access.request("languages.install", {
      toolId: "typescript",
      version: "1",
      intent: "manual",
    }),
    { reason: "unsupported-capability" }
  );
  expect(calls).toBe(0);
});

test("malformed boundaries and foreign ownership fail without echoing values", async () => {
  const { access } = fake(async () => ({ privateToken: "SECRET" }));
  await rejected(access.request("languages.catalog", {}), {
    reason: "invalid-input",
    message: "Language operation: invalid-input",
  });
  await rejected(access.request("languages.context.acquire", { ...acquire, clientId: "foreign" }), {
    reason: "not-owner",
  });
  expect(() => decodeLanguage(P.LanguageSettingsPatch, { interpreter: "\u0000SECRET" })).toThrow(
    "Language operation: invalid-input"
  );
});

test("connection loss promptly cancels a transport that ignores abort", async () => {
  const { access, controller } = fake(() => new Promise(() => {}));
  const request = access.request("languages.catalog", {});
  controller.abort();
  await rejected(request, { reason: "not-connected" });
});

test("reconnect recreates generation and sends newest full snapshots before requests", async () => {
  let generation = 1;

  let snapshot: LanguageOpenSnapshot = P.LanguageDocumentNotification.cases.Open.make({
    uri: "file:///fixture/a.ts",
    languageId: "typescript",
    version: 1,
    text: "old",
  });

  const calls: string[] = [];

  let ack = P.LanguageSyncAck.make({
    context: context(generation),
    acceptedSequence: 0,
    documents: [],
  });

  const invoke: LanguageTransport["invoke"] = async (method, input) => {
    calls.push(method);

    if (method === "languages.context.acquire") {
      ack = P.LanguageSyncAck.make({
        context: context(generation),
        acceptedSequence: 0,
        documents: [],
      });

      return P.LanguageContextSnapshot.make({
        context: context(generation),
        ack,
        limits,
        runtime: P.LanguageRuntime.cases.Starting.make({}),
      });
    }

    if (method === "languages.context.release") return;

    if (method === "languages.document.sync") {
      const sync = decodeLanguage(P.LanguageSyncInput, input);
      expect(sync.notification).toEqual(snapshot);
      ack = P.LanguageSyncAck.make({
        context: sync.context,
        acceptedSequence: sync.sequence,
        documents: [{ uri: snapshot.uri, version: snapshot.version }],
      });

      return ack;
    }

    const request = decodeLanguage(P.LanguageFeatureRequest, input);
    expect(request.fence.context.generation).toBe(generation);
    expect(request.fence.documents[0]?.version).toBe(snapshot.version);

    return P.LanguageFeatureResult.make({
      requestId: request.requestId,
      fence: request.fence,
      result: null,
    });
  };

  const documents = new LanguageDocuments(acquire, () => [snapshot]);
  await documents.reconnect(fake(invoke).access);
  await documents.request({
    requestId: "first",
    method: "textDocument/hover",
    params: {},
    deadline: 100,
  });
  documents.disconnect();
  snapshot = P.LanguageDocumentNotification.cases.Open.make({
    ...snapshot,
    version: 9,
    text: "current unsaved draft",
  });
  generation = 2;
  const restored = documents.reconnect(fake(invoke).access);

  const request = documents.request({
    requestId: "second",
    method: "textDocument/hover",
    params: {},
    deadline: 100,
  });

  await restored;
  await request;
  expect(calls).toEqual([
    "languages.context.acquire",
    "languages.document.sync",
    "languages.request",
    "languages.context.release",
    "languages.context.acquire",
    "languages.document.sync",
    "languages.request",
  ]);
});

test("typing invalidates pending feature results while buffers remain Client-owned", async () => {
  let answer: (() => void) | undefined;

  const snapshot = P.LanguageDocumentNotification.cases.Open.make({
    uri: "file:///fixture/a.ts",
    languageId: "typescript",
    version: 1,
    text: "text",
  });

  const ack = P.LanguageSyncAck.make({
    context: context(1),
    acceptedSequence: 1,
    documents: [{ uri: snapshot.uri, version: 1 }],
  });

  const { access } = fake(async (method, input) => {
    if (method === "languages.context.acquire")
      return P.LanguageContextSnapshot.make({
        context: context(1),
        ack: { ...ack, acceptedSequence: 0 },
        limits,
        runtime: P.LanguageRuntime.cases.Starting.make({}),
      });

    if (method === "languages.document.sync") return ack;
    const request = decodeLanguage(P.LanguageFeatureRequest, input);

    return new Promise((resolve) => {
      answer = () =>
        resolve(
          P.LanguageFeatureResult.make({
            requestId: request.requestId,
            fence: request.fence,
            result: null,
          })
        );
    });
  });

  const documents = new LanguageDocuments(acquire, () => [snapshot]);
  await documents.reconnect(access);

  const pending = documents.request({
    requestId: "hover",
    method: "textDocument/hover",
    params: {},
    deadline: 100,
  });

  await Bun.sleep(0);
  documents.invalidate();
  await rejected(pending, { reason: "cancelled" });
  answer?.();
});

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Test observes raw transport rejection before asserting its safe fields.
const rejected = async (
  promise: Promise<unknown>,
  expected: Partial<Pick<P.LanguageError, "reason" | "message">>
) => {
  const error = await promise.then(
    () => null,
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Captured test rejection is intentionally untrusted.
    (failure: unknown) => failure
  );

  expect(error).toMatchObject(expected);
};

test("Host progress streams preserve facts, reject routing collisions and stop on cancellation", async () => {
  const controller = new AbortController();
  let returned = 0;

  const progress = P.LanguageInstallProgress.make({
    hostId,
    toolId: "typescript",
    version: "1",
    jobId: "job",
    sequence: 1,
    phase: "downloading",
    downloadedBytes: 10,
    totalBytes: 100,
    message: "Downloading",
    activeVersion: null,
  });

  const access = new LanguageAccess({
    hostId,
    clientId: "client-a",
    capabilities: ["languages", "languages.install"],
    signal: new AbortController().signal,
    invoke: async () => {},
    takeBlob: async () => new Uint8Array(),
    watch: () => ({
      [Symbol.asyncIterator]: () => ({
        next: async () => ({ done: false, value: progress }),
        return: async () => {
          returned++;

          return { done: true, value: undefined };
        },
      }),
    }),
  });

  const stream = access
    .watch("languages.install.watch", { jobId: "job" }, controller.signal)
    [Symbol.asyncIterator]();

  expect((await stream.next()).value).toEqual(progress);
  controller.abort();
  expect((await stream.next()).done).toBe(true);
  expect(returned).toBe(1);

  const foreign = new LanguageAccess({
    ...access.transport,
    watch: async function* () {
      yield { ...progress, hostId: P.HostId.make("foreign") };
    },
  });

  await rejected(
    foreign
      .watch("languages.install.watch", { jobId: "job" }, new AbortController().signal)
      [Symbol.asyncIterator]()
      .next(),
    { reason: "server-failed" }
  );
});

test("installation fails closed for missing and evaluation-only catalog tools", async () => {
  const requests: string[] = [];

  const tool = P.LanguageTool.make({
    id: "experimental",
    disposition: "evaluation",
    version: "1",
    source: "fixture",
    license: "MIT",
    artifacts: [],
    requirements: [],
    argv: [],
    environment: {},
    limitations: [],
  });

  const { access } = fake(
    async (method) => {
      requests.push(method);

      return P.LanguageCatalog.make({
        revision: 1,
        releaseDate: "fixture",
        tools: [tool],
        integrations: [],
      });
    },
    ["languages", "languages.install"]
  );

  await rejected(
    access.request("languages.install", { toolId: "experimental", version: "1", intent: "manual" }),
    { reason: "not-offered" }
  );
  await rejected(
    access.request("languages.install", { toolId: "missing", version: "1", intent: "manual" }),
    { reason: "not-offered" }
  );
  expect(requests).toEqual(["languages.catalog", "languages.catalog"]);
});

test("context feeds reject another Client generation before delivering its log", async () => {
  const ack = P.LanguageSyncAck.make({ context: context(1), acceptedSequence: 0, documents: [] });

  const { access } = fake(async () =>
    P.LanguageContextSnapshot.make({
      context: context(1),
      ack,
      limits,
      runtime: P.LanguageRuntime.cases.Starting.make({}),
    })
  );

  await access.request("languages.context.acquire", acquire);
  const sameTransport = access.transport;

  const isolated = new LanguageAccess({
    ...sameTransport,
    watch: async function* () {
      yield P.LanguageContextEvent.cases.Log.make({
        context: context(2),
        level: "error",
        message: "PRIVATE FOREIGN LOG",
      });
    },
  });

  await isolated.request("languages.context.acquire", acquire);
  await rejected(
    isolated
      .watch("languages.context.watch", { context: context(1) }, new AbortController().signal)
      [Symbol.asyncIterator]()
      .next(),
    { reason: "server-failed" }
  );
  access.dispose();
  isolated.dispose();
});

test("resource proposals cannot cross a peer lacking the additional resource capability", async () => {
  const identity = context(1);
  const ack = P.LanguageSyncAck.make({ context: identity, acceptedSequence: 0, documents: [] });

  const fence = P.LanguageRequestFence.make({
    context: identity,
    requiredSequence: 0,
    documents: [],
  });

  const proposal = P.LanguageEditProposal.make({
    proposalId: "proposal",
    fence,
    origin: "code-action",
    label: "Create file",
    edit: { documentChanges: [{ kind: "create", uri: "file:///fixture/new.ts" }] },
    snapshots: [],
    expiresAt: Date.now() + 30000,
  });

  const { access } = fake(async (method) =>
    method === "languages.context.acquire"
      ? P.LanguageContextSnapshot.make({
          context: identity,
          ack,
          limits,
          runtime: P.LanguageRuntime.cases.Starting.make({}),
        })
      : P.LanguageFeatureResult.make({
          requestId: "action",
          fence,
          result: null,
          proposals: [proposal],
        })
  );

  await access.request("languages.context.acquire", acquire);
  await rejected(
    access.request("languages.request", {
      requestId: "action",
      fence,
      method: "textDocument/codeAction",
      params: {},
      deadline: 100,
    }),
    { reason: "unsupported-capability" }
  );
  access.dispose();
});

test("connection replacement rejects queued acquisition and notifications before forwarding", async () => {
  let obsoleteCalls = 0;

  const obsolete = fake(async () => {
    obsoleteCalls++;

    return {};
  });

  let freshCalls = 0;

  const fresh = fake(async () => {
    freshCalls++;

    return P.LanguageContextSnapshot.make({
      context: context(2),
      ack: P.LanguageSyncAck.make({ context: context(2), acceptedSequence: 0, documents: [] }),
      limits,
      runtime: P.LanguageRuntime.cases.Starting.make({}),
    });
  });

  const documents = new LanguageDocuments(acquire, () => []);
  const oldAcquire = rejected(documents.reconnect(obsolete.access), { reason: "stale-generation" });

  const oldSync = rejected(
    documents.sync(
      P.LanguageDocumentNotification.cases.Close.make({
        uri: "file:///fixture/a.ts",
        version: 1,
      })
    ),
    { reason: "stale-generation" }
  );

  await documents.reconnect(fresh.access);
  await Promise.all([oldAcquire, oldSync]);
  expect(obsoleteCalls).toBe(0);
  expect(freshCalls).toBe(1);
});

test("already-cancelled calls consume a late transport rejection", async () => {
  const controller = new AbortController();
  controller.abort();
  await rejected(
    abortable(Promise.reject(new Error("PRIVATE transport error")), controller.signal),
    {
      reason: "cancelled",
    }
  );
  await Bun.sleep(0);
});
