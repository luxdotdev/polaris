import { expect, test } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { Predicate } from "effect";
import { HostId } from "@polaris/protocol";
import { catalog, preflight } from "./index.ts";
import { createInstaller } from "../install/index.ts";
import { availability } from "../availability/index.ts";

test("bundled ShellCheck stays audit blocked on all four targets before approval or download", async () => {
  const tool = catalog.tools.find((entry) => entry.id === "shellcheck");

  if (tool === undefined) throw new Error("ShellCheck missing from managed catalog");

  expect(tool.disposition).toBe("offered");

  expect(tool.artifacts).toHaveLength(4);

  for (const artifact of tool.artifacts) {
    const platform = artifact.platforms[0];

    if (platform === undefined) throw new Error("ShellCheck target missing");

    expect(artifact.audit).toBe("pending");

    expect(preflight({ tool, platform, probes: [], phase: "install" }).status).toBe(
      "audit-required"
    );

    const fact = availability({
      hostId: HostId.make("managed-shellcheck-fixture"),
      platform,
      tool,
      connected: true,
      trusted: true,
      approved: false,
      phase: "feature",
      probes: [],
      installed: null,
      checkedAt: 1,
    });

    expect(Predicate.isTagged(fact.preflight, "Blocked")).toBe(true);

    const root = await realpath(await mkdtemp("/private/tmp/m31-managed-shellcheck-"));

    let approvals = 0;

    let downloads = 0;

    const installer = await createInstaller({
      hostId: fact.hostId,
      platform,
      root,
      adapters: {
        approve: async (exact) => {
          approvals++;

          return { approved: true, identity: exact.identity };
        },
        download: async function* () {
          downloads++;

          yield new Uint8Array();
        },
        decode: async () => {
          throw new Error("Unexpected artifact decode");
        },
      },
    });

    try {
      expect(() =>
        installer.install({ tool, connected: true, probes: [], intent: "install" })
      ).toThrow();

      expect(approvals).toBe(0);

      expect(downloads).toBe(0);

      expect(await installer.current(tool.id)).toBeNull();
    } finally {
      await installer.dispose();
      await rm(root, { recursive: true, force: true });
    }
  }
});
