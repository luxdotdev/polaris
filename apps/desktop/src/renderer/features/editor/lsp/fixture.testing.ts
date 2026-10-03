import * as P from "@polaris/protocol";
import { Predicate, Schema } from "effect";
import type { LanguageApi } from "../../../../shared/api.ts";
import {
  LanguageRequestInputs,
  LanguageRequestOutputs,
  LanguageSubscriptionItems,
  LanguageSubscriptionInputs,
} from "../../../../shared/languages.ts";

interface ContextFixture {
  readonly context: P.LanguageContextIdentity;
  ack: P.LanguageSyncAck;
  readonly documents: Map<string, { text: string; version: number }>;
}

/** Scripted providers for actual Editor fixture views; this supplies no production Host evidence. */
export class EditorProviderFixture {
  readonly contexts = new Map<string, ContextFixture>();
  readonly notifications: P.LanguageDocumentNotification[] = [];
  readonly requests: P.LanguageFeatureRequest[] = [];
  readonly subscribers = new Map<string, Set<(event: P.LanguageContextEvent) => void>>();
  readonly capabilities = P.LanguageProviderCapabilities.make({
    positionEncoding: "utf-16",
    synchronization: "incremental",
    openClose: true,
    save: true,
    saveIncludeText: true,
    methods: [
      "textDocument/completion",
      "textDocument/hover",
      "textDocument/signatureHelp",
      "textDocument/definition",
      "textDocument/references",
      "textDocument/documentSymbol",
      "workspace/symbol",
      "textDocument/codeAction",
      "textDocument/rename",
    ],
    completionResolve: false,
    actionResolve: false,
    executeCommands: [],
    diagnostics: "push",
    workspaceDiagnostics: false,
  });
  generation = 1;
  releases = 0;
  hold: Promise<void> | null = null;

  constructor(readonly hostId: P.HostId) {}

  readonly api: LanguageApi = {
    request: async (method, raw) => {
      const input = Schema.encodeUnknownSync(LanguageRequestInputs[method])(
        Schema.decodeUnknownSync(LanguageRequestInputs[method])(raw)
      );

      let value: typeof Schema.Json.Type | undefined;

      if (method === "languages.settings.get") {
        const settings = Schema.decodeUnknownSync(LanguageRequestInputs["languages.settings.get"])(
          input
        );

        value = { scope: settings.scope, revision: 0, settings: { formatOnSave: false } };
      } else if (method === "languages.discover") {
        const discovery = Schema.decodeUnknownSync(LanguageRequestInputs["languages.discover"])(
          input
        );

        value = {
          checkout: discovery.checkout,
          projectRoot: discovery.checkout.path,
          providers: [
            {
              providerId: "fixture",
              preflight: P.LanguagePreflight.cases.Eligible.make({ artifactId: null }),
              launch: null,
              prerequisites: [],
            },
          ],
          effectiveSettings: discovery.settings,
          trust: P.LanguageTrust.make({
            scope: P.LanguageTrustScope.cases.Workspace.make({
              hostId: this.hostId,
              workspaceId: discovery.checkout.workspaceId,
            }),
            revision: 1,
            trusted: true,
          }),
        };
      } else if (method === "languages.catalog")
        value = { revision: 1, releaseDate: "fixture", tools: [], integrations: [] };
      else if (method === "languages.context.acquire") {
        const acquire = Schema.decodeUnknownSync(
          LanguageRequestInputs["languages.context.acquire"]
        )(input);

        const context = P.LanguageContextIdentity.make({
          hostId: this.hostId,
          clientId: acquire.clientId,
          contextId: acquire.contextId,
          providerId: acquire.providerId,
          checkout: acquire.checkout,
          projectRoot: acquire.checkout.path,
          configurationFingerprint: "a".repeat(64),
          generation: this.generation,
        });

        const ack = P.LanguageSyncAck.make({ context, acceptedSequence: 0, documents: [] });
        this.contexts.set(context.contextId, { context, ack, documents: new Map() });
        value = {
          context,
          ack,
          runtime: P.LanguageRuntime.cases.Ready.make({ capabilities: this.capabilities }),
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
      } else if (method === "languages.document.sync") value = this.sync(input);
      else if (method === "languages.request")
        value = Schema.encodeSync(P.LanguageFeatureResult)(await this.feature(input));
      else if (method === "languages.context.release") {
        const release = Schema.decodeUnknownSync(
          LanguageRequestInputs["languages.context.release"]
        )(input);

        this.contexts.delete(release.context.contextId);
        this.releases++;
      } else if (method !== "languages.cancel" && method !== "languages.server.respond")
        return {
          ok: false,
          error: { code: "unavailable", message: "Unsupported scripted fixture method." },
        };

      return { ok: true, value: Schema.decodeUnknownSync(LanguageRequestOutputs[method])(value) };
    },
    subscribe: (kind, raw, listener) => {
      if (kind !== "languages.context.watch") return () => {};

      const input = Schema.decodeUnknownSync(LanguageSubscriptionInputs["languages.context.watch"])(
        raw
      );

      const events = this.subscribers.get(input.context.contextId) ?? new Set();

      const deliver = (event: P.LanguageContextEvent) =>
        listener.items([Schema.decodeUnknownSync(LanguageSubscriptionItems[kind])(event)]);

      events.add(deliver);
      this.subscribers.set(input.context.contextId, events);

      return () => {
        events.delete(deliver);

        if (events.size === 0) this.subscribers.delete(input.context.contextId);
      };
    },
  };

  diagnose(uri: string) {
    for (const fixture of this.contexts.values()) {
      const document = fixture.documents.get(uri);

      if (document === undefined) continue;

      const diagnostics = P.LanguageDiagnostics.make({
        context: fixture.context,
        uri,
        providerId: fixture.context.providerId,
        generation: fixture.context.generation,
        version: document.version,
        freshness: "versioned",
        kind: "full",
        resultId: null,
        previousResultId: null,
        truncated: false,
        items: [
          {
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
            severity: 2,
            code: null,
            source: "scripted",
            message: "Fixture diagnostic",
            tags: [],
          },
        ],
      });

      const event = P.LanguageContextEvent.cases.Diagnostics.make({ diagnostics });

      for (const deliver of this.subscribers.get(fixture.context.contextId) ?? []) deliver(event);
    }
  }

  private sync(raw: typeof Schema.Json.Type) {
    const input = Schema.decodeUnknownSync(P.LanguageSyncInput)(raw);
    const fixture = this.contexts.get(input.context.contextId);

    if (fixture === undefined) throw new Error("Unknown fixture context");
    const document = input.notification;
    const previous = fixture.documents.get(document.uri);

    if (Predicate.isTagged(document, "Open"))
      fixture.documents.set(document.uri, { text: document.text, version: document.version });
    else if (Predicate.isTagged(document, "Change")) {
      if (previous?.version !== document.previousVersion)
        throw new Error("Out-of-order fixture sync");
      const text = document.changes[0]?.text;

      if (
        text === undefined ||
        document.changes.length !== 1 ||
        document.changes[0]?.range !== undefined
      )
        throw new Error("Fixture expects full snapshot changes");
      fixture.documents.set(document.uri, { text, version: document.version });
    } else if (Predicate.isTagged(document, "Close")) fixture.documents.delete(document.uri);
    this.notifications.push(document);
    fixture.ack = P.LanguageSyncAck.make({
      context: fixture.context,
      acceptedSequence: input.sequence,
      documents: [...fixture.documents].map(([uri, value]) => ({ uri, version: value.version })),
    });

    return fixture.ack;
  }

  private async feature(raw: typeof Schema.Json.Type) {
    const input = Schema.decodeUnknownSync(LanguageRequestInputs["languages.request"])(raw);
    this.requests.push(input);
    const fixture = this.contexts.get(input.fence.context.contextId);

    if (fixture === undefined || !P.languageFenceSatisfied(input.fence, fixture.ack))
      throw new Error("Fixture request precedes unsaved synchronization");
    const uri = input.fence.documents[0]?.uri;

    if (uri === undefined) throw new Error("Fixture requires a document");
    const held = this.hold;

    if (held !== null) await held;

    return P.LanguageFeatureResult.make({
      requestId: input.requestId,
      fence: input.fence,
      result: featureResult(input.method, uri),
    });
  }
}

const featureResult = (method: string, uri: string): typeof Schema.Json.Type => {
  const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } };

  switch (method) {
    case "textDocument/completion":
      return [{ label: "fixtureCompletion", insertText: "fixtureCompletion" }];
    case "textDocument/hover":
      return { contents: { kind: "plaintext", value: "Unsaved fixture hover" } };
    case "textDocument/signatureHelp":
      return {
        signatures: [{ label: "fixture(value: string)", parameters: [{ label: "value: string" }] }],
      };
    case "textDocument/definition":
      return [{ uri, range }];
    case "textDocument/references":
      return [{ uri, range }];
    case "textDocument/documentSymbol":
      return [{ name: "fixtureSymbol", kind: 12, range, selectionRange: range }];
    case "workspace/symbol":
      return [{ name: "fixtureWorkspaceSymbol", kind: 12, location: { uri, range } }];
    case "textDocument/codeAction":
      return [
        { title: "Fixture fix", edit: { changes: { [uri]: [{ range, newText: "fixed" }] } } },
      ];
    case "textDocument/rename":
      return { changes: { [uri]: [{ range, newText: "renamed" }] } };
    default:
      return null;
  }
};
