import { ProcessBudget } from "./process-budget.ts";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  LanguageContextIdentity,
  LanguageContextEvent,
  LanguageContextSnapshot,
  LanguageEffectiveSettings,
  LanguageError,
  LanguageFeatureRequest,
  LanguageFeatureResult,
  LanguageLimits,
  LanguageKey,
  LanguageCheckout,
  LanguagePath,
  LanguageJsonObject,
  LanguageRequestFence,
  LanguageRuntime,
  LanguageSyncInput,
  LanguageServerResponse,
  LanguageMethod,
  LanguageDeadline,
} from "@polaris/protocol";
import type { LanguageJson } from "@polaris/protocol";
import { Schema } from "effect";
import type { DiscoveryFacts } from "../discovery/index.ts";
import { checkoutKey, checkoutPath } from "../trust/index.ts";
import { OrderedConnection } from "../transport/index.ts";
import { failure } from "../transport/framing.ts";
import { notificationMessage, clientCapabilities, drainStderr } from "./wire.ts";
import { ContextEvents } from "./events.ts";
import { Documents } from "./documents.ts";
import { decideLifecycle, lifecycleInitial, type LifecycleEvent } from "./lifecycle.ts";
import { negotiate } from "./capabilities.ts";
import { ServerBridge } from "./server.ts";
import { spawnLanguageProcess } from "./process.ts";

export { LanguageBroker } from "./service.ts";

export { spawnLanguageProcess } from "./process.ts";

export type { Launch } from "./process.ts";

export const limits = LanguageLimits.make({
  messageBytes: 1048576,
  queuedMessages: 256,
  outstandingRequests: 64,
  documents: 1024,
  diagnosticsPerDocument: 2000,
  logBytes: 65536,
  requestTimeoutMs: 10000,
});

const Acquire = Schema.Struct({
  clientId: LanguageKey,
  contextId: LanguageKey,
  interestId: LanguageKey,
  checkout: LanguageCheckout,
  path: LanguagePath,
  providerId: LanguageKey,
  settings: LanguageEffectiveSettings,
  refresh: Schema.optionalKey(Schema.Boolean),
});

export type { AcquireInput, BrokerOptions } from "./types.ts";

import type { AcquireInput, BrokerOptions, Entry } from "./types.ts";

const sameIdentity = (a: LanguageContextIdentity, b: LanguageContextIdentity) =>
  JSON.stringify(a) === JSON.stringify(b);

const contextKey = (clientId: string, facts: DiscoveryFacts) =>
  JSON.stringify([
    clientId,
    checkoutKey(facts.checkout),
    facts.checkout.path,
    facts.projectRoot,
    facts.providerId,
    facts.configurationFingerprint,
  ]);

/** Detached Host broker. The caller binds clientId to its authenticated existing connection. */
export function createLanguageBroker(options: BrokerOptions) {
  const entries = new Map<string, Entry>();
  const keys = new Map<string, Entry>();
  let generation = 0;
  let closed = false;
  let acquiring = 0;
  const acquisitions = new Set<{ clientId: string; cancelled: boolean }>();
  let documentBytes = 0;
  const processBudget = new ProcessBudget();

  const documents = (context: LanguageContextIdentity) =>
    new Documents(context, (delta) => {
      if (documentBytes + delta > 33554432)
        throw failure("too-large", "Host draft input budget reached");
      documentBytes += delta;
    });

  const cleanup = new Set<Promise<void>>();

  function track(promise: Promise<void>) {
    cleanup.add(promise);
    void promise.finally(() => cleanup.delete(promise)).catch(() => {});
  }

  function event(entry: Entry, value: LanguageContextEvent) {
    entry.events.emit(value);
  }

  function state(entry: Entry, value: typeof LanguageRuntime.Type) {
    entry.runtime = value;
    event(
      entry,
      LanguageContextEvent.cases.RuntimeChanged.make({ context: entry.identity, runtime: value })
    );
  }

  function move(entry: Entry, input: LifecycleEvent) {
    entry.lifecycle = decideLifecycle(entry.lifecycle, input);
    options.observeLifecycle?.({ event: input, phase: String(entry.lifecycle.value) });
  }

  function demanded(entry: Entry) {
    return entry.documents.open.size > 0;
  }

  function active(entry: Entry, identity: LanguageContextIdentity) {
    return (
      !closed &&
      entries.get(entry.identity.contextId) === entry &&
      sameIdentity(entry.identity, identity)
    );
  }

  function snapshot(entry: Entry) {
    return LanguageContextSnapshot.make({
      context: entry.identity,
      runtime: entry.runtime,
      ack: entry.documents.ack(),
      limits,
    });
  }

  function owned(clientId: string, input: LanguageContextIdentity) {
    const identity = Schema.decodeUnknownSync(LanguageContextIdentity)(input);

    if (identity.clientId !== clientId)
      throw failure("not-owner", "Context belongs to another Client");
    const entry = entries.get(identity.contextId);

    if (entry === undefined || !sameIdentity(identity, entry.identity))
      throw failure("stale-generation", "Language context generation changed");

    return entry;
  }

  function enqueue<A>(entry: Entry, operation: () => Promise<A>): Promise<A> {
    if (entry.queued >= 256)
      return Promise.reject(failure("queue-full", "Language command queue full"));
    entry.queued++;
    const result = entry.tail.then(operation);
    entry.tail = result.then(
      () => {},
      () => {}
    );
    void result.finally(() => entry.queued--).catch(() => {});

    return result;
  }

  function retire(
    entry: Entry,
    reason: "connection-lost" | "restart" | "settings-changed" | "closed",
    graceful = false
  ) {
    if (entry.timer !== undefined) clearTimeout(entry.timer);
    entry.timer = undefined;
    const identity = entry.identity;
    event(entry, LanguageContextEvent.cases.Invalidated.make({ context: identity, reason }));
    const connection = entry.connection;
    entry.connection = undefined;
    entry.stderrAbort?.abort();
    entry.stderrAbort = undefined;
    entry.bridge?.close();
    entry.bridge = undefined;
    entry.operations.clear();
    entry.capabilities = undefined;
    entry.identity = LanguageContextIdentity.make({ ...identity, generation: ++generation });
    entry.documents.clear();
    entry.documents = documents(entry.identity);

    if (connection !== undefined) {
      track(connection.close(graceful));
      track(connection.settlement());
    }
  }

  async function trusted(entry: Entry) {
    try {
      return await options.requireTrust(entry.facts.checkout);
    } catch (error) {
      move(entry, { type: "revoke" });
      retire(entry, "settings-changed");
      state(entry, LanguageRuntime.cases.AwaitingTrust.make({}));
      throw error;
    }
  }

  function onCrash(entry: Entry, identity: LanguageContextIdentity) {
    if (!active(entry, identity) || entry.lifecycle.matches("stopped")) return;
    const hadDemand = demanded(entry);
    const retry = hadDemand && entry.attempts < 2;
    move(entry, { type: "crash", retry });
    retire(entry, "restart");
    entry.attempts++;
    state(
      entry,
      LanguageRuntime.cases.Failed.make({
        message: "Language server failed",
        attempts: entry.attempts,
        retryAt: retry ? Date.now() + (options.retryMs ?? 250) * entry.attempts : null,
      })
    );

    if (retry)
      entry.timer = setTimeout(
        () => {
          entry.timer = undefined;
          move(entry, { type: "retry" });
          // A new generation waits for current Client snapshots; old edits are never replayed.
          state(entry, LanguageRuntime.cases.Stopped.make({ reason: "replaced" }));

          if (demanded(entry)) ensureStart(entry);
        },
        (options.retryMs ?? 250) * entry.attempts
      );
  }

  function serverSettings(entry: Entry): typeof LanguageJsonObject.Type {
    const settings = entry.facts.effectiveSettings.settings;

    return (
      settings.customServers?.find(({ id }) => id === entry.facts.providerId)?.settings ??
      settings.serverSettings?.[entry.facts.providerId] ??
      {}
    );
  }

  function initialization(entry: Entry): typeof LanguageJsonObject.Type {
    const settings = entry.facts.effectiveSettings.settings;

    return (
      settings.customServers?.find(({ id }) => id === entry.facts.providerId)
        ?.initializationOptions ?? {}
    );
  }

  async function start(entry: Entry) {
    const identity = entry.identity;
    move(entry, { type: "demand" });
    state(entry, LanguageRuntime.cases.Starting.make({}));

    let reservation: ReturnType<typeof processBudget.reserve> | undefined;

    try {
      reservation = processBudget.reserve();
      await trusted(entry);
      const launch = await options.resolveLaunch(entry.facts);
      await trusted(entry);

      if (!active(entry, identity) || !demanded(entry)) return;
      const port = reservation.spawn(() => (options.spawn ?? spawnLanguageProcess)(launch));

      const connection = new OrderedConnection(
        port,
        (message) => entry.bridge?.receive(message),
        () => onCrash(entry, identity)
      );

      entry.connection = connection;

      const bridge = new ServerBridge({
        context: identity,
        documents: entry.documents,
        connection,
        settings: serverSettings(entry),
        emit: (value) => {
          if (active(entry, identity)) event(entry, value);
        },
        current: () => active(entry, identity),
        authorize: async () => {
          await trusted(entry);
        },
        prepareEdit: options.prepareEdit,
        capabilities: (value) => {
          if (active(entry, identity)) entry.capabilities = value;
        },
      });

      entry.bridge = bridge;
      const stderrAbort = new AbortController();
      entry.stderrAbort = stderrAbort;
      track(
        drainStderr(
          port.stderr,
          (bytes) => {
            if (bytes > 65536) onCrash(entry, identity);
            else if (bytes > 0 && active(entry, identity))
              event(
                entry,
                LanguageContextEvent.cases.Log.make({
                  context: identity,
                  level: "warning",
                  message: "Language server wrote stderr; private output withheld",
                })
              );
          },
          stderrAbort.signal
        )
      );
      void port.exited.then(() => onCrash(entry, identity));

      const initialized = await connection.request("initialize", {
        processId: process.pid,
        rootUri: pathToFileURL(entry.facts.projectRoot).href,
        workspaceFolders: [{ uri: pathToFileURL(entry.facts.projectRoot).href, name: "project" }],
        capabilities: clientCapabilities,
        initializationOptions: initialization(entry),
        clientInfo: { name: "Polaris" },
      }).result;

      if (!active(entry, identity)) return;
      const capabilities = negotiate(initialized);
      await trusted(entry);
      await connection.send({ jsonrpc: "2.0", method: "initialized", params: {} });
      await connection.send({
        jsonrpc: "2.0",
        method: "workspace/didChangeConfiguration",
        params: { settings: serverSettings(entry) },
      });

      if (!active(entry, identity)) return;
      await enqueue(entry, async () => {
        if (!active(entry, identity)) return;

        for (const document of entry.documents.open.values()) {
          if (capabilities.openClose)
            await connection.send({
              jsonrpc: "2.0",
              method: "textDocument/didOpen",
              params: { textDocument: document },
            });
        }

        if (!active(entry, identity)) return;
        entry.capabilities = capabilities;
        bridge.setBase(capabilities);
        move(entry, { type: "ready" });
        state(entry, LanguageRuntime.cases.Ready.make({ capabilities: entry.capabilities }));
      });
      scheduleGrace(entry);
    } catch (error) {
      if (!active(entry, identity)) return;

      if (
        Schema.is(LanguageError)(error) &&
        [
          "queue-full",
          "missing-prerequisite",
          "not-installed",
          "audit-required",
          "unsupported-platform",
        ].includes(error.reason)
      ) {
        move(entry, { type: "stop" });
        state(
          entry,
          LanguageRuntime.cases.Failed.make({
            message: error.message,
            attempts: entry.attempts,
            retryAt: null,
          })
        );
      } else onCrash(entry, identity);
    } finally {
      reservation?.releaseUnstarted();
    }
  }

  function ensureStart(entry: Entry) {
    if (
      entry.connection !== undefined ||
      entry.starting !== undefined ||
      entry.attempts > 2 ||
      entry.timer !== undefined
    )
      return;
    const operation = start(entry);
    entry.starting = operation;
    track(
      operation.finally(() => {
        if (entry.starting === operation) entry.starting = undefined;
      })
    );
  }

  function scheduleGrace(entry: Entry) {
    if (demanded(entry) || entry.interests.size > 0 || entry.timer !== undefined) return;
    move(entry, { type: "empty" });
    entry.timer = setTimeout(() => {
      entry.timer = undefined;
      move(entry, { type: "grace" });
      entries.delete(entry.identity.contextId);
      keys.delete(contextKey(entry.input.clientId, entry.facts));
      track(shutdown(entry).finally(() => entry.events.close()));
    }, options.graceMs ?? 1500);
  }

  async function shutdown(entry: Entry) {
    const connection = entry.connection;

    if (connection !== undefined) {
      try {
        await connection.request("shutdown", {}, 500).result;
        await connection.send({ jsonrpc: "2.0", method: "exit" });
      } catch {
        /* Cleanup continues after bounded graceful shutdown. */
      }
    }

    retire(entry, "closed", true);
    state(entry, LanguageRuntime.cases.Stopped.make({ reason: "no-demand" }));
    await connection?.close(true);
  }

  async function acquire(clientId: string, payload: AcquireInput) {
    const input = Schema.decodeUnknownSync(Acquire)(payload);

    if (closed) throw failure("not-connected", "Language broker closed");

    if (clientId !== input.clientId) throw failure("not-owner", "Client identity mismatch");

    if (acquiring >= 8) throw failure("queue-full", "Language acquisition limit reached");
    acquiring++;
    const acquisition = { clientId, cancelled: false };
    acquisitions.add(acquisition);

    try {
      const facts = await options.discover(input);

      if (closed || acquisition.cancelled)
        throw failure("not-connected", "Language acquisition disconnected");
      const key = contextKey(clientId, facts);
      const existing = keys.get(key);

      if (existing !== undefined) {
        if (existing.interests.size >= 1024)
          throw failure("queue-full", "Language interest limit reached");
        existing.interests.add(input.interestId);

        if (existing.timer !== undefined && existing.lifecycle.matches("grace")) {
          clearTimeout(existing.timer);
          existing.timer = undefined;
          move(existing, { type: "demand" });
        }

        return snapshot(existing);
      }

      if (entries.size >= 32) throw failure("queue-full", "Language context limit reached");

      if (entries.has(input.contextId))
        throw failure("conflict", "Context identifier already used");

      const identity = LanguageContextIdentity.make({
        hostId: options.hostId,
        clientId,
        contextId: input.contextId,
        checkout: facts.checkout,
        providerId: facts.providerId,
        projectRoot: facts.projectRoot,
        configurationFingerprint: facts.configurationFingerprint,
        generation: ++generation,
      });

      const entry: Entry = {
        input,
        facts,
        identity,
        documents: documents(identity),
        interests: new Set([input.interestId]),
        events: new ContextEvents(),
        lifecycle: lifecycleInitial(),
        runtime: LanguageRuntime.cases.Stopped.make({ reason: "no-demand" }),
        attempts: 0,
        operations: new Map(),
        tail: Promise.resolve(),
        queued: 0,
      };

      entries.set(identity.contextId, entry);
      keys.set(key, entry);

      return snapshot(entry);
    } finally {
      acquisitions.delete(acquisition);
      acquiring--;
    }
  }

  async function sync(clientId: string, input: LanguageSyncInput) {
    const valid = Schema.decodeUnknownSync(LanguageSyncInput)(input);
    const entry = owned(clientId, valid.context);

    return enqueue(entry, async () => {
      owned(clientId, valid.context);
      const canonical = await trusted(entry);
      await checkoutPath(canonical, fileURLToPath(valid.notification.uri));
      owned(clientId, valid.context);

      const document = entry.documents.apply(
        valid.sequence,
        valid.notification,
        entry.capabilities?.positionEncoding ?? "utf-16"
      );

      for (const [key, operation] of entry.operations) {
        try {
          entry.documents.fence(operation.fence);
        } catch {
          entry.connection?.cancel(operation.id);
          entry.operations.delete(key);
        }
      }

      if (entry.capabilities !== undefined && entry.connection !== undefined) {
        const message = notificationMessage(valid.notification, document, entry.capabilities);

        if (message !== undefined) await entry.connection.send({ jsonrpc: "2.0", ...message });
      }

      if (demanded(entry)) {
        if (entry.lifecycle.matches("grace") && entry.timer !== undefined) {
          clearTimeout(entry.timer);
          entry.timer = undefined;
          move(entry, { type: "demand" });
        }

        ensureStart(entry);
      } else scheduleGrace(entry);
      const ack = entry.documents.ack();
      event(entry, LanguageContextEvent.cases.Synchronized.make({ ack }));

      return ack;
    });
  }

  async function requestRaw(
    clientId: string,
    requestId: string,
    inputFence: LanguageRequestFence,
    inputMethod: string,
    payload: typeof LanguageJsonObject.Type,
    inputDeadline: number,
    signal?: AbortSignal
  ): Promise<typeof LanguageJson.Type> {
    const fence = Schema.decodeUnknownSync(LanguageRequestFence)(inputFence);
    const method = Schema.decodeUnknownSync(LanguageMethod)(inputMethod);
    const params = Schema.decodeUnknownSync(LanguageJsonObject)(payload);
    const deadline = Schema.decodeUnknownSync(LanguageDeadline)(inputDeadline);

    if (signal?.aborted) throw failure("cancelled", "Language request cancelled");
    const entry = owned(clientId, fence.context);

    const operation = await enqueue(entry, async () => {
      if (signal?.aborted) throw failure("cancelled", "Language request cancelled");
      owned(clientId, fence.context);
      await trusted(entry);
      entry.documents.fence(fence);
      const connection = entry.connection;

      if (
        !entry.lifecycle.matches("ready") ||
        connection === undefined ||
        entry.capabilities === undefined
      )
        throw failure("not-ready", "Language server is not ready");

      if (!entry.capabilities.methods.includes(method))
        throw failure("unsupported-capability", "Server does not support this method");

      if (entry.operations.has(requestId))
        throw failure("conflict", "Request identifier already pending");

      if (method === "workspace/executeCommand") {
        const command = Schema.decodeUnknownSync(Schema.Struct({ command: Schema.String }))(
          params
        ).command;

        if (!entry.capabilities.executeCommands.includes(command))
          throw failure("unsupported-capability", "Server command not offered");
      }

      const left = deadline - Date.now();

      if (left <= 0) throw failure("timeout", "Language request deadline expired");

      const documentParams = Schema.decodeUnknownSync(
        Schema.Struct({ textDocument: Schema.optionalKey(Schema.Struct({ uri: Schema.String })) })
      )(params);

      if (documentParams.textDocument !== undefined) {
        if (!fence.documents.some(({ uri }) => uri === documentParams.textDocument?.uri))
          throw failure("stale-document", "Request document missing from fence");
        const canonical = await trusted(entry);
        await checkoutPath(canonical, fileURLToPath(documentParams.textDocument.uri));
      }

      owned(clientId, fence.context);
      entry.documents.fence(fence);

      if (signal?.aborted) throw failure("cancelled", "Language request cancelled");
      const pending = connection.request(method, params, left);
      entry.operations.set(requestId, { id: pending.id, fence });

      return { ...pending, cancel: () => connection.cancel(pending.id) };
    });

    const abort = operation.cancel;
    signal?.addEventListener("abort", abort, { once: true });

    if (signal?.aborted) abort();

    try {
      const result = await operation.result;
      owned(clientId, fence.context);
      await trusted(entry);
      entry.documents.fence(fence);

      if (method === "textDocument/diagnostic") {
        const diagnostic = Schema.decodeUnknownSync(
          Schema.Struct({
            textDocument: Schema.Struct({ uri: Schema.String }),
            previousResultId: Schema.optionalKey(Schema.String),
          })
        )(params);

        const document = fence.documents.find(({ uri }) => uri === diagnostic.textDocument.uri);

        if (document !== undefined)
          entry.bridge?.pull(
            document.uri,
            document.version,
            result,
            diagnostic.previousResultId ?? null
          );
      }

      return result;
    } finally {
      signal?.removeEventListener("abort", abort);

      if (entry.operations.get(requestId)?.fence === fence) entry.operations.delete(requestId);
    }
  }

  async function request(clientId: string, input: LanguageFeatureRequest, signal?: AbortSignal) {
    const valid = Schema.decodeUnknownSync(LanguageFeatureRequest)(input);

    return LanguageFeatureResult.make({
      requestId: valid.requestId,
      fence: valid.fence,
      result: await requestRaw(
        clientId,
        valid.requestId,
        valid.fence,
        valid.method,
        valid.params,
        valid.deadline,
        signal
      ),
    });
  }

  function cancel(clientId: string, context: LanguageContextIdentity, requestId: string) {
    const entry = owned(clientId, context);
    const pending = entry.operations.get(requestId);

    if (pending !== undefined) {
      entry.connection?.cancel(pending.id);
      entry.operations.delete(requestId);
    }
  }

  async function release(clientId: string, context: LanguageContextIdentity, interestId: string) {
    const entry = owned(clientId, context);
    entry.interests.delete(interestId);
    scheduleGrace(entry);
  }

  function watch(clientId: string, context: LanguageContextIdentity, signal?: AbortSignal) {
    const entry = owned(clientId, context);

    return entry.events.watch(
      LanguageContextEvent.cases.Snapshot.make({
        context: entry.identity,
        runtime: entry.runtime,
        ack: entry.documents.ack(),
      }),
      signal
    );
  }

  function disconnect(clientId: string) {
    for (const acquisition of acquisitions)
      if (acquisition.clientId === clientId) acquisition.cancelled = true;

    for (const entry of entries.values()) {
      if (entry.identity.clientId !== clientId) continue;
      move(entry, { type: "disconnect" });
      retire(entry, "connection-lost");
      state(entry, LanguageRuntime.cases.Stopped.make({ reason: "connection-lost" }));
      entries.delete(entry.identity.contextId);
      keys.delete(contextKey(entry.input.clientId, entry.facts));
      entry.events.close();
    }
  }

  async function restart(clientId: string, context: LanguageContextIdentity) {
    const entry = owned(clientId, context);
    retire(entry, "restart");
    entry.attempts = 0;
    move(entry, { type: "restart" });
    state(entry, LanguageRuntime.cases.Stopped.make({ reason: "manual" }));

    return snapshot(entry);
  }

  function invalidateTrust(checkout: LanguageCheckout) {
    options.invalidateDiscovery();

    for (const entry of entries.values()) {
      if (entry.facts.checkout.workspaceId !== checkout.workspaceId) continue;
      move(entry, { type: "revoke" });
      retire(entry, "settings-changed");
      state(entry, LanguageRuntime.cases.AwaitingTrust.make({}));
    }
  }

  async function configure(
    clientId: string,
    context: LanguageContextIdentity,
    settings: typeof LanguageEffectiveSettings.Type
  ) {
    const entry = owned(clientId, context);

    const input = {
      ...entry.input,
      settings: Schema.decodeUnknownSync(LanguageEffectiveSettings)(settings),
      refresh: true,
    };

    const facts = await options.discover(input);
    owned(clientId, context);
    const key = contextKey(clientId, facts);
    const other = keys.get(key);

    if (other !== undefined && other !== entry)
      throw failure("conflict", "Configuration context already acquired");
    keys.delete(contextKey(clientId, entry.facts));
    retire(entry, "settings-changed");
    entry.input = input;
    entry.facts = facts;
    entry.attempts = 0;
    entry.identity = LanguageContextIdentity.make({
      ...entry.identity,
      checkout: facts.checkout,
      projectRoot: facts.projectRoot,
      configurationFingerprint: facts.configurationFingerprint,
    });
    entry.documents.clear();
    entry.documents = documents(entry.identity);
    keys.set(key, entry);
    move(entry, { type: "restart" });
    state(entry, LanguageRuntime.cases.Stopped.make({ reason: "replaced" }));

    return snapshot(entry);
  }

  function invalidateConfiguration(checkout: LanguageCheckout) {
    options.invalidateDiscovery();

    for (const entry of entries.values()) {
      if (checkoutKey(entry.facts.checkout) !== checkoutKey(checkout)) continue;
      retire(entry, "settings-changed");
      move(entry, { type: "stop" });
      entries.delete(entry.identity.contextId);
      keys.delete(contextKey(entry.input.clientId, entry.facts));
      entry.events.close();
      state(entry, LanguageRuntime.cases.Stopped.make({ reason: "replaced" }));
    }
  }

  async function respond(clientId: string, input: typeof LanguageServerResponse.Type) {
    const valid = Schema.decodeUnknownSync(LanguageServerResponse)(input);
    const entry = owned(clientId, valid.context);
    await trusted(entry);

    if (entry.bridge === undefined) throw failure("not-ready", "Language connection not ready");
    await entry.bridge.respond(valid);
  }

  async function cancelProgress(
    clientId: string,
    context: LanguageContextIdentity,
    token: string | number
  ) {
    const entry = owned(clientId, context);
    await trusted(entry);
    await entry.connection?.send({
      jsonrpc: "2.0",
      method: "window/workDoneProgress/cancel",
      params: { token },
    });
  }

  async function close() {
    closed = true;

    for (const entry of entries.values()) {
      move(entry, { type: "stop" });
      retire(entry, "closed");
      entry.events.close();
    }

    entries.clear();
    keys.clear();
    await Promise.all(cleanup);
  }

  return {
    acquire,
    sync,
    request,
    requestRaw,
    cancel,
    release,
    watch,
    disconnect,
    restart,
    invalidateTrust,
    respond,
    cancelProgress,
    configure,
    invalidateConfiguration,
    snapshot: (clientId: string, context: LanguageContextIdentity) =>
      snapshot(owned(clientId, context)),
    close,
    stats: () => ({
      contexts: entries.size,
      cleanup: cleanup.size,
      acquiring,
      processSlots: processBudget.used,
      documentBytes,
      processes: [...entries.values()].filter((entry) => entry.connection !== undefined).length,
    }),
  };
}
