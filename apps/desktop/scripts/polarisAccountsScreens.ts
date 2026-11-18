#!/usr/bin/env node
/**
 * Settings → Polaris accounts end to end (ENG-944, Paper SS5): two local Account Servers with a
 * fake GitHub (`lib/accountServers.ts`, Postgres in Docker), PKCE sign-in to each through the
 * app's loopback return, a commit email, a Workspace's sharing account, then signing one out.
 * Screenshots in Moonlit, light and Compact. One local Daemon; no real GitHub or Polaris Cloud.
 * Needs a built app and Docker.
 *
 *   node scripts/polarisAccountsScreens.ts <out dir>
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { type Page } from "playwright-core";
import { startDaemon } from "./lib/daemon.ts";
import {
  scriptedElectron as electron,
  APP_DIR,
  electronBinary,
  sizeWindow,
} from "./lib/electron.ts";
import { MOCK_KEYCHAIN } from "./lib/githubFlow.ts";
import { seedSource } from "./lib/seed.ts";

const out = process.argv[2] ?? join(tmpdir(), "polaris-accounts-screens");

mkdirSync(out, { recursive: true });

const helper = spawn("bun", [join(APP_DIR, "scripts/lib/accountServers.ts")], {
  stdio: ["pipe", "pipe", "inherit"],
});

const firstLine = await new Promise<string>((resolve, reject) => {
  createInterface({ input: helper.stdout }).once("line", resolve);
  helper.once("exit", (code) => reject(new Error(`account servers exited ${code}`)));
});

// SAFETY: lib/accountServers.ts prints exactly this shape as its first line.
const { servers, browser } = JSON.parse(firstLine) as {
  readonly servers: readonly [string, string];
  readonly browser: string;
};

const home = mkdtempSync(join(tmpdir(), "polaris-accounts-"));

const daemon = await startDaemon({ home: join(home, "local"), benchHarness: true });

const userData = join(home, "user-data");

mkdirSync(userData, { recursive: true });

writeFileSync(
  join(userData, "settings.json"),
  JSON.stringify({ theme: "dark", welcomeSeen: true })
);

const shoot = async (page: Page, name: string) => {
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(out, `${name}.png`) });
  console.log(`polaris-accounts-screens: saved ${name}.png`);
};

const appearance = (page: Page, patch: Record<string, string>) =>
  page.evaluate(
    `window.polaris.request("settings.setAppearance", { patch: ${JSON.stringify(patch)} })`
  );

const signInTo = async (page: Page, server: string, login: string) => {
  const adding = page.getByTestId("add-polaris-account");

  if (!(await adding.isVisible())) await page.getByRole("button", { name: "Add account" }).click();
  await page.getByRole("radio", { name: /Use your own server/ }).click();
  await page.getByLabel("Account server URL").fill(server);
  await page.getByRole("button", { name: "Sign in with GitHub" }).click();
  await page
    .getByTestId("polaris-account")
    .filter({ hasText: `@${login}` })
    .waitFor({ timeout: 20_000 });
};

const choose = async (page: Page, trigger: string, option: string | RegExp) => {
  await page.getByRole("combobox", { name: trigger }).first().click();
  await page.getByRole("option", { name: option }).click();
};

const app = await electron.launch({
  executablePath: electronBinary(),
  args: [APP_DIR, MOCK_KEYCHAIN],
  env: {
    ...process.env,
    POLARIS_DESKTOP_LOCAL_SOCKET: daemon.socketPath,
    POLARIS_DESKTOP_BENCH_HARNESS: "1",
    POLARIS_DESKTOP_LOCAL_LABEL: "Mac Studio",
    POLARIS_DESKTOP_USER_DATA: userData,
    POLARIS_DESKTOP_HIDDEN: "1",
  },
});

try {
  // The system browser is the stand-in, so no tab opens on this machine.
  await app.evaluate(({ shell }, standIn) => {
    shell.openExternal = async (url: string) => {
      const response = await fetch(`${standIn}/open?url=${encodeURIComponent(url)}`);

      if (!response.ok) throw new Error(await response.text());
    };
  }, browser);

  const page = await app.firstWindow();

  await sizeWindow(app, 1440, 900);
  await page
    .locator('[data-host="local"][data-connection="connected"]')
    .waitFor({ timeout: 20_000 });
  await page.evaluate(
    seedSource([
      { hostKey: "local", name: "polaris", sessions: [] },
      { hostKey: "local", name: "dotfiles", sessions: [] },
    ])
  );
  await app.evaluate(({ Menu }) => {
    Menu.getApplicationMenu()?.getMenuItemById("settings.open")?.click();
  });
  await page.getByTestId("settings").waitFor({ timeout: 5_000 });
  await page.getByRole("button", { name: "Polaris accounts", exact: true }).click();
  await shoot(page, "empty-dark");

  await page.getByRole("button", { name: "Add account" }).click();
  await shoot(page, "add-account-dark");
  await appearance(page, { theme: "light" });
  await shoot(page, "add-account-light");
  await appearance(page, { theme: "dark" });

  await signInTo(page, servers[0], "octocat");
  await signInTo(page, servers[1], "hubot");
  await choose(page, "Commit email for @octocat", "octocat@work.example");
  await choose(
    page,
    "Each workspace is shared as the Polaris account chosen at its first share.",
    /^polaris ·/
  );
  await choose(
    page,
    "Each workspace is shared as the Polaris account chosen at its first share.",
    /^dotfiles ·/
  );
  await choose(page, "Polaris account", "@hubot · 127.0.0.1");
  await page.getByText("Workspaces: dotfiles").waitFor({ timeout: 5_000 });

  await shoot(page, "two-accounts-dark");
  await appearance(page, { theme: "light" });
  await shoot(page, "two-accounts-light");
  await appearance(page, { theme: "dark", density: "compact" });
  await shoot(page, "two-accounts-compact");
  await appearance(page, { density: "calm" });

  await page.getByRole("button", { name: "More for @hubot" }).click();
  await page.getByRole("menuitem", { name: /Sign out of @hubot/ }).click();
  await page
    .getByTestId("polaris-account")
    .filter({ hasText: "@hubot" })
    .waitFor({ state: "detached" });
  await shoot(page, "after-sign-out-dark");

  await page.getByRole("button", { name: "Hosts", exact: true }).click();
  await page.waitForTimeout(800);
  await shoot(page, "hosts-after-sign-out-dark");
  const connected = await page.getByText(/Connected · local/).count();

  console.log(`polaris-accounts-screens: local host connected after sign-out: ${connected > 0}`);
} finally {
  await app.close();
  helper.stdin.end();
  await daemon.stop();
  rmSync(home, { recursive: true, force: true });
}
