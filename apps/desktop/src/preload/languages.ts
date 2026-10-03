import { ipcRenderer } from "electron";
import type { IpcError, LanguageApi, SubscriptionListener } from "../shared/api.ts";
import { LANGUAGE_CHANNELS } from "../shared/languageChannels.ts";

interface LanguageEntry {
  readonly id: number;
  readonly items: readonly unknown[];
  readonly end?: IpcError | null;
}

const listeners = new Map<number, SubscriptionListener<unknown>>();

let nextId = 1;

const deliver = (run: () => void) => {
  try {
    run();
  } catch {
    console.error("polaris: a language subscription listener threw");
  }
};

ipcRenderer.on(LANGUAGE_CHANNELS.entries, (_event, entry: LanguageEntry) => {
  const listener = listeners.get(entry.id);

  if (listener === undefined) return;

  if (entry.items.length > 0) deliver(() => listener.items(entry.items));

  if (entry.end !== undefined) {
    listeners.delete(entry.id);
    const end = entry.end;
    deliver(() => listener.end?.(end));
  }
});

/** Main owns origin checks, authority and method-specific payload/result decoding. */
export const languageApi: LanguageApi = {
  request: (method, input) => ipcRenderer.invoke(LANGUAGE_CHANNELS.request, { method, input }),
  subscribe: (kind, input, listener) => {
    const id = nextId++;

    // SAFETY: Main's closed subscription table decodes each item for this kind and ID.
    listeners.set(id, listener as SubscriptionListener<unknown>);
    ipcRenderer.send(LANGUAGE_CHANNELS.subscribe, { id, kind, input });

    return () => {
      if (!listeners.delete(id)) return;
      ipcRenderer.send(LANGUAGE_CHANNELS.unsubscribe, { id });
    };
  },
};
