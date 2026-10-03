import { respondResourceReceiptRequest } from "./resourceReceipts.ts";
import { autocompletion } from "@codemirror/autocomplete";
import { setDiagnostics } from "@codemirror/lint";
import { Compartment, StateEffect } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import * as P from "@polaris/protocol";
import { Match, Predicate, Schema } from "effect";
import type { LanguageApi } from "../../../../shared/api.ts";
import type { AppState } from "../../../store/store.ts";
import { polaris } from "../../bridge.ts";
import { previewDocument } from "../runtime/markdown.ts";
import { applyBufferLanguage } from "../runtime/buffers.ts";
import { fileKey } from "../model/drafts.ts";
import { languageFor, type LanguageId } from "../model/language.ts";
import { bindFormatter } from "../formatting/bridge.ts";
import { formattedText } from "../formatting/edits.ts";
import { LanguageFeatures } from "./features.ts";
import { LanguageDiagnosticFeed, cmDiagnostics } from "./diagnostics.ts";
import { completionSource, hoverExtension } from "./codemirror.ts";
import { bufferText, documentLanguageId, type LanguageBuffer } from "./types.ts";
import { providerFence } from "./requests.ts";
import { readLanguageConfiguration } from "./configuration.ts";
import { EditorLanguageSession } from "./sessions.ts";
import { languagePatch, languageStore } from "./state.ts";
import type { CodeActions } from "./payloads.ts";
import type { LanguageProvider } from "./types.ts";
import type {
  AuthenticatedLanguageIdentity,
  EditorLanguageMount,
  EditorLanguagePort,
  LanguageIdentityLookup,
} from "./lifecycle.ts";
import { signatureExtension } from "./signatures.ts";
import type { LanguageCommand } from "./queries.ts";
import {
  featureIntentCurrent,
  prepareLanguageEdit,
  type PreparedLanguageEdit,
} from "./preparation.ts";
import { offerServerEdit } from "./serverEdits.ts";
import { configurationItems } from "./serverConfiguration.ts";
import { ownedProvider } from "./ownership.ts";

interface Entry {
  readonly input: EditorLanguageMount;
  readonly features: LanguageFeatures;
  readonly diagnostics: LanguageDiagnosticFeed;
  readonly compartment: Compartment;
  readonly read: () => LanguageBuffer;
  groups: EditorLanguageSession[];
  disabled: ReadonlyMap<string, readonly string[]>;
  detach: (() => void)[];
  unformat: (() => void) | null;
  controller: AbortController;
  language: LanguageId;
  manual: LanguageId | null;
  stamp: string;
  providerSignature: string;
  paintScheduled: boolean;
  disposed: boolean;
}

import {
  identityLookup,
  refreshers,
  completionProposal,
  editProposal,
  actionProposal,
} from "./bindings.ts";

export { bindLanguageIdentity, bindLanguageProposals } from "./bindings.ts";

export type { LanguageActionProposal } from "./bindings.ts";

export class EditorLanguageCoordinator implements EditorLanguagePort {
  private command: ((key: string, command: LanguageCommand | "back") => void) | null = null;
  private readonly entries = new Map<string, Entry>();
  private readonly groups = new Map<string, EditorLanguageSession>();
  private readonly instance = crypto.randomUUID();
  private readonly refresh = () => {
    for (const entry of this.entries.values()) this.refreshEntry(entry);
  };

  constructor(
    readonly app: () => AppState,
    readonly api: () => LanguageApi | undefined = () => polaris().languages,
    readonly identity: LanguageIdentityLookup = (hostKey) => identityLookup(hostKey)
  ) {
    refreshers.add(this.refresh);
  }

  get(key: string) {
    return this.entries.get(key);
  }
  setCommands(run: (key: string, command: LanguageCommand | "back") => void) {
    this.command = run;
  }

  mount(input: EditorLanguageMount) {
    const key = fileKey(input.file.hostKey, input.file.path);
    const previous = this.entries.get(key);

    if (previous !== undefined) this.release(previous);
    const uri = `file://${encodeURI(input.file.path).replace(/#/g, "%23").replace(/\?/g, "%3F")}`;

    const read = (): LanguageBuffer => ({
      uri,
      doc: input.view.state.doc,
      version: input.revision(),
      lineSeparator: input.view.state.lineBreak === "\r\n" ? "\r\n" : "\n",
    });

    const unavailable: LanguageApi = {
      request: async () => ({
        ok: false,
        error: { code: "unavailable", message: "Language tooling is unavailable." },
      }),
      subscribe: () => () => undefined,
    };

    const routed: LanguageApi = {
      request: (method, input) => (this.api() ?? unavailable).request(method, input),
      subscribe: (kind, input, listener) =>
        (this.api() ?? unavailable).subscribe(kind, input, listener),
    };

    const features = new LanguageFeatures({
      api: routed,
      buffer: read,
      providers: () =>
        entry.groups.flatMap((group) => {
          const provider = group.provider(uri);

          return provider === null
            ? []
            : [ownedProvider(provider, entry.disabled.get(provider.context.providerId) ?? [])];
        }),
    });

    const entry: Entry = {
      input,
      features,
      read,
      compartment: new Compartment(),
      groups: [],
      disabled: new Map(),
      detach: [],
      unformat: null,
      controller: new AbortController(),
      language: input.manual ?? languageFor(input.file.path, input.view.state.doc.line(1).text),
      manual: input.manual ?? null,
      stamp: "",
      providerSignature: "",
      paintScheduled: false,
      disposed: false,
      diagnostics: new LanguageDiagnosticFeed(features.requests, () => this.paint(entry)),
    };

    this.entries.set(key, entry);
    languageStore.setState((state) => ({
      files: {
        ...state.files,
        [key]: {
          language: entry.language,
          manual: entry.manual,
          status: "unavailable",
          fact: "Language tooling is unavailable on this Host.",
          providers: [],
          panel: null,
          rows: [],
          busy: false,
        },
      },
    }));
    input.view.dispatch({
      effects: StateEffect.appendConfig.of(
        entry.compartment.of([
          autocompletion({
            override: [
              completionSource(features, {
                propose: (proposal) => {
                  if (completionProposal === null)
                    languagePatch(key, {
                      panel: "Completion",
                      rows: [
                        {
                          label: "This completion requires an edit proposal.",
                          detail: "The edit coordinator is unavailable.",
                        },
                      ],
                    });
                  else completionProposal(proposal);
                },
              }),
            ],
          }),
          hoverExtension(features),
          signatureExtension(features),
          keymap.of([
            {
              key: "F12",
              run: () => {
                this.command?.(key, "definition");

                return true;
              },
            },
            {
              key: "Shift-F12",
              run: () => {
                this.command?.(key, "references");

                return true;
              },
            },
            {
              key: "Mod-Shift-o",
              run: () => {
                this.command?.(key, "symbols");

                return true;
              },
            },
            {
              key: "Alt-ArrowLeft",
              run: () => {
                this.command?.(key, "back");

                return true;
              },
            },
          ]),
        ])
      ),
    });
    this.refreshEntry(entry);

    return {
      selectedLanguage: () => entry.manual,
      edited: () => {
        features.invalidate();
        entry.diagnostics.clear();
        languagePatch(key, { rows: [], busy: false });

        for (const group of entry.groups) group.edited(uri);
      },
      saved: (version: number, diskVersion: P.FileVersion) => {
        for (const group of entry.groups) group.saved(uri, version, diskVersion);
      },
      dispose: () => this.release(entry),
    };
  }

  private paint(entry: Entry) {
    if (entry.paintScheduled || entry.disposed) return;
    entry.paintScheduled = true;
    queueMicrotask(() => {
      entry.paintScheduled = false;

      if (!entry.disposed)
        entry.input.view.dispatch(
          setDiagnostics(
            entry.input.view.state,
            cmDiagnostics(entry.features.requests, entry.diagnostics.values())
          )
        );
    });
  }

  private stopGroups(entry: Entry) {
    entry.features.invalidate();
    entry.diagnostics.clear();
    entry.unformat?.();
    entry.unformat = null;

    for (const detach of entry.detach) detach();
    entry.detach = [];
    entry.groups = [];

    for (const [key, group] of this.groups) if (group.isDisposed()) this.groups.delete(key);
  }

  private environment(entry: Entry) {
    const app = this.app();
    const host = app.hosts.find((value) => value.key === entry.input.file.hostKey);
    const document = previewDocument(app, entry.input.file);
    const identity = this.identity(entry.input.file.hostKey);

    const usable =
      host?.status.state === "connected" &&
      host.status.capabilities.includes("languages") &&
      identity !== null &&
      identity.hostId === host.status.host?.hostId &&
      identity.connectionEpoch > 0;

    return { host, document, identity: usable ? identity : null };
  }

  private refreshEntry(entry: Entry, force = false) {
    if (entry.disposed) return;
    const environment = this.environment(entry);

    const stamp = JSON.stringify([
      environment.identity,
      environment.document?.checkout,
      environment.host?.status.state,
      environment.host?.status.capabilities,
      entry.manual,
    ]);

    if (!force && stamp === entry.stamp) return;
    entry.stamp = stamp;
    entry.controller.abort();
    entry.controller = new AbortController();
    this.stopGroups(entry);
    const key = fileKey(entry.input.file.hostKey, entry.input.file.path);

    if (
      environment.identity === null ||
      environment.document === null ||
      this.api() === undefined
    ) {
      if (entry.manual === null) {
        entry.language = languageFor(entry.input.file.path, entry.read().doc.line(1).text);
        void applyBufferLanguage(key, entry.language);
      }

      this.localConfiguration(entry, environment.document, stamp);

      languagePatch(key, {
        status: "unavailable",
        fact: "Language tooling is unavailable on this Host. Local syntax remains available.",
        providers: [],
        rows: [],
        busy: false,
      });

      return;
    }

    languagePatch(key, {
      status: "loading",
      fact: "Checking language tooling on this Host…",
      rows: [],
      busy: false,
    });
    void this.configure(entry, environment.identity, environment.document.checkout, stamp).catch(
      () => {
        if (!entry.disposed && stamp === entry.stamp)
          languagePatch(key, {
            status: "unavailable",
            fact: "Language tooling is unavailable or awaiting trust on this Host.",
            providers: [],
          });
      }
    );
  }

  private localConfiguration(
    entry: Entry,
    document: ReturnType<typeof previewDocument>,
    stamp: string
  ) {
    const api = this.api();

    if (api === undefined || document === null) return;
    const key = fileKey(entry.input.file.hostKey, entry.input.file.path);
    void readLanguageConfiguration(api, {
      hostKey: entry.input.file.hostKey,
      hostId: document.hostId,
      workspaceId: document.checkout.workspaceId,
      path: entry.input.file.path,
      manual: entry.manual,
      firstLine: entry.read().doc.line(1).text,
      signal: entry.controller.signal,
    })
      .then((configuration) => {
        if (entry.disposed || stamp !== entry.stamp) return;
        entry.language = configuration.language;
        void applyBufferLanguage(key, entry.language);
        languagePatch(key, { language: entry.language, manual: entry.manual });
      })
      .catch(() => undefined);
  }

  private async configure(
    entry: Entry,
    identity: AuthenticatedLanguageIdentity,
    checkout: P.LanguageCheckout,
    stamp: string
  ) {
    const api = this.api();

    if (api === undefined) return;
    const { file } = entry.input;

    const current = () =>
      !entry.disposed &&
      !entry.controller.signal.aborted &&
      stamp === entry.stamp &&
      JSON.stringify(this.environment(entry).identity) === JSON.stringify(identity);

    const configuration = await readLanguageConfiguration(api, {
      hostKey: file.hostKey,
      hostId: identity.hostId,
      workspaceId: checkout.workspaceId,
      path: file.path,
      manual: entry.manual,
      firstLine: entry.read().doc.line(1).text,
      signal: entry.controller.signal,
    });

    if (!current()) return;
    entry.language = configuration.language;
    void applyBufferLanguage(fileKey(file.hostKey, file.path), entry.language);

    const discovery = await api.request("languages.discover", {
      hostKey: file.hostKey,
      checkout,
      path: file.path,
      documentLanguageId: documentLanguageId(entry.language),
      settings: configuration.settings,
    });

    if (!discovery.ok) throw new Error(discovery.error.message);
    const found = Schema.decodeUnknownSync(P.LanguageDiscovery)(discovery.value);

    if (!current() || JSON.stringify(found.checkout) !== JSON.stringify(checkout)) return;
    const catalog = await api.request("languages.catalog", { hostKey: file.hostKey });

    if (!current()) return;

    if (catalog.ok) {
      const descriptors = Schema.decodeUnknownSync(P.LanguageCatalog)(catalog.value)
        .integrations.filter((integration) =>
          integration.languageIds.includes(documentLanguageId(entry.language))
        )
        .flatMap((integration) => integration.providers);

      entry.disabled = new Map(
        descriptors.map((provider) => [provider.id, provider.disableFeatures])
      );
    }

    const selected = configuration.settings.providers.length
      ? configuration.settings.providers
      : found.providers.map((provider) => provider.providerId);

    const eligible = selected.filter(
      (id, index) =>
        selected.indexOf(id) === index &&
        found.providers.some(
          (provider) =>
            provider.providerId === id && Predicate.isTagged(provider.preflight, "Eligible")
        )
    );

    for (const id of eligible) this.attachProvider(entry, api, identity, checkout, found, id);

    await Promise.all(entry.groups.map((group) => group.ready()));

    if (!current()) return;
    const settings = found.effectiveSettings;
    entry.unformat = bindFormatter(file, {
      settings: async () => ({
        formatOnSave: settings.formatOnSave,
        formatter: settings.formatter,
      }),
      format: async (snapshot, formatter, signal) => {
        await Promise.all(entry.groups.map((group) => group.ready()));

        if (
          signal.aborted ||
          !current() ||
          snapshot.diskVersion === null ||
          snapshot.version !== entry.input.revision() ||
          snapshot.text !== bufferText(entry.read())
        )
          throw new Error("Formatter document changed.");
        const providers = entry.features.options.providers();

        const provider = Predicate.isTagged(formatter, "Provider")
          ? providers.find((value) => value.context.providerId === formatter.providerId)
          : providers[0];

        if (provider === undefined) throw new Error("The selected formatter is unavailable.");
        const buffer = entry.read();

        const outcome = await entry.features.format(
          provider,
          P.LanguageFormatPreflight.make({
            requestId: `format-${crypto.randomUUID()}`,
            fence: providerFence(provider, buffer),
            document: { uri: buffer.uri, version: buffer.version },
            snapshot: snapshot.text,
            expectedDiskVersion: snapshot.diskVersion,
            formatter,
            options: {},
            reason: snapshot.reason,
            deadline: Date.now() + 5000,
          }),
          signal
        );

        return Match.value(outcome).pipe(
          Match.tag("Formatted", (value) =>
            formattedText(snapshot.text, value.edits, provider.capabilities.positionEncoding)
          ),
          Match.tag("Skipped", () => snapshot.text),
          Match.tag("Failed", (value) => {
            throw new Error(value.message);
          }),
          Match.exhaustive
        );
      },
    });
  }

  private attachProvider(
    entry: Entry,
    api: LanguageApi,
    identity: AuthenticatedLanguageIdentity,
    checkout: P.LanguageCheckout,
    found: typeof P.LanguageDiscovery.Type,
    id: string
  ) {
    const file = entry.input.file;

    const groupKey = JSON.stringify([
      file.hostKey,
      identity,
      checkout,
      found.projectRoot,
      id,
      found.effectiveSettings,
    ]);

    let group = this.groups.get(groupKey);

    if (group === undefined || group.isDisposed()) {
      for (const [key, value] of this.groups) if (value.isDisposed()) this.groups.delete(key);

      if (this.groups.size >= 128) throw new Error("Too many language contexts.");
      group = new EditorLanguageSession(
        api,
        file.hostKey,
        {
          clientId: identity.clientId,
          contextId: `editor-${crypto.randomUUID()}`,
          checkout,
          path: file.path,
          providerId: id,
          settings: found.effectiveSettings,
          interestId: `editor-${this.instance}`,
        },
        identity.hostId,
        (event) => this.serverRequest(api, file.hostKey, found.effectiveSettings, event),
        (event) => {
          if (!Predicate.isTagged(event, "Diagnostics")) return;

          for (const value of this.entries.values()) {
            const provider = value.features.options
              .providers()
              .find(
                (candidate) => candidate.context.contextId === event.diagnostics.context.contextId
              );

            if (provider !== undefined) value.diagnostics.receive(provider, event.diagnostics);
          }
        }
      );
      this.groups.set(groupKey, group);
    }

    entry.groups.push(group);
    entry.detach.push(
      group.attach({
        read: entry.read,
        language: () => entry.language,
        changed: () => {
          const providers = entry.features.options.providers();

          const signature = JSON.stringify(
            providers.map((provider) => [
              provider.context,
              provider.capabilities,
              provider.ack.documents.find((document) => document.uri === entry.read().uri),
            ])
          );

          if (signature !== entry.providerSignature) {
            entry.features.invalidate();
            entry.diagnostics.clear();
            languagePatch(fileKey(file.hostKey, file.path), { rows: [], busy: false });
          }

          entry.providerSignature = signature;
          languagePatch(fileKey(file.hostKey, file.path), {
            language: entry.language,
            manual: entry.manual,
            providers: providers.map((provider) => provider.context.providerId),
            status: providers.length ? "ready" : "unavailable",
            fact: providers.length ? "" : "Language tooling is unavailable or synchronizing.",
          });
        },
      })
    );
  }

  private async serverRequest(
    api: LanguageApi,
    hostKey: string,
    settings: typeof P.LanguageEffectiveSettings.Type,
    event: Extract<P.LanguageContextEvent, { _tag: "ServerRequest" }>
  ) {
    if (await respondResourceReceiptRequest(api, hostKey, event)) return;

    const offer = (kind: "legacy" | "tree", proposal: PreparedLanguageEdit) => {
      const entries = [...this.entries.values()].filter(
        (entry) => entry.input.file.hostKey === hostKey
      );

      const buffers = entries.map((entry) => entry.read());
      const signatures = entries.map((entry) => entry.providerSignature);
      const identity = this.identity(hostKey);

      return offerServerEdit({
        context: event.request.context,
        proposal,
        kind,
        treeNegotiated: P.languageRpcAllowed(
          "languages.tree.edit.decide",
          this.app().hosts.find((host) => host.key === hostKey)?.status.capabilities ?? []
        ),
        providers: entries.flatMap((entry) => entry.features.options.providers()),
        buffers,
        current: () =>
          identity !== null &&
          JSON.stringify(identity) === JSON.stringify(this.identity(hostKey)) &&
          entries.every(
            (entry, index) =>
              !entry.disposed &&
              entry.providerSignature === signatures[index] &&
              entry.read().doc === buffers[index]?.doc &&
              entry.read().version === buffers[index]?.version
          ),
        offer: editProposal,
      });
    };

    const result = await Match.value(event.payload).pipe(
      Match.tag("Configuration", ({ items }) =>
        configurationItems(event.request.context, settings, items)
      ),
      Match.tag("WorkspaceFolders", () => [
        {
          uri: `file://${encodeURI(event.request.context.projectRoot)}`,
          name: event.request.context.projectRoot.split("/").pop() ?? "Workspace",
        },
      ]),
      Match.tag("ApplyEdit", ({ proposal }) => offer("legacy", proposal)),
      Match.tag("TreeApplyEdit", ({ proposal }) => offer("tree", proposal)),
      Match.tag("Unsupported", () => undefined),
      Match.orElse(() => null)
    );

    void api
      .request("languages.server.respond", {
        hostKey,
        context: event.request.context,
        response: P.LanguageJsonRpcResponse.make({
          jsonrpc: "2.0",
          id: event.request.request.id,
          ...(result === undefined
            ? { error: { code: -32601, message: "Unsupported language server request." } }
            : { result }),
        }),
      })
      .catch(() => undefined);
  }

  select(key: string, language: LanguageId | null) {
    const entry = this.entries.get(key);

    if (entry === undefined) return;
    entry.manual = language;

    if (language !== null) {
      entry.language = language;
      void applyBufferLanguage(key, language);
    }

    languagePatch(key, { language: entry.language, manual: language });
    this.refreshEntry(entry, true);
  }

  async action(
    key: string,
    provider: LanguageProvider,
    action: NonNullable<typeof CodeActions.Type>[number],
    request: P.LanguageFeatureRequest,
    result: P.LanguageFeatureResult
  ) {
    const entry = this.entries.get(key);

    if (entry === undefined || action.disabled !== undefined) return;
    const buffer = entry.read();

    if (
      !entry.features.requests.intentCurrent(provider, buffer, request.fence) ||
      !featureIntentCurrent(request, result, provider, buffer)
    )
      return;

    if (actionProposal !== null) {
      actionProposal({ action, provider, buffer, request, result });

      return;
    }

    if (!("edit" in action) || action.edit === undefined) {
      this.unavailableEdit(key);

      return;
    }

    await this.prepareEdit(
      key,
      provider,
      request,
      result,
      action.edit,
      "code-action",
      action.title
    );
  }

  async prepareEdit(
    key: string,
    provider: LanguageProvider,
    request: P.LanguageFeatureRequest,
    result: P.LanguageFeatureResult,
    edit: P.LanguageWorkspaceEdit,
    origin: "rename" | "code-action",
    label: string
  ) {
    const entry = this.entries.get(key);

    if (entry === undefined) return;
    const buffer = entry.read();

    const current = () =>
      this.entries.get(key) === entry &&
      entry.features.requests.intentCurrent(provider, buffer, request.fence) &&
      featureIntentCurrent(request, result, provider, buffer);

    try {
      const proposal = await prepareLanguageEdit(
        { request, result, edit, origin, label, signal: entry.features.requests.signal },
        current
      );

      if (!current()) return;

      if (proposal === null || editProposal === null) {
        this.unavailableEdit(key);

        return;
      }

      await editProposal(proposal);
    } catch {
      if (current()) this.unavailableEdit(key, "Edit preparation failed.");
    }
  }

  private unavailableEdit(key: string, label = "The edit coordinator is unavailable.") {
    languagePatch(key, {
      panel: "Edit acceptance",
      rows: [
        {
          label,
          detail: "No edits were applied.",
        },
      ],
    });
  }

  refreshSettings(hostKey: string, workspaceId: string) {
    for (const entry of this.entries.values())
      if (entry.input.file.hostKey === hostKey && entry.input.file.workspaceId === workspaceId)
        this.refreshEntry(entry, true);
  }
  refreshHosts() {
    this.refresh();
  }
  private release(entry: Entry) {
    if (entry.disposed) return;
    entry.disposed = true;
    entry.controller.abort();
    this.stopGroups(entry);
    entry.features.dispose();
    entry.diagnostics.dispose();
    entry.input.view.dispatch({ effects: entry.compartment.reconfigure([]) });
    const key = fileKey(entry.input.file.hostKey, entry.input.file.path);

    if (this.entries.get(key) === entry) {
      this.entries.delete(key);
      languageStore.setState((state) => {
        const { [key]: _gone, ...files } = state.files;

        return { files };
      });
    }
  }
  dispose() {
    refreshers.delete(this.refresh);

    for (const entry of this.entries.values()) this.release(entry);

    for (const group of this.groups.values()) group.dispose();
    this.groups.clear();
  }
}
