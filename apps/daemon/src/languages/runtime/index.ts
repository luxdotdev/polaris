import { serverSettings } from "./serverSettings.ts";
import { predictionDocument, rememberPredictionDiagnostics } from "./prediction.ts";
import { ServerLogs } from "./logs.ts";
import { bindFormat } from "./format.ts";
import { bindResourceReceipt, bindServerResponse, bindRecoveryReceipt } from "./resourceReceipt.ts";
import { bindLifecycle, shutdownConnection } from "./lifecycleControl.ts";
import { configurationWatches } from "./configurationWatch.ts";
import { bindRestarts } from "./restart.ts";
import { Acquire } from "./acquire.ts";
import { enqueue } from "./queue.ts";
import { AcknowledgmentOwners } from "./acknowledgmentOwners.ts";
import { LaunchAdmission } from "./launchAdmission.ts";
import type { ProcessReservation } from "./process-budget.ts";
import { processAdmission } from "./processAdmission.ts";
import { BrokerCleanup, acquisitionTask, settleClientDisconnect } from "./clientSettlement.ts";
import type { ClientAcquisition } from "./clientSettlement.ts";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  LanguageContextIdentity,
  LanguageDocumentNotification,
  LanguageContextEvent,
  LanguageError,
  LanguageFeatureRequest,
  LanguageFeatureResult,
  LanguageCheckout,
  LanguageJsonObject,
  LanguageRequestFence,
  LanguageRuntime,
  LanguageSyncInput,
  LanguageMethod,
  LanguageDeadline,
} from "@polaris/protocol";
import type { LanguageJson } from "@polaris/protocol";
import { Schema } from "effect";
import { checkoutKey, checkoutPath, trustScope, trustScopeKey } from "../trust/index.ts";
import { failure } from "../transport/framing.ts";
import { bounded } from "../transport/deadline.ts";
import { notificationMessage, clientCapabilities, drainStderr } from "./wire.ts";
import { ContextEvents } from "./events.ts";
import { Documents } from "./documents.ts";
import { decideLifecycle, lifecycleInitial, type LifecycleEvent } from "./lifecycle.ts";
import { launchSettings } from "../rust/settings.ts";
import { negotiate, pythonCapabilities } from "./capabilities.ts";
import { ServerBridge } from "./server.ts";
import { bindServerPreparation } from "./serverPreparation.ts";
import { FeatureEvidence, createFeatureVerifier } from "./featureEvidence.ts";
import { contextKey, sameIdentity, initialization } from "./keys.ts";
import { spawnLanguageProcess } from "./process.ts";
import { snapshot } from "./snapshot.ts";

export { LanguageBroker } from "./service.ts";

export { spawnLanguageProcess } from "./process.ts";

export type { Launch } from "./process.ts";

import { limits } from "./types.ts";

export { limits };

export type { AcquireInput, BrokerOptions } from "./types.ts";

import type { AcquireInput, BrokerOptions, Entry } from "./types.ts";

/** Detached Host broker. The caller binds clientId to its authenticated existing connection. */
export function createLanguageBroker(options: BrokerOptions) {
  const entries = new Map<string, Entry>();
  const keys = new Map<string, Entry>();
  const acknowledgments = new AcknowledgmentOwners(owned);
  let generation = 0;
  let closed = false;
  let acquiring = 0;

  const acquisitions = new Set<ClientAcquisition>();

  let documentBytes = 0;
  const processes = processAdmission(options, entries, move, shutdown);
  const featureEvidence = new FeatureEvidence();

  const documents = (context: LanguageContextIdentity) =>
    new Documents(context, (delta) => {
      if (documentBytes + delta > 33554432)
        throw failure("too-large", "Host draft input budget reached");
      documentBytes += delta;
    });

  const clientSettlement = new BrokerCleanup();
  const cleanup = clientSettlement.all;
  const track = clientSettlement.trackGlobal;

  function event(entry: Entry, value: LanguageContextEvent) {
    rememberPredictionDiagnostics(entry, value);
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
    const step = { event: input, phase: String(entry.lifecycle.value) };
    options.observeLifecycle?.({ ...step, contextId: entry.identity.contextId });
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

  function owned(clientId: string, input: LanguageContextIdentity) {
    const identity = Schema.decodeUnknownSync(LanguageContextIdentity)(input);

    if (identity.clientId !== clientId)
      throw failure("not-owner", "Context belongs to another Client");
    const entry = entries.get(identity.contextId);

    if (entry === undefined || !sameIdentity(identity, entry.identity))
      throw failure("stale-generation", "Language context generation changed");

    return entry;
  }

  function retire(
    entry: Entry,
    reason: "connection-lost" | "restart" | "settings-changed" | "closed",
    graceful = false,
    preserveDocuments = false
  ) {
    processes.retire(entry);
    const retained = preserveDocuments ? [...entry.documents.open.values()] : [];
    const sequence = entry.documents.sequence;
    acknowledgments.retire(entry);

    if (!preserveDocuments) watches.unwatch(entry);

    if (entry.timer !== undefined) clearTimeout(entry.timer);
    entry.timer = undefined;
    const identity = entry.identity;

    if (preserveDocuments) entry.replacementSource ??= identity;
    else event(entry, LanguageContextEvent.cases.Invalidated.make({ context: identity, reason }));
    const connection = entry.connection;
    const admission = entry.launchAdmission;
    entry.launchAdmission = undefined;
    admission?.abort();
    entry.connection = undefined;
    entry.logs?.close();
    entry.logs = undefined;
    entry.stderrAbort?.abort();
    entry.stderrAbort = undefined;
    entry.bridge?.close();
    entry.bridge = undefined;
    entry.operations.clear();
    entry.capabilities = undefined;
    entry.identity = LanguageContextIdentity.make({ ...identity, generation: ++generation });
    entry.documents.clear();
    entry.documents = documents(entry.identity);

    for (const document of retained)
      entry.documents.apply(
        entry.documents.sequence + 1,
        LanguageDocumentNotification.cases.Open.make(document),
        "utf-16"
      );

    if (preserveDocuments) entry.documents.sequence = sequence;
    entry.starting = undefined;

    if (admission !== undefined) {
      const closing = (async () => {
        if (graceful) await shutdownConnection(connection);
        await admission.close(graceful);
      })();

      entry.launchRetirement = Promise.all([entry.launchRetirement, closing]).then(() => {});
      track(entry.launchRetirement, true, identity.clientId);
    } else if (connection !== undefined) {
      track(
        (async () => {
          if (graceful) await shutdownConnection(connection);
          await connection.close(graceful);
        })(),
        true,
        identity.clientId
      );
      track(connection.settlement(), true, identity.clientId);
    }
  }

  async function trusted(entry: Entry) {
    try {
      return await options.requireTrust(entry.facts.checkout, entry.facts);
    } catch (error) {
      move(entry, { type: "revoke" });
      retire(entry, "settings-changed");
      state(entry, LanguageRuntime.cases.AwaitingTrust.make({}));
      throw error;
    }
  }

  const watches = configurationWatches(options, async (entry) => {
    if (entries.get(entry.identity.contextId) !== entry) return;
    await configure(entry.identity.clientId, entry.identity, entry.input.settings, false);
  });

  const { onCrash, onStartFailure, scheduleGrace, cancelGrace, publishReplacement } = bindLifecycle(
    {
      options,
      entries,
      keys,
      active,
      move,
      state,
      retire,
      shutdown,
      ensureStart,
      track,
      stopWatching: watches.unwatch,
    }
  );

  async function start(entry: Entry) {
    const identity = entry.identity;
    watches.watch(entry);
    entry.stderr = "";

    const admission = new LaunchAdmission(
      identity,
      entry.facts,
      () => active(entry, identity) && demanded(entry)
    );

    entry.launchAdmission = admission;
    move(entry, { type: "demand" });
    state(entry, LanguageRuntime.cases.Starting.make({}));

    let reservation: ProcessReservation | undefined;

    try {
      await entry.launchRetirement;
      reservation = await processes.reserve(entry, admission.request);
      await trusted(entry);

      const launch = await admission.resolve(
        options.reserveLaunch,
        options.resolveLaunch,
        async () => {
          await trusted(entry);
        }
      );

      const reserved = reservation;

      const { port, connection } = admission.connect(
        () => reserved.spawn(() => (options.spawn ?? spawnLanguageProcess)(launch)),
        (message) => entry.bridge?.receive(message),
        () => onCrash(entry, identity)
      );

      entry.connection = connection;
      const logs = new ServerLogs(identity);
      entry.logs = logs;

      const bridge = new ServerBridge({
        context: identity,
        documents: entry.documents,
        connection,
        settings: launchSettings(entry.facts, launch, () => serverSettings(entry)),
        log: (source, level, text) => {
          if (active(entry, identity)) logs.append(source, level, text);
        },
        emit: (value) => {
          if (active(entry, identity)) event(entry, value);
        },
        current: () => active(entry, identity),
        authorize: async () => {
          await trusted(entry);
        },
        prepareEdit: bindServerPreparation(
          entry,
          acknowledgments,
          admission.request,
          options.prepareEdit
        ),
        treeEdits: () => options.supportsTreeEdits?.(admission.request) === true,
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
          },
          stderrAbort.signal,
          (text) => {
            if (active(entry, identity)) {
              entry.stderr = (entry.stderr + text).slice(-4096);
              logs.stderr(text);
            }
          }
        )
      );
      void port.exited.then(() => onCrash(entry, identity));

      const initialized = await connection.request("initialize", {
        processId: process.pid,
        rootUri: pathToFileURL(entry.facts.projectRoot).href,
        workspaceFolders: [{ uri: pathToFileURL(entry.facts.projectRoot).href, name: "project" }],
        capabilities: clientCapabilities,
        initializationOptions: launch.initializationOptions ?? initialization(entry),
        clientInfo: { name: "Polaris" },
      }).result;

      if (!active(entry, identity)) return;
      const capabilities = pythonCapabilities(negotiate(initialized), entry.facts.providerId);
      await trusted(entry);
      await connection.send({ jsonrpc: "2.0", method: "initialized", params: {} });
      await connection.send({
        jsonrpc: "2.0",
        method: "workspace/didChangeConfiguration",
        params: { settings: launchSettings(entry.facts, launch, () => serverSettings(entry)) },
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
      onStartFailure(
        entry,
        identity,
        Schema.is(LanguageError)(error) ? error : undefined,
        admission.spawned
      );
    } finally {
      reservation?.releaseUnstarted();
      const release = admission.releaseUnstarted();
      track(release, true, identity.clientId);
      await release;
    }
  }

  function ensureStart(entry: Entry) {
    if (
      entry.connection !== undefined ||
      entry.starting !== undefined ||
      entry.lifecycle.matches("failed") ||
      entry.timer !== undefined
    )
      return;
    const operation = start(entry);
    entry.starting = operation;
    track(
      operation.finally(() => {
        if (entry.starting === operation) entry.starting = undefined;
      }),
      false,
      entry.identity.clientId
    );
  }

  async function shutdown(entry: Entry, reason: "no-demand" | "process-budget" = "no-demand") {
    const source = entry.identity;
    retire(entry, "closed", true, true);

    if (entry.interests.size === 0) watches.unwatch(entry);
    options.invalidateDiscovery();
    entry.runtime = LanguageRuntime.cases.Stopped.make({ reason });
    publishReplacement(entry, source);
    state(entry, entry.runtime);
    await entry.launchRetirement;
  }

  async function acquire(clientId: string, payload: AcquireInput) {
    const input = Schema.decodeUnknownSync(Acquire)(payload);

    if (closed) throw failure("not-connected", "Language broker closed");

    if (clientId !== input.clientId) throw failure("not-owner", "Client identity mismatch");

    if (acquiring >= 8) throw failure("queue-full", "Language acquisition limit reached");
    acquiring++;
    const acquisition = acquisitionTask(clientId);

    acquisitions.add(acquisition);

    try {
      const facts = await options.discover(input);

      if (closed || acquisition.cancelled)
        throw failure("not-connected", "Language acquisition disconnected");
      const key = contextKey(clientId, facts);
      const candidate = entries.get(input.contextId);

      const sameInput =
        candidate !== undefined &&
        candidate.input.clientId === clientId &&
        candidate.input.path === input.path &&
        candidate.input.providerId === input.providerId &&
        checkoutKey(candidate.input.checkout) === checkoutKey(input.checkout) &&
        JSON.stringify(candidate.input.settings) === JSON.stringify(input.settings);

      const existing = keys.get(key) ?? (sameInput ? candidate : undefined);

      if (existing !== undefined) {
        if (existing.interests.size >= 1024)
          throw failure("queue-full", "Language interest limit reached");
        existing.interests.add(input.interestId);

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
        crashes: [],
        stderr: "",
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
      acquisition.finish();
    }
  }

  async function sync(clientId: string, input: LanguageSyncInput) {
    const valid = Schema.decodeUnknownSync(LanguageSyncInput)(input);
    const entry = owned(clientId, valid.context);

    return enqueue(entry, async () => {
      owned(clientId, valid.context);
      processes.touch(entry);
      const canonical = await trusted(entry);
      await checkoutPath(canonical, fileURLToPath(valid.notification.uri));
      owned(clientId, valid.context);

      const document = entry.documents.apply(
        valid.sequence,
        valid.notification,
        entry.capabilities?.positionEncoding ?? "utf-16"
      );

      acknowledgments.synchronized(entry, valid.notification);

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

      owned(clientId, valid.context);

      if (demanded(entry)) {
        cancelGrace(entry);
        ensureStart(entry);
      } else {
        processes.cancel(entry);
        scheduleGrace(entry);
      }

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
      processes.touch(entry);
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

    const result = LanguageFeatureResult.make({
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

    featureEvidence.record(clientId, valid, result);

    return result;
  }

  const verifyFeatureEdit = createFeatureVerifier(featureEvidence, {
    owned,
    fence: (entry, fence) => entry.documents.fence(fence),
    trusted,
  });

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
    featureEvidence.forget(clientId);

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

    for (const entry of entries.values()) scheduleGrace(entry);
  }

  function invalidateTrust(checkout: LanguageCheckout, preserveDocuments = false) {
    options.invalidateDiscovery();

    for (const entry of entries.values()) {
      if (
        trustScopeKey(trustScope(options.hostId, entry.facts.checkout)) !==
        trustScopeKey(trustScope(options.hostId, checkout))
      )
        continue;
      move(entry, { type: "revoke" });
      retire(entry, "settings-changed", false, preserveDocuments);

      if (preserveDocuments) entry.runtime = LanguageRuntime.cases.AwaitingTrust.make({});
      else state(entry, LanguageRuntime.cases.AwaitingTrust.make({}));
    }
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
    await watches.close();
    // Return before the connection deadline; owned teardown and leases remain tracked.
    await bounded(Promise.all(cleanup), 2500);
  }

  const { restart, configure, restartMatching, reloadTrust } = bindRestarts({
    options,
    entries,
    keys,
    owned,
    retire,
    documents,
    move,
    ensureStart,
    releaseWatch: watches.unwatch,
  });

  return {
    acquire,
    predictionDocument: (
      clientId: string,
      checkout: LanguageCheckout,
      uri: string,
      buffer: string
    ) => predictionDocument(entries.values(), clientId, checkout, uri, buffer),
    sync,
    acknowledgeBuffer: (...args: Parameters<AcknowledgmentOwners["record"]>) =>
      acknowledgments.record(...args),
    readAcknowledgedBuffer: (...args: Parameters<AcknowledgmentOwners["read"]>) =>
      acknowledgments.read(...args),
    readPreparationDocument: (...args: Parameters<AcknowledgmentOwners["document"]>) =>
      acknowledgments.document(...args),
    invalidateBufferAcknowledgments: (
      principal: Parameters<AcknowledgmentOwners["disconnect"]>[0]
    ) => acknowledgments.disconnect(principal),
    request,
    setProcessLimit: (limit: number) => processes.budget.setLimit(limit),
    format: bindFormat(owned, requestRaw),
    watchLog: (clientId: string, context: LanguageContextIdentity, signal?: AbortSignal) => {
      const logs = owned(clientId, context).logs;

      if (logs === undefined) throw failure("not-ready", "Language server log unavailable");

      return logs.watch(signal);
    },
    verifyFeatureEdit,
    requestRaw,
    cancel,
    release,
    watch,
    disconnect,
    disconnectAndWait: (clientId: string) =>
      settleClientDisconnect(
        clientId,
        entries.values(),
        acquisitions,
        disconnect,
        clientSettlement
      ),
    restart,
    invalidateTrust,
    restartMatching,
    reloadTrust,
    respond: bindServerResponse(owned, trusted),
    challengeReceipt: bindResourceReceipt(owned, trusted),
    challengeRecoveryReceipt: bindRecoveryReceipt(() => entries.values(), owned, trusted),
    cancelProgress,
    configure,
    invalidateConfiguration,
    snapshot: (clientId: string, context: LanguageContextIdentity) =>
      snapshot(owned(clientId, context)),
    authorizeExecution: (clientId: string, context: LanguageContextIdentity) =>
      trusted(owned(clientId, context)).then(() => {}),
    close,
    stats: () => ({
      contexts: entries.size,
      cleanup: cleanup.size,
      acquiring,
      processSlots: processes.budget.used,
      processLimit: processes.budget.limit,
      documentBytes,
      processes: [...entries.values()].filter((entry) => entry.connection !== undefined).length,
    }),
  };
}
