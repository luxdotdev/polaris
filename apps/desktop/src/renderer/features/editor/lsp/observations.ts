import * as P from "@polaris/protocol";
import { Predicate, Schema } from "effect";
import type { LanguageApi } from "../../../../shared/api.ts";
import { languageIpcError } from "../../../../shared/languageError.ts";
import type { AuthenticatedLanguageIdentity } from "./lifecycle.ts";
import {
  readEffectiveLanguageSettings,
  readLanguageConfiguration,
  type SettingsInput,
} from "./configuration.ts";
import type { LanguageId } from "../model/language.ts";

/** A read that straddled `invalidate()`: its answer is stale, so the caller reads again. */
export class ObservationsChanged extends Error {
  constructor() {
    super("Language observations changed.");
  }
}

/** How often `settled` reads again; each retry follows a real invalidation. */
const SETTLE_ATTEMPTS = 3;

interface Scope {
  readonly hostKey: string;
  readonly identity: AuthenticatedLanguageIdentity;
  readonly checkout: P.LanguageCheckout;
}

interface Observation {
  readonly found: typeof P.LanguageDiscovery.Type;
  readonly disabled: ReadonlyMap<string, readonly string[]>;
}

/** Demand-only observations; directory boundaries preserve nested projects and their tooling. */
export class EditorLanguageObservations {
  private epoch = 0;
  private readonly settings = new Map<string, Promise<typeof P.LanguageEffectiveSettings.Type>>();
  private readonly discoveries = new Map<string, Promise<Observation>>();

  private scope(input: Scope) {
    return JSON.stringify([input.hostKey, input.identity, input.checkout]);
  }

  private retain<A>(cache: Map<string, Promise<A>>, key: string, load: () => Promise<A>) {
    const previous = cache.get(key);

    if (previous !== undefined) return previous;

    if (cache.size >= 128) cache.delete(cache.keys().next().value ?? "");
    const epoch = this.epoch;

    const pending = load().then((value) => {
      if (epoch !== this.epoch) throw new ObservationsChanged();

      return value;
    });

    cache.set(key, pending);
    void pending.catch(() => {
      if (cache.get(key) === pending) cache.delete(key);
    });

    return pending;
  }

  configuration(api: LanguageApi, scope: Scope, input: SettingsInput) {
    // A shared read has its own lifetime; closing one preview must not cancel another file's read.
    const sharedInput = { ...input, signal: new AbortController().signal };

    return readLanguageConfiguration(api, input, (language: LanguageId) =>
      this.retain(this.settings, JSON.stringify([this.scope(scope), language]), () =>
        readEffectiveLanguageSettings(api, sharedInput, language)
      )
    );
  }

  discover(
    api: LanguageApi,
    scope: Scope,
    path: string,
    language: string,
    settings: typeof P.LanguageEffectiveSettings.Type,
    refresh = false
  ) {
    const directory = path.slice(0, path.lastIndexOf("/"));

    const key = JSON.stringify([
      this.scope(scope),
      language === "sql" ? path : directory,
      language,
      settings,
    ]);

    return this.retain(this.discoveries, key, async () => {
      const discovery = await api.request("languages.discover", {
        hostKey: scope.hostKey,
        checkout: scope.checkout,
        path,
        documentLanguageId: language,
        settings,
        refresh,
      });

      if (!discovery.ok) throw languageIpcError(discovery.error);
      const found = Schema.decodeUnknownSync(P.LanguageDiscovery)(discovery.value);
      const catalog = await api.request("languages.catalog", { hostKey: scope.hostKey });

      if (!catalog.ok) throw languageIpcError(catalog.error);

      const descriptors = Schema.decodeUnknownSync(P.LanguageCatalog)(catalog.value)
        .integrations.filter((integration) => integration.languageIds.includes(language))
        .flatMap((integration) => integration.providers);

      if (!found.providers.some((provider) => Predicate.isTagged(provider.preflight, "Eligible")))
        this.discoveries.delete(key);

      return {
        found,
        disabled: new Map(descriptors.map((provider) => [provider.id, provider.disableFeatures])),
      };
    });
  }

  /** Runs `read` again when the observations changed under it (a context replaced, Trust changed). */
  async settled<A>(read: () => Promise<A>, attempts = SETTLE_ATTEMPTS): Promise<A> {
    try {
      return await read();
    } catch (error) {
      if (!(error instanceof ObservationsChanged) || attempts <= 1) throw error;

      return this.settled(read, attempts - 1);
    }
  }

  invalidate() {
    this.epoch++;
    this.settings.clear();
    this.discoveries.clear();
  }
}
