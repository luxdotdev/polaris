import { expect, test } from "bun:test";
import { rejects } from "node:assert/strict";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { join } from "node:path";
import * as P from "@polaris/protocol";
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
