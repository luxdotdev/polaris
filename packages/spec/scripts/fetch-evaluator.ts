#!/usr/bin/env bun
/**
 * Installs the Rust evaluator `quint test` and `quint run` use, ahead of time and with retries.
 * Quint fetches it on first use through GitHub's unauthenticated API, which shared CI runners
 * exhaust; with `GITHUB_TOKEN` set this asks as that token instead. Usage:
 *   bun packages/spec/scripts/fetch-evaluator.ts
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Schema } from "effect";
import { rustEvaluatorDir } from "@informalsystems/quint/dist/src/config.js";
import { QUINT_EVALUATOR_VERSION } from "@informalsystems/quint/dist/src/rust/binaryManager.js";

const ASSETS = new Map([
  ["darwin-arm64", "quint_evaluator-aarch64-apple-darwin.tar.gz"],
  ["darwin-x64", "quint_evaluator-x86_64-apple-darwin.tar.gz"],
  ["linux-arm64", "quint_evaluator-aarch64-unknown-linux-gnu.tar.gz"],
  ["linux-x64", "quint_evaluator-x86_64-unknown-linux-gnu.tar.gz"],
]);

const asset = ASSETS.get(`${process.platform}-${process.arch}`);

if (asset === undefined)
  throw new Error(`No Quint evaluator for ${process.platform}-${process.arch}`);

const directory = rustEvaluatorDir(QUINT_EVALUATOR_VERSION);

const executable = join(directory, "quint_evaluator");

const headers = (accept: string): Headers => {
  const result = new Headers({ Accept: accept, "User-Agent": "polaris-spec" });

  const token = process.env.GITHUB_TOKEN;

  if (token) result.set("Authorization", `Bearer ${token}`);

  return result;
};

const Release = Schema.Struct({
  assets: Schema.Array(Schema.Struct({ name: Schema.String, url: Schema.String })),
});

const download = async (): Promise<Uint8Array> => {
  const tag = encodeURIComponent(`evaluator/${QUINT_EVALUATOR_VERSION}`);

  const release = await fetch(
    `https://api.github.com/repos/informalsystems/quint/releases/tags/${tag}`,
    { headers: headers("application/vnd.github+json") }
  );

  if (!release.ok) throw new Error(`release lookup: ${release.status} ${release.statusText}`);

  const { assets } = Schema.decodeUnknownSync(Release)(await release.json());

  const found = assets.find((candidate) => candidate.name === asset);

  if (found === undefined) throw new Error(`${asset} is missing from the release`);

  const body = await fetch(found.url, { headers: headers("application/octet-stream") });

  if (!body.ok) throw new Error(`download: ${body.status} ${body.statusText}`);

  return new Uint8Array(await body.arrayBuffer());
};

const install = async () => {
  for (let attempt = 1; ; attempt++) {
    try {
      return await download();
    } catch (error) {
      if (attempt === 4) throw error;
      console.error(`Quint evaluator fetch failed (${String(error)}); retrying`);
      await Bun.sleep(attempt * 5000);
    }
  }
};

if (existsSync(executable)) {
  console.log(`Quint evaluator ${QUINT_EVALUATOR_VERSION} already at ${executable}`);
} else {
  const archive = await install();

  mkdirSync(directory, { recursive: true });
  const tarball = join(directory, asset);

  writeFileSync(tarball, archive);
  execFileSync("tar", ["-xzf", tarball, "-C", directory]);
  rmSync(tarball);

  if (!existsSync(executable)) throw new Error(`${asset} did not contain quint_evaluator`);
  console.log(`Quint evaluator ${QUINT_EVALUATOR_VERSION} installed at ${executable}`);
}
