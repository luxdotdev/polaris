import * as P from "@polaris/protocol";
import { Match, Option, Schema } from "effect";
import type { Diagnostic } from "@codemirror/lint";
import { offsetAt } from "./position.ts";
import { LanguageRequests, providerFence } from "./requests.ts";
import type { LanguageProvider } from "./types.ts";

export interface ProviderDiagnostics {
  readonly provider: LanguageProvider;
  readonly diagnostics: P.LanguageDiagnostics;
}

/** Provider sets replace independently. Unversioned data is exposed but never painted as current. */
export class LanguageDiagnosticFeed {
  private readonly sets = new Map<string, ProviderDiagnostics>();
  private stops: (() => void)[] = [];
  private disposed = false;
  private revision = 0;
  constructor(
    readonly requests: LanguageRequests,
    readonly changed: (items: readonly ProviderDiagnostics[]) => void
  ) {}

  refresh() {
    this.clear();

    if (this.disposed) return;
    const revision = this.revision;

    for (const provider of this.requests.options.providers().slice(0, 32)) {
      this.stops.push(
        this.requests.options.api.subscribe(
          "languages.context.watch",
          { hostKey: provider.hostKey, context: provider.context },
          {
            items: (events) => {
              if (this.disposed || revision !== this.revision) return;

              for (const raw of events) {
                const decoded = Schema.decodeUnknownOption(P.LanguageContextEvent)(raw);

                if (Option.isNone(decoded)) continue;
                const event = decoded.value;
                Match.value(event).pipe(
                  Match.tag("Diagnostics", ({ diagnostics }) =>
                    this.receive(provider, diagnostics)
                  ),
                  Match.tag("Invalidated", ({ context }) => {
                    if (!this.owns(provider, context)) return;
                    this.requests.invalidate();
                    this.remove(provider);
                  }),
                  Match.tag("CapabilitiesChanged", ({ context }) => {
                    if (!this.owns(provider, context)) return;
                    this.requests.invalidate();
                    this.remove(provider);
                  }),
                  Match.orElse(() => undefined)
                );
              }
            },
            end: () => {
              if (revision === this.revision) {
                this.requests.invalidate();
                this.remove(provider);
              }
            },
          }
        )
      );
    }
  }

  private owns(provider: LanguageProvider, context: P.LanguageContextIdentity): boolean {
    return P.languageFenceSatisfied(
      { context: provider.context, requiredSequence: 0, documents: [] },
      { context, acceptedSequence: 0, documents: [] }
    );
  }

  private remove(provider: LanguageProvider) {
    this.sets.delete(provider.context.contextId);
    this.changed(this.values());
  }

  receive(provider: LanguageProvider, value: P.LanguageDiagnostics) {
    if (this.disposed) return;
    const decoded = Schema.decodeUnknownOption(P.LanguageDiagnostics)(value);

    if (Option.isNone(decoded)) return;
    const diagnostics = decoded.value;
    const buffer = this.requests.options.buffer();

    if (
      diagnostics.uri !== buffer.uri ||
      provider.capabilities.diagnostics === "none" ||
      !this.requests.current(provider, buffer) ||
      !P.languageFenceSatisfied(providerFence(provider, buffer), {
        context: diagnostics.context,
        acceptedSequence: provider.ack.acceptedSequence,
        documents: [{ uri: buffer.uri, version: buffer.version }],
      })
    )
      return;

    if (diagnostics.version !== null && diagnostics.version !== buffer.version) return;
    const previous = this.sets.get(provider.context.contextId)?.diagnostics;

    if (diagnostics.kind === "unchanged") {
      if (previous === undefined || previous.resultId !== diagnostics.previousResultId) return;
      this.sets.set(provider.context.contextId, {
        provider,
        diagnostics: P.LanguageDiagnostics.make({
          ...diagnostics,
          kind: "full",
          items: previous.items,
        }),
      });
    } else this.sets.set(provider.context.contextId, { provider, diagnostics });
    this.changed(this.values());
  }

  values(): ProviderDiagnostics[] {
    const buffer = this.requests.options.buffer();

    return this.requests.options
      .providers()
      .slice(0, 32)
      .flatMap((provider) => {
        const value = this.sets.get(provider.context.contextId);

        return value &&
          this.requests.current(value.provider, buffer) &&
          (value.diagnostics.version === null || value.diagnostics.version === buffer.version)
          ? [value]
          : [];
      });
  }

  clear() {
    this.revision++;

    for (const stop of this.stops) stop();
    this.stops = [];
    this.sets.clear();
    this.changed([]);
  }
  dispose() {
    this.disposed = true;
    this.clear();
  }
}

export const cmDiagnostics = (
  requests: LanguageRequests,
  values: readonly ProviderDiagnostics[]
): Diagnostic[] => {
  const buffer = requests.options.buffer();
  const seen = new Set<string>();

  return values
    .flatMap(({ provider, diagnostics }) => {
      if (
        diagnostics.freshness !== "versioned" ||
        diagnostics.version !== buffer.version ||
        !requests.current(provider, buffer)
      )
        return [];

      return diagnostics.items.flatMap((item): Diagnostic[] => {
        try {
          const from = offsetAt(
            buffer.doc,
            item.range.start,
            provider.capabilities.positionEncoding
          );

          const to = offsetAt(buffer.doc, item.range.end, provider.capabilities.positionEncoding);
          const key = JSON.stringify([from, to, item.message, item.severity, item.source]);

          if (seen.has(key)) return [];
          seen.add(key);

          const severity = Match.value(item.severity).pipe(
            Match.when(1, () => "error" as const),
            Match.when(2, () => "warning" as const),
            Match.orElse(() => "info" as const)
          );

          return [
            {
              from,
              to,
              severity,
              message: item.message,
              source: `${provider.context.providerId}${item.source ? ` · ${item.source}` : ""}`,
            },
          ];
        } catch {
          return [];
        }
      });
    })
    .slice(0, 2000);
};
