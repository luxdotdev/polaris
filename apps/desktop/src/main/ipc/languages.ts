// oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- RPC/IPC boundaries accept untrusted bytes; matching schemas decode both directions before use.
import { decodeLanguage } from "@polaris/client";
import { Schema } from "effect";
import type { LanguageApi, IpcError } from "../../shared/api.ts";
import { LANGUAGE_CHANNELS } from "../../shared/languageChannels.ts";
import {
  LanguageRequestInputs,
  LanguageSubscriptionInputs,
  type LanguageRequestMethod,
  type LanguageSubscriptionKind,
} from "../../shared/languages.ts";

export { LANGUAGE_CHANNELS };

interface LanguageSender {
  readonly id: number;
  readonly send: (channel: string, value: unknown) => void;
  readonly once: (event: "destroyed", listener: () => void) => void;
  readonly on: (
    event: "did-start-navigation",
    listener: (details: { isMainFrame: boolean; isSameDocument: boolean }) => void
  ) => void;
}

interface LanguageIpcEvent {
  readonly sender: LanguageSender;
  readonly senderFrame: { readonly url: string } | null;
}

export interface LanguageIpcRegistrar {
  readonly handle: (
    channel: string,
    handler: (event: LanguageIpcEvent, value: unknown) => Promise<unknown>
  ) => void;
  readonly on: (
    channel: string,
    handler: (event: LanguageIpcEvent, value: unknown) => void
  ) => void;
  readonly removeHandler: (channel: string) => void;
  readonly removeAllListeners: (channel: string) => void;
}

const requestEnvelope = Schema.Struct({ method: Schema.String, input: Schema.Unknown });

const subscribeEnvelope = Schema.Struct({
  id: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })),
  kind: Schema.String,
  input: Schema.Unknown,
});

const unsubscribeEnvelope = Schema.Struct({ id: Schema.Int });

const invalid = { ok: false, error: { code: "InvalidInput", message: "Invalid language request" } };

/** Opt-in registration; only the app origin may reach main's language authority. */
export const registerLanguageIpc = (
  ipc: LanguageIpcRegistrar,
  api: LanguageApi,
  trusted: (url: string) => boolean
) => {
  const windows = new Map<number, Map<number, () => void>>();

  const clear = (id: number) => {
    for (const stop of windows.get(id)?.values() ?? []) stop();
    windows.delete(id);
  };

  const allowed = (event: LanguageIpcEvent) =>
    event.senderFrame !== null && trusted(event.senderFrame.url);

  ipc.handle(LANGUAGE_CHANNELS.request, async (event, value) => {
    if (!allowed(event))
      return { ok: false, error: { code: "Forbidden", message: "Untrusted sender" } };

    try {
      const input = decodeLanguage(requestEnvelope, value);

      if (!Object.hasOwn(LanguageRequestInputs, input.method)) return invalid;
      // SAFETY: own-property membership establishes the closed method table key.
      const method = input.method as LanguageRequestMethod;

      // SAFETY: the bridge decodes method-specific payloads before dispatch.
      return api.request(method, input.input as never);
    } catch {
      return invalid;
    }
  });
  ipc.on(LANGUAGE_CHANNELS.subscribe, (event, value) => {
    if (!allowed(event)) return;

    try {
      const input = decodeLanguage(subscribeEnvelope, value);

      if (!Object.hasOwn(LanguageSubscriptionInputs, input.kind)) return;
      let entries = windows.get(event.sender.id);

      if (entries === undefined) {
        entries = new Map();
        windows.set(event.sender.id, entries);
        event.sender.once("destroyed", () => clear(event.sender.id));
        event.sender.on("did-start-navigation", (details) => {
          if (details.isMainFrame && !details.isSameDocument) clear(event.sender.id);
        });
      }

      if (entries.size >= 512 && !entries.has(input.id)) return;
      entries.get(input.id)?.();
      // SAFETY: own-property membership establishes the closed subscription key.
      const kind = input.kind as LanguageSubscriptionKind;

      const send = (items: ReadonlyArray<unknown>, end?: IpcError | null) => {
        if (end === undefined) {
          event.sender.send(LANGUAGE_CHANNELS.entries, { id: input.id, items });

          return;
        }

        event.sender.send(LANGUAGE_CHANNELS.entries, { id: input.id, items, end });
      };

      let ended = false;

      // SAFETY: bridge decodes the subscription payload and each delivered item.
      const stop = api.subscribe(kind, input.input as never, {
        items: (items) => send(items),
        end: (error) => {
          ended = true;
          entries?.delete(input.id);
          send([], error);
        },
      });

      if (ended) stop();
      else entries.set(input.id, stop);
    } catch {
      /* Invalid input creates no subscription. */
    }
  });
  ipc.on(LANGUAGE_CHANNELS.unsubscribe, (event, value) => {
    if (!allowed(event)) return;

    try {
      const { id } = decodeLanguage(unsubscribeEnvelope, value);
      windows.get(event.sender.id)?.get(id)?.();
      windows.get(event.sender.id)?.delete(id);
    } catch {
      /* Invalid input owns no subscription. */
    }
  });

  return {
    dispose: () => {
      for (const id of windows.keys()) clear(id);
      ipc.removeHandler(LANGUAGE_CHANNELS.request);
      ipc.removeAllListeners(LANGUAGE_CHANNELS.subscribe);
      ipc.removeAllListeners(LANGUAGE_CHANNELS.unsubscribe);
    },
  };
};
