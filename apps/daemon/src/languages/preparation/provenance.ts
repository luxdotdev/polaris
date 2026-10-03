import * as P from "@polaris/protocol";
import { Schema } from "effect";
import { fingerprint } from "../../files/edits/journal.ts";

export interface ProposalPrincipal {
  readonly hostId: P.HostId;
  readonly clientId: string;
}

export type PreparedProposal = P.LanguageEditProposal | P.LanguageTreeEditProposal;

interface Evidence {
  readonly principal: ProposalPrincipal;
  readonly hash: string;
  readonly expiresAt: number;
  readonly validate: () => Promise<void>;
}

const unavailable = () =>
  new P.LanguageError({
    reason: "stale-document",
    message: "Current Host proposal evidence unavailable",
    retryable: false,
  });

const resourceCoverage = (proposal: PreparedProposal) => {
  const required = new Set<string>();

  for (const step of proposal.edit.documentChanges ?? []) {
    if (!("kind" in step)) continue;

    if (step.kind === "rename") {
      required.add(step.oldUri);
      required.add(step.newUri);
    } else required.add(step.uri);
  }

  if (required.size === 0) return;

  if (!("format" in proposal)) throw unavailable();
  const snapshots = proposal.resourceSnapshots;

  if (
    snapshots.length !== required.size ||
    snapshots.some((snapshot) => !required.has(snapshot.uri))
  )
    throw unavailable();
};

const metadata = (proposal: PreparedProposal) => {
  const object = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown))(proposal);

  const encoded =
    "format" in object || "resourceSnapshots" in object
      ? Schema.encodeSync(P.LanguageTreeEditProposal)(
          Schema.decodeUnknownSync(P.LanguageTreeEditProposal)(proposal)
        )
      : Schema.encodeSync(P.LanguageEditProposal)(
          Schema.decodeUnknownSync(P.LanguageEditProposal)(proposal)
        );

  const prepared = P.decodeLanguageResourceProposal(encoded);

  if (!("format" in object) && prepared.edit.documentChanges?.some((step) => "kind" in step))
    throw unavailable();

  resourceCoverage(prepared);

  return {
    key: fingerprint(prepared.proposalId),
    hash: fingerprint(encoded),
    expiresAt: prepared.expiresAt,
  };
};

/** Trusted Host preparation alone records evidence; validation closures retain authority, never proposal text. */
export class HostProposalEvidence {
  private readonly records = new Map<string, Evidence>();
  private disposed = false;
  private readonly revoked = new WeakSet<ProposalPrincipal>();
  private readonly epochs = new WeakMap<ProposalPrincipal, number>();

  constructor(private readonly now: () => number = Date.now) {}

  private prune() {
    if (this.disposed) throw unavailable();

    for (const [key, evidence] of this.records)
      if (evidence.expiresAt <= this.now()) this.records.delete(key);
  }

  private inspect(proposal: PreparedProposal) {
    this.prune();
    const value = metadata(proposal);

    if (value.expiresAt <= this.now() || value.expiresAt > this.now() + 60000) throw unavailable();

    return value;
  }

  private scope(principal: ProposalPrincipal, proposal: PreparedProposal) {
    if (
      this.revoked.has(principal) ||
      principal.hostId !== proposal.fence.context.hostId ||
      principal.clientId !== proposal.fence.context.clientId
    )
      throw unavailable();
  }

  async record(
    principal: ProposalPrincipal,
    proposal: PreparedProposal,
    validate: () => Promise<void>,
    signal?: AbortSignal
  ) {
    try {
      if (signal?.aborted) throw unavailable();
      this.scope(principal, proposal);
      const epoch = this.epochs.get(principal) ?? 0;
      const value = this.inspect(proposal);
      await validate();

      if (
        signal?.aborted ||
        (this.epochs.get(principal) ?? 0) !== epoch ||
        JSON.stringify(this.inspect(proposal)) !== JSON.stringify(value)
      )
        throw unavailable();
      await validate();

      if (
        signal?.aborted ||
        (this.epochs.get(principal) ?? 0) !== epoch ||
        JSON.stringify(this.inspect(proposal)) !== JSON.stringify(value)
      )
        throw unavailable();
      const previous = this.records.get(value.key);

      if (
        previous !== undefined &&
        (previous.principal !== principal || previous.hash !== value.hash)
      )
        throw unavailable();

      if (previous !== undefined) {
        await this.verify(principal, proposal);

        if (signal?.aborted) throw unavailable();

        return;
      }

      if (this.records.size >= 128) {
        const oldest = this.records.keys().next().value;

        if (oldest !== undefined) this.records.delete(oldest);
      }

      this.records.set(value.key, {
        principal,
        hash: value.hash,
        expiresAt: value.expiresAt,
        validate,
      });
    } catch {
      throw unavailable();
    }
  }

  private owned(principal: ProposalPrincipal, proposal: PreparedProposal) {
    this.scope(principal, proposal);
    const value = this.inspect(proposal);
    const evidence = this.records.get(value.key);

    if (evidence === undefined || evidence.principal !== principal || evidence.hash !== value.hash)
      throw unavailable();

    return evidence;
  }

  /** Call again after locks and asynchronous waits; this grants no durable draft or retry authority. */
  async verify(principal: ProposalPrincipal, proposal: PreparedProposal) {
    try {
      const evidence = this.owned(principal, proposal);
      await evidence.validate();

      if (this.owned(principal, proposal) !== evidence) throw unavailable();
      await evidence.validate();

      if (this.owned(principal, proposal) !== evidence) throw unavailable();
    } catch {
      throw unavailable();
    }
  }

  revoke(principal: ProposalPrincipal) {
    this.revoked.add(principal);
    this.epochs.set(principal, (this.epochs.get(principal) ?? 0) + 1);

    for (const [key, evidence] of this.records)
      if (evidence.principal === principal) this.records.delete(key);
  }

  dispose() {
    this.records.clear();
    this.disposed = true;
  }
}
