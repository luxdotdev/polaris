#!/usr/bin/env node
/**
 * The closed Output rail (ENG-978; Paper 0.11.0 R1, R1b, R2) in dark and light, on a real Daemon
 * with the bench Harness: Working with many long-named files, Ready with a pull request and a
 * branch ahead, Needs You, a session with no changes, and the Host Reconnecting. Needs a built app.
 *
 *   node scripts/outputRailScreens.ts <out dir>
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as P from "@polaris/protocol";
import type { Page } from "playwright-core";
import { startDaemon } from "./lib/daemon.ts";
import {
  scriptedElectron as electron,
  APP_DIR,
  electronBinary,
  sizeWindow,
} from "./lib/electron.ts";
import { initSessionRepo } from "./lib/sessionReviewFlow.ts";

const out = process.argv[2] ?? join(tmpdir(), "polaris-output-rail-screens");

mkdirSync(out, { recursive: true });

const home = mkdtempSync(join(tmpdir(), "polaris-rail-"));

const repo = join(home, "polaris");

const git = (...args: string[]) => execFileSync("git", args, { cwd: repo }).toString();

initSessionRepo(repo);

// A branch three commits ahead of its upstream: the rail's ↑3.
execFileSync("git", ["init", "-q", "--bare", join(home, "origin.git")]);

git("checkout", "-qb", "lucas/eng-978-closed-output-rail-a-compact-status-view");

git("remote", "add", "origin", join(home, "origin.git"));

git("push", "-qu", "origin", "HEAD");

for (const n of [1, 2, 3]) {
  writeFileSync(join(repo, `notes-${n}.md`), `note ${n}\n`);
  git("add", ".");
  git("commit", "-qm", `note ${n}`);
}

const daemon = await startDaemon({ home: join(home, "local"), benchHarness: true });

const userData = join(home, "user-data");

mkdirSync(userData, { recursive: true });

writeFileSync(
  join(userData, "settings.json"),
  JSON.stringify({ theme: "dark", welcomeSeen: true })
);

/** The bench Harness's Turn script (`BenchDriver.ts`); fields left out take its defaults. */
interface BenchScript {
  readonly items: number;
  readonly deltasPerItem?: number;
  readonly deltaIntervalMs?: number;
  readonly touchFiles?: number;
  readonly approvalEvery?: number;
  readonly approvalCommand?: string;
}

const bench = (script: BenchScript) => `bench:${JSON.stringify(script)}`;

/** About twenty seconds of streaming, editing three files from its fifth item. */
const LONG = bench({ items: 40, deltasPerItem: 4, deltaIntervalMs: 150, touchFiles: 3 });

const dispatchSource = (command: P.Command) =>
  `window.polaris.request("dispatch", { hostKey: "local", commandId: crypto.randomUUID(), command: ${JSON.stringify(command)} }).then((r) => { if (!r.ok) throw new Error(r.error.message); return r.value; })`;

/** Page source: registers the Workspace once; resolves with its id. */
const workspaceSource = `(async () => {
  const api = window.polaris;
  await ${dispatchSource(P.Command.cases.RegisterWorkspace.make({ path: repo, name: "polaris" }))};
  return await new Promise((resolve) => {
    const close = api.subscribe("host", { hostKey: "local" }, { items: (items) => {
      for (const i of items) {
        const all = i._tag === "Snapshot" ? i.workspaces
          : i._tag === "Event" && i.envelope.event._tag === "WorkspaceRegistered" ? [i.envelope.event.workspace] : [];
        const found = all.find((w) => w.path === ${JSON.stringify(repo)});
        if (found) { close(); resolve(found.id); return; }
      }
    } });
  });
})()`;

const start = async (page: Page, workspaceId: string, title: string, prompt: string) => {
  const sessionId = P.SessionId.make(crypto.randomUUID());

  await page.evaluate(
    dispatchSource(
      P.Command.cases.StartSession.make({
        sessionId,
        workspaceId: P.WorkspaceId.make(workspaceId),
        harness: "claude",
        placement: P.SessionPlacement.cases.InPlace.make({}),
        permissionMode: "auto",
        model: null,
        effort: null,
        prompt,
        attachments: [],
      })
    )
  );
  await page.evaluate(dispatchSource(P.Command.cases.RenameSession.make({ sessionId, title })));

  return sessionId;
};

/** Files with long names, written while the Turn works so its checkpoint takes them. */
const LONG_NAMES = [
  "src/harness/claude/ClaudeDriverIntegration.test.ts",
  "src/store/workspaceSubscriptionsWithoutDuplications.ts",
  "src/store/snapshotAroundReconnectBounds.ts",
  "src/shell/OutputRailCompactStatusView.tsx",
  "src/shell/copy.ts",
  "docs/adr/0142-a-closed-output-rail-that-reports-the-session.md",
  "CONTEXT.md",
  "README.md",
  "packages/protocol/src/events/sessionPullRequestLinked.ts",
];

const writeLongNames = () => {
  for (const [i, path] of LONG_NAMES.entries()) {
    mkdirSync(join(repo, path, ".."), { recursive: true });
    writeFileSync(join(repo, path), `${"export const line = 1;\n".repeat(4 + i * 7)}`);
  }
};

const bothThemes = async (page: Page, name: string) => {
  for (const theme of ["dark", "light"] as const) {
    await page.evaluate(
      `window.polaris.request("settings.setAppearance", { patch: { theme: "${theme}" } })`
    );
    await page.mouse.move(700, 880);
    await page.waitForTimeout(700);
    await page.screenshot({ path: join(out, `${name}-${theme}.png`) });
    const box = await page.getByTestId("output-rail").boundingBox();

    if (box !== null)
      await page.screenshot({
        path: join(out, `${name}-${theme}-rail.png`),
        clip: { x: box.x - 8, y: box.y - 8, width: box.width + 16, height: 900 - box.y },
      });
    console.log(`output-rail-screens: saved ${name}-${theme}.png`);
  }

  await page.evaluate(
    `window.polaris.request("settings.setAppearance", { patch: { theme: "dark" } })`
  );
};

/** Opens the session; its first edit opens Output, which we close so the rail shows. */
const openSession = async (page: Page, title: string) => {
  await page.locator('[data-slot="chip"]', { hasText: "polaris" }).first().click();
  await page.getByText(title, { exact: true }).first().click();
};

const closeOutput = async (page: Page) => {
  await page.getByTestId("output-panel").waitFor({ timeout: 30_000 });
  await page.getByRole("button", { name: "Hide output" }).click();
  await page.getByTestId("output-rail").waitFor();
};

const stateIs = (page: Page, state: RegExp) =>
  page.getByTestId("session-state").filter({ hasText: state }).waitFor({ timeout: 60_000 });

let stopped = false;

try {
  const app = await electron.launch({
    executablePath: electronBinary(),
    args: ["--use-mock-keychain", APP_DIR],
    env: {
      ...process.env,
      POLARIS_DESKTOP_LOCAL_SOCKET: daemon.socketPath,
      POLARIS_DESKTOP_BENCH_HARNESS: "1",
      POLARIS_DESKTOP_LOCAL_LABEL: "Mac Studio",
      POLARIS_DESKTOP_USER_DATA: userData,
      POLARIS_DESKTOP_HIDDEN: "1",
    },
  });

  const page = await app.firstWindow();

  await sizeWindow(app, 1440, 900);
  await page
    .locator('[data-host="local"][data-connection="connected"]')
    .waitFor({ timeout: 20_000 });
  const workspaceId = String(await page.evaluate(workspaceSource));

  // No changes: a short Turn that edits nothing.
  const empty = "Glossary first pass";

  await start(page, workspaceId, empty, bench({ items: 2, deltasPerItem: 1 }));
  await openSession(page, empty);
  await stateIs(page, /^Idle/);
  await bothThemes(page, "no-changes");

  // Working (R1, R1b): many files, long names, a pull request, a branch ahead.
  const title = "Polaris planning";
  const sessionId = await start(page, workspaceId, title, LONG);

  await page.evaluate(
    dispatchSource(
      P.Command.cases.LinkPullRequest.make({
        sessionId,
        pullRequest: new P.PullRequestRef({
          repo: new P.RepoRef({ host: "github.com", owner: "lux", name: "polaris" }),
          number: 212,
        }),
      })
    )
  );
  await openSession(page, title);
  await closeOutput(page);
  writeLongNames();
  await page.waitForTimeout(2500);
  await bothThemes(page, "working");

  // Ready (R2): the Turn's checkpoint has every file.
  await stateIs(page, /^Idle/);
  await page.waitForTimeout(1500);
  await bothThemes(page, "ready");

  // Needs You (R2): the next Turn asks to run a command.
  await page.evaluate(
    dispatchSource(
      P.Command.cases.SendTurn.make({
        sessionId,
        prompt: bench({ items: 3, approvalEvery: 1, approvalCommand: "cargo build" }),
        attachments: [],
      })
    )
  );
  await stateIs(page, /^Needs you/);
  await page.waitForTimeout(800);
  await bothThemes(page, "needs-you");

  // Reconnecting (R2): the Daemon goes away.
  await daemon.stop();
  stopped = true;
  await page
    .locator('[data-host="local"]:not([data-connection="connected"])')
    .first()
    .waitFor({ timeout: 20_000 });
  await page.waitForTimeout(3000);
  await bothThemes(page, "reconnecting");
  await app.close();
} finally {
  if (!stopped) await daemon.stop();
  rmSync(home, { recursive: true, force: true });
}
