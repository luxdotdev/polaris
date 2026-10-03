import { expect, test } from "bun:test";
import { chmod, writeFile } from "node:fs/promises";
import * as P from "@polaris/protocol";
import { fixture } from "../discovery/fixture.ts";
import { createProjectDiscovery } from "../discovery/index.ts";
import { createSelectionLedger } from "../install/selection-ledger.ts";
import { configuredLaunchAdapters } from "./configuredLaunch.ts";

async function setup() {
  const f = await fixture();
  const executable = await f.put("configured-server", "existing configured bytes; never executed");
  await chmod(executable, 0o700);
  const discovery = createProjectDiscovery({ registry: f.registry });

  const facts = await discovery.discover({
    checkout: f.checkout,
    path: await f.put("a.ts"),
    providerId: "typescript",
    settings: P.LanguageEffectiveSettings.make({
      ...f.settings,
      settings: {
        executableOverrides: {
          typescript: { executable, argv: ["--stdio"], environment: { LOCAL: "private" } },
        },
      },
    }),
  });

  const context = P.LanguageContextIdentity.make({
    hostId: f.hostId,
    clientId: "client",
    contextId: "context",
    checkout: f.checkout,
    providerId: "typescript",
    projectRoot: facts.projectRoot,
    generation: 1,
    configurationFingerprint: facts.configurationFingerprint,
  });

  const controller = new AbortController();
  let current = true;
  const request = { context, facts, signal: controller.signal, isCurrent: () => current };
  const ledger = createSelectionLedger();

  return {
    f,
    request,
    executable,
    ledger,
    adapters: configuredLaunchAdapters(ledger),
    stale: () => {
      current = false;
    },
  };
}

test("explicit configured launch retains its lease and refuses foreign requests, staleness and release reuse", async () => {
  const f = await setup();
  const lease = await f.adapters.reserveLaunch(f.request);

  try {
    const launch = await f.adapters.resolveLaunch(f.request.facts, lease, f.request);
    expect(launch.executable).toBe(f.executable);
    expect(launch.args).toEqual(["--stdio"]);
    expect(launch.cwd).toBe(f.request.facts.projectRoot);
    expect(f.ledger.stats().launches).toBe(1);
    expect(
      f.adapters.resolveLaunch(f.request.facts, lease, { ...f.request })
    ).rejects.toMatchObject({ reason: "not-owner" });
    f.stale();
    expect(lease.validate(f.request.signal)).rejects.toMatchObject({ reason: "cancelled" });
  } finally {
    await lease.release();
    expect(f.ledger.stats().launches).toBe(0);
    expect(f.adapters.resolveLaunch(f.request.facts, lease, f.request)).rejects.toMatchObject({
      reason: "not-owner",
    });
    f.ledger.dispose();
    await f.f.cleanup();
  }
});

test("configured executable replacement invalidates an already captured launch", async () => {
  const f = await setup();
  const lease = await f.adapters.reserveLaunch(f.request);

  try {
    await writeFile(f.executable, "changed executable bytes");
    expect(f.adapters.resolveLaunch(f.request.facts, lease, f.request)).rejects.toMatchObject({
      reason: "conflict",
    });
  } finally {
    await lease.release();
    f.ledger.dispose();
    await f.f.cleanup();
  }
});
