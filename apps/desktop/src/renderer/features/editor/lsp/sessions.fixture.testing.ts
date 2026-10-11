import { EditorState } from "@codemirror/state";
import * as P from "@polaris/protocol";
import { Predicate, Schema } from "effect";
import type { LanguageApi, SubscriptionListener } from "../../../../shared/api.ts";
import { LanguageRequestOutputs, LanguageSubscriptionItems } from "../../../../shared/languages.ts";
import { EditorLanguageSession } from "./sessions.ts";

export const sessionFixture = (root = "/fixture", generation = 1, initiallyStopped = false) => {
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

  let context = P.LanguageContextIdentity.make({
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
  let staleWatches = 0;
  let watchReason: P.LanguageError["reason"] = "stale-generation";

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
      if (staleWatches > 0) {
        staleWatches--;
        context = P.LanguageContextIdentity.make({
          ...context,
          generation: context.generation + 1,
        });
        ack = P.LanguageSyncAck.make({ ...ack, context });
        queueMicrotask(() =>
          listener.end?.({
            code: "LanguageError",
            message: "Generation changed before watch",
            languageError: new P.LanguageError({
              reason: watchReason,
              message: "Generation changed before watch",
              retryable: true,
            }),
          })
        );

        return () => undefined;
      }

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
    replace: () => {
      const previous = context;
      context = P.LanguageContextIdentity.make({
        ...context,
        generation: context.generation + 1,
        configurationFingerprint: "b".repeat(64),
      });
      ack = P.LanguageSyncAck.make({ ...ack, context });
      listeners[0]?.items([
        P.LanguageContextEvent.cases.Replaced.make({
          context: previous,
          replacement: context,
          runtime: P.LanguageRuntime.cases.Stopped.make({ reason: "replaced" }),
          ack,
        }),
      ]);

      return context;
    },
    stats: () => ({ releases, acquisitions }),
    hold: (value: Promise<void> | null) => {
      hold = value;
    },
    staleWatches: (count: number, reason: P.LanguageError["reason"] = "stale-generation") => {
      staleWatches = count;
      watchReason = reason;
    },
    foreignAck: () => {
      foreignAck = true;
    },
    foreign: () => {
      foreign = true;
    },
  };
};
