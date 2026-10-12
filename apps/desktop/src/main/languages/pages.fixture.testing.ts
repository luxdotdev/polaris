/** One Language Context and a fake language API, for the page clean-up tests. */
import * as P from "@polaris/protocol";
import { Match, Schema } from "effect";
import type { LanguageApi } from "../../shared/api.ts";
import {
  LanguageRequestOutputs,
  type LanguageRequestInput,
  type LanguageRequestMethod,
} from "../../shared/languages.ts";

const checkout = P.LanguageCheckout.cases.Workspace.make({
  workspaceId: P.WorkspaceId.make("ws_162e0407-f484-4fa0-8020-ebb7a4c481b8"),
  path: "/repo",
});

const settings = P.LanguageEffectiveSettings.make({
  revision: 0,
  formatOnSave: true,
  formatter: P.LanguageFormatterSelection.cases.None.make({}),
  providers: [],
  settings: {},
  origins: {},
});

export const context = P.LanguageContextIdentity.make({
  hostId: P.HostId.make("9166ea8d-daf6-466b-a995-501f971e9d15"),
  clientId: "language-a",
  contextId: "editor-0123",
  checkout,
  projectRoot: "/repo",
  providerId: "typescript-language-server",
  configurationFingerprint: "f".repeat(64),
  generation: 2,
});

export const acquire = {
  hostKey: "local",
  clientId: "language-a",
  contextId: "editor-0123",
  checkout,
  path: "/repo/a.ts",
  providerId: "typescript-language-server",
  settings,
  interestId: "editor-page",
};

export const release = { hostKey: "local", context, interestId: "editor-page" };

export const sync = (notification: P.LanguageDocumentNotification) => ({
  hostKey: "local",
  context,
  sequence: 1,
  notification,
});

export const open = (uri: string) =>
  sync(
    P.LanguageDocumentNotification.cases.Open.make({
      uri,
      languageId: "typescript",
      version: 1,
      text: "",
    })
  );

export const close = (uri: string) =>
  sync(P.LanguageDocumentNotification.cases.Close.make({ uri, version: 1 }));

const limits = P.LanguageLimits.make({
  messageBytes: 1,
  queuedMessages: 1,
  outstandingRequests: 1,
  documents: 1,
  diagnosticsPerDocument: 1,
  logBytes: 1,
  requestTimeoutMs: 1,
});

/** The Daemon's side: the context at sequence 7 with `documents` open. */
export const fakeLanguages = (documents: ReadonlyArray<P.LanguageDocumentFence>) => {
  const calls: Array<{
    readonly method: LanguageRequestMethod;
    readonly input: LanguageRequestInput<LanguageRequestMethod>;
  }> = [];

  const ack = P.LanguageSyncAck.make({ context, acceptedSequence: 7, documents });

  const reply = (method: LanguageRequestMethod) =>
    Match.value(method).pipe(
      Match.when("languages.context.acquire", () => ({
        context,
        runtime: P.LanguageRuntime.cases.Stopped.make({ reason: "no-demand" }),
        ack,
        limits,
      })),
      Match.when("languages.document.sync", () => ack),
      Match.orElse(() => undefined)
    );

  const api: LanguageApi = {
    request: async (method, input) => {
      calls.push({ method, input });

      return {
        ok: true,
        value: Schema.decodeUnknownSync(LanguageRequestOutputs[method])(reply(method)),
      };
    },
    subscribe: () => () => {},
  };

  return { api, calls };
};
