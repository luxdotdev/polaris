import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fixtureEnvironment } from "./process.mjs";

const fixtureRoot = process.argv[2];

const fixtureConfigPath = join(fixtureRoot, "config");

const fixtureCachePath = join(fixtureRoot, "cache");

const fixtureStatePath = join(fixtureRoot, "state");

const fixtureStorePath = join(fixtureRoot, "store");

mkdirSync(fixtureConfigPath, { recursive: true });

for (const name of ["user.npmrc", "global.npmrc"]) writeFileSync(join(fixtureConfigPath, name), "");

const installerEnvironment = {
  ...fixtureEnvironment(fixtureRoot),
  XDG_CONFIG_HOME: fixtureConfigPath,
  npm_config_userconfig: join(fixtureConfigPath, "user.npmrc"),
  npm_config_globalconfig: join(fixtureConfigPath, "global.npmrc"),
  npm_config_cache_dir: fixtureCachePath,
  npm_config_state_dir: fixtureStatePath,
  npm_config_store_dir: fixtureStorePath,
  npm_config_registry: "https://registry.npmjs.org/",
  npm_config_verify_store_integrity: "true",
  npm_config_update_notifier: "false",
};

const options = ["--dir", fixtureRoot];

const configResult = spawnSync("pnpm", ["--dir", fixtureRoot, "config", "list", "--json"], {
  cwd: fixtureRoot,
  env: installerEnvironment,
  encoding: "utf8",
  timeout: 10000,
});

assert.equal(configResult.status, 0, configResult.stderr);

const config = JSON.parse(configResult.stdout);

assert.equal(config.userconfig, installerEnvironment.npm_config_userconfig);

assert.equal(config.globalconfig, installerEnvironment.npm_config_globalconfig);

assert.equal(config["cache-dir"], fixtureCachePath);

assert.equal(config["state-dir"], fixtureStatePath);

assert.equal(config["store-dir"], fixtureStorePath);

assert.equal(config.registry, "https://registry.npmjs.org/");

for (const key of Object.keys(config))
  assert.ok(!/auth|token|password|username/i.test(key), `Unexpected credential setting ${key}`);

console.log(
  JSON.stringify({
    pnpmConfig: {
      userconfig: config.userconfig,
      globalconfig: config.globalconfig,
      configDir: join(fixtureConfigPath, "pnpm"),
      cacheDir: fixtureCachePath,
      stateDir: fixtureStatePath,
      storeDir: fixtureStorePath,
    },
    credentialSettings: "none",
    inheritedEnvironment: "allowlist only",
  })
);

const result = spawnSync("pnpm", [...options, "install", "--frozen-lockfile", "--ignore-scripts"], {
  cwd: fixtureRoot,
  env: installerEnvironment,
  stdio: "inherit",
  timeout: 180000,
});

assert.equal(result.status, 0, `Fixture install failed: ${result.error?.message ?? result.signal}`);
