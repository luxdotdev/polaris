import { expect, test } from "bun:test";
import { EditorState } from "@codemirror/state";
import * as P from "@polaris/protocol";
import { Predicate, Schema } from "effect";
import type { LanguageApi, SubscriptionListener } from "../../../../shared/api.ts";
import { LanguageRequestOutputs, LanguageSubscriptionItems } from "../../../../shared/languages.ts";
import {
  bindLanguagePreparation,
  featureIntentCurrent,
  prepareLanguageEdit,
  serverEditCurrent,
} from "./preparation.ts";
import { configurationItems } from "./serverConfiguration.ts";
import { ownedProvider } from "./ownership.ts";
import { EditorProviderFixture } from "./fixture.testing.ts";
import { EditorLanguageSession } from "./sessions.ts";
import { associatedLanguage, matchesAssociation } from "./configuration.ts";

const fixture = (root = "/fixture", generation = 1, initiallyStopped = false) => {
  const hostId = P.HostId.make("fake");

  const checkout = P.LanguageCheckout.cases.Workspace.make({
    workspaceId: P.WorkspaceId.make("workspace"),
    path: root,
  });

  const settings = P.LanguageEffectiveSettings.make({
    revision: 0,
    formatOnSave: true,
    formatter: P.LanguageFormatterSelection.cases.None.make({}),
    providers: [],
    settings: {},
    origins: {},
  });

  const context = P.LanguageContextIdentity.make({
    hostId,
    checkout,
    clientId: "client",
    contextId: "context",
    providerId: "typescript",
    projectRoot: root,
    configurationFingerprint: "a".repeat(64),
    generation,
  });

  const capabilities = P.LanguageProviderCapabilities.make({
    positionEncoding: "utf-8",
    synchronization: "incremental",
    openClose: true,
    save: true,
    saveIncludeText: true,
    methods: ["textDocument/completion"],
    completionResolve: false,
    actionResolve: false,
    executeCommands: [],
    diagnostics: "push",
    workspaceDiagnostics: false,
  });

  let ack = P.LanguageSyncAck.make({ context, acceptedSequence: 0, documents: [] });
  const notifications: P.LanguageDocumentNotification[] = [];
  const listeners: SubscriptionListener<P.LanguageContextEvent>[] = [];
  let releases = 0;
  let acquisitions = 0;
  let hold: Promise<void> | null = null;
  let foreign = false;
  let foreignAck = false;

  const api: LanguageApi = {
    request: async (method, input) => {
      let value: typeof P.LanguageContextSnapshot.Type | P.LanguageSyncAck | undefined;

      if (method === "languages.context.acquire") {
        acquisitions++;
        value = {
          context: foreign ? { ...context, clientId: "foreign" } : context,
          runtime: initiallyStopped
            ? P.LanguageRuntime.cases.Stopped.make({ reason: "no-demand" })
            : P.LanguageRuntime.cases.Ready.make({ capabilities }),
          ack: foreignAck ? { ...ack, context: { ...context, clientId: "foreign" } } : ack,
          limits: {
            messageBytes: 1048576,
            queuedMessages: 32,
            outstandingRequests: 32,
            documents: 32,
            diagnosticsPerDocument: 2000,
            logBytes: 65536,
            requestTimeoutMs: 5000,
          },
        };
      } else if (method === "languages.document.sync") {
        const sync = Schema.decodeUnknownSync(P.LanguageSyncInput)(input);

        if (hold !== null) await hold;
        notifications.push(sync.notification);
        const document = sync.notification;
        ack = P.LanguageSyncAck.make({
          context,
          acceptedSequence: sync.sequence,
          documents: Predicate.isTagged(document, "Close")
            ? ack.documents.filter((item) => item.uri !== document.uri)
            : [
                ...ack.documents.filter((item) => item.uri !== document.uri),
                { uri: document.uri, version: document.version },
              ],
        });
        value = ack;
      } else if (method === "languages.context.release") releases++;
      else throw new Error("Unexpected request");

      return { ok: true, value: Schema.decodeUnknownSync(LanguageRequestOutputs[method])(value) };
    },
    subscribe: (kind, _input, listener) => {
      listeners.push({
        items: (events) =>
          listener.items(
            events.map((value) => Schema.decodeUnknownSync(LanguageSubscriptionItems[kind])(value))
          ),
      });

      return () => undefined;
    },
  };

  const session = new EditorLanguageSession(
    api,
    "fake",
    {
      clientId: "client",
      contextId: "context",
      providerId: "typescript",
      checkout,
      path: `${root}/a.ts`,
      settings,
      interestId: "interest",
    },
    hostId,
    () => undefined
  );

  const buffer = (uri: string) => {
    let state = EditorState.create({
      doc: "a😀é\r\nunsaved",
      extensions: EditorState.lineSeparator.of("\r\n"),
    });

    let version = 1;
    const read = () => ({ uri, version, doc: state.doc, lineSeparator: "\r\n" as const });
    const detach = session.attach({ read, language: () => "typescript", changed: () => undefined });

    return {
      read,
      detach,
      edit: (text: string) => {
        state = state.update({ changes: { from: 0, to: state.doc.length, insert: text } }).state;
        version++;
        session.edited(uri);
      },
    };
  };

  return {
    session,
    buffer,
    context,
    capabilities,
    notifications,
    listeners,
    stats: () => ({ releases, acquisitions }),
    hold: (value: Promise<void> | null) => {
      hold = value;
    },
    foreignAck: () => {
      foreignAck = true;
    },
    foreign: () => {
      foreign = true;
    },
  };
};

test("one project/provider queue retains two hidden unsaved buffers and closes only released interests", async () => {
  const f = fixture();
  const a = f.buffer("file:///fixture/a.ts");
  const b = f.buffer("file:///fixture/b.ts");
  await f.session.ready();
  expect(f.stats().acquisitions).toBe(1);
  expect(f.notifications).toHaveLength(2);
  expect(f.notifications[0]).toMatchObject({ text: "a😀é\r\nunsaved" });
  a.detach();
  await f.session.ready();
  expect(f.stats().releases).toBe(0);
  expect(f.session.provider(b.read().uri)).not.toBeNull();
  b.detach();
  await f.session.ready();
  await Promise.resolve();
  expect(f.stats().releases).toBe(1);
  expect(f.notifications.filter((value) => Predicate.isTagged(value, "Close"))).toHaveLength(2);
});

test("edit burst invalidates features immediately then coalesces latest exact text behind acknowledgment", async () => {
  const f = fixture();
  const a = f.buffer("file:///fixture/a.ts");
  await f.session.ready();
  let release = () => {};

  f.hold(
    new Promise<void>((resolve) => {
      release = resolve;
    })
  );
  a.edit("first");
  a.edit("last😀");
  expect(f.session.provider(a.read().uri)).toBeNull();
  await Promise.resolve();
  f.hold(null);
  release();
  await f.session.ready();
  expect(f.notifications.at(-1)).toMatchObject({
    previousVersion: 1,
    version: 3,
    changes: [{ text: "last😀" }],
  });
  expect(f.session.provider(a.read().uri)?.ack.documents).toContainEqual({
    uri: a.read().uri,
    version: 3,
  });
  f.session.dispose();
});

test("foreign acquisition and invalidated generation never expose a usable provider", async () => {
  const foreign = fixture();
  foreign.foreign();
  foreign.buffer("file:///fixture/a.ts");
  expect(foreign.session.ready()).rejects.toThrow();
  expect(foreign.session.provider("file:///fixture/a.ts")).toBeNull();
  foreign.session.dispose();
  const f = fixture();
  const a = f.buffer("file:///fixture/a.ts");
  await f.session.ready();
  f.listeners[0]?.items([
    P.LanguageContextEvent.cases.Invalidated.make({
      context: f.context,
      reason: "connection-lost",
    }),
  ]);
  expect(f.session.provider(a.read().uri)).toBeNull();
  f.session.dispose();
});

test("dynamic actual method gaps replace provider capabilities and save carries the synced revision", async () => {
  const f = fixture();
  const a = f.buffer("file:///fixture/a.ts");
  await f.session.ready();
  f.listeners[0]?.items([
    P.LanguageContextEvent.cases.CapabilitiesChanged.make({
      context: f.context,
      capabilities: { ...f.capabilities, methods: [] },
      registrations: [],
    }),
  ]);
  expect(f.session.provider(a.read().uri)?.capabilities.methods).toEqual([]);
  f.session.saved(
    a.read().uri,
    1,
    P.FileVersion.make({ hash: "a".repeat(64), size: 1, mtimeMs: 1 })
  );
  await f.session.ready();
  expect(f.notifications.at(-1)).toMatchObject({
    version: 1,
    text: "a😀é\r\nunsaved",
  });
  f.session.dispose();
});

test("associations match bounded literal/wildcard paths and preserve last scoped selection", () => {
  expect(matchesAssociation("*.custom", "main.custom")).toBe(true);
  expect(matchesAssociation("a*.ts", "ba.ts")).toBe(false);
  expect(
    associatedLanguage(
      "/root/main.custom",
      [
        { language: "python", extensions: ["custom"] },
        { language: "prisma", filenames: ["main.custom"] },
      ],
      "plain"
    )
  ).toBe("prisma");
});

test("initial and streamed acknowledgment ownership is independently fenced", async () => {
  const initial = fixture();
  initial.foreignAck();
  initial.buffer("file:///fixture/a.ts");
  expect(initial.session.ready()).rejects.toThrow();
  expect(initial.notifications).toHaveLength(0);
  expect(initial.stats().releases).toBe(1);
  initial.session.dispose();
  const f = fixture();
  const a = f.buffer("file:///fixture/a.ts");
  await f.session.ready();
  f.listeners[0]?.items([
    P.LanguageContextEvent.cases.Snapshot.make({
      context: f.context,
      runtime: P.LanguageRuntime.cases.Ready.make({ capabilities: f.capabilities }),
      ack: { context: { ...f.context, clientId: "foreign" }, acceptedSequence: 100, documents: [] },
    }),
  ]);
  expect(f.session.provider(a.read().uri)).toBeNull();
  f.session.dispose();
});

test("configured roles suppress duplicates without inventing provider capabilities", async () => {
  const f = fixture();
  const a = f.buffer("file:///fixture/a.ts");
  await f.session.ready();
  const provider = f.session.provider(a.read().uri);

  if (provider === null) throw new Error("Expected synchronized provider");

  const full: typeof provider = {
    ...provider,
    capabilities: {
      ...provider.capabilities,
      methods: [
        ...provider.capabilities.methods,
        "textDocument/diagnostic",
        "workspace/diagnostic",
        "textDocument/rangeFormatting",
      ],
      workspaceDiagnostics: true,
    },
  };

  const owned = ownedProvider(full, ["completion", "diagnostics", "formatting"]);
  expect(owned.capabilities.methods).toEqual([]);
  expect(owned.capabilities.diagnostics).toBe("none");
  expect(owned.capabilities.workspaceDiagnostics).toBe(false);
  expect(provider.capabilities.methods).toEqual(["textDocument/completion"]);
  expect(ownedProvider(provider, []).capabilities.methods).toEqual(provider.capabilities.methods);
  f.session.dispose();
});

test("disposal during held sync rejects late acknowledgment and releases exactly once", async () => {
  const f = fixture();
  const a = f.buffer("file:///fixture/a.ts");
  await f.session.ready();
  let release = () => {};

  f.hold(
    new Promise<void>((resolve) => {
      release = resolve;
    })
  );
  a.edit("held unsaved😀");
  await Promise.resolve();
  f.session.dispose();
  f.session.dispose();
  f.hold(null);
  release();
  await f.session.ready();
  expect(f.session.provider(a.read().uri)).toBeNull();
  expect(f.stats().releases).toBe(1);
});

test("configuration response preserves order, nested provider sections and checkout scope", () => {
  const f = fixture();

  const settings = P.LanguageEffectiveSettings.make({
    revision: 1,
    formatOnSave: true,
    formatter: P.LanguageFormatterSelection.cases.None.make({}),
    providers: [],
    origins: {},
    settings: {
      serverSettings: {
        typescript: { nested: { enabled: false }, value: 0 },
        foreign: { secret: "other provider" },
      },
    },
  });

  expect(
    configurationItems(f.context, settings, [
      { section: "nested.enabled" },
      { section: "value" },
      { section: "missing" },
      { section: "secret" },
      { scopeUri: "file:///elsewhere/a.ts", section: "value" },
      { scopeUri: "file:///fixture/a.ts", section: "nested" },
    ])
  ).toEqual([false, 0, null, null, null, { enabled: false }]);
});

test("capability registrations cannot resurrect a provider whose runtime is not Ready", async () => {
  const f = fixture();
  const a = f.buffer("file:///fixture/a.ts");
  await f.session.ready();
  f.listeners[0]?.items([
    P.LanguageContextEvent.cases.RuntimeChanged.make({
      context: f.context,
      runtime: P.LanguageRuntime.cases.Starting.make({}),
    }),
  ]);
  f.listeners[0]?.items([
    P.LanguageContextEvent.cases.CapabilitiesChanged.make({
      context: f.context,
      capabilities: f.capabilities,
      registrations: [],
    }),
  ]);
  expect(f.session.provider(a.read().uri)).toBeNull();
  a.edit("new unsaved during startup");
  await Promise.resolve();
  f.listeners[0]?.items([
    P.LanguageContextEvent.cases.RuntimeChanged.make({
      context: f.context,
      runtime: P.LanguageRuntime.cases.Ready.make({ capabilities: f.capabilities }),
    }),
  ]);
  await f.session.ready();
  expect(f.notifications.at(-1)).toMatchObject({
    changes: [{ text: "new unsaved during startup" }],
    version: 2,
  });
  expect(f.session.provider(a.read().uri)).not.toBeNull();
  f.session.dispose();
});

test("edit preparation keeps original request/result and rejects late provider replacement", async () => {
  const f = fixture();

  const fence = P.LanguageRequestFence.make({
    context: f.context,
    requiredSequence: 1,
    documents: [{ uri: "file:///fixture/a.ts", version: 1 }],
  });

  const request = P.LanguageFeatureRequest.make({
    requestId: "request",
    fence,
    method: "textDocument/rename",
    params: { newName: "new" },
    deadline: Date.now() + 5000,
  });

  const edit = P.LanguageWorkspaceEdit.make({ changes: { "file:///fixture/a.ts": [] } });

  const result = P.LanguageFeatureResult.make({
    requestId: request.requestId,
    fence,
    result: edit,
  });

  const input = {
    request,
    result,
    edit,
    origin: "rename" as const,
    label: "Rename",
    signal: new AbortController().signal,
  };

  expect(await prepareLanguageEdit(input, () => true)).toBeNull();
  let release = () => {};

  const held = new Promise<void>((resolve) => {
    release = resolve;
  });

  let current = true;
  let seenRequest: P.LanguageFeatureRequest | null = null;

  const unbind = bindLanguagePreparation(async (value) => {
    seenRequest = value.request;
    await held;

    return P.LanguageEditProposal.make({
      proposalId: "fake-authoritative-proposal",
      fence,
      origin: "rename",
      label: "Rename",
      edit,
      snapshots: [],
      expiresAt: Date.now() + 5000,
    });
  });

  try {
    const pending = prepareLanguageEdit(input, () => current);
    current = false;
    release();
    expect(await pending).toBeNull();
    expect(Schema.decodeUnknownSync(P.LanguageFeatureRequest)(seenRequest)).toEqual(request);
    expect(
      await prepareLanguageEdit(
        { ...input, result: { ...result, requestId: "foreign" } },
        () => true
      )
    ).toBeNull();
    current = true;

    const samePort = async () => {
      await Promise.resolve();

      return P.LanguageEditProposal.make({
        proposalId: "fake-authoritative-proposal",
        fence,
        origin: "rename",
        label: "Rename",
        edit,
        snapshots: [],
        expiresAt: Date.now() + 5000,
      });
    };

    const oldRegistration = bindLanguagePreparation(samePort);
    const obsolete = prepareLanguageEdit(input, () => current);
    oldRegistration();
    const newRegistration = bindLanguagePreparation(samePort);

    try {
      expect(await obsolete).toBeNull();
      const cancelled = new AbortController();
      cancelled.abort();
      expect(
        await prepareLanguageEdit({ ...input, signal: cancelled.signal }, () => current)
      ).toBeNull();
    } finally {
      newRegistration();
    }
  } finally {
    unbind();
  }
});

test("two checkout queues remain isolated and reconnect opens the retained latest draft", async () => {
  const left = fixture("/left");
  const right = fixture("/right");
  const a = left.buffer("file:///left/a.ts");
  const b = right.buffer("file:///right/a.ts");
  await Promise.all([left.session.ready(), right.session.ready()]);
  a.edit("left unsaved😀");
  await Promise.resolve();
  await left.session.ready();
  expect(right.notifications).toHaveLength(1);
  expect(right.session.provider(b.read().uri)).not.toBeNull();
  left.session.dispose();

  const replacement = fixture("/left", 2);

  const detach = replacement.session.attach({
    read: a.read,
    language: () => "typescript",
    changed: () => {},
  });

  await replacement.session.ready();
  expect(replacement.notifications[0]).toMatchObject({ version: 2, text: "left unsaved😀" });
  expect(replacement.session.provider(a.read().uri)?.context.generation).toBe(2);
  expect(left.session.provider(a.read().uri)).toBeNull();
  detach();
  await replacement.session.ready();
  right.session.dispose();
});

test("renderer provider fixture enforces actual unsaved acknowledgment before requests", async () => {
  const f = fixture();
  const service = new EditorProviderFixture(f.context.hostId);

  const session = new EditorLanguageSession(
    service.api,
    "fake",
    f.session.acquisition,
    f.context.hostId,
    () => {}
  );

  const state = EditorState.create({ doc: "unsaved😀" });
  const uri = "file:///fixture/a.ts";

  const detach = session.attach({
    read: () => ({ uri, version: 1, doc: state.doc }),
    language: () => "typescript",
    changed: () => {},
  });

  await session.ready();
  const provider = session.provider(uri);

  if (provider === null) throw new Error("Missing fixture provider");

  const request = P.LanguageFeatureRequest.make({
    requestId: "fixture-request",
    method: "textDocument/hover",
    params: { textDocument: { uri } },
    deadline: Date.now() + 5000,
    fence: { context: provider.context, requiredSequence: 1, documents: [{ uri, version: 1 }] },
  });

  const answer = await service.api.request("languages.request", { hostKey: "fake", ...request });
  expect(answer.ok).toBe(true);
  expect(service.contexts.get(provider.context.contextId)?.documents.get(uri)?.text).toBe(
    "unsaved😀"
  );
  expect(
    service.api.request("languages.request", {
      hostKey: "fake",
      ...request,
      fence: { ...request.fence, documents: [{ uri, version: 2 }] },
    })
  ).rejects.toThrow();
  detach();
  await session.ready();
  expect(service.releases).toBe(1);
});

test("server edits require owned request context and every current retained draft revision", async () => {
  const f = fixture();
  const a = f.buffer("file:///fixture/a.ts");
  await f.session.ready();
  const provider = f.session.provider(a.read().uri);

  if (provider === null) throw new Error("Missing synchronized provider");

  const proposal = P.LanguageEditProposal.make({
    proposalId: "server-fixture",
    origin: "server-apply-edit",
    label: "Server fixture",
    edit: { changes: {} },
    snapshots: [],
    expiresAt: Date.now() + 5000,
    fence: {
      context: provider.context,
      requiredSequence: 1,
      documents: [{ uri: a.read().uri, version: 1 }],
    },
  });

  expect(serverEditCurrent(f.context, proposal, [provider], [a.read()])).toBe(true);
  expect(
    serverEditCurrent(
      f.context,
      { ...proposal, edit: { documentChanges: [{ kind: "delete", uri: a.read().uri }] } },
      [provider],
      [a.read()]
    )
  ).toBe(false);
  expect(
    serverEditCurrent({ ...f.context, clientId: "foreign" }, proposal, [provider], [a.read()])
  ).toBe(false);
  expect(
    serverEditCurrent(f.context, { ...proposal, expiresAt: Date.now() - 1 }, [provider], [a.read()])
  ).toBe(false);
  a.edit("new unsaved text");
  expect(serverEditCurrent(f.context, proposal, [provider], [a.read()])).toBe(false);
  f.session.dispose();
});

test("retained action intent cannot be revived by a newer synchronized draft", async () => {
  const f = fixture();
  const a = f.buffer("file:///fixture/a.ts");
  await f.session.ready();
  const provider = f.session.provider(a.read().uri);

  if (provider === null) throw new Error("Missing synchronized provider");

  const fence = P.LanguageRequestFence.make({
    context: provider.context,
    requiredSequence: provider.ack.acceptedSequence,
    documents: [{ uri: a.read().uri, version: a.read().version }],
  });

  const request = P.LanguageFeatureRequest.make({
    requestId: "retained-action",
    fence,
    method: "textDocument/codeAction",
    params: {},
    deadline: Date.now() + 5000,
  });

  const result = P.LanguageFeatureResult.make({ requestId: request.requestId, fence, result: [] });

  expect(featureIntentCurrent(request, result, provider, a.read())).toBe(true);
  expect(
    featureIntentCurrent(request, { ...result, requestId: "foreign" }, provider, a.read())
  ).toBe(false);
  a.edit("new synchronized draft");
  await f.session.ready();
  const replacement = f.session.provider(a.read().uri);

  if (replacement === null) throw new Error("Missing replacement acknowledgment");
  expect(featureIntentCurrent(request, result, replacement, a.read())).toBe(false);
  f.session.dispose();
});

test("detach during held Open closes that document before same-URI reattachment", async () => {
  const f = fixture();
  const retained = f.buffer("file:///fixture/retained.ts");
  await f.session.ready();
  let release = () => {};

  f.hold(
    new Promise<void>((resolve) => {
      release = resolve;
    })
  );
  const old = f.buffer("file:///fixture/a.ts");
  await Promise.resolve();
  await Promise.resolve();
  old.detach();
  const replacement = f.buffer(old.read().uri);
  f.hold(null);
  release();
  await f.session.ready();
  expect(
    f.notifications.filter((value) => value.uri === old.read().uri).map((value) => value._tag)
  ).toEqual(["Open", "Close", "Open"]);
  expect(f.session.provider(replacement.read().uri)).not.toBeNull();
  expect(f.session.provider(retained.read().uri)).not.toBeNull();
  f.session.dispose();
});

test("a stopped provider receives initial Open demand before Ready capabilities arrive", async () => {
  const f = fixture("/fixture", 1, true);
  const a = f.buffer("file:///fixture/a.ts");
  await f.session.ready();
  expect(f.notifications.map((notification) => notification._tag)).toEqual(["Open"]);
  expect(f.session.provider(a.read().uri)).toBeNull();
  f.listeners[0]?.items([
    P.LanguageContextEvent.cases.RuntimeChanged.make({
      context: f.context,
      runtime: P.LanguageRuntime.cases.Ready.make({ capabilities: f.capabilities }),
    }),
  ]);
  await f.session.ready();
  expect(f.session.provider(a.read().uri)).not.toBeNull();
  expect(f.notifications.map((notification) => notification._tag)).toEqual(["Open"]);
  f.session.dispose();
});
