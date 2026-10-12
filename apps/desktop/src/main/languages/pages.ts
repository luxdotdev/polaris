// oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- the IPC boundary hands raw renderer input through; each observation decodes it with the method's schema.
/**
 * What one renderer page holds in the Daemon's language contexts: interests and open
 * documents. Main's language identity outlives the page, so when the page reloads or closes
 * Main closes those documents and releases those interests before the next page asks again.
 */
import * as P from "@polaris/protocol";
import { Match, Option, Predicate, Schema } from "effect";
import type { LanguageApi } from "../../shared/api.ts";
import { LanguageRequestInputs, type LanguageRequestMethod } from "../../shared/languages.ts";

type AcquireInput = (typeof LanguageRequestInputs)["languages.context.acquire"]["Type"];

interface Held {
  input: AcquireInput;
  readonly interests: Set<string>;
  readonly uris: Set<string>;
}

const keyOf = (hostKey: string, contextId: string) => `${hostKey}\u0000${contextId}`;

/** Bounds the clean-up; a slow Daemon must not hold the next page for long. */
const CLEANUP_MS = 5000;

export class LanguagePage {
  private readonly held = new Map<string, Held>();
  private readonly inflight = new Set<Promise<unknown>>();

  /** Runs a request for this page and records what it acquired, opened, closed or released. */
  async request(api: LanguageApi, method: LanguageRequestMethod, input: unknown): Promise<unknown> {
    // SAFETY: the bridge decodes method-specific payloads before dispatch.
    const pending = api.request(method, input as never);
    this.inflight.add(pending);

    try {
      const result = await pending;

      if (result.ok) this.observe(method, input);

      return result;
    } finally {
      this.inflight.delete(pending);
    }
  }

  private observe(method: LanguageRequestMethod, input: unknown) {
    Match.value(method).pipe(
      Match.when("languages.context.acquire", () => this.acquired(input)),
      Match.when("languages.context.release", () => this.released(input)),
      Match.when("languages.context.configure", () => this.configured(input)),
      Match.when("languages.document.sync", () => this.synced(input)),
      Match.orElse(() => undefined)
    );
  }

  private acquired(input: unknown) {
    const value = Schema.decodeUnknownOption(LanguageRequestInputs["languages.context.acquire"])(
      input
    );

    if (Option.isNone(value)) return;
    const key = keyOf(value.value.hostKey, value.value.contextId);

    const held = this.held.get(key) ?? {
      input: value.value,
      interests: new Set(),
      uris: new Set(),
    };

    held.input = value.value;
    held.interests.add(value.value.interestId);
    this.held.set(key, held);
  }

  private released(input: unknown) {
    const value = Schema.decodeUnknownOption(LanguageRequestInputs["languages.context.release"])(
      input
    );

    if (Option.isNone(value)) return;
    const key = keyOf(value.value.hostKey, value.value.context.contextId);
    const held = this.held.get(key);

    held?.interests.delete(value.value.interestId);

    if (held?.interests.size === 0) this.held.delete(key);
  }

  private configured(input: unknown) {
    const value = Schema.decodeUnknownOption(LanguageRequestInputs["languages.context.configure"])(
      input
    );

    if (Option.isNone(value)) return;
    const held = this.held.get(keyOf(value.value.hostKey, value.value.context.contextId));

    if (held !== undefined) held.input = { ...held.input, settings: value.value.settings };
  }

  private synced(input: unknown) {
    const value = Schema.decodeUnknownOption(LanguageRequestInputs["languages.document.sync"])(
      input
    );

    if (Option.isNone(value)) return;
    const held = this.held.get(keyOf(value.value.hostKey, value.value.context.contextId));
    const { notification } = value.value;

    if (held === undefined) return;

    if (Predicate.isTagged(notification, "Close")) held.uris.delete(notification.uri);
    else held.uris.add(notification.uri);
  }

  /** Closes this page's documents and releases its interests; failures leave the rest to the Daemon. */
  async cleanup(api: LanguageApi) {
    const work = (async () => {
      await Promise.allSettled(this.inflight);
      const held = [...this.held.values()];
      this.held.clear();
      await Promise.allSettled(held.map((entry) => close(api, entry)));
    })();

    await Promise.race([work, new Promise((resolve) => setTimeout(resolve, CLEANUP_MS))]);
  }
}

/** Reads the context's current identity and sequence with a short-lived interest, then closes. */
const close = async (api: LanguageApi, held: Held) => {
  const { hostKey } = held.input;
  const probe = `cleanup-${crypto.randomUUID()}`;

  const snapshot = await api.request("languages.context.acquire", {
    ...held.input,
    interestId: probe,
  });

  if (!snapshot.ok) return;
  const { context, ack } = snapshot.value;
  let sequence = ack.acceptedSequence;

  for (const document of ack.documents) {
    if (!held.uris.has(document.uri)) continue;
    sequence++;

    const closed = await api.request("languages.document.sync", {
      hostKey,
      context,
      sequence,
      notification: P.LanguageDocumentNotification.cases.Close.make({
        uri: document.uri,
        version: document.version,
      }),
    });

    if (!closed.ok) break;
  }

  for (const interestId of [...held.interests, probe])
    await api.request("languages.context.release", { hostKey, context, interestId });
};
