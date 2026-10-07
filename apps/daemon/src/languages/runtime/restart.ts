import {
  LanguageCheckout,
  LanguageContextIdentity,
  LanguageContextEvent,
  LanguageDocumentNotification,
  LanguageEffectiveSettings,
  LanguageRuntime,
} from "@polaris/protocol";
import { Schema } from "effect";
import { checkoutKey, trustScope, trustScopeKey } from "../trust/index.ts";
import { contextKey } from "./keys.ts";
import { snapshot } from "./snapshot.ts";
import { failure } from "../transport/framing.ts";
import type { BrokerOptions, Entry } from "./types.ts";
import type { Documents } from "./documents.ts";
import type { LifecycleEvent } from "./lifecycle.ts";

export function bindRestarts(ports: {
  options: BrokerOptions;
  entries: Map<string, Entry>;
  keys: Map<string, Entry>;
  owned: (clientId: string, context: LanguageContextIdentity) => Entry;
  retire: (
    entry: Entry,
    reason: "settings-changed",
    graceful: boolean,
    preserveDocuments: boolean
  ) => void;
  documents: (context: LanguageContextIdentity) => Documents;
  move: (entry: Entry, event: LifecycleEvent) => void;
  ensureStart: (entry: Entry) => void;
}) {
  const { options, entries, keys, owned, retire, documents, move, ensureStart } = ports;

  async function restart(clientId: string, context: LanguageContextIdentity) {
    const entry = owned(clientId, context);

    return configure(clientId, context, entry.input.settings);
  }

  async function configure(
    clientId: string,
    context: LanguageContextIdentity,
    settings: typeof LanguageEffectiveSettings.Type
  ) {
    const entry = owned(clientId, context);

    const input = {
      ...entry.input,
      settings: Schema.decodeUnknownSync(LanguageEffectiveSettings)(settings),
      refresh: true,
    };

    const facts = await options.discover(input);
    owned(clientId, context);
    const key = contextKey(clientId, facts);
    const other = keys.get(key);

    if (other !== undefined && other !== entry)
      throw failure("conflict", "Configuration context already acquired");
    keys.delete(contextKey(clientId, entry.facts));
    const retained = [...entry.documents.open.values()];
    const sequence = entry.documents.sequence;
    retire(entry, "settings-changed", false, true);
    entry.input = input;
    entry.facts = facts;
    entry.attempts = 0;
    entry.identity = LanguageContextIdentity.make({
      ...entry.identity,
      checkout: facts.checkout,
      projectRoot: facts.projectRoot,
      configurationFingerprint: facts.configurationFingerprint,
    });
    entry.documents.clear();
    entry.documents = documents(entry.identity);

    for (const document of retained)
      entry.documents.apply(
        entry.documents.sequence + 1,
        LanguageDocumentNotification.cases.Open.make(document),
        "utf-16"
      );
    entry.documents.sequence = sequence;
    keys.set(key, entry);
    move(entry, { type: "restart" });
    entry.runtime = LanguageRuntime.cases.Stopped.make({ reason: "replaced" });
    const source = entry.replacementSource ?? context;
    delete entry.replacementSource;
    entry.events.emit(
      LanguageContextEvent.cases.Replaced.make({
        context: source,
        replacement: entry.identity,
        runtime: entry.runtime,
        ack: entry.documents.ack(),
      })
    );

    if (entry.documents.open.size > 0) ensureStart(entry);

    return snapshot(entry);
  }

  async function restartMatching(
    clientId: string | null,
    checkout: LanguageCheckout | null,
    workspaceId: string,
    providerId?: string
  ) {
    const selected = [...entries.values()].filter(
      (entry) =>
        (clientId === null || entry.identity.clientId === clientId) &&
        entry.facts.checkout.workspaceId === workspaceId &&
        (checkout === null || checkoutKey(checkout) === checkoutKey(entry.facts.checkout)) &&
        (providerId === undefined || providerId === entry.facts.providerId)
    );

    const results = [];

    for (const entry of selected)
      results.push(await restart(entry.identity.clientId, entry.identity));

    return results;
  }

  async function reloadTrust(checkout: LanguageCheckout) {
    const scope = trustScopeKey(trustScope(options.hostId, checkout));

    for (const entry of entries.values()) {
      if (trustScopeKey(trustScope(options.hostId, entry.facts.checkout)) === scope)
        await restart(entry.identity.clientId, entry.identity);
    }
  }

  return { restart, configure, restartMatching, reloadTrust };
}
