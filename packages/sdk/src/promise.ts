/**
 * The plain API, for Extensions that don't use Effect: Promises for calls,
 * async iterators for feeds. Errors are the same classes the Effect API fails
 * with (`NotGranted`, `HostUnreachable`…), thrown or rejected.
 */
import type { HostInfo } from "@polaris/protocol";
import { Effect, Exit, Scope, Stream } from "effect";
import {
  type ApprovalResponse,
  openPolaris,
  type Polaris,
  type PolarisOptions,
  type StartSessionInput,
  type SubscribeSessionOptions,
} from "./client.ts";
import type { OpenTransport } from "./connection.ts";
import type { HostView } from "./hostView.ts";
import type { HostEntry } from "./link.ts";
import type { SessionView } from "./sessionView.ts";

export interface PolarisClient {
  readonly hosts: ReadonlyArray<HostEntry>;
  connect(hostId: string): Promise<HostInfo>;
  /** Ends when the client closes; breaking out of the loop stops it. */
  subscribeHost(hostId: string): AsyncIterable<HostView>;
  subscribeHosts(): AsyncIterable<ReadonlyArray<HostView>>;
  subscribeSession(
    hostId: string,
    sessionId: string,
    options?: SubscribeSessionOptions
  ): AsyncIterable<SessionView>;
  sendTurn(hostId: string, sessionId: string, prompt: string): Promise<void>;
  respondToApproval(
    hostId: string,
    sessionId: string,
    requestId: string,
    response: ApprovalResponse
  ): Promise<void>;
  interrupt(hostId: string, sessionId: string): Promise<void>;
  continue(hostId: string, sessionId: string): Promise<void>;
  /** Resolves with the new session's id. */
  startSession(hostId: string, input: StartSessionInput): Promise<string>;
  /** Closes every connection; open feeds end. */
  close(): Promise<void>;
}

/** Wraps an Effect `Polaris` whose connections live in `scope`. */
export const promiseClient = (polaris: Polaris, scope: Scope.Closeable): PolarisClient => ({
  hosts: polaris.hosts,
  connect: (hostId) => Effect.runPromise(polaris.connect(hostId)),
  subscribeHost: (hostId) => Stream.toAsyncIterable(polaris.subscribeHost(hostId)),
  subscribeHosts: () => Stream.toAsyncIterable(polaris.subscribeHosts()),
  subscribeSession: (hostId, sessionId, options) =>
    Stream.toAsyncIterable(polaris.subscribeSession(hostId, sessionId, options)),
  sendTurn: (hostId, sessionId, prompt) =>
    Effect.runPromise(polaris.sendTurn(hostId, sessionId, prompt)),
  respondToApproval: (hostId, sessionId, requestId, response) =>
    Effect.runPromise(polaris.respondToApproval(hostId, sessionId, requestId, response)),
  interrupt: (hostId, sessionId) => Effect.runPromise(polaris.interrupt(hostId, sessionId)),
  continue: (hostId, sessionId) => Effect.runPromise(polaris.continue(hostId, sessionId)),
  startSession: (hostId, input) => Effect.runPromise(polaris.startSession(hostId, input)),
  close: () => Effect.runPromise(Scope.close(scope, Exit.void)),
});

/** `createPolaris` with a transport of your own. Rejects with `InvalidPairing`. */
export const createPolarisWith = async (
  options: PolarisOptions,
  openTransport: OpenTransport
): Promise<PolarisClient> => {
  const scope = Effect.runSync(Scope.make());

  const polaris = await Effect.runPromise(
    Scope.provide(openPolaris(options, openTransport), scope)
  );

  return promiseClient(polaris, scope);
};
