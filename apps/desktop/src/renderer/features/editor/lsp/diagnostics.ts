import * as P from "@polaris/protocol";
import { Match, Option, Schema } from "effect";
import type { Diagnostic } from "@codemirror/lint";
import { offsetAt } from "./position.ts";
import { LanguageRequests, providerFence } from "./requests.ts";
import type { LanguageBuffer, LanguageProvider } from "./types.ts";

export interface ProviderDiagnostics {
  readonly provider: LanguageProvider;
  readonly diagnostics: P.LanguageDiagnostics;
  /** For an unversioned set: the buffer version the provider had acknowledged when it arrived. */
  readonly at?: number;
}

const acknowledged = (provider: LanguageProvider, buffer: LanguageBuffer) =>
  provider.ack.documents.some(
    (document) => document.uri === buffer.uri && document.version === buffer.version
  );

/**
 * Provider sets replace independently. An unversioned push paints only for the buffer version
 * acknowledged when it arrived (ADR-0021); last-known data never paints as current.
 */
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

  private readonly watchers = new Set<() => void>();

  /** Calls `watch` after every change to the sets; returns the unsubscribe. */
  observe(watch: () => void): () => void {
    this.watchers.add(watch);

    return () => {
      this.watchers.delete(watch);
    };
  }

  private publish(items: readonly ProviderDiagnostics[]) {
    this.changed(items);

    for (const watch of this.watchers) watch();
  }

  private owns(provider: LanguageProvider, context: P.LanguageContextIdentity): boolean {
    return P.languageFenceSatisfied(
      { context: provider.context, requiredSequence: 0, documents: [] },
      { context, acceptedSequence: 0, documents: [] }
    );
  }

  private remove(provider: LanguageProvider) {
    this.sets.delete(provider.context.contextId);
    this.publish(this.values());
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
    } else if (diagnostics.freshness === "unversioned") {
      if (!acknowledged(provider, buffer)) return;
      this.sets.set(provider.context.contextId, { provider, diagnostics, at: buffer.version });
    } else this.sets.set(provider.context.contextId, { provider, diagnostics });
    this.publish(this.values());
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
          (value.diagnostics.version === null || value.diagnostics.version === buffer.version) &&
          (value.at === undefined || value.at === buffer.version)
          ? [value]
          : [];
      });
  }

  clear() {
    this.revision++;

    for (const stop of this.stops) stop();
    this.stops = [];
    this.sets.clear();
    this.publish([]);
  }
  dispose() {
    this.disposed = true;
    this.clear();
  }
}

/** LSP tags 1 (unnecessary) and 2 (deprecated) as classes on the marked range. */
const markClassOf = (tags: (typeof P.LanguageDiagnostic.Type)["tags"]): { markClass?: string } => {
  const classes = [
    ...(tags.includes(1) ? ["cm-lintRange-unnecessary"] : []),
    ...(tags.includes(2) ? ["cm-lintRange-deprecated"] : []),
  ];

  return classes.length === 0 ? {} : { markClass: classes.join(" ") };
};

export const cmDiagnostics = (
  requests: LanguageRequests,
  values: readonly ProviderDiagnostics[],
  label: (provider: LanguageProvider) => string = (provider) => provider.context.providerId
): Diagnostic[] => {
  const buffer = requests.options.buffer();
  const seen = new Set<string>();

  return values
    .flatMap(({ provider, diagnostics, at }) => {
      const current =
        diagnostics.freshness === "versioned"
          ? diagnostics.version === buffer.version
          : diagnostics.freshness === "unversioned" && at === buffer.version;

      if (!current || !requests.current(provider, buffer)) return [];

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
            Match.when(4, () => "hint" as const),
            Match.orElse(() => "info" as const)
          );

          return [
            {
              from,
              to,
              severity,
              message: item.message,
              source: `${label(provider)}${item.source ? ` · ${item.source}` : ""}`,
              ...markClassOf(item.tags),
            },
          ];
        } catch {
          return [];
        }
      });
    })
    .slice(0, 2000);
};
