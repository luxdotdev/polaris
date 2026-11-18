#!/usr/bin/env node
/**
 * Shared Sessions end to end (ENG-941), as an owner and a Teammate use them: a local Account
 * Server with a fake GitHub and a real relay (`lib/sharingServers.ts`), the owner's Daemon and
 * app signed in as @octocat, and a second app with its own Daemon signed in as @hubot. Nine
 * steps (`lib/sharingSteps.ts`, `lib/sharingAccessSteps.ts`), each checked and screenshotted
 * dark and light at Balanced density; `results.json` holds the pass/fail table.
 * Needs `bun scripts/build.ts --no-app` and Docker. No real GitHub, relay or Polaris Cloud.
 *
 *   POLARIS_RELAY_BIN=<polaris-relay> node scripts/sharingE2e.ts <out dir>
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  stepBoundaries,
  stepCoAuthor,
  stepHostOffline,
  stepRoleAndRevoke,
} from "./lib/sharingAccessSteps.ts";
import { launch, log, newHome, type Rig, runStep, startServers } from "./lib/sharingRig.ts";
import { initSessionRepo } from "./lib/sessionReviewFlow.ts";
import { stepApprovals, stepComments, stepOpen, stepQueue, stepShare } from "./lib/sharingSteps.ts";

const out = process.argv[2] ?? join(tmpdir(), "polaris-sharing-e2e");

mkdirSync(out, { recursive: true });

const servers = await startServers();

const home = newHome();

const repo = join(home, "repo");

initSessionRepo(repo);

const STEPS = [
  ["Owner shares as a contributor", stepShare],
  ["Teammate accepts and opens over the relay", stepOpen],
  ["The shared queue", stepQueue],
  ["Approvals", stepApprovals],
  ["Comments", stepComments],
  ["Co-authored-by", stepCoAuthor],
  ["Downgrade to commenter, and revoke", stepRoleAndRevoke],
  ["The owner's Host offline and back", stepHostOffline],
  ["What a Teammate never reaches", stepBoundaries],
] as const;

const people: Array<Rig["owner"]> = [];

let failed = 0;

try {
  const owner = await launch({
    home,
    servers,
    name: "owner",
    login: "octocat",
    label: "Mac Studio",
  });

  people.push(owner);

  const teammate = await launch({
    home,
    servers,
    name: "teammate",
    login: "hubot",
    label: "MacBook Pro",
  });

  people.push(teammate);
  const rig: Rig = { out, home, repo, servers, owner, teammate, sessions: [], checks: [] };

  for (const [index, [title, step]] of STEPS.entries())
    await runStep(rig, index + 1, title, () => step(rig));

  writeFileSync(join(out, "results.json"), `${JSON.stringify(rig.checks, null, 2)}\n`);

  for (const [index, [title]] of STEPS.entries()) {
    const mine = rig.checks.filter((c) => c.step === index + 1);
    const pass = mine.length > 0 && mine.every((c) => c.pass);

    log(
      `${pass ? "PASS" : "FAIL"} · ${index + 1}. ${title} (${mine.filter((c) => c.pass).length}/${mine.length})`
    );
  }

  failed = rig.checks.filter((c) => !c.pass).length;
} finally {
  for (const { app, daemon } of people) {
    await app.close().catch(() => undefined);
    await daemon.stop().catch(() => undefined);
  }

  servers.stop();
  rmSync(home, { recursive: true, force: true });
}

process.exit(failed === 0 ? 0 : 1);
