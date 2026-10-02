import { Predicate } from "effect";
import * as P from "@polaris/protocol";
import { LanguageAccess, languageFailure } from "./index.ts";

export type LanguageOpenSnapshot = Extract<
  P.LanguageDocumentNotification,
  { readonly _tag: "Open" }
>;

/** Buffers stay Client-owned; reconnect reads current full snapshots, never a notification replay. */
export class LanguageDocuments {
  private access: LanguageAccess | null = null;
  private context: P.LanguageContextIdentity | null = null;
  private ack: P.LanguageSyncAck | null = null;
  private sequence = 0;
  private epoch = 0;
  private generationEpoch = 0;
  private connection = new AbortController();
  private queued = 0;
  private tail: Promise<unknown> = Promise.resolve();
  private pending = new AbortController();

  constructor(
    private readonly acquire: (typeof P.AcquireLanguageContext)["payloadSchema"]["Type"],
    private readonly snapshots: () => ReadonlyArray<LanguageOpenSnapshot>
  ) {}

  invalidate() {
    this.epoch++;
    this.pending.abort();
    this.pending = new AbortController();
  }

  disconnect() {
    this.invalidate();
    this.generationEpoch++;
    this.connection.abort();
    this.connection = new AbortController();

    if (this.access !== null && this.context !== null) {
      void this.access
        .request("languages.context.release", {
          context: this.context,
          interestId: this.acquire.interestId,
        })
        .catch(() => undefined);
    }

    this.access = null;
    this.context = null;
    this.ack = null;
    this.sequence = 0;
  }

  private enqueue<A>(work: () => Promise<A>): Promise<A> {
    if (this.queued >= 32) return Promise.reject(languageFailure("queue-full"));
    this.queued++;

    const next = this.tail.then(work).finally(() => {
      this.queued--;
    });

    this.tail = next.catch(() => undefined);

    return next;
  }

  reconnect(access: LanguageAccess): Promise<void> {
    this.disconnect();
    this.access = access;
    const epoch = this.generationEpoch;
    const signal = this.connection.signal;

    return this.enqueue(async () => {
      if (epoch !== this.generationEpoch) throw languageFailure("stale-generation");
      const result = await access.request("languages.context.acquire", this.acquire, signal);

      if (epoch !== this.generationEpoch) throw languageFailure("stale-generation");

      if (
        result.context.clientId !== access.transport.clientId ||
        result.context.hostId !== access.transport.hostId
      )
        throw languageFailure("not-owner");
      this.context = result.context;
      this.ack = result.ack;
      this.sequence = result.ack.acceptedSequence;

      for (const snapshot of this.snapshots()) await this.deliver(snapshot);
    });
  }

  private async deliver(notification: P.LanguageDocumentNotification) {
    if (this.access === null || this.context === null) throw languageFailure("not-connected");
    const epoch = this.generationEpoch;
    const sequence = this.sequence + 1;
    const context = this.context;

    const ack = await this.access.request(
      "languages.document.sync",
      { context, sequence, notification },
      this.connection.signal
    );

    if (epoch !== this.generationEpoch) throw languageFailure("stale-generation");

    const documents = Predicate.isTagged(notification, "Close")
      ? []
      : [{ uri: notification.uri, version: notification.version }];

    if (
      ack.acceptedSequence !== sequence ||
      !P.languageFenceSatisfied({ context, requiredSequence: sequence, documents }, ack)
    )
      throw languageFailure("stale-document");
    this.sequence = sequence;
    this.ack = ack;
  }

  sync(notification: P.LanguageDocumentNotification): Promise<void> {
    this.invalidate();
    const epoch = this.generationEpoch;

    return this.enqueue(() => {
      if (epoch !== this.generationEpoch) throw languageFailure("stale-generation");

      return this.deliver(notification);
    });
  }

  async request(input: Omit<P.LanguageFeatureRequest, "fence">): Promise<P.LanguageFeatureResult> {
    const epoch = this.epoch;
    const signal = this.pending.signal;

    const prepared = await this.enqueue(async () => {
      if (epoch !== this.epoch) throw languageFailure("stale-document");

      if (this.access === null || this.context === null || this.ack === null)
        throw languageFailure("not-connected");
      const documents = this.snapshots().map(({ uri, version }) => ({ uri, version }));
      const fence = { context: this.context, requiredSequence: this.sequence, documents };

      if (!P.languageFenceSatisfied(fence, this.ack)) throw languageFailure("stale-document");

      return { access: this.access, fence };
    });

    const result = await prepared.access.request(
      "languages.request",
      { ...input, fence: prepared.fence },
      signal
    );

    if (
      epoch !== this.epoch ||
      this.ack === null ||
      result.requestId !== input.requestId ||
      !P.languageFenceSatisfied(result.fence, this.ack) ||
      !P.languageFenceSatisfied(
        {
          ...prepared.fence,
          documents: this.snapshots().map(({ uri, version }) => ({ uri, version })),
        },
        this.ack
      ) ||
      JSON.stringify(result.fence) !== JSON.stringify(prepared.fence)
    )
      throw languageFailure("stale-document");

    return result;
  }
}
