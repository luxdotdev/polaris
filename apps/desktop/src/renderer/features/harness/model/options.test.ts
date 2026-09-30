import { describe, expect, test } from "bun:test";
import { HARNESS_CATALOGUE, type HarnessStatus } from "@polaris/protocol";
import {
  type AvailabilityReport,
  defaultHarness,
  harnessOptions,
  listedOptions,
  otherCount,
  readyOn,
} from "./options.ts";

const probe = (harness: string, status: HarnessStatus, version: string | null = "1.0.0") => ({
  harness,
  status,
  version,
  minVersion: "2.0.0",
  detail: status === "ready" ? null : "said the Harness",
  signInArgv: status === "not-installed" ? null : [harness, "login"],
});

const report = (...harnesses: ReadonlyArray<ReturnType<typeof probe>>): AvailabilityReport => ({
  harnesses,
  checkedAt: "2026-09-30T00:00:00.000Z",
});

const [first, second, third] = HARNESS_CATALOGUE;

describe("Harness options", () => {
  test("every Harness the Host reports appears, in its order, catalogue or not", () => {
    const all = report(
      ...HARNESS_CATALOGUE.map((e) => probe(e.kind, "ready")),
      probe("zed", "ready")
    );

    expect(harnessOptions(all, []).map((o) => o.kind)).toEqual([
      ...HARNESS_CATALOGUE.map((e) => e.kind),
      "zed",
    ]);
  });

  test("an unknown kind shows by its name, with no docs", () => {
    const [zed] = harnessOptions(report(probe("zed", "not-installed")), []);

    expect(zed).toMatchObject({
      name: "zed",
      docsUrl: null,
      setupLine: "zed isn't installed on this host.",
    });
  });

  test("only ready and needs-sign-in are listed; the rest count as other", () => {
    const options = harnessOptions(
      report(
        probe(first.kind, "ready"),
        probe(second.kind, "needs-sign-in"),
        probe(third.kind, "not-installed"),
        probe("zed", "outdated"),
        probe("yak", "unknown")
      ),
      []
    );

    expect(listedOptions(options).map((o) => o.kind)).toEqual([first.kind, second.kind]);
    expect(otherCount(options)).toBe(3);
  });

  test("not installed: the catalogue's setup line and docs, never an install command", () => {
    const [option] = harnessOptions(report(probe(first.kind, "not-installed")), []);

    expect(option).toMatchObject({
      startable: false,
      listed: false,
      setupLine: first.setup.install,
      docsUrl: first.setup.docsUrl,
      signInArgv: null,
    });
    expect(Object.keys(first.setup)).not.toContain("installCommand");
  });

  test("needs sign-in carries its own sign-in; outdated says what to do", () => {
    const [signIn, outdated] = harnessOptions(
      report(probe(first.kind, "needs-sign-in"), probe(second.kind, "outdated", "1.4.0")),
      []
    );

    expect(signIn).toMatchObject({
      listed: true,
      startable: false,
      setupLine: first.setup.signIn,
      signInArgv: [first.kind, "login"],
    });
    expect(outdated?.setupLine).toBe(
      `${second.name} 1.4.0 is older than 2.0.0, the oldest Polaris supports. See its setup guide.`
    );
    expect(outdated?.signInArgv).toBeNull();
  });

  test("without a report, the drivers the Daemon announces are listed, status unknown", () => {
    expect(harnessOptions(null, [second.capability, "git.diff"])).toMatchObject([
      { kind: second.kind, status: "unknown", startable: true, listed: true },
    ]);
  });

  test("the default is the first listed Harness that can start", () => {
    const options = harnessOptions(
      report(
        probe(first.kind, "not-installed"),
        probe(second.kind, "needs-sign-in"),
        probe(third.kind, "ready")
      ),
      []
    );

    expect(defaultHarness(options)).toBe(third.kind);
    expect(defaultHarness(harnessOptions(report(probe(first.kind, "needs-sign-in")), []))).toBe(
      first.kind
    );
    expect(defaultHarness([])).toBeNull();
  });

  test("ready on N of M hosts", () => {
    const [ready] = harnessOptions(report(probe(first.kind, "ready")), []);
    const [not] = harnessOptions(report(probe(first.kind, "not-installed")), []);

    expect(readyOn([ready, not, undefined])).toBe("Ready on 1 of 3 hosts");
    expect(readyOn([ready])).toBe("Ready on 1 of 1 host");
  });
});
