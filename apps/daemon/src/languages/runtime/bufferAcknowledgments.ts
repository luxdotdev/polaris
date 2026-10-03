import {
  LanguageContextIdentity,
  LanguageCounter,
  LanguageDocumentText,
  LanguageError,
  LanguageRequestFence,
  LanguageUri,
  languageFenceSatisfied,
} from "@polaris/protocol";
import { Schema } from "effect";
import type { Documents } from "./documents.ts";

export const AcknowledgedBuffer = Schema.Struct({
  uri: LanguageUri,
  version: LanguageCounter,
  text: LanguageDocumentText,
  draftRevision: LanguageCounter,
});

export type AcknowledgedBuffer = typeof AcknowledgedBuffer.Type;

/** Supplied afresh by actual connection membership and current owned runtime context, never a request. */
export interface BufferAcknowledgmentAuthority {
  readonly principal: object;
  readonly context: LanguageContextIdentity;
  readonly documents: Documents;
  readonly signal: AbortSignal;
}

export interface BufferAcknowledgmentLimits {
  readonly entries: number;
  readonly bytes: number;
}

interface Entry {
  readonly buffer: AcknowledgedBuffer;
  readonly document: NonNullable<ReturnType<Documents["open"]["get"]>>;
  readonly bytes: number;
}

const unavailable = () =>
  new LanguageError({
    reason: "stale-document",
    message: "Authenticated buffer acknowledgment unavailable",
    retryable: true,
  });

const identity = (context: LanguageContextIdentity) => {
  try {
    return JSON.stringify(Schema.encodeSync(LanguageContextIdentity)(context));
  } catch {
    throw unavailable();
  }
};

const resolveAuthority = (authority: () => BufferAcknowledgmentAuthority | null) => {
  try {
    return authority();
  } catch {
    throw unavailable();
  }
};

/** One exact connection/context lifetime; replacement requires a fresh store. No document text is logged. */
export class BufferAcknowledgments {
  private readonly entries = new Map<string, Entry>();
  private readonly initial: BufferAcknowledgmentAuthority;
  private readonly context: string;
  private bytes = 0;
  private disposed = false;
  private readonly abort = () => this.dispose();

  constructor(
    private readonly authority: () => BufferAcknowledgmentAuthority | null,
    private readonly limits: BufferAcknowledgmentLimits = { entries: 1024, bytes: 8388608 }
  ) {
    const initial = resolveAuthority(authority);

    if (
      initial === null ||
      initial.signal.aborted ||
      !Number.isSafeInteger(limits.entries) ||
      limits.entries < 1 ||
      limits.entries > 1024 ||
      !Number.isSafeInteger(limits.bytes) ||
      limits.bytes < 1 ||
      limits.bytes > 8388608
    )
      throw unavailable();
    this.initial = initial;
    this.context = identity(initial.context);
    initial.signal.addEventListener("abort", this.abort, { once: true });
    this.current();
  }

  private current() {
    try {
      return this.checkedCurrent();
    } catch {
      this.dispose();
      throw unavailable();
    }
  }

  private checkedCurrent() {
    const current = resolveAuthority(this.authority);

    if (
      this.disposed ||
      current === null ||
      current.signal.aborted ||
      current.principal !== this.initial.principal ||
      current.signal !== this.initial.signal ||
      current.documents !== this.initial.documents ||
      identity(current.context) !== this.context ||
      identity(current.documents.context) !== this.context
    ) {
      this.dispose();
      throw unavailable();
    }

    return current;
  }

  private mirrored(fence: LanguageRequestFence, uri: string) {
    const current = this.current();
    const document = current.documents.open.get(uri);
    const ack = current.documents.ack();

    if (
      document === undefined ||
      !languageFenceSatisfied(fence, ack) ||
      !fence.documents.some((item) => item.uri === uri && item.version === document.version)
    )
      throw unavailable();

    return document;
  }

  /** Called only after the Host has accepted the document sync; supplied fields remain untrusted. */
  record(fenceInput: LanguageRequestFence, bufferInput: AcknowledgedBuffer): void {
    try {
      const fence = Schema.decodeUnknownSync(LanguageRequestFence)(fenceInput);
      const buffer = Schema.decodeUnknownSync(AcknowledgedBuffer)(bufferInput);
      const document = this.mirrored(fence, buffer.uri);

      if (document.version !== buffer.version || document.text !== buffer.text) throw unavailable();
      const prior = this.entries.get(buffer.uri);

      if (prior?.document === document && buffer.draftRevision < prior.buffer.draftRevision)
        throw unavailable();
      const bytes = Buffer.byteLength(buffer.text) + Buffer.byteLength(buffer.uri);
      const total = this.bytes - (prior?.bytes ?? 0) + bytes;

      if (
        total > this.limits.bytes ||
        (prior === undefined && this.entries.size >= this.limits.entries)
      )
        throw unavailable();
      this.current();
      this.entries.set(buffer.uri, { buffer: Object.freeze({ ...buffer }), document, bytes });
      this.bytes = total;
    } catch {
      throw unavailable();
    }
  }

  /** The preparation adapter passes its independently delivered fence and re-reads after every wait. */
  read(fenceInput: LanguageRequestFence, uriInput: string): AcknowledgedBuffer {
    try {
      const fence = Schema.decodeUnknownSync(LanguageRequestFence)(fenceInput);
      const uri = Schema.decodeUnknownSync(LanguageUri)(uriInput);
      const document = this.mirrored(fence, uri);
      const entry = this.entries.get(uri);

      if (
        entry === undefined ||
        entry.document !== document ||
        entry.buffer.version !== document.version ||
        entry.buffer.text !== document.text
      ) {
        this.close(uri);
        throw unavailable();
      }

      this.current();

      return Object.freeze({ ...entry.buffer });
    } catch {
      throw unavailable();
    }
  }

  /** Wire this to Host document close; mirror object identity also rejects close/reopen ABA. */
  close(uri: string): void {
    const prior = this.entries.get(uri);

    if (prior === undefined) return;
    this.entries.delete(uri);
    this.bytes -= prior.bytes;
  }

  /** Wire to context replacement/release and connection teardown, in addition to the owned signal. */
  dispose(): void {
    this.disposed = true;
    this.entries.clear();
    this.bytes = 0;
    this.initial.signal.removeEventListener("abort", this.abort);
  }
}
