import { expect, test } from "bun:test";
import { join } from "node:path";
import { Effect } from "effect";
import { fixture } from "../discovery/fixture.ts";
import { createProjectDiscovery } from "../discovery/index.ts";
import { createExecutionTrust, createFileTrustRepository } from "../trust/index.ts";
import { trustStatus } from "./trustStatus.ts";

test("static TypeScript and plugin facts ask once without disabling the bundled provider", async () => {
  const f = await fixture();

  try {
    const path = await f.put("file.ts");
    await f.put("tsconfig.json", '{"compilerOptions":{"plugins":[{"name":"example-plugin"}]}}');
    await f.put("node_modules/typescript/package.json", '{"name":"typescript","version":"7.0.2"}');

    const binary = await f.put(
      `node_modules/@typescript/typescript-${process.platform}-${process.arch}/lib/tsc`,
      "must never execute"
    );

    await f.put(
      `node_modules/@typescript/typescript-${process.platform}-${process.arch}/package.json`,
      '{"version":"7.0.2"}'
    );

    const trust = createExecutionTrust({
      hostId: f.hostId,
      registry: f.registry,
      repository: createFileTrustRepository(join(f.temporary, "trust")),
      authorizeGrant: async () => {},
    });

    const service = {
      claimAsk: trust.claimAsk,
      inspect: () => Effect.die("unused"),
      set: () => Effect.die("unused"),
      change: () => Effect.die("unused"),
      require: () => Effect.die("unused"),
    };

    const discovery = createProjectDiscovery({ registry: f.registry, bundledTypeScript: true });

    const facts = await discovery.discover({
      checkout: f.checkout,
      path,
      providerId: "typescript-language-server",
      settings: f.settings,
    });

    const observed = (await trust.inspect(f.checkout)).trust;
    expect(facts.bundledTypeScript).toBe(true);
    expect(facts.nativeServer).toBe(binary);
    expect(trustStatus(facts, observed, service)).toMatchObject({
      ask: true,
      provider: "bundled",
      wouldRun: { typescriptVersion: "7.0.2", native: true, plugins: ["example-plugin"] },
    });
    expect(trustStatus(facts, observed, service).ask).toBe(false);
    await trust.change(f.checkout, "decline", 0);
    expect(trustStatus(facts, (await trust.inspect(f.checkout)).trust, service).ask).toBe(false);
    await trust.change(f.checkout, "trust", 1);
    expect(trustStatus(facts, (await trust.inspect(f.checkout)).trust, service).provider).toBe(
      "project"
    );
    await trust.change(f.checkout, "use-bundled", 2);
    expect(trustStatus(facts, (await trust.inspect(f.checkout)).trust, service).provider).toBe(
      "bundled"
    );
  } finally {
    await f.cleanup();
  }
});
