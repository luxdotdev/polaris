import { resolve } from "node:path";
import type { LanguageAvailability } from "@polaris/protocol";
import { availability } from "../availability/index.ts";
import type { ProbeFact } from "../catalog/selection.ts";
import type { Tool } from "../catalog/model.ts";
import { preflight } from "../catalog/selection.ts";
import { artifactIdentity } from "./identity.ts";
import {
  createInstaller,
  type InstallerOptions,
  type ExactArtifact,
  type InstallHandle,
} from "./index.ts";
import { descriptor, defaultLimits } from "./types.ts";
import { createDemandObservations, type ObservationAdmission } from "./observations.ts";

export type { ObservationAdmission } from "./observations.ts";

import { abortable, checkAbort, failure } from "./validation.ts";

export interface HostObservations {
  readonly connected: boolean;
  readonly probes: ReadonlyArray<ProbeFact>;
}

export type RequestGuard = (signal: AbortSignal) => Promise<void>;

export interface SelectionReservation {
  /** Recheck current trust and session state while holding launch admission. */
  readonly validate: RequestGuard;
  readonly release: () => Promise<void>;
}

export interface HostInstallationOptions extends Omit<InstallerOptions, "adapters"> {
  readonly tools: ReadonlyArray<unknown>;
  readonly adapters: Omit<InstallerOptions["adapters"], "beforeSelect" | "afterSelection">;
  /** Demand only; trusted=false must not execute Workspace or configured developer code. */
  readonly observe: (
    tool: Tool,
    phase: "install" | "feature",
    trusted: boolean,
    signal: AbortSignal,
    admission?: ObservationAdmission
  ) => Promise<HostObservations>;
  /** Resource-bearing observation adapters must await owned transport/process cleanup here. */
  readonly disposeObservations?: () => Promise<void>;
  /** Atomically exclude new language-server sessions until release. Missing adapter denies selection. */
  readonly reserveSelection?:
    | ((exact: ExactArtifact, signal: AbortSignal) => Promise<SelectionReservation>)
    | undefined;
}

interface Demand {
  readonly guard: RequestGuard;
  readonly signal: AbortSignal;
  readonly admission?: ObservationAdmission | undefined;
}

/** Construct through one Daemon-owned registry; no idle timers, executable lookup or implicit approvals. */
async function constructHost(options: HostInstallationOptions) {
  const tools = new Map(
    options.tools.map((input) => {
      const value = descriptor(input, defaultLimits.metadataBytes);

      return [value.tool.id, value];
    })
  );

  if (tools.size !== options.tools.length || tools.size > 256)
    throw failure("invalid-input", "Invalid Host tool catalog");
  const demands = new Map<string, Set<Demand>>();
  const reservations = new Map<string, SelectionReservation>();
  const acquisitions = new Map<string, Promise<SelectionReservation>>();
  const recovery = new Set<string>();
  const lifetime = new AbortController();
  let requests = 0;
  let disposed = false;

  const find = (toolId: string) => {
    const value = tools.get(toolId);

    if (!value) throw failure("not-offered", "Tool is not in this Host catalog");

    if (recovery.has(toolId))
      throw failure("recovery-required", "Tool selection requires recovery", true);

    return value;
  };

  const observationJobs = createDemandObservations({
    lifetime: lifetime.signal,
    observe: options.observe,
  });

  const observations = (
    toolId: string,
    phase: "install" | "feature",
    trusted: boolean,
    signal: AbortSignal,
    admission?: ObservationAdmission,
    selectedTool?: Tool
  ) => {
    if (disposed) throw failure("cancelled", "Host installation service is disposed");

    return observationJobs.observe(
      selectedTool ?? find(toolId).tool,
      phase,
      trusted,
      signal,
      admission
    );
  };

  async function guards(toolId: string, signal: AbortSignal) {
    const active = [...(demands.get(toolId) ?? [])].filter((demand) => !demand.signal.aborted);

    if (!active.length) throw failure("cancelled", "Installation has no current request");

    for (const demand of active) await abortable(demand.guard(signal), signal);
    checkAbort(signal);
  }

  const installer = await createInstaller({
    ...options,
    adapters: {
      ...options.adapters,
      async beforeSelect(exact, signal) {
        await guards(exact.tool.id, signal);

        if (!options.reserveSelection)
          throw failure("conflict", "Tool selection requires a current-session barrier", true);
        const acquisition = options.reserveSelection(structuredClone(exact), signal);
        acquisitions.set(exact.tool.id, acquisition);
        const reservation = await acquisition;

        reservations.set(exact.tool.id, reservation);
        checkAbort(signal);
        await abortable(reservation.validate(signal), signal);
        await guards(exact.tool.id, signal);

        const admission = [...(demands.get(exact.tool.id) ?? [])].find(
          (demand) => !demand.signal.aborted
        )?.admission;

        const observed = await observations(
          exact.tool.id,
          "install",
          true,
          signal,
          admission,
          exact.tool
        );

        const checked = preflight({
          tool: exact.tool,
          platform: exact.platform,
          probes: observed.probes,
          phase: "install",
        });

        if (!observed.connected) throw failure("not-connected", "Host is unavailable", true);

        if (checked.status !== "eligible") throw failure(checked.status, checked.reason, true);
        await abortable(reservation.validate(signal), signal);
        await guards(exact.tool.id, signal);
      },
      async afterSelection(exact) {
        const acquisition = acquisitions.get(exact.tool.id);

        if (!acquisition) return;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 2000);
        let reservation: SelectionReservation;

        try {
          reservation = await abortable(acquisition, controller.signal);
        } catch (cause) {
          recovery.add(exact.tool.id);
          void acquisition
            .then((late) => late.release())
            .catch(() => {
              recovery.add(exact.tool.id);
            });
          throw cause;
        } finally {
          clearTimeout(timer);
          acquisitions.delete(exact.tool.id);
        }

        try {
          await reservation.release();
        } catch (cause) {
          recovery.add(exact.tool.id);
          throw cause;
        } finally {
          reservations.delete(exact.tool.id);
        }
      },
    },
  });

  async function exactApproval(
    toolId: string,
    observed: HostObservations,
    signal: AbortSignal,
    selected = find(toolId)
  ) {
    const value = selected;

    const checked = preflight({
      tool: value.tool,
      platform: options.platform,
      probes: observed.probes,
      phase: "install",
    });

    if (!checked.artifact || !options.adapters.approve) return false;

    const exact: ExactArtifact = {
      hostId: options.hostId,
      platform: options.platform,
      tool: value.tool,
      descriptor: value.raw,
      artifact: checked.artifact,
      identity: artifactIdentity({
        hostId: options.hostId,
        platform: options.platform,
        descriptor: value.raw,
        artifact: checked.artifact,
      }),
    };

    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    signal.addEventListener("abort", abort, { once: true });

    if (signal.aborted) abort();

    const timer = setTimeout(
      () => controller.abort(failure("timeout", "Artifact approval could not be checked", true)),
      2000
    );

    try {
      const approved = await abortable(
        options.adapters.approve(structuredClone(exact), controller.signal),
        controller.signal
      );

      return approved.approved && approved.identity === exact.identity;
    } finally {
      clearTimeout(timer);
      controller.abort();
      signal.removeEventListener("abort", abort);
    }
  }

  async function inspect(
    toolId: string,
    phase: "install" | "feature",
    trusted: boolean,
    signal: AbortSignal,
    admission?: ObservationAdmission
  ): Promise<LanguageAvailability> {
    const value = find(toolId);
    const installed = await installer.current(toolId);
    const debris = await installer.recoveryFacts(toolId);

    if (debris.length)
      throw failure(
        "recovery-required",
        `Tool installation requires recovery: ${debris.join(", ")}`,
        true
      );

    const selected =
      phase === "feature" && installed
        ? descriptor(installed.descriptor, defaultLimits.metadataBytes)
        : value;

    const observed = await observations(toolId, phase, trusted, signal, admission, selected.tool);
    const approved = await exactApproval(toolId, observed, signal, selected);
    await abortable(admission?.requireCurrent(signal) ?? Promise.resolve(), signal);
    checkAbort(signal);

    const fact = availability({
      hostId: options.hostId,
      platform: options.platform,
      tool: selected.raw,
      connected: observed.connected,
      trusted,
      approved,
      phase,
      probes: observed.probes,
      installed,
      progress: installer.progress(toolId) ?? undefined,
      checkedAt: Date.now(),
    });

    return {
      ...fact,
      pinnedVersion: value.tool.version,
      updateCandidate:
        installed && installed.version !== value.tool.version ? value.tool.version : null,
    };
  }

  async function start(
    toolId: string,
    intent: "encounter" | "install" | "update" | "rollback",
    guard: RequestGuard,
    signal = new AbortController().signal,
    target?: string,
    admission?: ObservationAdmission
  ): Promise<InstallHandle> {
    checkAbort(signal);
    await abortable(guard(signal), signal);
    let value = find(toolId);
    const debris = await installer.recoveryFacts(toolId);

    if (debris.length)
      throw failure(
        "recovery-required",
        `Tool installation requires recovery: ${debris.join(", ")}`,
        true
      );

    if (intent === "rollback") {
      const version = (await installer.versions(toolId)).find(
        (candidate) => candidate.identity === target
      );

      if (!version) throw failure("not-installed", "Rollback version is not retained");
      value = descriptor(version.descriptor, defaultLimits.metadataBytes);
    }

    const observed = await abortable(
      observations(toolId, "install", true, signal, admission, value.tool),
      signal
    );

    await abortable(guard(signal), signal);
    checkAbort(signal);
    const active = demands.get(toolId) ?? new Set<Demand>();
    const demand = { guard, signal, admission };
    active.add(demand);
    demands.set(toolId, active);
    let handle: InstallHandle;

    try {
      const request = { tool: value.raw, connected: observed.connected, probes: observed.probes };
      handle =
        intent === "rollback"
          ? installer.rollback(request)
          : installer.install({ ...request, intent });
    } catch (cause) {
      active.delete(demand);

      if (!active.size) demands.delete(toolId);
      throw cause;
    }

    const cancel = () => handle.cancel();
    signal.addEventListener("abort", cancel, { once: true });

    if (signal.aborted) cancel();

    const result = handle.result.finally(() => {
      signal.removeEventListener("abort", cancel);
      active.delete(demand);

      if (!active.size) demands.delete(toolId);
    });

    return { jobId: handle.jobId, result, cancel };
  }

  async function demand<T>(action: (signal: AbortSignal) => Promise<T>, signal = lifetime.signal) {
    checkAbort(lifetime.signal);
    checkAbort(signal);

    if (requests >= 64)
      throw failure("queue-full", "Host installation request limit reached", true);
    requests++;
    const controller = new AbortController();
    const combined = AbortSignal.any([controller.signal, signal, lifetime.signal]);

    const timer = setTimeout(
      () => controller.abort(failure("timeout", "Host installation preflight timed out", true)),
      2000
    );

    try {
      return await abortable(action(combined), combined);
    } finally {
      clearTimeout(timer);
      requests--;
    }
  }

  return {
    hostId: options.hostId,
    inspect: (
      toolId: string,
      phase: "install" | "feature",
      trusted: boolean,
      admission?: ObservationAdmission,
      signal?: AbortSignal
    ) => demand((current) => inspect(toolId, phase, trusted, current, admission), signal),
    install: (
      toolId: string,
      intent: "encounter" | "install" | "update",
      guard: RequestGuard,
      signal?: AbortSignal,
      admission?: ObservationAdmission
    ) => demand((current) => start(toolId, intent, guard, current, undefined, admission), signal),
    rollback: (
      toolId: string,
      identity: string,
      guard: RequestGuard,
      signal?: AbortSignal,
      admission?: ObservationAdmission
    ) =>
      demand((current) => start(toolId, "rollback", guard, current, identity, admission), signal),
    current: installer.current,
    versions: installer.versions,
    recoveryFacts: installer.recoveryFacts,
    progress: installer.progress,
    subscribe: (listener: Parameters<typeof installer.subscribe>[0]) =>
      installer.subscribe(listener),
    tool: (toolId: string) => structuredClone(find(toolId).tool),
    stats: () => ({
      ...installer.stats(),
      ...observationJobs.stats(),
      requests,
      reservations: reservations.size,
      selections: acquisitions.size,
      recovery: [...recovery],
    }),
    async dispose() {
      disposed = true;
      lifetime.abort();
      await installer.dispose();
      await observationJobs.dispose();
      await options.disposeObservations?.();
    },
  };
}

export type HostInstallation = Awaited<ReturnType<typeof constructHost>>;

/** One registry per Daemon scope. Concurrent construction shares a Promise; changed bindings fail closed. */
export function createHostInstallations() {
  const hosts = new Map<
    string,
    { options: HostInstallationOptions; instance: Promise<HostInstallation> }
  >();

  let disposed = false;

  return {
    get(options: HostInstallationOptions) {
      if (disposed) throw failure("cancelled", "Host installation registry is disposed");
      const current = hosts.get(options.hostId);

      if (current) {
        if (current.options !== options)
          throw failure("conflict", "Host installer is already bound to immutable options");

        return current.instance;
      }

      if (hosts.size >= 16) throw failure("queue-full", "Host installation registry limit reached");
      const hostId = options.hostId;

      const snapshot = Object.freeze({
        ...options,
        root: resolve(options.root),
        platform: structuredClone(options.platform),
        tools: structuredClone(options.tools),
        adapters: Object.freeze({ ...options.adapters }),
        limits: { ...options.limits },
      });

      const instance = constructHost(snapshot).catch((cause) => {
        hosts.delete(hostId);
        throw cause;
      });

      hosts.set(hostId, { options, instance });

      return instance;
    },
    async dispose() {
      disposed = true;
      await Promise.all(
        [...hosts.values()].map(async ({ instance }) => (await instance).dispose())
      );
      hosts.clear();
    },
  };
}
