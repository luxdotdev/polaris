import type { LanguageContextIdentity } from "@polaris/protocol";
import type { DiscoveryFacts } from "../discovery/index.ts";
import type { Launch } from "./process.ts";
import { OrderedConnection, type ProcessPort } from "../transport/index.ts";
import { failure } from "../transport/framing.ts";

export interface LaunchAdmissionRequest {
  context: LanguageContextIdentity;
  facts: DiscoveryFacts;
  signal: AbortSignal;
  isCurrent: () => boolean;
}

export interface LaunchSelectionLease {
  selectionIdentity: string;
  validate: (signal: AbortSignal) => Promise<void>;
  assertCurrent: () => void;
  release: () => Promise<void>;
}

export const blockedLaunchReasons = new Set([
  "queue-full",
  "missing-prerequisite",
  "not-installed",
  "audit-required",
  "unsupported-platform",
]);

type ConnectionSettlement = {
  close: (graceful?: boolean) => Promise<void>;
  settlement: () => Promise<void>;
};

/** Own selection exclusion through unbounded raw settlement; a failed close deadline never releases it. */
export class LaunchAdmission {
  private readonly controller = new AbortController();
  readonly request: LaunchAdmissionRequest;
  private lease: LaunchSelectionLease | undefined;
  private pending: Promise<LaunchSelectionLease> | undefined;
  private port: ProcessPort | undefined;
  private connection: ConnectionSettlement | undefined;
  private releasing: Promise<void> | undefined;
  private closing: Promise<void> | undefined;

  constructor(context: LanguageContextIdentity, facts: DiscoveryFacts, isCurrent: () => boolean) {
    this.request = { context, facts, signal: this.controller.signal, isCurrent };
  }

  get spawned() {
    return this.port !== undefined;
  }

  abort() {
    this.controller.abort();
  }

  private assertRequest() {
    if (this.request.signal.aborted || !this.request.isCurrent())
      throw failure("stale-generation", "Launch generation is no longer current");
  }

  async acquire(reserve?: (request: LaunchAdmissionRequest) => Promise<LaunchSelectionLease>) {
    this.assertRequest();

    if (reserve === undefined)
      throw failure("audit-required", "Launch selection admission is unavailable");
    this.pending = reserve(this.request).then((lease) => {
      this.lease = lease;

      return lease;
    });
    const lease = await this.pending;
    await this.validate();

    return lease;
  }

  async validate() {
    this.assertRequest();
    const lease = this.lease;

    if (lease === undefined)
      throw failure("audit-required", "Launch selection lease is unavailable");
    await lease.validate(this.request.signal);
    this.assertRequest();
    lease.assertCurrent();
  }

  async resolve(
    reserve: ((request: LaunchAdmissionRequest) => Promise<LaunchSelectionLease>) | undefined,
    resolveLaunch: (
      facts: DiscoveryFacts,
      lease: LaunchSelectionLease,
      request: LaunchAdmissionRequest
    ) => Promise<Launch>,
    trust: () => Promise<void>
  ) {
    const lease = await this.acquire(reserve);
    const launch = await resolveLaunch(this.request.facts, lease, this.request);
    await this.validate();
    await trust();
    await this.validate();

    return launch;
  }

  connect(
    invoke: () => ProcessPort,
    receive: ConstructorParameters<typeof OrderedConnection>[1],
    onClose: ConstructorParameters<typeof OrderedConnection>[2]
  ) {
    const port = this.spawn(invoke);
    const connection = new OrderedConnection(port, receive, onClose);
    this.attach(connection);

    return { port, connection };
  }

  spawn(invoke: () => ProcessPort) {
    this.assertRequest();

    if (this.lease === undefined)
      throw failure("audit-required", "Launch selection lease is unavailable");
    this.lease.assertCurrent();
    const port = invoke();
    this.port = port;

    return port;
  }

  attach(connection: ConnectionSettlement) {
    this.connection = connection;
  }

  private release() {
    this.releasing ??= (async () => {
      await this.pending?.catch(() => undefined);
      await this.lease?.release();
    })();

    return this.releasing;
  }

  releaseUnstarted() {
    return this.port === undefined ? this.release() : Promise.resolve();
  }

  close(graceful = false) {
    this.abort();
    this.closing ??= (async () => {
      await this.pending?.catch(() => undefined);

      if (this.connection !== undefined) {
        const closing = this.connection.close(graceful);
        await Promise.all([closing, this.connection.settlement(), this.port?.exited]);
      } else if (this.port !== undefined)
        await Promise.all([this.port.stop(graceful), this.port.exited]);
      await this.release();
    })();

    return this.closing;
  }
}
