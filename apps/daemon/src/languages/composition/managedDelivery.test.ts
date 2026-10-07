import { expect, test } from "bun:test";
import { rejects } from "node:assert/strict";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { join } from "node:path";
import * as P from "@polaris/protocol";
import { createProjectDiscovery } from "../discovery/index.ts";
import { fixture as projectFixture } from "../discovery/fixture.ts";
import { createHostInstallations } from "../install/host.ts";
import { createSelectionLedger } from "../install/selection-ledger.ts";
import { artifactFixture, hostId, platform } from "../install/fixture.testing.ts";
import { httpsArtifactDownload } from "../install/download.ts";
import { createManagedDelivery } from "./managedDelivery.ts";

const settings = (automatic = true) =>
  P.LanguageEffectiveSettings.make({
    revision: 0,
    formatOnSave: true,
    formatter: P.LanguageFormatterSelection.cases.None.make({}),
    providers: [],
    origins: {},
    settings: { downloadLanguageToolsAutomatically: automatic },
  });

async function fixture(corrupt = false) {
  const root = await realpath(await mkdtemp("/private/tmp/slice-1-delivery-"));
  const source = artifactFixture();
  const downloads = new Map<string, number>();

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;
      downloads.set(path, (downloads.get(path) ?? 0) + 1);

      return new Response(corrupt ? Buffer.from("corrupt") : source.bytes);
    },
  });

  const registry = createHostInstallations();
  const ledger = createSelectionLedger();
  const managed = createManagedDelivery();

  const tools = ["node", "typescript", "typescript-language-server"].map((id) => ({
    ...source.tool,
    id,
    artifacts: source.tool.artifacts.map((artifact) => ({
      ...artifact,
      url: `https://fixture.invalid/${id}`,
    })),
  }));

  const host = await registry.get({
    root: join(root, "private"),
    hostId,
    platform,
    tools,
    adapters: {
      approve: async (exact) => ({ approved: true, identity: exact.identity }),
      download: httpsArtifactDownload(async (url, init) => {
        const response = await fetch(new URL(new URL(url).pathname, server.url), init);

        return new Response(response.body, { status: response.status, headers: response.headers });
      }),
      decode: async () => source.payload,
    },
    observe: async () => ({ connected: true, probes: [] }),
    reserveSelection: (exact, signal) => ledger.reserveSelection(exact.tool.id, signal),
  });

  managed.delivery.bind(host);
  const admission = { cwd: root, requireCurrent: async () => {} };

  return {
    root,
    host,
    managed,
    downloads,
    admission,
    async close() {
      await registry.dispose();
      ledger.dispose();
      await managed.dispose();
      await server.stop(true);
      await rm(root, { recursive: true, force: true });
    },
  };
}

test("local artifact server installs once per Host/tool/version across concurrent opens and reuse", async () => {
  const f = await fixture();

  try {
    await Promise.all(
      Array.from({ length: 3 }, () =>
        f.managed.delivery.ensure(settings(), f.admission, new AbortController().signal)
      )
    );
    await f.managed.delivery.ensure(settings(false), f.admission, new AbortController().signal);

    for (const id of ["node", "typescript", "typescript-language-server"]) {
      expect(f.downloads.get(`/${id}`)).toBe(1);
      expect((await f.host.current(id))?.version).toBe("1.0.0");
    }
  } finally {
    await f.close();
  }
});

test("auto-download off reports not-installed without contacting the fixture server", async () => {
  const f = await fixture();

  try {
    await rejects(
      f.managed.delivery.ensure(settings(false), f.admission, new AbortController().signal),
      { reason: "not-installed" }
    );
    expect(f.downloads.size).toBe(0);
    expect(await f.host.current("node")).toBeNull();
  } finally {
    await f.close();
  }
});

test("fixture checksum mismatch never activates a private runtime or server", async () => {
  const f = await fixture(true);

  try {
    await rejects(
      f.managed.delivery.ensure(settings(), f.admission, new AbortController().signal),
      { reason: "audit-required" }
    );
    expect(await f.host.current("node")).toBeNull();
    expect(await f.host.current("typescript-language-server")).toBeNull();
  } finally {
    await f.close();
  }
});

test("launch plans select native TS 7, project tsserver/plugins, and guarded bundled override", async () => {
  const f = await fixture();
  const project = await projectFixture();

  try {
    await f.managed.delivery.ensure(settings(), f.admission, new AbortController().signal);
    const installed = await f.host.current("typescript-language-server");

    if (installed === null) throw new Error("Fixture installation missing");
    const path = await project.put("file.ts");
    await project.put(
      "tsconfig.json",
      '{"compilerOptions":{"plugins":[{"name":"sample-plugin"}]}}'
    );
    await project.put(
      "node_modules/typescript/package.json",
      '{"name":"typescript","version":"6.0.3"}'
    );
    const tsserver = await project.put("node_modules/typescript/lib/tsserver.js", "fixture");

    const discovery = createProjectDiscovery({
      registry: project.registry,
      bundledTypeScript: true,
    });

    const input = {
      checkout: project.checkout,
      path,
      providerId: "typescript-language-server",
      settings: project.settings,
    };

    const old = await discovery.discover({ ...input, useProjectTypeScript: true });
    const oldPlan = await f.managed.delivery.plan(old, installed);
    expect(oldPlan.launch.initializationOptions).toMatchObject({ tsserver: { path: tsserver } });
    expect(oldPlan.launch.environment.NODE_OPTIONS).toBe("");
    expect(old.plugins.map(({ name }) => name)).toEqual(["sample-plugin"]);
    const bundled = await f.managed.delivery.plan(await discovery.discover(input), installed);
    expect(bundled.launch.environment.NODE_OPTIONS).toContain("plugin-guard.cjs");
    const binary = "/fixture/native-tsc";
    const native = { ...old, tsserver: null, sdkVersion: "7.0.2", nativeServer: binary };
    expect((await f.managed.delivery.plan(native, installed)).launch).toMatchObject({
      executable: binary,
      args: ["--lsp", "--stdio"],
      cwd: old.projectRoot,
    });
    await rejects(f.managed.delivery.plan({ ...native, nativeServer: null }, installed), {
      reason: "missing-prerequisite",
    });
  } finally {
    await f.close();
    await project.cleanup();
  }
});
