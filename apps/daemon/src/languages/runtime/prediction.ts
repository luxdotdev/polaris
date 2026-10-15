import {
  LanguageRequestFence,
  type LanguageContextEvent,
  type LanguageDiagnostics,
} from "@polaris/protocol";
import type { LanguageCheckout } from "@polaris/protocol";
import { checkoutKey } from "../trust/index.ts";
import { Predicate } from "effect";
import type { Entry } from "./types.ts";

const diagnostics = new WeakMap<Entry, Map<string, LanguageDiagnostics>>();

export function rememberPredictionDiagnostics(entry: Entry, event: LanguageContextEvent) {
  if (!Predicate.isTagged(event, "Diagnostics")) return;
  const value = event.diagnostics;

  if (value.kind !== "full" || value.version === null) return;
  let files = diagnostics.get(entry);

  if (files === undefined) {
    files = new Map();
    diagnostics.set(entry, files);
  }

  files.delete(value.uri);
  files.set(value.uri, { ...value, items: value.items.slice(0, 64) });

  while (files.size > 32) files.delete(files.keys().next().value!);
}

/** A closed document's diagnostics no longer describe an open buffer. */
export function forgetPredictionDiagnostics(entry: Entry, uri: string) {
  diagnostics.get(entry)?.delete(uri);
}

/** Passive lookup: never acquires, synchronizes, or starts an Editor's server. */
export function predictionDocument(
  entries: Iterable<Entry>,
  clientId: string,
  checkout: LanguageCheckout,
  uri: string,
  buffer: string
) {
  for (const entry of entries) {
    if (
      entry.identity.clientId !== clientId ||
      checkoutKey(entry.identity.checkout) !== checkoutKey(checkout) ||
      !entry.lifecycle.matches("ready") ||
      entry.connection === undefined ||
      entry.capabilities?.positionEncoding !== "utf-16"
    )
      continue;
    const document = entry.documents.open.get(uri);

    if (document === undefined || document.text !== buffer) continue;
    const published = diagnostics.get(entry)?.get(uri);

    return {
      diagnostics:
        published?.version === document.version &&
        published.generation === entry.identity.generation
          ? published.items
          : [],
      fence: LanguageRequestFence.make({
        context: entry.identity,
        requiredSequence: entry.documents.sequence,
        documents: [{ uri, version: document.version }],
      }),
      methods: entry.capabilities.methods,
    };
  }

  return undefined;
}
