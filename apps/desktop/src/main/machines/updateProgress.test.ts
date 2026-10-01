import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyPlan,
  type ApplyProgress,
  loadBuilds,
  planInstall,
  probeHost,
  Ssh,
} from "@polaris/client/install";
import { Effect, Predicate } from "effect";
import { hostPlatform, runOnFakeHost, writeDist } from "./fakeHost.testing.ts";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "polaris-update-progress-"));
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

const upgrade = (corrupt: boolean) => {
  const home = join(root, "host");
  const dist = join(root, "dist");
  const platform = hostPlatform();
  writeDist(dist, { version: "0.1.0", platform });
  runOnFakeHost(home, `mkdir -p "$HOME" && "${join(dist, platform, "polaris")}" install`);
  writeDist(dist, { version: "0.2.0", platform, paddingBytes: 400_000 });
  const builds = loadBuilds(dist);
  const progress: Array<ApplyProgress> = [];

  if (corrupt) writeFileSync(join(dist, platform, "polaris"), "corrupt");

  const run = Effect.gen(function* () {
    const probe = yield* probeHost("fake");
    const plan = planInstall(probe, builds, { trigger: "user", approvedSha256: new Set() });

    if (!Predicate.isTagged(plan, "Upgrade")) throw new Error("expected upgrade");

    return yield* applyPlan("fake", plan, (p) => progress.push(p));
  }).pipe(Effect.provide(Ssh.local(home)));

  return { home, progress, builds, run };
};

test("upload progress counts real bytes and switches after SHA-256 verification", async () => {
  const { progress, builds, run, home } = upgrade(false);
  await Effect.runPromise(run);
  const total = builds[0]!.files[0]!.size;

  expect(progress[0]).toEqual({ stage: "uploading", bytes: 0, total });
  expect(progress.some((p) => p.bytes > 0 && p.bytes < total)).toBe(true);
  expect(progress.at(-1)).toEqual({ stage: "switching", bytes: total, total });
  expect(progress.every((p, i) => p.bytes >= (progress[i - 1]?.bytes ?? 0))).toBe(true);
  expect(readdirSync(join(home, ".polaris")).some((name) => name.startsWith("upload-"))).toBe(
    false
  );
});

test("a rejected upload is cleaned up and never switches the installed binary", async () => {
  const { progress, run, home } = upgrade(true);
  const error = await Effect.runPromise(Effect.flip(run));

  expect(error.message).toContain("SHA-256");
  expect(progress.some((p) => p.stage === "switching")).toBe(false);
  expect(runOnFakeHost(home, '"$HOME/.polaris/bin/current/polaris" version').stdout).toContain(
    "0.1.0"
  );
  expect(readdirSync(join(home, ".polaris")).some((name) => name.startsWith("upload-"))).toBe(
    false
  );
});
