import { expect, test } from "bun:test";
import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import * as P from "@polaris/protocol";
import { Predicate, Schema } from "effect";
import type { LanguageApi, SubscriptionListener } from "../../../../shared/api.ts";
import { LanguageRequestOutputs, LanguageSubscriptionItems } from "../../../../shared/languages.ts";
import { completionSource, cmSnippet } from "./codemirror.ts";
import { LanguageDiagnosticFeed, cmDiagnostics } from "./diagnostics.ts";
import { LanguageFeatures } from "./features.ts";
import { offsetAt, positionAt } from "./position.ts";
import { providerFence } from "./requests.ts";
import {
  bufferText,
  documentLanguageId,
  type LanguageBuffer,
  type LanguageProvider,
} from "./types.ts";

const uri = "file:///fixture/a.ts";

const methods = Schema.decodeUnknownSync(P.LanguageFeatureMethod)("textDocument/completion");

const provider = (
  id: string,
  encoding: typeof P.LanguagePositionEncoding.Type = "utf-16"
): LanguageProvider => {
  const context = P.LanguageContextIdentity.make({
    hostId: P.HostId.make("fake"),
    clientId: "client",
    contextId: id,
    checkout: P.LanguageCheckout.cases.Workspace.make({
      workspaceId: P.WorkspaceId.make("fake"),
      path: "/fixture",
    }),
    projectRoot: "/fixture",
    providerId: id,
    configurationFingerprint: "a".repeat(64),
    generation: 1,
  });

  return {
    hostKey: "fake",
    context,
    capabilities: P.LanguageProviderCapabilities.make({
      positionEncoding: encoding,
      synchronization: "full",
      openClose: true,
      save: false,
      saveIncludeText: false,
      methods: [
        methods,
        "textDocument/hover",
        "textDocument/signatureHelp",
        "textDocument/definition",
        "textDocument/references",
        "textDocument/documentSymbol",
        "workspace/symbol",
        "textDocument/rename",
        "textDocument/codeAction",
        "completionItem/resolve",
        "codeAction/resolve",
        "workspace/executeCommand",
        "textDocument/formatting",
      ],
      completionResolve: true,
      actionResolve: true,
      executeCommands: ["safe"],
      diagnostics: "push-and-pull",
      workspaceDiagnostics: false,
    }),
    ack: P.LanguageSyncAck.make({ context, acceptedSequence: 1, documents: [{ uri, version: 1 }] }),
  };
};

const fixture = (timeoutMs = 100, maxPending = 32) => {
  let state = EditorState.create({ doc: "a😀é\nitem" });
  let buffer: LanguageBuffer = { uri, version: 1, doc: state.doc };
  let providers = [provider("first", "utf-8"), provider("second", "utf-32")];

  const pending: {
    request: P.LanguageFeatureRequest;
    resolve: (value: P.LanguageFeatureResult) => void;
  }[] = [];

  const cancelled: string[] = [];

  const formats: {
    input: P.LanguageFormatPreflight;
    resolve: (value: P.LanguageFormatOutcome) => void;
  }[] = [];

  const listeners: SubscriptionListener<P.LanguageContextEvent>[] = [];
  let stopped = 0;

  const api: LanguageApi = {
    request: async (method, input) => {
      let value:
        | typeof P.LanguageJson.Type
        | P.LanguageFeatureResult
        | P.LanguageFormatOutcome
        | undefined;

      if (method === "languages.request") {
        const request = Schema.decodeUnknownSync(P.LanguageFeatureRequest)(input);
        value = await new Promise<P.LanguageFeatureResult>((resolve) =>
          pending.push({ request, resolve })
        );
      } else if (method === "languages.format") {
        const format = Schema.decodeUnknownSync(P.LanguageFormatPreflight)(input);
        value = await new Promise<P.LanguageFormatOutcome>((resolve) =>
          formats.push({ input: format, resolve })
        );
      } else if (method === "languages.cancel")
        cancelled.push(
          Schema.decodeUnknownSync(P.CancelLanguageRequest.payloadSchema)(input).requestId
        );
      else throw new Error("Unexpected fake request");

      return {
        ok: true,
        value: Schema.decodeUnknownSync(LanguageRequestOutputs[method])(value),
      };
    },
    subscribe: (kind, _input, listener) => {
      if (kind !== "languages.context.watch") throw new Error("Unexpected fake feed");
      listeners.push({
        items: (events) =>
          listener.items(
            events.map((event) => {
              return Schema.decodeUnknownSync(LanguageSubscriptionItems[kind])(event);
            })
          ),
      });

      return () => {
        stopped++;
      };
    },
  };

  const features = new LanguageFeatures({
    api,
    buffer: () => buffer,
    providers: () => providers,
    timeoutMs,
    maxPending,
  });

  const reply = (
    index: number,
    result: typeof P.LanguageJson.Type,
    fence?: P.LanguageRequestFence
  ) => {
    const entry = pending[index];

    if (!entry) throw new Error("No fake pending call");
    entry.resolve(
      P.LanguageFeatureResult.make({
        requestId: entry.request.requestId,
        fence: fence ?? entry.request.fence,
        result,
      })
    );
  };

  return {
    features,
    pending,
    cancelled,
    formats,
    listeners,
    reply,
    get stopped() {
      return stopped;
    },
    get state() {
      return state;
    },
    get buffer() {
      return buffer;
    },
    get providers() {
      return providers;
    },
    setLineSeparator() {
      buffer = { ...buffer, lineSeparator: "\r\n" };
    },
    setProviders(next: LanguageProvider[]) {
      providers = next;
    },
    change() {
      state = state.update({ changes: { from: state.doc.length, insert: "!" } }).state;
      buffer = { ...buffer, version: buffer.version + 1, doc: state.doc };
    },
  };
};

test("position conversion roundtrips Unicode and rejects split/out-of-range positions", () => {
  const doc = EditorState.create({ doc: "a😀é\nz" }).doc;

  for (const encoding of ["utf-8", "utf-16", "utf-32"] as const) {
    for (const offset of [0, 1, 3, 4, 5, 6])
      expect(offsetAt(doc, positionAt(doc, offset, encoding), encoding)).toBe(offset);
    expect(() => positionAt(doc, 2, encoding)).toThrow();
  }

  expect(positionAt(doc, 4, "utf-8")).toEqual({ line: 0, character: 7 });
  expect(() => offsetAt(doc, { line: 0, character: 2 }, "utf-8")).toThrow();
  expect(() => offsetAt(doc, { line: 1, character: 2 }, "utf-16")).toThrow();
  expect(documentLanguageId("tsx")).toBe("typescriptreact");
});

test("aggregate in provider order with actual capabilities and negotiated encoding", async () => {
  const f = fixture();
  const task = f.features.completion(4);
  expect(f.pending[0]?.request.params.position).toEqual({ line: 0, character: 7 });
  expect(f.pending[1]?.request.params.position).toEqual({ line: 0, character: 3 });
  f.reply(1, [{ label: "second" }]);
  f.reply(0, { isIncomplete: true, items: [{ label: "first" }] });
  expect((await task).map((entry) => entry.provider.context.providerId)).toEqual([
    "first",
    "second",
  ]);
  f.setProviders(
    f.providers.map((p) => ({ ...p, capabilities: { ...p.capabilities, methods: [] } }))
  );
  expect(await f.features.hover(0)).toEqual([]);
  expect(f.pending).toHaveLength(2);
  f.features.dispose();
});

test("out-of-order replacement cancels old requests and rejects late answers", async () => {
  const f = fixture();
  const old = f.features.hover(0);
  const next = f.features.hover(1);
  expect(await old).toEqual([]);
  expect(f.cancelled).toHaveLength(2);
  f.reply(0, { contents: "old" });
  f.reply(1, { contents: "old" });
  f.reply(2, { contents: "new" });
  f.reply(3, { contents: "new" });
  expect(await next).toHaveLength(2);
  f.features.dispose();
});

test("buffer change, generation, echoed fence, malformed payload and disposal fences", async () => {
  const f = fixture();
  const changed = f.features.hover(0);
  f.change();
  f.reply(0, { contents: "old" });
  f.reply(1, { contents: "old" });
  expect(await changed).toEqual([]);
  const g = fixture();
  const generation = g.features.hover(0);
  g.setProviders(
    g.providers.map((p) => {
      const context = { ...p.context, generation: 2 };

      return { ...p, context, ack: { ...p.ack, context } };
    })
  );
  g.reply(0, { contents: "old" });
  g.reply(1, { contents: "old" });
  expect(await generation).toEqual([]);
  const h = fixture();
  const bad = h.features.hover(0);
  h.reply(0, { contents: "wrong" }, { ...h.pending[0]!.request.fence, requiredSequence: 0 });
  h.reply(1, { contents: 12 });
  expect(await bad).toEqual([]);
  const disposed = h.features.signature(0);
  h.features.dispose();
  expect(await disposed).toEqual([]);
  f.features.dispose();
  g.features.dispose();
});

test("deadline settles nonresponsive transport and explicit cancellation", async () => {
  const f = fixture(5);
  expect(await f.features.hover(0)).toEqual([]);
  expect(f.cancelled).toHaveLength(2);
  const controller = new AbortController();
  const task = f.features.signature(0, controller.signal);
  controller.abort();
  expect(await task).toEqual([]);
  expect(f.cancelled).toHaveLength(4);
  f.features.dispose();
});

test("resolve/execute only call originating provider and permitted command", async () => {
  const f = fixture();
  expect(await f.features.execute(f.providers[0]!, "unsafe", [])).toEqual([]);
  const task = f.features.resolve(f.providers[1]!, "completionItem/resolve", { label: "x" });
  expect(f.pending).toHaveLength(1);
  expect(f.pending[0]?.request.fence.context.providerId).toBe("second");
  f.reply(0, { label: "resolved" });
  expect(await task).toHaveLength(1);
  f.features.dispose();
});

test("CodeMirror CompletionContext source retains provider edits and returns bounded options", async () => {
  const f = fixture();
  const proposed: string[] = [];

  const source = completionSource(f.features, {
    propose: (proposal) => proposed.push(proposal.item.label),
  });

  const task = source(new CompletionContext(f.state, 8, true));
  f.reply(0, [
    {
      label: "itemA",
      insertText: "newItem",
      textEdit: {
        range: { start: { line: 1, character: 0 }, end: { line: 1, character: 4 } },
        newText: "newItem",
      },
    },
  ]);
  f.reply(1, [{ label: "itemB" }]);
  const result = await task;
  expect(result?.options).toHaveLength(2);
  expect(result?.from).toBe(5);
  expect(cmSnippet("call(${1:value}, $2)$0")).toBe("call(${1:value}, ${2:})${0:}");
  expect(cmSnippet("${1|one,two|}")).toBeNull();
  expect(proposed).toEqual([]);
  f.features.dispose();
});

const diagnostic = (p: LanguageProvider, version: number | null = 1): P.LanguageDiagnostics =>
  P.LanguageDiagnostics.make({
    context: p.context,
    providerId: p.context.providerId,
    generation: 1,
    uri,
    version,
    freshness: version === null ? "unversioned" : "versioned",
    kind: "full",
    resultId: "one",
    previousResultId: null,
    items: [
      {
        range: {
          start: { line: 0, character: 1 },
          end: { line: 0, character: p.capabilities.positionEncoding === "utf-8" ? 5 : 2 },
        },
        severity: 2,
        source: "fake",
        code: null,
        message: "message",
        tags: [],
      },
    ],
    truncated: false,
  });

test("diagnostic provider replacement, unchanged result IDs and conservative freshness", () => {
  const f = fixture();
  const feed = new LanguageDiagnosticFeed(f.features.requests, () => {});
  feed.refresh();
  feed.receive(f.providers[0]!, diagnostic(f.providers[0]!));
  feed.receive(f.providers[1]!, diagnostic(f.providers[1]!, null));
  expect(feed.values()).toHaveLength(2);
  expect(cmDiagnostics(f.features.requests, feed.values())).toHaveLength(1);
  const current = diagnostic(f.providers[0]!);
  feed.receive(f.providers[0]!, {
    ...current,
    kind: "unchanged",
    items: [],
    resultId: "two",
    previousResultId: "wrong",
  });
  expect(feed.values()[0]?.diagnostics.resultId).toBe("one");
  feed.receive(f.providers[0]!, {
    ...current,
    kind: "unchanged",
    items: [],
    resultId: "two",
    previousResultId: "one",
  });
  expect(feed.values()[0]?.diagnostics.items).toHaveLength(1);
  f.change();
  expect(cmDiagnostics(f.features.requests, feed.values())).toEqual([]);
  feed.dispose();
  expect(f.stopped).toBe(2);
  f.listeners[0]?.items([P.LanguageContextEvent.cases.Diagnostics.make({ diagnostics: current })]);
  expect(feed.values()).toEqual([]);
  f.features.dispose();
});

test("format preflight rejects wrong snapshot before IPC", async () => {
  const f = fixture();
  const p = f.providers[0]!;

  const result = await f.features.format(
    p,
    P.LanguageFormatPreflight.make({
      requestId: "format",
      fence: providerFence(p, f.buffer),
      document: { uri, version: 1 },
      snapshot: "wrong",
      expectedDiskVersion: { hash: "a".repeat(64), size: 1, mtimeMs: 0 },
      formatter: P.LanguageFormatterSelection.cases.Provider.make({
        providerId: p.context.providerId,
      }),
      options: {},
      reason: "manual",
      deadline: Date.now() + 100,
    })
  );

  expect(result).toEqual(
    P.LanguageFormatOutcome.cases.Failed.make({
      requestId: "format",
      reason: "stale",
      message: "Language formatting: stale",
    })
  );
  expect(f.pending).toEqual([]);
  f.features.dispose();
});

test("timed-out transport retains bounded capacity until actual settlement", async () => {
  const f = fixture(5, 2);
  expect(await f.features.hover(0)).toEqual([]);
  expect(await f.features.signature(0)).toEqual([]);
  expect(f.pending).toHaveLength(2);
  f.reply(0, null);
  f.reply(1, null);
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  const next = f.features.signature(0);
  expect(f.pending).toHaveLength(4);
  f.reply(2, {
    signatures: [{ label: "fn(x)", parameters: [{ label: [3, 4] }] }],
    activeSignature: 0,
  });
  f.reply(3, null);
  expect(await next).toHaveLength(1);
  f.features.dispose();
});

test("navigation, references, symbols, actions and pull reports decode method payloads", async () => {
  const f = fixture();

  const location = {
    uri: "file:///fixture/closed.ts",
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
  };

  const nav = f.features.navigation("textDocument/definition", 0);
  f.reply(0, location);
  f.reply(1, [
    { targetUri: location.uri, targetRange: location.range, targetSelectionRange: location.range },
  ]);
  expect(await nav).toHaveLength(2);
  const refs = f.features.references(0, false);
  expect(f.pending[2]?.request.params.context).toEqual({ includeDeclaration: false });
  f.reply(2, [location]);
  f.reply(3, []);
  expect(await refs).toHaveLength(2);
  const symbols = f.features.documentSymbols();
  f.reply(4, [
    { name: "fn", kind: 12, range: location.range, selectionRange: location.range, children: [] },
  ]);
  f.reply(5, [{ name: "fn", kind: 12, location }]);
  expect(await symbols).toHaveLength(2);
  const workspace = f.features.workspaceSymbols("fn");
  f.reply(6, [{ name: "fn", kind: 12, location: { uri: location.uri }, data: { token: 1 } }]);
  f.reply(7, null);
  expect(await workspace).toHaveLength(1);
  const actions = f.features.codeActions(0, 1);
  f.reply(8, [
    {
      title: "Draft edit",
      edit: { changes: { [location.uri]: [{ range: location.range, newText: "new" }] } },
    },
  ]);
  f.reply(9, null);
  expect(await actions).toHaveLength(1);
  f.setProviders(
    f.providers.map((p) => ({
      ...p,
      capabilities: {
        ...p.capabilities,
        methods: [...p.capabilities.methods, "textDocument/diagnostic"],
      },
    }))
  );
  const pull = f.features.pullDiagnostics(new Map([["first", "old"]]));
  expect(f.pending[10]?.request.params.previousResultId).toBe("old");
  f.reply(10, {
    kind: "full",
    resultId: "new",
    items: [{ range: location.range, message: "hello" }],
  });
  f.reply(11, { kind: "unchanged", resultId: "old" });
  expect(await pull).toHaveLength(2);
  f.features.dispose();
});

const preflight = (f: ReturnType<typeof fixture>): P.LanguageFormatPreflight =>
  P.LanguageFormatPreflight.make({
    requestId: "format",
    fence: providerFence(f.providers[0]!, f.buffer),
    document: { uri, version: f.buffer.version },
    snapshot: bufferText(f.buffer),
    expectedDiskVersion: { hash: "a".repeat(64), size: 1, mtimeMs: 0 },
    formatter: P.LanguageFormatterSelection.cases.Provider.make({ providerId: "first" }),
    options: {},
    reason: "manual",
    deadline: Date.now() + 100,
  });

test("format is awaitable, stale-safe and cancelled by disposal without applying edits", async () => {
  const f = fixture();
  const input = preflight(f);
  const task = f.features.format(f.providers[0]!, input);
  expect(f.formats).toHaveLength(1);
  f.formats[0]!.resolve(
    P.LanguageFormatOutcome.cases.Formatted.make({
      requestId: input.requestId,
      fence: input.fence,
      document: input.document,
      edits: [],
    })
  );
  expect(await task).toEqual(
    P.LanguageFormatOutcome.cases.Formatted.make({
      requestId: input.requestId,
      fence: input.fence,
      document: input.document,
      edits: [],
    })
  );
  const stale = f.features.format(f.providers[0]!, input);
  f.change();
  f.formats[1]!.resolve(
    P.LanguageFormatOutcome.cases.Formatted.make({
      requestId: input.requestId,
      fence: input.fence,
      document: input.document,
      edits: [],
    })
  );
  expect(await stale).toMatchObject({ reason: "stale" });
  const g = fixture();
  const cancelled = g.features.format(g.providers[0]!, preflight(g));
  g.features.dispose();
  expect(await cancelled).toMatchObject({ reason: "cancelled" });
  expect(g.cancelled).toEqual(["format"]);
  f.features.dispose();
});

test("completion applies a single atomic local edit transaction with additional edits", async () => {
  const f = fixture();
  let state = f.state;

  const source = completionSource(f.features, {
    propose: () => {
      throw new Error("Unexpected proposal");
    },
  });

  const task = source(new CompletionContext(state, 8, true));
  f.reply(0, [
    {
      label: "replacement",
      textEdit: {
        range: { start: { line: 1, character: 0 }, end: { line: 1, character: 4 } },
        newText: "replacement",
      },
      additionalTextEdits: [
        {
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
          newText: "b",
        },
      ],
    },
  ]);
  f.reply(1, []);
  const completion = (await task)!.options[0]!;

  const fake = {
    get state() {
      return state;
    },
    dispatch(spec: Parameters<EditorView["dispatch"]>[0]) {
      state = state.update(spec).state;
    },
  };

  // SAFETY: this plain completion's public apply callback only accesses state and dispatch.
  const view = fake as EditorView;

  if (!Predicate.isFunction(completion.apply)) throw new Error("No completion apply");
  completion.apply(view, completion, 5, 8);
  expect(state.doc.toString()).toBe("b😀é\nreplacement");
  f.features.dispose();
});

test("diagnostic invalidation cancels work and stale subscription generations cannot resurrect sets", async () => {
  const f = fixture();
  const feed = new LanguageDiagnosticFeed(f.features.requests, () => {});
  feed.refresh();
  const task = f.features.hover(0);
  f.listeners[0]!.items([
    P.LanguageContextEvent.cases.Invalidated.make({
      context: f.providers[0]!.context,
      reason: "connection-lost",
    }),
  ]);
  expect(await task).toEqual([]);
  const old = f.listeners[0]!;
  feed.refresh();
  old.items([
    P.LanguageContextEvent.cases.Diagnostics.make({ diagnostics: diagnostic(f.providers[0]!) }),
  ]);
  expect(feed.values()).toEqual([]);
  feed.dispose();
  f.features.dispose();
});

test("early provider answer is revalidated after the remaining providers settle", async () => {
  const f = fixture();
  const task = f.features.hover(0);
  f.reply(0, { contents: "early" });
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  f.change();
  f.reply(1, { contents: "late" });
  expect(await task).toEqual([]);
  f.features.dispose();
});

test("completion list defaults retain edits/snippets/data and provider trigger characters", async () => {
  const f = fixture();
  f.setProviders(f.providers.map((p) => ({ ...p, completionTriggerCharacters: ["é"] })));

  const task = completionSource(f.features, { propose: () => {} })(
    new CompletionContext(f.state, 4, false)
  );

  expect(f.pending[0]?.request.params.context).toEqual({ triggerKind: 2, triggerCharacter: "é" });
  f.reply(0, {
    isIncomplete: false,
    itemDefaults: {
      insertTextFormat: 2,
      data: { source: "defaults" },
      editRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 7 } },
    },
    items: [{ label: "completion", textEditText: "${1:replacement}" }],
  });
  f.reply(1, null);
  expect((await task)?.options).toHaveLength(1);
  f.features.dispose();
});

test("formatter preserves the captured CRLF serialization boundary", async () => {
  const f = fixture();
  f.setLineSeparator();
  const input = preflight(f);
  expect(input.snapshot).toBe("a😀é\r\nitem");
  const task = f.features.format(f.providers[0]!, input);
  f.formats[0]!.resolve(
    P.LanguageFormatOutcome.cases.Formatted.make({
      requestId: input.requestId,
      fence: input.fence,
      document: input.document,
      edits: [],
    })
  );
  expect(await task).toEqual(
    P.LanguageFormatOutcome.cases.Formatted.make({
      requestId: input.requestId,
      fence: input.fence,
      document: input.document,
      edits: [],
    })
  );
  f.features.dispose();
});

test("invalid limit configuration cannot disable bounded admission", () => {
  expect(() => fixture(5, Number.NaN)).toThrow();
  expect(() => fixture(Number.POSITIVE_INFINITY)).toThrow();
});
