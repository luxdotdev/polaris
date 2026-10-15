/** A LanguageFeatures over a fake language bridge with two providers, for the adapter tests. */
import { EditorState } from "@codemirror/state";
import * as P from "@polaris/protocol";
import { Schema } from "effect";
import type { LanguageApi, SubscriptionListener } from "../../../../shared/api.ts";
import { LanguageRequestOutputs, LanguageSubscriptionItems } from "../../../../shared/languages.ts";
import { LanguageFeatures } from "./features.ts";
import type { LanguageBuffer, LanguageProvider } from "./types.ts";

export const uri = "file:///fixture/a.ts";

const methods = Schema.decodeUnknownSync(P.LanguageFeatureMethod)("textDocument/completion");

export const provider = (
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

export const fixture = (timeoutMs = 100, maxPending = 32, text = "a😀é\nitem") => {
  let state = EditorState.create({ doc: text });
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
