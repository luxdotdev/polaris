// Builds and packs the spike for one host: `bun pack.ts <mac>.<tailnet>.ts.net`.
// The host goes into the bundle and app.json's network whitelist; neither is committed.
import { mkdirSync } from "node:fs";

import manifest from "./app.json" with { type: "json" };

const host = Bun.argv[2] ?? "";

if (!/^[a-z0-9.-]+$/.test(host)) {
  console.error("usage: bun pack.ts <mac>.<tailnet>.ts.net");
  process.exit(1);
}

const run = (command: ReadonlyArray<string>, env: Record<string, string> = {}) => {
  const result = Bun.spawnSync([...command], {
    env: { ...Bun.env, ...env },
    stdio: ["inherit", "inherit", "inherit"],
  });

  if (result.exitCode !== 0) process.exit(result.exitCode);
};

const permissions = manifest.permissions.map((permission) => ({
  ...permission,
  whitelist: [`https://${host}`, `wss://${host}`],
}));

mkdirSync("build", { recursive: true });

await Bun.write("build/app.json", `${JSON.stringify({ ...manifest, permissions }, null, 2)}\n`);

run(["bunx", "vite", "build"], { VITE_SPIKE_HOST: host });

run(["bunx", "evenhub", "pack", "build/app.json", "dist", "-o", "polaris-g2-spike.ehpk"]);
