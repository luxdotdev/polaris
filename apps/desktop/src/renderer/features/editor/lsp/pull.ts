import * as P from "@polaris/protocol";
import type { LanguageDiagnosticFeed } from "./diagnostics.ts";
import type { LanguageFeatures } from "./features.ts";
import type * as Payload from "./payloads.ts";
import type { LanguageBuffer, LanguageProvider } from "./types.ts";

/** A pull report as a versioned set for the buffer version the request was made against. */
export const pulledDiagnostics = (
  provider: LanguageProvider,
  buffer: LanguageBuffer,
  payload: typeof Payload.PullDiagnostic.Type,
  previousResultId: string | null
) =>
  P.LanguageDiagnostics.make({
    context: provider.context,
    uri: buffer.uri,
    providerId: provider.context.providerId,
    generation: provider.context.generation,
    version: buffer.version,
    freshness: "versioned",
    kind: payload.kind,
    resultId: payload.resultId ?? null,
    previousResultId,
    items:
      payload.kind === "full"
        ? payload.items.map((item) => ({
            ...item,
            severity: item.severity ?? null,
            code: item.code ?? null,
            source: item.source ?? null,
            tags: item.tags ?? [],
          }))
        : [],
    truncated: false,
  });

const pulls = (provider: LanguageProvider) =>
  provider.capabilities.diagnostics === "pull" ||
  provider.capabilities.diagnostics === "push-and-pull";

/**
 * Pulls the open buffer's diagnostics whenever its providers acknowledge a new version, for
 * servers such as TypeScript 7's that publish none unasked. Full reports only, so no chaining.
 */
export class DiagnosticPull {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private controller = new AbortController();

  constructor(
    readonly features: LanguageFeatures,
    readonly feed: LanguageDiagnosticFeed
  ) {}

  schedule() {
    this.stop();

    if (!this.features.options.providers().some(pulls)) return;
    const { signal } = this.controller;
    this.timer = setTimeout(() => void this.run(signal).catch(() => undefined), 150);
  }

  private async run(signal: AbortSignal) {
    const buffer = this.features.options.buffer();
    const answers = await this.features.pullDiagnostics(new Map(), signal);

    if (signal.aborted) return;

    for (const { provider, payload } of answers)
      this.feed.receive(provider, pulledDiagnostics(provider, buffer, payload, null));
  }

  stop() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.controller.abort();
    this.controller = new AbortController();
  }
}
