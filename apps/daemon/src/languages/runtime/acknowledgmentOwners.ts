import {
  LanguageBufferAcknowledgmentReceipt,
  type LanguageConnectionIdentity,
  type LanguageContextIdentity,
  type LanguageRequestFence,
  type LanguageDocumentNotification,
} from "@polaris/protocol";
import { Predicate } from "effect";
import { BufferAcknowledgments, type AcknowledgedBuffer } from "./bufferAcknowledgments.ts";
import type { Entry } from "./types.ts";
import { enqueue } from "./queue.ts";
import { failure } from "../transport/framing.ts";

interface Owner {
  principal: LanguageConnectionIdentity;
  controller: AbortController;
  store: BufferAcknowledgments;
  bytes: Map<string, number>;
}

const stale = () =>
  failure("stale-document", "Current authenticated document acknowledgment unavailable");

/** Private per-entry mirrors; the complete Host acknowledgment text budget is at most 8 MiB. */
export class AcknowledgmentOwners {
  private readonly owners = new Map<Entry, Owner>();
  private bytes = 0;

  constructor(
    private readonly owned: (clientId: string, context: LanguageContextIdentity) => Entry
  ) {}

  private owner(entry: Entry, principal: LanguageConnectionIdentity, current: () => boolean) {
    if (!current()) throw stale();
    const old = this.owners.get(entry);

    if (old !== undefined) {
      if (old.principal !== principal || old.controller.signal.aborted) throw stale();

      return old;
    }

    if (this.owners.size >= 64)
      throw failure("queue-full", "Host acknowledgment context limit reached");
    const identity = entry.identity;
    const documents = entry.documents;
    const controller = new AbortController();

    const authority = () => {
      try {
        if (
          !current() ||
          controller.signal.aborted ||
          entry.identity !== identity ||
          entry.documents !== documents ||
          this.owned(principal.clientId, identity) !== entry
        )
          return null;

        return { principal, context: identity, documents, signal: controller.signal };
      } catch {
        return null;
      }
    };

    const owner = {
      principal,
      controller,
      store: new BufferAcknowledgments(authority),
      bytes: new Map<string, number>(),
    };

    this.owners.set(entry, owner);

    return owner;
  }

  record(
    principal: LanguageConnectionIdentity,
    current: () => boolean,
    fence: LanguageRequestFence,
    buffer: AcknowledgedBuffer
  ) {
    if (!current()) throw stale();
    const entry = this.owned(principal.clientId, fence.context);

    return enqueue(entry, async () => {
      if (!current() || this.owned(principal.clientId, fence.context) !== entry) throw stale();
      const owner = this.owner(entry, principal, current);
      const bytes = Buffer.byteLength(buffer.text) + Buffer.byteLength(buffer.uri);
      const total = this.bytes - (owner.bytes.get(buffer.uri) ?? 0) + bytes;

      if (total > 8388608) throw failure("too-large", "Host acknowledgment text budget reached");
      owner.store.record(fence, buffer);
      const acknowledged = owner.store.read(fence, buffer.uri);
      owner.bytes.set(buffer.uri, bytes);
      this.bytes = total;

      if (!current()) throw stale();

      return LanguageBufferAcknowledgmentReceipt.make({
        context: entry.identity,
        uri: acknowledged.uri,
        version: acknowledged.version,
        draftRevision: acknowledged.draftRevision,
        acceptedSequence: entry.documents.ack().acceptedSequence,
      });
    });
  }

  read(
    principal: LanguageConnectionIdentity,
    current: () => boolean,
    fence: LanguageRequestFence,
    uri: string
  ) {
    if (!current()) throw stale();
    const entry = this.owned(principal.clientId, fence.context);
    const owner = this.owners.get(entry);

    if (owner === undefined || owner.principal !== principal) throw stale();

    return owner.store.read(fence, uri);
  }

  /** Host-only mirror metadata; missing acknowledgment never turns an open mirror into a closed file. */
  document(
    principal: LanguageConnectionIdentity,
    current: () => boolean,
    fence: LanguageRequestFence,
    uri: string
  ) {
    if (!current() || principal.hostId !== fence.context.hostId) throw stale();
    const entry = this.owned(principal.clientId, fence.context);
    entry.documents.fence(fence);
    const document = entry.documents.open.get(uri);

    if (!current() || this.owned(principal.clientId, fence.context) !== entry) throw stale();

    return document === undefined
      ? null
      : Object.freeze({ version: document.version, text: document.text });
  }

  synchronized(entry: Entry, notification: LanguageDocumentNotification) {
    const owner = this.owners.get(entry);

    if (owner !== undefined && !Predicate.isTagged(notification, "Save")) {
      owner.store.close(notification.uri);
      this.bytes -= owner.bytes.get(notification.uri) ?? 0;
      owner.bytes.delete(notification.uri);
    }
  }

  retire(entry: Entry) {
    const owner = this.owners.get(entry);

    if (owner === undefined) return;
    owner.controller.abort();
    owner.store.dispose();

    for (const bytes of owner.bytes.values()) this.bytes -= bytes;
    this.owners.delete(entry);
  }

  disconnect(principal: LanguageConnectionIdentity) {
    for (const [entry, owner] of this.owners) {
      if (owner.principal === principal) this.retire(entry);
    }
  }
}
