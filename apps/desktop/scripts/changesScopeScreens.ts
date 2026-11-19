#!/usr/bin/env node
/**
 * The Changes tab's scope (ENG-977) in dark and light: a session whose first Turn edits two
 * files and whose second changes nothing, shown whole by default, then narrowed to the empty
 * Turn, which says so in one line. Needs a built app.
 *
 *   node scripts/changesScopeScreens.ts <out dir>
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "playwright-core";
import { startDaemon } from "./lib/daemon.ts";
import {
  scriptedElectron as electron,
  APP_DIR,
  electronBinary,
  sizeWindow,
} from "./lib/electron.ts";
import { initSessionRepo } from "./lib/sessionReviewFlow.ts";
import { execFileSync } from "node:child_process";

const out = process.argv[2] ?? join(tmpdir(), "polaris-changes-scope-screens");

mkdirSync(out, { recursive: true });

const home = mkdtempSync(join(tmpdir(), "polaris-scope-"));

const repo = join(home, "acme");

initSessionRepo(repo);

const daemon = await startDaemon({ home: join(home, "local"), benchHarness: true });

const userData = join(home, "user-data");

mkdirSync(userData, { recursive: true });

writeFileSync(
  join(userData, "settings.json"),
  JSON.stringify({ theme: "dark", welcomeSeen: true })
);

/** A Turn slow enough (about 2s) for the session to be open while it edits. */
const bench = (touchFiles: number) =>
  `bench:${JSON.stringify({ items: 4, deltasPerItem: 4, deltaIntervalMs: 150, touchFiles })}`;

const TITLE = "Tidy the bench files";

/** Page source: registers the Workspace and starts the session; resolves with its id. */
const startSource = `(async () => {
  const api = window.polaris;
  const must = (r, what) => { if (!r.ok) throw new Error(what + ": " + r.error.message); return r.value; };
  const dispatch = (command) =>
    api.request("dispatch", { hostKey: "local", commandId: crypto.randomUUID(), command }).then((r) => must(r, command._tag));
  await dispatch({ _tag: "RegisterWorkspace", path: ${JSON.stringify(repo)}, name: "acme" });
  const workspaceId = await new Promise((resolve) => {
    const close = api.subscribe("host", { hostKey: "local" }, { items: (items) => {
      for (const i of items) {
        const all = i._tag === "Snapshot" ? i.workspaces
          : i._tag === "Event" && i.envelope.event._tag === "WorkspaceRegistered" ? [i.envelope.event.workspace] : [];
        const found = all.find((w) => w.path === ${JSON.stringify(repo)});
        if (found) { close(); resolve(found.id); return; }
      }
    } });
  });
  const sessionId = crypto.randomUUID();
  await dispatch({ _tag: "StartSession", sessionId, workspaceId, harness: "claude",
    placement: { _tag: "InPlace" }, permissionMode: "auto", model: null, effort: null,
    prompt: ${JSON.stringify(bench(2))}, attachments: [] });
  await dispatch({ _tag: "RenameSession", sessionId, title: ${JSON.stringify(TITLE)} });
  return sessionId;
})()`;

const sendSource = (sessionId: string, prompt: string) =>
  `window.polaris.request("dispatch", { hostKey: "local", commandId: crypto.randomUUID(), command: { _tag: "SendTurn", sessionId: ${JSON.stringify(sessionId)}, prompt: ${JSON.stringify(prompt)}, attachments: [] } })`;

const afterCheckpoints = (sessionId: string) =>
  execFileSync(
    "git",
    ["for-each-ref", "--format=%(refname)", `refs/polaris/checkpoints/${sessionId}`],
    {
      cwd: repo,
    }
  )
    .toString()
    .split("\n")
    .filter((r) => r.endsWith("/after")).length;

const waitForTurns = async (sessionId: string, count: number) => {
  for (let i = 0; i < 150 && afterCheckpoints(sessionId) < count; i++)
    await new Promise((resolve) => setTimeout(resolve, 200));

  if (afterCheckpoints(sessionId) < count) throw new Error(`never finished ${count} Turns`);
};

const bothThemes = async (page: Page, name: string) => {
  for (const theme of ["dark", "light"] as const) {
    await page.evaluate(
      `window.polaris.request("settings.setAppearance", { patch: { theme: "${theme}" } })`
    );
    await page.mouse.move(10, 880);
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(out, `${name}-${theme}.png`) });
    console.log(`changes-scope-screens: saved ${name}-${theme}.png`);
  }
};

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

  const sessionId = String(await page.evaluate(startSource));

  await page.locator('[data-slot="chip"]', { hasText: "acme" }).first().click();
  await page.getByText(TITLE, { exact: true }).first().click();
  await waitForTurns(sessionId, 1);
  // The first edit opened Output by itself; an empty second Turn leaves it open.
  await page.getByTestId("output-panel").waitFor({ timeout: 15_000 });
  await page.evaluate(sendSource(sessionId, bench(0)));
  await waitForTurns(sessionId, 2);
  await page.getByTestId("session-state").filter({ hasText: /^Idle/ }).waitFor({ timeout: 30_000 });
  await page.getByTestId("output-panel").waitFor();
  await page.getByTestId("diff-turn").filter({ hasText: "All turns" }).waitFor();
  await bothThemes(page, "session-scope");

  await page.getByTestId("diff-turn").click();
  await page.getByRole("menuitemradio", { name: /^Turn 2/ }).click();
  await page.getByTestId("diff-empty").waitFor();
  await bothThemes(page, "empty-turn");
  await app.close();
} finally {
  await daemon.stop();
  rmSync(home, { recursive: true, force: true });
}
