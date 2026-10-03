// oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- RPC/IPC boundaries accept untrusted bytes; matching schemas decode both directions before use.
import * as P from "@polaris/protocol";
import { languageEventContext, languageProposalResources } from "./events.ts";
import { Option, Predicate, Schema } from "effect";

export const languageMethods = {
  "languages.catalog": P.GetLanguageCatalog,
  "languages.availability": P.GetLanguageAvailability,
  "languages.install": P.InstallLanguageTool,
  "languages.install.cancel": P.CancelLanguageInstall,
  "languages.discover": P.DiscoverLanguageProject,
  "languages.trust.get": P.GetLanguageTrust,
  "languages.trust.set": P.SetLanguageTrust,
  "languages.context.acquire": P.AcquireLanguageContext,
  "languages.context.release": P.ReleaseLanguageContext,
  "languages.context.restart": P.RestartLanguageContext,
  "languages.document.sync": P.SyncLanguageDocument,
  "languages.document.acknowledge": P.AcknowledgeLanguageDocument,
  "languages.edit.prepare": P.PrepareLanguageEdit,
  "languages.request": P.RequestLanguageFeature,
  "languages.cancel": P.CancelLanguageRequest,
  "languages.progress.cancel": P.CancelLanguageProgress,
  "languages.server.respond": P.RespondLanguageServer,
  "languages.context.configure": P.ConfigureLanguageContext,
  "languages.format": P.PreflightLanguageFormat,
  "languages.edit.decide": P.AcceptLanguageEdit,
  "languages.operation.get": P.GetLanguageOperation,
  "languages.operation.recover": P.RecoverLanguageOperation,
  "languages.tree.edit.decide": P.DecideLanguageTreeEdit,
  "languages.tree.operation.get": P.GetLanguageTreeOperation,
  "languages.tree.operation.recover": P.RecoverLanguageTreeOperation,
  "languages.preview.media": P.ReadLanguagePreviewMedia,
} as const;

export const languageFeeds = {
  "languages.context.watch": {
    input: P.WatchLanguageContext.payloadSchema,
    item: P.LanguageContextEvent,
  },
  "languages.install.watch": {
    input: P.WatchLanguageInstall.payloadSchema,
    item: P.LanguageInstallProgress,
  },
  "languages.availability.watch": {
    input: P.WatchLanguageAvailability.payloadSchema,
    item: Schema.Array(P.LanguageAvailability).check(Schema.isMaxLength(512)),
  },
} as const;

export type LanguageMethod = keyof typeof languageMethods;

export type LanguageInput<M extends LanguageMethod> =
  (typeof languageMethods)[M]["payloadSchema"]["Type"];

export type LanguageOutput<M extends LanguageMethod> =
  (typeof languageMethods)[M]["successSchema"]["Type"];

export type LanguageFeed = keyof typeof languageFeeds;

export type LanguageFeedInput<K extends LanguageFeed> = (typeof languageFeeds)[K]["input"]["Type"];

export type LanguageFeedItem<K extends LanguageFeed> = (typeof languageFeeds)[K]["item"]["Type"];

interface ContextOperation {
  readonly contextId: string;
  readonly providerId: string;
  readonly checkout: P.LanguageCheckout;
  readonly previous: P.LanguageContextIdentity | undefined;
  readonly token: symbol | null;
}

/** Supplied by the authenticated existing Host connection; never opens another transport. */
export interface LanguageTransport {
  readonly hostId: P.HostId;
  readonly clientId: string;
  readonly capabilities: ReadonlyArray<P.Capability>;
  readonly signal: AbortSignal;
  readonly invoke: (
    method: LanguageMethod,
    input: unknown,
    signal: AbortSignal
  ) => Promise<unknown>;
  readonly watch: (
    kind: LanguageFeed,
    input: unknown,
    signal: AbortSignal
  ) => AsyncIterable<unknown>;
  readonly takeBlob: (id: P.BlobId, maxBytes: number, signal: AbortSignal) => Promise<Uint8Array>;
}

export const languageFailure = (reason: P.LanguageError["reason"]) =>
  new P.LanguageError({
    reason,
    message: `Language operation: ${reason}`,
    retryable: reason === "not-connected",
  });

/** Parse errors never include private Settings or unsaved document values. */
export const decodeLanguage = <S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  value: unknown
): S["Type"] => {
  try {
    return Schema.decodeUnknownSync(schema)(value);
  } catch {
    throw languageFailure("invalid-input");
  }
};

const authorize = (transport: LanguageTransport, value: unknown) => {
  const identity = Schema.decodeUnknownOption(
    Schema.Struct({
      clientId: Schema.optionalKey(Schema.String),
      context: Schema.optionalKey(P.LanguageContextIdentity),
      fence: Schema.optionalKey(P.LanguageRequestFence),
      acceptance: Schema.optionalKey(P.LanguageTreeEditAcceptance),
    })
  )(value);

  if (Option.isNone(identity)) throw languageFailure("invalid-input");
  const input = identity.value;
  const context = input.context ?? input.fence?.context ?? input.acceptance?.fence.context;

  if (
    (input.clientId !== undefined && input.clientId !== transport.clientId) ||
    (context !== undefined &&
      (context.clientId !== transport.clientId || context.hostId !== transport.hostId))
  )
    throw languageFailure("not-owner");
};

export class LanguageAccess {
  private pendingCalls = 0;
  private readonly acks = new Map<string, P.LanguageSyncAck>();
  private readonly contexts = new Map<string, P.LanguageContextIdentity>();
  private readonly contextOperations = new Map<string, symbol>();
  private readonly lifetime = new AbortController();
  private readonly interests = new Map<string, Set<string>>();
  private readonly lost = () => this.dispose();

  constructor(readonly transport: LanguageTransport) {
    transport.signal.addEventListener("abort", this.lost, { once: true });
  }

  dispose() {
    if (this.lifetime.signal.aborted) return;
    this.lifetime.abort();
    this.transport.signal.removeEventListener("abort", this.lost);

    if (!this.transport.signal.aborted) {
      const signal = AbortSignal.any([this.transport.signal, AbortSignal.timeout(1000)]);

      for (const [id, interests] of this.interests) {
        const context = this.contexts.get(id);

        if (context === undefined) continue;

        for (const interestId of interests)
          void Promise.resolve()
            .then(() =>
              this.transport.invoke("languages.context.release", { context, interestId }, signal)
            )
            .catch(() => undefined);
      }
    }

    this.acks.clear();
    this.contexts.clear();
    this.contextOperations.clear();
    this.interests.clear();
  }

  private owner(input: unknown) {
    authorize(this.transport, input);

    const value = decodeLanguage(
      Schema.Struct({
        context: Schema.optionalKey(P.LanguageContextIdentity),
        fence: Schema.optionalKey(P.LanguageRequestFence),
        acceptance: Schema.optionalKey(P.LanguageTreeEditAcceptance),
      }),
      input
    );

    const fence = value.fence ?? value.acceptance?.fence;
    const context = value.context ?? fence?.context;

    if (
      context !== undefined &&
      JSON.stringify(this.contexts.get(context.contextId)) !== JSON.stringify(context)
    )
      throw languageFailure("not-owner");

    if (fence !== undefined) {
      const ack = this.acks.get(fence.context.contextId);

      if (ack === undefined || !P.languageFenceSatisfied(fence, ack))
        throw languageFailure("stale-document");
    }
  }

  private hostFacts(value: unknown) {
    const host = Schema.decodeUnknownOption(Schema.Struct({ hostId: P.HostId }))(value);

    if (Option.isSome(host) && host.value.hostId !== this.transport.hostId)
      throw languageFailure("not-owner");

    const hosts = Schema.decodeUnknownOption(Schema.Array(Schema.Struct({ hostId: P.HostId })))(
      value
    );

    if (Option.isSome(hosts) && hosts.value.some((entry) => entry.hostId !== this.transport.hostId))
      throw languageFailure("not-owner");
  }

  private beginContextOperation(method: LanguageMethod, input: unknown): ContextOperation | null {
    if (
      ![
        "languages.context.acquire",
        "languages.context.restart",
        "languages.context.configure",
      ].includes(method)
    )
      return null;

    const requested =
      method === "languages.context.acquire"
        ? decodeLanguage(P.AcquireLanguageContext.payloadSchema, input)
        : decodeLanguage(P.RestartLanguageContext.payloadSchema, input).context;

    const token = method === "languages.context.acquire" ? null : Symbol();

    if (token !== null) this.contextOperations.set(requested.contextId, token);

    return { ...requested, previous: this.contexts.get(requested.contextId), token };
  }

  private currentContextOperation(operation: ContextOperation, context: P.LanguageContextIdentity) {
    const current = JSON.stringify(this.contexts.get(operation.contextId));
    const previous = JSON.stringify(operation.previous);

    if (operation.token !== null) {
      if (
        this.contextOperations.get(operation.contextId) !== operation.token ||
        current !== previous
      )
        throw languageFailure("stale-generation");
    } else if (
      this.contextOperations.has(operation.contextId) ||
      (current !== previous && current !== JSON.stringify(context))
    )
      throw languageFailure("stale-generation");
  }

  private validateContextOperation(
    method: LanguageMethod,
    operation: ContextOperation,
    context: P.LanguageContextIdentity
  ) {
    if (
      operation.contextId !== context.contextId ||
      operation.providerId !== context.providerId ||
      JSON.stringify(operation.checkout) !== JSON.stringify(context.checkout)
    )
      throw languageFailure("not-owner");

    this.currentContextOperation(operation, context);
    const previous = operation.previous;

    if (previous === undefined) return;

    if (
      context.generation < previous.generation ||
      (context.generation === previous.generation &&
        (method === "languages.context.restart" ||
          JSON.stringify(context) !== JSON.stringify(previous)))
    )
      throw languageFailure("stale-generation");
  }

  private track(
    method: LanguageMethod,
    input: unknown,
    output: unknown,
    operation: ContextOperation | null
  ) {
    this.hostFacts(output);

    if (operation !== null) {
      const snapshot = decodeLanguage(P.LanguageContextSnapshot, output);
      authorize(this.transport, { context: snapshot.context });
      this.validateContextOperation(method, operation, snapshot.context);

      if (
        !P.languageFenceSatisfied(
          { context: snapshot.context, requiredSequence: 0, documents: [] },
          snapshot.ack
        )
      )
        throw languageFailure("stale-generation");
      this.contexts.set(snapshot.context.contextId, snapshot.context);
      this.acks.set(snapshot.context.contextId, snapshot.ack);

      if (method === "languages.context.acquire") {
        const acquired = decodeLanguage(P.AcquireLanguageContext.payloadSchema, input);
        const interests = this.interests.get(acquired.contextId) ?? new Set<string>();
        interests.add(acquired.interestId);
        this.interests.set(acquired.contextId, interests);
      }
    }
  }

  private async installEligible(
    method: LanguageMethod,
    input: LanguageInput<LanguageMethod>,
    signal: AbortSignal
  ) {
    if (method !== "languages.install") return;
    const install = decodeLanguage(P.InstallLanguageTool.payloadSchema, input);
    const catalog = await this.request("languages.catalog", {}, signal);
    const tool = catalog.tools.find((entry) => entry.id === install.toolId);

    if (tool === undefined || !P.languageToolOffered(tool)) throw languageFailure("not-offered");
  }

  private proposals(proposals: ReadonlyArray<P.LanguageEditProposal>) {
    if (
      proposals.some(languageProposalResources) &&
      !this.transport.capabilities.includes("languages.resources")
    )
      throw languageFailure("unsupported-capability");
  }

  private feed(
    kind: LanguageFeed,
    input: LanguageFeedInput<LanguageFeed>,
    output: LanguageFeedItem<LanguageFeed>
  ) {
    if (kind !== "languages.context.watch") return;
    const expected = decodeLanguage(P.WatchLanguageContext.payloadSchema, input).context;
    const event = decodeLanguage(P.LanguageContextEvent, output);

    if (JSON.stringify(languageEventContext(event)) !== JSON.stringify(expected))
      throw languageFailure("not-owner");

    if (
      Predicate.isTagged(event, "ServerRequest") &&
      Predicate.isTagged(event.payload, "ApplyEdit")
    )
      this.proposals([event.payload.proposal]);
  }

  private completed(
    method: LanguageMethod,
    input: LanguageInput<LanguageMethod>,
    output: LanguageOutput<LanguageMethod>
  ) {
    if (method === "languages.tree.edit.decide") this.owner(input);

    if (method === "languages.request")
      this.proposals(decodeLanguage(P.LanguageFeatureResult, output).proposals ?? []);

    if (method === "languages.document.sync") {
      const sync = decodeLanguage(P.SyncLanguageDocument.payloadSchema, input);
      const ack = decodeLanguage(P.LanguageSyncAck, output);

      const documents = Predicate.isTagged(sync.notification, "Close")
        ? []
        : [{ uri: sync.notification.uri, version: sync.notification.version }];

      if (
        ack.acceptedSequence !== sync.sequence ||
        !P.languageFenceSatisfied(
          { context: sync.context, requiredSequence: sync.sequence, documents },
          ack
        )
      )
        throw languageFailure("stale-document");
      this.acks.set(sync.context.contextId, ack);
    }

    if (method === "languages.request" || method === "languages.format") {
      this.owner(input);

      const original = decodeLanguage(
        Schema.Struct({ requestId: P.LanguageKey, fence: P.LanguageRequestFence }),
        input
      );

      const fenced = Schema.decodeUnknownOption(
        Schema.Struct({ requestId: P.LanguageKey, fence: P.LanguageRequestFence })
      )(output);

      if (
        Option.isSome(fenced) &&
        (fenced.value.requestId !== original.requestId ||
          JSON.stringify(fenced.value.fence) !== JSON.stringify(original.fence))
      )
        throw languageFailure("stale-document");
    }
  }

  private released(method: LanguageMethod, input: LanguageInput<LanguageMethod>) {
    if (method !== "languages.context.release") return;
    const release = decodeLanguage(P.ReleaseLanguageContext.payloadSchema, input);
    const interests = this.interests.get(release.context.contextId);
    interests?.delete(release.interestId);

    if (interests?.size === 0) {
      this.interests.delete(release.context.contextId);
      this.contexts.delete(release.context.contextId);
      this.acks.delete(release.context.contextId);
      this.contextOperations.delete(release.context.contextId);
    }
  }

  private guard(method: keyof typeof P.LANGUAGE_RPC_CAPABILITIES) {
    if (this.transport.signal.aborted || this.lifetime.signal.aborted)
      throw languageFailure("not-connected");

    if (!P.languageRpcAllowed(method, this.transport.capabilities))
      throw languageFailure("unsupported-capability");
  }

  async request<M extends LanguageMethod>(
    method: M,
    value: LanguageInput<M>,
    signal = new AbortController().signal
  ): Promise<LanguageOutput<M>> {
    this.guard(method);
    const input = decodeLanguage(languageMethods[method].payloadSchema, value);
    this.owner(input);

    if (method === "languages.context.acquire" && this.contexts.size >= 1024)
      throw languageFailure("queue-full");
    const timeout = AbortSignal.timeout(30000);
    const joined = AbortSignal.any([this.transport.signal, this.lifetime.signal, signal, timeout]);

    if (joined.aborted) throw languageFailure("cancelled");

    if (this.pendingCalls >= 128) throw languageFailure("queue-full");
    this.pendingCalls++;
    const operation = this.beginContextOperation(method, input);

    try {
      await this.installEligible(method, input, joined);

      const result = await abortable(this.transport.invoke(method, input, joined), joined);
      this.guard(method);
      // SAFETY: the method indexes its corresponding validated success schema.
      const decoded = decodeLanguage(languageMethods[method].successSchema, result);
      this.track(method, input, decoded, operation);

      this.completed(method, input, decoded);
      this.released(method, input);

      return decoded;
    } catch (error) {
      if (this.transport.signal.aborted || this.lifetime.signal.aborted)
        throw languageFailure("not-connected");

      if (timeout.aborted) throw languageFailure("timeout");

      if (joined.aborted) throw languageFailure("cancelled");

      if (error instanceof P.LanguageError) throw languageFailure(error.reason);
      throw languageFailure("server-failed");
    } finally {
      this.pendingCalls--;

      if (operation !== null && this.contextOperations.get(operation.contextId) === operation.token)
        this.contextOperations.delete(operation.contextId);
    }
  }

  async *watch<K extends LanguageFeed>(
    kind: K,
    value: LanguageFeedInput<K>,
    signal: AbortSignal
  ): AsyncIterable<LanguageFeedItem<K>> {
    this.guard(kind);
    const input = decodeLanguage(languageFeeds[kind].input, value);
    this.owner(input);
    const joined = AbortSignal.any([this.transport.signal, this.lifetime.signal, signal]);

    let iterator: AsyncIterator<unknown> | undefined;

    try {
      iterator = this.transport.watch(kind, input, joined)[Symbol.asyncIterator]();

      while (!joined.aborted) {
        const next = await abortable(iterator.next(), joined);

        if (next.done) return;
        this.guard(kind);
        // SAFETY: the feed indexes its matching decoded item schema.
        const decoded = decodeLanguage(languageFeeds[kind].item, next.value);
        this.hostFacts(decoded);
        this.feed(kind, input, decoded);
        yield decoded;
      }
    } catch {
      if (this.transport.signal.aborted || this.lifetime.signal.aborted)
        throw languageFailure("not-connected");
      throw languageFailure(joined.aborted ? "cancelled" : "server-failed");
    } finally {
      void Promise.resolve()
        .then(() => iterator?.return?.())
        .catch(() => undefined);
    }
  }
}

export const abortable = <A>(promise: Promise<A>, signal: AbortSignal): Promise<A> =>
  new Promise((resolve, reject) => {
    const aborted = () => reject(languageFailure("cancelled"));

    if (signal.aborted) {
      aborted();
    } else signal.addEventListener("abort", aborted, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", aborted);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", aborted);
        reject(error);
      }
    );
  });

export * from "./documents.ts";
