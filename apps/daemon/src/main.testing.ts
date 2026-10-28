#!/usr/bin/env bun
/**
 * The Daemon for tests that spawn one: `main.ts` with HostSecrets in
 * `<POLARIS_HOME>/secrets`, never the user's Keychain. Never compiled into a release.
 */
import { useFileSecretsForTests } from "./secrets/index.ts";

useFileSecretsForTests();

await import("./main.ts");
