#!/usr/bin/env node
/**
 * Screenshots of Settings → Hosts against Paper S4 / O3 / O4, both themes:
 * this Mac, a fake remote Host awaiting install approval (then installed),
 * `localhost` over the real ssh (host key not trusted here), and an
 * unreachable alias (reconnecting). Also the add-a-host form.
 *
 *   node scripts/machineScreens.ts <dir> [--build]
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, type Page } from "playwright-core";
import { startDaemon } from "./lib/daemon.ts";
import { APP_DIR, electronBinary } from "./lib/electron.ts";
import { FAKE_ALIAS, prepareFakeHost } from "./lib/machineFlow.ts";

const dir = process.argv[2];

if (dir === undefined) throw new Error("usage: node scripts/machineScreens.ts <dir> [--build]");

if (process.argv.includes("--build")) {
  spawnSync("bun", [join(APP_DIR, "scripts/build.ts"), "--no-app"], { stdio: "inherit" });
}

const home = mkdtempSync(join(tmpdir(), "polaris-screens-"));

const userData = join(home, "user-data");

const daemon = await startDaemon({ home, benchHarness: true });

const fake = prepareFakeHost(join(home, "remote"));

mkdirSync(userData, { recursive: true });

mkdirSync(dir, { recursive: true });

writeFileSync(
  join(userData, "settings.json"),
  JSON.stringify({
    hosts: [
      { alias: FAKE_ALIAS, label: "Mac Studio" },
      { alias: "localhost", label: "Raspberry Pi 4" },
      { alias: "polaris-screens.invalid", label: "Linux VM" },
    ],
  })
);

const app = await electron.launch({
  executablePath: electronBinary(),
  args: [APP_DIR],
  env: {
    ...process.env,
    ...fake.env,
    POLARIS_DESKTOP_LOCAL_SOCKET: daemon.socketPath,
    POLARIS_DESKTOP_BENCH_HARNESS: "1",
    POLARIS_DESKTOP_USER_DATA: userData,
    POLARIS_DESKTOP_LOCAL_LABEL: "MacBook Pro",
    POLARIS_DESKTOP_HIDDEN: "1",
  },
});

const setTheme = async (page: Page, theme: "dark" | "light") => {
  await page.evaluate(`window.polaris.request("settings.setTheme", { theme: "${theme}" })`);
  await page.locator(`html[data-theme="${theme}"]`).waitFor({ state: "attached" });
  await page.waitForTimeout(300);
};

const shoot = async (page: Page, name: string) => {
  for (const theme of ["dark", "light"] as const) {
    await setTheme(page, theme);
    const path = join(dir, `${name}-${theme}.png`);

    await page.screenshot({ path });
    console.log(`screens: ${path}`);
  }
};

/** Settings → Hosts through the shell's ⌘, and the nav, else the preview route. */
const openHosts = async (page: Page) => {
  await page.keyboard.press("Meta+Comma");
  const nav = page.getByRole("button", { name: "Hosts", exact: true });

  if (await nav.isVisible().catch(() => false)) await nav.click();
  else await page.evaluate(`location.hash = "#hosts"; location.reload()`);
  await page.getByTestId("hosts-settings").waitFor({ timeout: 10_000 });
};

try {
  const page = await app.firstWindow();

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: null });
  await openHosts(page);
  await page.getByTestId("install-approval").waitFor({ timeout: 30_000 });
  await page.locator('[data-testid="machine-localhost"][data-state="needs-attention"]').waitFor({
    timeout: 30_000,
  });
  await shoot(page, "hosts-attention");

  await page.getByTestId("install-approval").scrollIntoViewIfNeeded();
  await shoot(page, "approve-install");
  await page.getByRole("button", { name: "Approve and install" }).click();
  await page
    .locator(`[data-testid="machine-${FAKE_ALIAS}"][data-state="connected"]`)
    .waitFor({ timeout: 60_000 });
  await page.getByTestId("install-outcome").waitFor({ timeout: 10_000 });
  await shoot(page, "installed");

  await page.getByRole("button", { name: "Add a host" }).click();
  await page.getByTestId("add-machine").scrollIntoViewIfNeeded();
  await shoot(page, "add-host");
} finally {
  await app.close();
  await daemon.stop();
  fake.stop();
  rmSync(home, { recursive: true, force: true });
}
