/**
 * Builds the app and packs it for Even Hub:
 * `bun run pack --host <origin> [--host …]` writes build/app.json with those
 * origins in the network whitelist, then build/polaris-g2-<version>.ehpk.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import manifest from "../app.json" with { type: "json" };
import pkg from "../package.json" with { type: "json" };
import { BadHost, hostsFromArgs, withWhitelist } from "./manifest.ts";

const root = join(import.meta.dir, "..");

const hosts = hostsFromArgs(Bun.argv.slice(2));

if (hosts.length === 0) {
  console.error("usage: bun run pack --host <mac>.<tailnet>.ts.net [--host <origin> …]");
  process.exit(1);
}

const run = (command: ReadonlyArray<string>) => {
  const result = Bun.spawnSync([...command], {
    cwd: root,
    stdio: ["inherit", "inherit", "inherit"],
  });

  if (result.exitCode !== 0) process.exit(result.exitCode);
};

let built: ReturnType<typeof withWhitelist<typeof manifest>>;

try {
  built = withWhitelist(manifest, hosts, pkg.version);
} catch (error) {
  if (!(error instanceof BadHost)) throw error;
  console.error(error.message);
  process.exit(1);
}

mkdirSync(join(root, "build"), { recursive: true });

await Bun.write(join(root, "build", "app.json"), `${JSON.stringify(built, null, 2)}\n`);

run(["bunx", "vite", "build"]);

const output = join("build", `polaris-g2-${pkg.version}.ehpk`);

run(["bunx", "evenhub", "pack", "build/app.json", "dist", "-o", output]);

const network = built.permissions.find((permission) => permission.name === "network");

console.log(`${output}: whitelist ${network?.whitelist?.join(", ") ?? ""}`);
