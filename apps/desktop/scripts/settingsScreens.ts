#!/usr/bin/env node
/**
 * Screenshots of Settings against Paper's S1 Harnesses (dark), S2 Usage (dark)
 * and S3 Appearance (light), with four local Daemons standing in for four
 * machines. Needs a built app.
 *
 *   node scripts/settingsScreens.ts <out dir>
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, type Page } from "playwright-core";
import { startDaemon } from "./lib/daemon.ts";
import { APP_DIR, electronBinary, sizeWindow } from "./lib/electron.ts";

const out = process.argv[2] ?? join(tmpdir(), "polaris-settings-screens");

mkdirSync(out, { recursive: true });

const MACHINES = [
  { key: "studio", label: "Mac Studio" },
  { key: "vm", label: "Linux VM" },
  { key: "pi", label: "Raspberry Pi 4" },
] as const;

const home = mkdtempSync(join(tmpdir(), "polaris-settings-screens-"));

const daemons = await Promise.all(
  ["local", ...MACHINES.map((m) => m.key)].map((key) =>
    startDaemon({ home: join(home, key), benchHarness: true })
  )
);

const [local, ...rest] = daemons;

const userData = join(home, "user-data");

mkdirSync(userData, { recursive: true });

writeFileSync(
  join(userData, "settings.json"),
  JSON.stringify({ theme: "dark", welcomeSeen: true })
);

const app = await electron.launch({
  executablePath: electronBinary(),
  args: [APP_DIR],
  env: {
    ...process.env,
    POLARIS_DESKTOP_LOCAL_SOCKET: local?.socketPath ?? "",
    POLARIS_DESKTOP_BENCH_HARNESS: "1",
    POLARIS_DESKTOP_LOCAL_LABEL: "MacBook Pro",
    POLARIS_DESKTOP_EXTRA_HOSTS: JSON.stringify(
      MACHINES.map((m, i) => ({ ...m, socket: rest[i]?.socketPath ?? "" }))
    ),
    POLARIS_DESKTOP_USER_DATA: userData,
    POLARIS_DESKTOP_HIDDEN: "1",
  },
});

const setAppearance = async (page: Page, patch: Record<string, string>) => {
  await page.evaluate(
    `window.polaris.request("settings.setAppearance", { patch: ${JSON.stringify(patch)} })`
  );
  await page.waitForTimeout(400);
};

const shoot = async (page: Page, name: string) => {
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(out, `${name}.png`) });
  console.log(`settings-screens: saved ${name}.png`);
};

try {
  const page = await app.firstWindow();

  await sizeWindow(app, 1440, 900);
  await page.emulateMedia({ colorScheme: null });
  await page
    .locator('[data-host="local"][data-connection="connected"]')
    .waitFor({ timeout: 20_000 });
  await app.evaluate(({ Menu }) => {
    Menu.getApplicationMenu()?.getMenuItemById("settings.open")?.click();
  });
  await page.getByTestId("settings").waitFor({ timeout: 5_000 });

  // S3: Appearance, light.
  await setAppearance(page, { theme: "light" });
  await shoot(page, "S3-appearance-light-calm");

  for (const density of ["balanced", "compact"]) {
    await setAppearance(page, { density });
    await shoot(page, `S3-appearance-light-${density}`);
  }

  await setAppearance(page, { density: "calm", theme: "dark" });
  await shoot(page, "S3-appearance-dark-calm");

  // S1: Harnesses, dark.
  await page.getByRole("button", { name: "Harnesses" }).click();
  await page.getByTestId("harness-group").first().waitFor({ timeout: 10_000 });
  await page.waitForTimeout(3_000);
  await shoot(page, "S1-harnesses-dark-collapsed");
  // A Harness ready everywhere folds; open Claude Code's if it did.
  const folded = page.locator('button[aria-expanded="false"]', { hasText: "Claude Code" });

  if ((await folded.count()) > 0) await folded.click();
  await shoot(page, "S1-harnesses-dark");
  await setAppearance(page, { theme: "light" });
  await shoot(page, "S1-harnesses-light");

  // S2: Usage, dark.
  await setAppearance(page, { theme: "dark" });
  await page.getByRole("button", { name: "Usage" }).click();
  await page.waitForTimeout(2_000);
  await shoot(page, "S2-usage-dark");

  // The gear in the sidebar footer and the K menu's Settings actions.
  await page.keyboard.press("Escape");
  await page.getByTestId("settings").waitFor({ state: "detached" });
  await page.getByRole("button", { name: "Settings" }).hover();
  await shoot(page, "entry-sidebar-gear-dark");
  await page.keyboard.press("Meta+k");
  await page.keyboard.type("settings");
  await shoot(page, "entry-k-menu-dark");
} finally {
  await app.close();
  await Promise.all(daemons.map((d) => d.stop()));
  rmSync(home, { recursive: true, force: true });
}
