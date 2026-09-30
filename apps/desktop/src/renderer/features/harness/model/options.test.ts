import { describe, expect, test } from "bun:test";
import { HARNESS_CATALOGUE, type HarnessStatus } from "@polaris/protocol";
import { type AvailabilityReport, defaultHarness, harnessOptions } from "./harnesses.ts";

const probe = (harness: string, status: HarnessStatus, version: string | null = "1.0.0") => ({
  harness,
  status,
  version,
  minVersion: "2.0.0",
  detail: status === "ready" ? null : "said the Harness",
  signInArgv: null,
});

const report = (...harnesses: ReadonlyArray<ReturnType<typeof probe>>): AvailabilityReport => ({
  harnesses,
  checkedAt: "2026-09-30T00:00:00.000Z",
});

const [first, second] = HARNESS_CATALOGUE;

describe("harness options", () => {
  test("every catalogue Harness the Host reports appears, in its order", () => {
    const all = report(...HARNESS_CATALOGUE.map((e) => probe(e.kind, "ready")));

    expect(harnessOptions(all, []).map((o) => o.kind)).toEqual(
      HARNESS_CATALOGUE.map((e) => e.kind)
    );
  });

  test("a Harness the Host doesn't report is left out; unknown kinds too", () => {
    expect(
      harnessOptions(report(probe(second.kind, "ready"), probe("future-harness", "ready")), []).map(
        (o) => o.kind
      )
    ).toEqual([second.kind]);
  });

  test("not installed: the catalogue's setup line and docs, never an install command", () => {
    const [option] = harnessOptions(report(probe(first.kind, "not-installed")), []);

    expect(option).toMatchObject({
      startable: false,
      setupLine: first.setup.install,
      docsUrl: first.setup.docsUrl,
    });
    expect(Object.keys(first.setup)).not.toContain("installCommand");
  });

  test("needs sign-in and outdated say what to do", () => {
    const [signIn, outdated] = harnessOptions(
      report(probe(first.kind, "needs-sign-in"), probe(second.kind, "outdated", "1.4.0")),
      []
    );

    expect(signIn?.setupLine).toBe(first.setup.signIn);
    expect(outdated?.setupLine).toBe(
      `${second.name} 1.4.0 is older than 2.0.0, the oldest Polaris supports. See its setup guide.`
    );
    expect(outdated?.detail).toBe("said the Harness");
  });

  test("ready and unknown can start", () => {
    const options = harnessOptions(
      report(probe(first.kind, "unknown"), probe(second.kind, "ready")),
      []
    );

    expect(options.map((o) => [o.startable, o.setupLine])).toEqual([
      [true, null],
      [true, null],
    ]);
  });

  test("without a report, the Harnesses whose driver the Daemon announces", () => {
    expect(harnessOptions(null, [second.capability, "git.diff"])).toMatchObject([
      { kind: second.kind, status: "unknown", startable: true },
    ]);
  });

  test("the default is the first Harness that can start", () => {
    const options = harnessOptions(
      report(probe(first.kind, "not-installed"), probe(second.kind, "ready")),
      []
    );

    expect(defaultHarness(options)).toBe(second.kind);
    expect(defaultHarness([])).toBeNull();
  });
});
