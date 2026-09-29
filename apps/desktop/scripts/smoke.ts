#!/usr/bin/env node
/**
 * Smoke test: starts a throwaway Daemon on the bench Harness, launches the
 * built app against it with a hidden window (Playwright's Electron support),
 * starts the proof session and asserts the screen shows it live, to the end.
 *
 *   node scripts/smoke.ts [--build] [--show] [--screenshots <dir>]
 *
 * Runs under Node: Playwright's Electron launcher does not connect under Bun.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, type Page } from "playwright-core";
import { spawnSync } from "node:child_process";
import { APP_DIR, electronBinary } from "./lib/electron.ts";
import { startDaemon } from "./lib/daemon.ts";

const args = process.argv.slice(2);

const flag = (name: string) => args.includes(name);

const option = (name: string) => {
  const at = args.indexOf(name);

  return at === -1 ? null : (args[at + 1] ?? null);
};

const screenshots = option("--screenshots");

const step = (message: string) => console.log(`smoke: ${message}`);

if (flag("--build")) {
  spawnSync("bun", [join(APP_DIR, "scripts/build.ts"), "--no-app"], { stdio: "inherit" });
}

const home = mkdtempSync(join(tmpdir(), "polaris-smoke-"));

const userData = join(home, "user-data");

const daemon = await startDaemon({ home, benchHarness: true });

step(`Daemon up at ${daemon.socketPath}`);

const app = await electron.launch({
  executablePath: electronBinary(),
  args: [APP_DIR],
  env: {
    ...process.env,
    POLARIS_DESKTOP_LOCAL_SOCKET: daemon.socketPath,
    POLARIS_DESKTOP_BENCH_HARNESS: "1",
    POLARIS_DESKTOP_USER_DATA: userData,
    POLARIS_DESKTOP_HIDDEN: flag("--show") ? "0" : "1",
  },
});

const shoot = async (page: Page, theme: "dark" | "light") => {
  if (screenshots === null) return;
  mkdirSync(screenshots, { recursive: true });
  // What View → Appearance does (menu.ts), without driving the native menu.
  await app.evaluate(({ nativeTheme }, t) => {
    nativeTheme.themeSource = t;
  }, theme);
  await page.waitForTimeout(300);
  const path = join(screenshots, `proof-${theme}.png`);

  await page.screenshot({ path });
  step(`saved ${path}`);
};

let failed = false;

try {
  const page = await app.firstWindow();

  await page.setViewportSize({ width: 1280, height: 800 });
  // Playwright emulates a light colour scheme by default; follow the app's own theme instead.
  await page.emulateMedia({ colorScheme: null });
  await page
    .getByTestId("connection-local")
    .filter({ hasText: /^connected$/ })
    .waitFor({ timeout: 15_000 });
  step("local Host connected");

  await page.getByRole("button", { name: "Start proof session" }).click();
  await page.getByTestId("session-panel").waitFor({ timeout: 15_000 });
  step("proof session open");

  await page.getByTestId("live-item").first().waitFor({ timeout: 15_000 });
  step("live deltas streaming");

  await page
    .getByTestId("session-state")
    .filter({ hasText: /^working$/ })
    .waitFor({ timeout: 15_000 });
  await shoot(page, "dark");

  await page
    .getByTestId("session-state")
    .filter({ hasText: /^idle$/ })
    .waitFor({ timeout: 60_000 });
  const items = await page.getByTestId("turn-items").first().textContent();

  step(`turn finished: ${items}`);

  if (items !== "6 items") throw new Error(`expected 6 items, saw ${items}`);
  await shoot(page, "light");
  step("ok");
} catch (error) {
  failed = true;
  console.error("smoke: FAILED", error);
} finally {
  await app.close();
  await daemon.stop();
  rmSync(home, { recursive: true, force: true });
}

process.exit(failed ? 1 : 0);
