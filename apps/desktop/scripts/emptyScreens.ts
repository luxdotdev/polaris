#!/usr/bin/env node
/**
 * Screenshots of the empty states and the terminal drawer, from a fresh
 * Daemon: the Host with no workspaces, a workspace with no sessions, the
 * drawer, nothing needs you, and a mode that arrives later. Every theme and
 * density; compare with Paper 57Q-1, VG-0 and 5SH-1.
 *
 *   node scripts/emptyScreens.ts --out <dir> [--build]
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, type Page } from "playwright-core";
import { seenUserData } from "./lib/userData.ts";
import { startDaemon } from "./lib/daemon.ts";
import { APP_DIR, electronBinary } from "./lib/electron.ts";
import { initRepo } from "./lib/sessionFlow.ts";

const args = process.argv.slice(2);

const at = args.indexOf("--out");

const out = at === -1 ? null : (args[at + 1] ?? null);

if (out === null) throw new Error("usage: node scripts/emptyScreens.ts --out <dir> [--build]");

if (args.includes("--build"))
  spawnSync("bun", [join(APP_DIR, "scripts/build.ts"), "--no-app"], { stdio: "inherit" });

mkdirSync(out, { recursive: true });

const home = mkdtempSync(join(tmpdir(), "polaris-empty-"));

const daemon = await startDaemon({ home, benchHarness: true });

const app = await electron.launch({
  executablePath: electronBinary(),
  args: [APP_DIR],
  env: {
    ...process.env,
    POLARIS_DESKTOP_LOCAL_SOCKET: daemon.socketPath,
    POLARIS_DESKTOP_LOCAL_LABEL: "Mac Studio",
    POLARIS_DESKTOP_BENCH_HARNESS: "1",
    POLARIS_DESKTOP_USER_DATA: seenUserData(join(home, "user-data")),
    POLARIS_DESKTOP_HIDDEN: "1",
  },
});

const DENSITIES = ["calm", "balanced", "compact"] as const;

const appearance = async (page: Page, theme: "dark" | "light", density: string) => {
  await page.evaluate(`window.polaris.request("settings.setTheme", { theme: "${theme}" })`);
  await page.evaluate(`window.polaris.request("settings.setDensity", { density: "${density}" })`);
  await page
    .locator(`html[data-theme="${theme}"][data-density="${density}"]`)
    .waitFor({ state: "attached" });
  await page.waitForTimeout(250);
};

/** `<name>-<theme>.png` at Calm, plus `<name>-<theme>-<density>.png` for the other two. */
const shoot = async (page: Page, name: string) => {
  for (const theme of ["dark", "light"] as const) {
    for (const density of DENSITIES) {
      await appearance(page, theme, density);
      const suffix = density === "calm" ? "" : `-${density}`;

      await page.screenshot({ path: join(out, `${name}-${theme}${suffix}.png`) });
    }
  }

  await appearance(page, "dark", "calm");
  console.log(`screens: ${name}`);
};

try {
  const page = await app.firstWindow();

  // Size the real window: viewport emulation reports DPR 1 while WebGL still draws at 2x.
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 900);
  });
  await page
    .locator('[data-host="local"][data-connection="connected"]')
    .waitFor({ timeout: 15_000 });
  await page.getByTestId("host-stage").waitFor();
  await page.waitForTimeout(800);
  await shoot(page, "host-stage");

  const repo = join(home, "code", "polaris");

  initRepo(repo);
  await page.getByTestId("add-workspace").click();
  await page.getByTestId("workspace-path").fill(repo);
  await page.keyboard.press("Enter");
  await page.getByTestId("workspace-stage").waitFor({ timeout: 10_000 });
  await page.waitForTimeout(500);
  await shoot(page, "workspace-stage");

  await page.getByText("Needs you", { exact: true }).click();
  await page.getByTestId("nothing-needs-you").waitFor();
  await shoot(page, "nothing-needs-you");
  await page.getByText("Sessions", { exact: true }).first().click();

  await page.keyboard.press("Control+Backquote");
  await page.getByTestId("terminal-surface").waitFor();
  await page.waitForTimeout(600);
  await page.keyboard.type(
    "ls -la && git log --oneline && printf '\\e[31mred \\e[32mgreen \\e[33myellow \\e[34mblue \\e[35mmagenta \\e[36mcyan\\e[0m\\n'\n"
  );
  await page.waitForTimeout(800);
  await shoot(page, "terminal-drawer");
  await page.keyboard.type("exit\n");
  await page.getByTestId("terminal-ended").waitFor({ timeout: 10_000 });
  await shoot(page, "terminal-ended");

  // What View → Review (⌘2) sends from the native menu.
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send("polaris:app", {
      kind: "route",
      route: "review",
    });
  });
  await page.waitForTimeout(400);
  await shoot(page, "later-mode");
} finally {
  await app.close();
  await daemon.stop();
  rmSync(home, { recursive: true, force: true });
}
