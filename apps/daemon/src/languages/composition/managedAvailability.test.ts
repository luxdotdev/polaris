import { expect, test } from "bun:test";
import { Effect, Result } from "effect";
import * as P from "@polaris/protocol";
import { availability } from "../availability/index.ts";
import { artifactFixture, hostId, platform } from "../install/fixture.testing.ts";
import { providerAvailability } from "./managedAvailability.ts";
import type { ManagedDelivery } from "./managedDelivery.ts";
import type { ObservationAdmission, InstallationInspection } from "../install/host.ts";

const settings = (automatic = true) =>
  P.LanguageEffectiveSettings.make({
    revision: 0,
    formatOnSave: true,
    formatter: P.LanguageFormatterSelection.cases.None.make({}),
    providers: [],
    origins: {},
    settings: { downloadLanguageToolsAutomatically: automatic },
  });

function fixture(options: { python?: boolean; approved?: boolean; unsupported?: boolean } = {}) {
  let ensures = 0;
  const phases: string[] = [];
  const admission = { cwd: "/fixture", requireCurrent: async () => {} };
  const source = artifactFixture();

  const tool = {
    ...source.tool,
    id: "basedpyright",
    requirements: [
      {
        id: "node",
        scope: "server",
        executable: "node",
        version: ">=24.18.0",
        required: true,
        detail: "Private Polaris Node",
      },
      {
        id: "python-interpreter",
        scope: "project",
        executable: "python",
        version: "present",
        required: true,
        detail: "Selected Python interpreter; no Python download",
      },
    ],
  };

  const managed: ManagedDelivery = {
    bind: () => {},
    ensure: async (effective) => {
      ensures++;

      if (effective.settings.downloadLanguageToolsAutomatically === false)
        throw new P.LanguageError({ reason: "not-installed", message: "Off", retryable: false });

      throw new Error("Discovery must not start or await downloads");
    },
    plan: async () => {
      throw new Error("Discovery must not launch a server");
    },
  };

  const installation = {
    inspect: (
      _id: string,
      phase: "install" | "feature",
      trusted: boolean,
      _admission?: ObservationAdmission,
      inspection: InstallationInspection = {}
    ) => {
      phases.push(phase);

      return Effect.succeed(
        availability({
          hostId,
          platform: options.unsupported ? { os: "linux", arch: "x64", libc: "musl" } : platform,
          tool,
          connected: true,
          trusted,
          approved: options.approved ?? true,
          phase,
          probes:
            options.python === false
              ? []
              : [
                  {
                    id: "python-interpreter",
                    executable: "/fixture/.venv/bin/python",
                    version: "present",
                  },
                ],
          installed: null,
          checkedAt: 1,
          deferManagedNode: inspection.deferManagedNode === true,
        })
      );
    },
  };

  return { installation, managed, admission, phases, ensures: () => ensures };
}

test("cold managed discovery returns eligibility without downloads or claiming installation", async () => {
  const f = fixture();

  const fact = await Effect.runPromise(
    providerAvailability(
      f.installation,
      f.managed,
      "basedpyright",
      "feature",
      false,
      f.admission,
      settings()
    )
  );

  expect(f.ensures()).toBe(0);
  expect(f.phases).toEqual(["install"]);
  expect(fact.phase).toBe("feature");
  expect(fact.preflight).toEqual(P.LanguagePreflight.cases.Eligible.make({ artifactId: "fake" }));
  expect(fact.installation).toEqual(P.LanguageInstallation.cases.NotInstalled.make({}));
  expect(fact.prerequisites).toMatchObject([
    { requirement: { id: "python-interpreter" }, outcome: "satisfied" },
  ]);
});

for (const [options, reason] of [
  [{ python: false }, "missing-prerequisite"],
  [{ approved: false }, "audit-required"],
  [{ unsupported: true }, "unsupported-platform"],
] as const) {
  test(`cold managed discovery preserves ${reason} without downloading`, async () => {
    const f = fixture(options);

    const fact = await Effect.runPromise(
      providerAvailability(
        f.installation,
        f.managed,
        "basedpyright",
        "feature",
        false,
        f.admission,
        settings()
      )
    );

    expect(fact.preflight).toMatchObject({ reason });
    expect(f.ensures()).toBe(0);
  });
}

test("automatic downloads off checks existing pins and reports not-installed without inspection", async () => {
  const f = fixture();

  const result = await Effect.runPromise(
    providerAvailability(
      f.installation,
      f.managed,
      "basedpyright",
      "feature",
      false,
      f.admission,
      settings(false)
    ).pipe(Effect.result)
  );

  expect(Result.isFailure(result)).toBe(true);

  if (Result.isFailure(result)) expect(result.failure.reason).toBe("not-installed");
  expect(f.ensures()).toBe(1);
  expect(f.phases).toEqual([]);
});

test("ordinary provider inspection retains its feature and trust checks", async () => {
  const f = fixture();

  const fact = await Effect.runPromise(
    providerAvailability(
      f.installation,
      f.managed,
      "other-provider",
      "feature",
      false,
      f.admission,
      settings()
    )
  );

  expect(fact.preflight).toMatchObject({ reason: "missing-prerequisite" });
  expect(fact.prerequisites).toHaveLength(2);
  expect(f.phases).toEqual(["feature"]);
  expect(f.ensures()).toBe(0);
});
