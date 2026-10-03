import { isAbsolute, join, relative } from "node:path";
import { access, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import { Match } from "effect";
import type { DiscoveryFacts } from "../discovery/index.ts";
import type { Launch } from "../runtime/process.ts";
import type { LaunchAdmissionRequest, LaunchSelectionLease } from "../runtime/launchAdmission.ts";
import type { ObservationAdmission, HostInstallation, RequestGuard } from "../install/host.ts";
import type { InstalledVersion } from "../install/index.ts";
import type { createSelectionLedger } from "../install/selection-ledger.ts";
import { checkAbort, failure } from "../install/validation.ts";
import { descriptor, defaultLimits } from "../install/types.ts";

export interface VerifiedLaunchPlan {
  readonly launch: Launch;
  readonly runtimeExecutable?: string;
  readonly entry: string;
  readonly identity: string;
  readonly thirdPartyDiscoveryDisabled?: boolean;
}

interface ManagedLaunchOptions {
  readonly host: HostInstallation;
  readonly ledger: ReturnType<typeof createSelectionLedger>;
  readonly toolId: (facts: DiscoveryFacts) => string;
  readonly requireCurrent: (request: LaunchAdmissionRequest) => RequestGuard;
  readonly plan?: (
    facts: DiscoveryFacts,
    installed: InstalledVersion
  ) => Promise<VerifiedLaunchPlan>;
}

const eligible = (fact: Awaited<ReturnType<HostInstallation["inspect"]>>) =>
  Match.value(fact.preflight).pipe(
    Match.tag("Eligible", () => {}),
    Match.tag("Blocked", (blocked) => {
      throw failure(blocked.reason, blocked.message, true);
    }),
    Match.exhaustive
  );

async function verifyPlan(
  host: HostInstallation,
  toolId: string,
  facts: DiscoveryFacts,
  installed: InstalledVersion,
  plan: VerifiedLaunchPlan,
  assertCurrent: () => void,
  admission: ObservationAdmission,
  signal: AbortSignal
) {
  const { tool } = descriptor(installed.descriptor, defaultLimits.metadataBytes);
  const artifact = tool.artifacts.find((candidate) => candidate.id === installed.artifactId);

  if (
    !artifact ||
    plan.identity !== installed.identity ||
    plan.entry !== join(installed.directory, artifact.entry)
  )
    throw failure("audit-required", "Provider launch does not match the installed artifact");

  if (artifact.packaging && plan.thirdPartyDiscoveryDisabled !== true)
    throw failure("audit-required", "Provider third-party discovery must be disabled");

  if (plan.launch.cwd !== facts.projectRoot)
    throw failure(
      "invalid-input",
      "Provider working directory differs from its discovered project"
    );
  const executable = plan.launch.executable;
  const inside = relative(installed.directory, executable);
  const entryPath = await realpath(plan.entry);
  assertCurrent();
  const executablePath = await realpath(executable);
  assertCurrent();

  if (!isAbsolute(executable) || entryPath !== plan.entry || executablePath !== executable)
    throw failure("missing-prerequisite", "Provider executable path could not be verified");

  if (inside.startsWith("..") || isAbsolute(inside)) {
    const inspected = await host.inspect(toolId, "feature", true, admission, signal);
    assertCurrent();
    eligible(inspected);

    if (
      plan.runtimeExecutable !== executable ||
      !plan.launch.args.includes(plan.entry) ||
      !inspected.prerequisites.some(
        (fact) =>
          fact.outcome === "satisfied" &&
          fact.effectiveExecutable === executable &&
          fact.requirement.scope === "server"
      )
    )
      throw failure("missing-prerequisite", "Provider runtime is not a verified prerequisite");
  } else if (executable !== plan.entry)
    throw failure("audit-required", "Provider executable differs from the verified entry");
  await access(executable, constants.X_OK);
  assertCurrent();
}

/** Runtime owns lease release through raw child/connection cleanup. Use the installer's same Host ledger. */
export function managedLaunchAdapters(options: ManagedLaunchOptions) {
  const owned = new WeakMap<
    LaunchSelectionLease,
    { request: LaunchAdmissionRequest; toolId: string; admission: ObservationAdmission }
  >();

  async function reserveLaunch(request: LaunchAdmissionRequest): Promise<LaunchSelectionLease> {
    const signal = request.signal;

    const assertRequest = () => {
      checkAbort(signal);

      if (
        request.context.hostId !== options.host.hostId ||
        request.context.providerId !== request.facts.providerId ||
        request.context.projectRoot !== request.facts.projectRoot ||
        request.context.configurationFingerprint !== request.facts.configurationFingerprint
      )
        throw failure("invalid-input", "Language-server admission identity differs from discovery");

      if (!request.isCurrent())
        throw failure("stale-generation", "Language-server admission is no longer current");
    };

    assertRequest();
    const guard = options.requireCurrent(request);
    const admission = Object.freeze({ cwd: request.facts.projectRoot, requireCurrent: guard });
    await guard(signal);
    assertRequest();
    const toolId = options.toolId(request.facts);
    const inspected = await options.host.inspect(toolId, "feature", true, admission, signal);
    assertRequest();
    eligible(inspected);
    await guard(signal);
    assertRequest();
    const installed = await options.host.current(toolId);
    assertRequest();

    if (!installed) throw failure("not-installed", "Managed language tool is not installed", true);
    const held = await options.ledger.reserveLaunch(toolId, installed.identity, signal);

    const assertCurrent = () => {
      assertRequest();
      held.assertCurrent();
    };

    const lease: LaunchSelectionLease = {
      selectionIdentity: installed.identity,
      assertCurrent,
      async validate(next) {
        checkAbort(next);
        assertCurrent();
        await guard(signal);
        assertCurrent();
        const current = await options.host.current(toolId);
        assertCurrent();

        if (current?.identity !== installed.identity)
          throw failure("conflict", "Managed tool selection changed", true);
        const inspected = await options.host.inspect(toolId, "feature", true, admission, signal);
        assertCurrent();
        eligible(inspected);
        await guard(signal);
        checkAbort(next);
        assertCurrent();
      },
      async release() {
        await held.release();
        owned.delete(lease);
      },
    };

    owned.set(lease, { request, toolId, admission });

    try {
      await lease.validate(signal);

      return lease;
    } catch (cause) {
      await lease.release();
      throw cause;
    }
  }

  async function resolveLaunch(
    facts: DiscoveryFacts,
    lease: LaunchSelectionLease,
    request: LaunchAdmissionRequest
  ): Promise<Launch> {
    const binding = owned.get(lease);

    if (!binding || binding.request !== request || facts !== request.facts)
      throw failure("conflict", "Provider launch requires its runtime-owned reservation", true);
    const signal = request.signal;
    await lease.validate(signal);
    const installed = await options.host.current(binding.toolId);
    lease.assertCurrent();

    if (!installed || installed.identity !== lease.selectionIdentity)
      throw failure("conflict", "Provider launch selection differs from its reservation", true);

    if (!options.plan)
      throw failure("audit-required", "Provider launch adapter has not been verified");
    const snapshot = structuredClone(facts);
    const plan = await options.plan(snapshot, structuredClone(installed));
    await lease.validate(signal);
    await verifyPlan(
      options.host,
      binding.toolId,
      snapshot,
      installed,
      plan,
      () => lease.assertCurrent(),
      binding.admission,
      signal
    );
    await lease.validate(signal);
    lease.assertCurrent();

    return structuredClone(plan.launch);
  }

  return { reserveLaunch, resolveLaunch };
}
