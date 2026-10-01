import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { locateBuilds } from "./builds.ts";
import { writeDist } from "./fakeHost.testing.ts";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "polaris-builds-"));
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

test("a user recovery rebuilds all targets rather than dropping other platforms", async () => {
  const repoDist = join(root, "apps/daemon/dist");
  const complete = join(root, "complete");
  writeDist(repoDist, { version: "0.1.0", platform: "darwin-arm64" });
  writeDist(complete, { version: "0.2.0", platform: "linux-x64" });
  mkdirSync(join(root, "scripts"), { recursive: true });
  writeFileSync(
    join(root, "scripts/build-daemon.ts"),
    `import { cpSync, writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(join(root, "args.json"))}, JSON.stringify(process.argv.slice(2)));
cpSync(${JSON.stringify(complete)}, ${JSON.stringify(repoDist)}, { recursive: true });`
  );
  const builds = locateBuilds({ env: {}, resources: null, repoRoot: root, buildOnDemand: true });
  let started = 0;

  const onBuild = Effect.sync(() => {
    started += 1;
  });

  const background = await Effect.runPromise(
    builds.forPlatform("linux-x64", { build: false, onBuild })
  );

  expect(background.map((b) => b.platform)).toEqual(["darwin-arm64"]);
  expect(started).toBe(0);

  const refreshed = await Effect.runPromise(
    builds.forPlatform("linux-x64", { build: true, onBuild })
  );

  expect(refreshed.map((b) => b.version)).toEqual(["0.2.0"]);
  expect(readFileSync(join(root, "args.json"), "utf8")).toBe("[]");
  expect(started).toBe(1);
});

test("a packaged app uses its bundled targets, and an explicit fixture takes precedence", async () => {
  writeDist(join(root, "resources/daemon"), { version: "0.2.0", platform: "linux-x64" });
  writeDist(join(root, "fixture"), { version: "0.3.0", platform: "linux-arm64" });
  const base = { resources: join(root, "resources"), repoRoot: root, buildOnDemand: true };
  const packaged = locateBuilds({ ...base, env: {} });

  const fixture = locateBuilds({
    ...base,
    env: { POLARIS_DESKTOP_DAEMON_DIST: join(root, "fixture") },
  });

  const options = { build: false, onBuild: Effect.void };

  expect(packaged.source).toBe("bundled");
  expect((await Effect.runPromise(packaged.forPlatform("linux-x64", options)))[0]?.version).toBe(
    "0.2.0"
  );
  expect(fixture.source).toBe("env");
  expect((await Effect.runPromise(fixture.forPlatform("linux-arm64", options)))[0]?.version).toBe(
    "0.3.0"
  );
});
