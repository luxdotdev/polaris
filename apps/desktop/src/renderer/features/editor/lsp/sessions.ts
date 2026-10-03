import * as P from "@polaris/protocol";
import { Match, Option, Predicate, Schema } from "effect";
import type { LanguageApi } from "../../../../shared/api.ts";
import {
  bufferText,
  documentLanguageId,
  type LanguageBuffer,
  type LanguageProvider,
} from "./types.ts";
import type { LanguageId } from "../model/language.ts";

type Acquisition = typeof P.AcquireLanguageContext.payloadSchema.Type;

export interface SyncedBuffer {
  readonly read: () => LanguageBuffer;
  readonly language: () => LanguageId;
  readonly changed: () => void;
}

const sameContext = (a: P.LanguageContextIdentity, b: P.LanguageContextIdentity) =>
  JSON.stringify(a) === JSON.stringify(b);

/** One ordered queue per acquired provider/project, shared by every retained buffer interest. */
export class EditorLanguageSession {
  private readonly lifetime = new AbortController();
  private context: P.LanguageContextIdentity | null = null;
  private ack: P.LanguageSyncAck | null = null;
  private capabilities: P.LanguageProviderCapabilities | null = null;
  private runtimeReady = false;
  private triggers: readonly string[] = [];
  private readonly buffers = new Map<string, SyncedBuffer>();
  private readonly sent = new Map<string, number>();
  private tail: Promise<void> = Promise.resolve();
  private sequence = 0;
  private queued = 0;
  private epoch = 0;
  private stopped = false;
  private unwatch: (() => void) | null = null;
  private opening: Promise<void> | null = null;
  private scheduled = false;
  private readonly dirty = new Set<string>();

  constructor(
    readonly api: LanguageApi,
    readonly hostKey: string,
    readonly acquisition: Acquisition,
    readonly hostId: P.HostId,
    readonly serverRequest: (
      event: Extract<P.LanguageContextEvent, { _tag: "ServerRequest" }>
    ) => void,
    readonly observed: (event: P.LanguageContextEvent) => void = () => undefined
  ) {}

  private changed() {
    for (const buffer of this.buffers.values()) buffer.changed();
  }

  private enqueue(work: () => Promise<void>): Promise<void> {
    if (this.stopped || this.queued >= 32)
      return Promise.reject(new Error("Language queue unavailable."));
    const epoch = this.epoch;
    this.queued++;

    const next = this.tail
      .then(async () => {
        if (this.stopped || epoch !== this.epoch) throw new Error("Language context replaced.");
        await work();
      })
      .finally(() => {
        this.queued--;
      });

    this.tail = next.catch(() => undefined);

    return next;
  }

  private async acquire() {
    const epoch = this.epoch;

    const reply = await this.api.request("languages.context.acquire", {
      hostKey: this.hostKey,
      ...this.acquisition,
    });

    if (!reply.ok) throw new Error(reply.error.message);
    const snapshot = Schema.decodeUnknownSync(P.LanguageContextSnapshot)(reply.value);
    const context = snapshot.context;

    if (
      context.hostId !== this.hostId ||
      context.clientId !== this.acquisition.clientId ||
      context.contextId !== this.acquisition.contextId ||
      context.providerId !== this.acquisition.providerId ||
      JSON.stringify(context.checkout) !== JSON.stringify(this.acquisition.checkout)
    )
      throw new Error("Language context ownership changed.");

    if (!sameContext(context, snapshot.ack.context)) {
      void this.api
        .request("languages.context.release", {
          hostKey: this.hostKey,
          context,
          interestId: this.acquisition.interestId,
        })
        .catch(() => undefined);
      throw new Error("Language acknowledgment ownership changed.");
    }

    if (this.stopped || epoch !== this.epoch) {
      void this.api
        .request("languages.context.release", {
          hostKey: this.hostKey,
          context,
          interestId: this.acquisition.interestId,
        })
        .catch(() => undefined);

      return;
    }

    this.context = context;
    this.ack = snapshot.ack;
    this.sequence = snapshot.ack.acceptedSequence;
    this.runtime(snapshot.runtime);
    this.unwatch = this.api.subscribe(
      "languages.context.watch",
      { hostKey: this.hostKey, context },
      {
        items: (events) => {
          if (!this.stopped && epoch === this.epoch) for (const event of events) this.event(event);
        },
        end: () => {
          if (!this.stopped && epoch === this.epoch) this.unavailable();
        },
      }
    );

    for (const [uri, buffer] of this.buffers) await this.deliverOpen(uri, buffer);
    this.changed();
  }

  private runtime(runtime: typeof P.LanguageRuntime.Type) {
    const wasReady = this.capabilities !== null;
    this.runtimeReady = Predicate.isTagged(runtime, "Ready");
    this.capabilities = Predicate.isTagged(runtime, "Ready") ? runtime.capabilities : null;

    if (!wasReady && this.capabilities !== null && this.unwatch !== null)
      void this.enqueue(async () => {
        for (const [uri, buffer] of this.buffers) await this.deliverLatest(uri, buffer);
        this.changed();
      }).catch(() => this.unavailable());
  }

  private unavailable() {
    this.lifetime.abort();
    this.epoch++;
    this.runtimeReady = false;
    this.capabilities = null;
    this.sent.clear();
    this.unwatch?.();
    this.unwatch = null;
    this.changed();
  }

  private event(raw: P.LanguageContextEvent) {
    const event = Schema.decodeUnknownSync(P.LanguageContextEvent)(raw);
    const context = this.context;

    if (context === null) return;
    this.observed(event);
    Match.value(event).pipe(
      Match.tag("Snapshot", (value) => {
        if (!sameContext(context, value.context)) return;

        if (!sameContext(context, value.ack.context)) {
          this.unavailable();

          return;
        }

        this.runtime(value.runtime);

        if (value.ack.acceptedSequence >= (this.ack?.acceptedSequence ?? 0)) this.ack = value.ack;
        this.changed();
      }),
      Match.tag("RuntimeChanged", (value) => {
        if (!sameContext(context, value.context)) return;
        this.runtime(value.runtime);
        this.changed();
      }),
      Match.tag("CapabilitiesChanged", (value) => {
        if (!sameContext(context, value.context)) return;
        this.capabilities = this.runtimeReady ? value.capabilities : null;
        this.triggers = value.registrations.flatMap((registration) => {
          if (registration.method !== "textDocument/completion") return [];

          const options = Schema.decodeUnknownOption(
            Schema.Struct({
              triggerCharacters: Schema.Array(Schema.String).check(Schema.isMaxLength(128)),
            })
          )(registration.registerOptions);

          return Option.isSome(options) ? options.value.triggerCharacters : [];
        });
        this.changed();
      }),
      Match.tag("Invalidated", (value) => {
        if (sameContext(context, value.context)) this.unavailable();
      }),
      Match.tag("ServerRequest", (value) => {
        if (sameContext(context, value.request.context)) this.serverRequest(value);
      }),
      Match.orElse(() => undefined)
    );
  }

  attach(buffer: SyncedBuffer): () => void {
    const uri = buffer.read().uri;
    this.buffers.set(uri, buffer);

    if (this.opening === null) {
      this.opening = this.enqueue(() => this.acquire());
      void this.opening.catch(() => this.unavailable());
    } else if (this.context !== null && this.capabilities !== null)
      void this.enqueue(() => this.deliverOpen(uri, buffer)).catch(() => this.unavailable());

    return () => {
      if (this.buffers.get(uri) !== buffer) return;
      this.buffers.delete(uri);
      this.dirty.delete(uri);
      void this.enqueue(async () => {
        const version = this.sent.get(uri);

        if (version === undefined) return;
        await this.deliver(P.LanguageDocumentNotification.cases.Close.make({ uri, version }));
        this.sent.delete(uri);
      }).catch(() => this.unavailable());

      if (this.buffers.size === 0)
        void this.tail.finally(() => {
          if (this.buffers.size === 0) this.dispose();
        });
    };
  }

  private async deliver(notification: P.LanguageDocumentNotification) {
    const context = this.context;

    if (context === null) throw new Error("Language context unavailable.");
    const sequence = this.sequence + 1;
    const epoch = this.epoch;

    const result = await this.api.request("languages.document.sync", {
      hostKey: this.hostKey,
      context,
      sequence,
      notification,
    });

    if (!result.ok) throw new Error(result.error.message);
    const ack = Schema.decodeUnknownSync(P.LanguageSyncAck)(result.value);

    const documents = Predicate.isTagged(notification, "Close")
      ? []
      : [{ uri: notification.uri, version: notification.version }];

    if (
      this.stopped ||
      epoch !== this.epoch ||
      ack.acceptedSequence !== sequence ||
      !P.languageFenceSatisfied({ context, requiredSequence: sequence, documents }, ack)
    )
      throw new Error("Language document acknowledgment changed.");
    this.sequence = sequence;
    this.ack = ack;
  }

  private async deliverOpen(uri: string, buffer: SyncedBuffer) {
    if (this.buffers.get(uri) !== buffer || this.sent.has(uri)) return;
    const value = buffer.read();
    await this.deliver(
      P.LanguageDocumentNotification.cases.Open.make({
        uri,
        version: value.version,
        languageId: documentLanguageId(buffer.language()),
        text: bufferText(value),
      })
    );
    this.sent.set(uri, value.version);
  }

  private async deliverLatest(uri: string, buffer: SyncedBuffer) {
    const value = buffer.read();
    const previousVersion = this.sent.get(uri);

    if (previousVersion === undefined) await this.deliverOpen(uri, buffer);
    else if (value.version > previousVersion) {
      await this.deliver(
        P.LanguageDocumentNotification.cases.Change.make({
          uri,
          previousVersion,
          version: value.version,
          changes: [{ text: bufferText(value) }],
        })
      );
      this.sent.set(uri, value.version);
    }
  }

  /** Coalesce a burst into the latest full unsaved text; never replay an old generation's changes. */
  edited(uri: string) {
    this.dirty.add(uri);
    this.changed();

    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;

      if (this.stopped) return;
      const uris = [...this.dirty];
      this.dirty.clear();

      if (this.capabilities === null) return;
      void this.enqueue(async () => {
        for (const key of uris) {
          const buffer = this.buffers.get(key);

          if (buffer === undefined) continue;
          await this.deliverLatest(key, buffer);
        }

        this.changed();
      }).catch(() => this.unavailable());
    });
  }

  async ready() {
    await this.opening;
    await this.tail;
  }
  isDisposed() {
    return this.stopped;
  }

  /** Context lifetime survives ordinary document edits; its acknowledgment still fences acceptance. */
  refactorContext(): { provider: LanguageProvider; signal: AbortSignal } | null {
    if (
      this.stopped ||
      this.lifetime.signal.aborted ||
      this.context === null ||
      this.ack === null ||
      this.capabilities === null
    )
      return null;

    return {
      signal: this.lifetime.signal,
      provider: {
        hostKey: this.hostKey,
        context: this.context,
        ack: this.ack,
        capabilities: this.capabilities,
      },
    };
  }

  provider(uri: string): LanguageProvider | null {
    const buffer = this.buffers.get(uri)?.read();

    if (
      buffer === undefined ||
      this.capabilities === null ||
      this.context === null ||
      this.ack === null ||
      this.sent.get(uri) !== buffer.version ||
      !P.languageFenceSatisfied(
        {
          context: this.context,
          requiredSequence: this.sequence,
          documents: [{ uri, version: buffer.version }],
        },
        this.ack
      )
    )
      return null;

    return {
      hostKey: this.hostKey,
      context: this.context,
      ack: this.ack,
      capabilities: this.capabilities,
      completionTriggerCharacters: this.triggers,
    };
  }

  saved(uri: string, version: number, diskVersion: P.FileVersion) {
    void this.enqueue(async () => {
      const buffer = this.buffers.get(uri);
      const provider = this.provider(uri);

      if (
        buffer === undefined ||
        provider === null ||
        !provider.capabilities.save ||
        buffer.read().version !== version
      )
        return;

      let notification: Extract<P.LanguageDocumentNotification, { readonly _tag: "Save" }> =
        P.LanguageDocumentNotification.cases.Save.make({ uri, version, diskVersion });

      if (provider.capabilities.saveIncludeText)
        notification = P.LanguageDocumentNotification.cases.Save.make({
          ...notification,
          text: bufferText(buffer.read()),
        });
      await this.deliver(notification);
      this.changed();
    }).catch(() => this.unavailable());
  }

  dispose() {
    if (this.stopped) return;
    this.stopped = true;
    this.lifetime.abort();
    this.epoch++;
    this.unwatch?.();
    this.unwatch = null;
    this.capabilities = null;

    if (this.context !== null)
      void this.api
        .request("languages.context.release", {
          hostKey: this.hostKey,
          context: this.context,
          interestId: this.acquisition.interestId,
        })
        .catch(() => undefined);
    this.changed();
    this.buffers.clear();
    this.sent.clear();
  }
}
