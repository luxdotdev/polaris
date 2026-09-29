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
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, type Page } from "playwright-core";
import { spawnSync } from "node:child_process";
import { APP_DIR, electronBinary, OUT_DIR, REPO_ROOT } from "./lib/electron.ts";
import { probeSource } from "./lib/probe.ts";
import { startDaemon } from "./lib/daemon.ts";
import { initRepo, sessionFlow } from "./lib/sessionFlow.ts";

const args = process.argv.slice(2);

const flag = (name: string) => args.includes(name);

const option = (name: string) => {
  const at = args.indexOf(name);

  return at === -1 ? null : (args[at + 1] ?? null);
};

const screenshots = option("--screenshots");

/** The renderer bundle: large enough that `files.read` sends it as a blob. */
const bigAsset = () => {
  const dir = join(OUT_DIR, "renderer/assets");
  const js = readdirSync(dir).find((f) => f.endsWith(".js"));

  if (js === undefined) throw new Error("build the renderer first");

  return join(dir, js);
};

const step = (message: string) => console.log(`smoke: ${message}`);

if (flag("--build")) {
  spawnSync("bun", [join(APP_DIR, "scripts/build.ts"), "--no-app"], { stdio: "inherit" });
}

const home = mkdtempSync(join(tmpdir(), "polaris-smoke-"));

const userData = join(home, "user-data");

const daemon = await startDaemon({ home, benchHarness: true });

const UNREACHABLE = "polaris-smoke.invalid";

// A remote Host that can't be reached: it must show a Connection State, never block the app.
mkdirSync(userData, { recursive: true });

writeFileSync(
  join(userData, "settings.json"),
  JSON.stringify({ hosts: [{ alias: UNREACHABLE, label: "Nowhere" }] })
);

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

const setTheme = async (page: Page, theme: "dark" | "light") => {
  // What View → Appearance does (menu.ts): the setting, then data-theme on the root.
  await page.evaluate(`window.polaris.request("settings.setTheme", { theme: "${theme}" })`);
  await page.locator(`html[data-theme="${theme}"]`).waitFor({ state: "attached" });
  await page.waitForTimeout(300);
};

/** Saves `<name>-dark.png` and `<name>-light.png`, then leaves the app dark. */
const shoot = async (page: Page, name: string) => {
  if (screenshots === null) return;
  mkdirSync(screenshots, { recursive: true });

  for (const theme of ["dark", "light"] as const) {
    await setTheme(page, theme);
    const path = join(screenshots, `${name}-${theme}.png`);

    await page.screenshot({ path });
    step(`saved ${path}`);
  }

  await setTheme(page, "dark");
};

let failed = false;

const consoleErrors: Array<string> = [];

try {
  const page = await app.firstWindow();

  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.setViewportSize({ width: 1280, height: 800 });
  // Playwright emulates a light colour scheme by default; follow the app's own theme instead.
  await page.emulateMedia({ colorScheme: null });
  await page
    .getByTestId("connection-local")
    .filter({ hasText: /^connected$/ })
    .waitFor({ timeout: 15_000 });
  step("local Host connected");

  const remote = page.getByTestId(`connection-${UNREACHABLE}`);

  await remote
    .filter({ hasText: /^(reconnecting|needs attention|offline)$/ })
    .waitFor({ timeout: 20_000 });
  step(`unreachable remote Host: ${await remote.textContent()}`);

  await page.getByRole("button", { name: "Start proof session" }).click();
  await page.getByTestId("session-panel").waitFor({ timeout: 15_000 });
  step("proof session open");

  await page.getByTestId("live-item").first().waitFor({ timeout: 15_000 });
  step("live deltas streaming");

  await page
    .getByTestId("session-state")
    .filter({ hasText: /^Working/ })
    .waitFor({ timeout: 15_000 });
  await shoot(page, "proof");

  await page.getByTestId("session-state").filter({ hasText: /^Idle/ }).waitFor({ timeout: 60_000 });
  const items = await page.getByTestId("turn-item").count();

  step(`turn finished: ${items} items`);

  if (items !== 6) throw new Error(`expected 6 items, saw ${items}`);

  const repo = join(home, "smoke-repo");

  initRepo(repo);
  await sessionFlow({ page, repo, step, shoot: (name) => shoot(page, name) });

  const probe = await Promise.race([
    page.evaluate(probeSource({ bigFile: bigAsset(), repo: REPO_ROOT })),
    new Promise((_, reject) =>
      setTimeout(async () => {
        const steps = await page.evaluate("JSON.stringify(window.__probeSteps)");

        reject(new Error(`RPC probe timed out after ${String(steps)}`));
      }, 20_000)
    ),
  ]);

  step(`RPC round trips: ${JSON.stringify(probe)}`);

  if (!JSON.stringify(probe).includes('"terminal":true'))
    throw new Error("terminal output missing");

  if (consoleErrors.length > 0) throw new Error(`renderer errors:\n${consoleErrors.join("\n")}`);
  step("ok");
} catch (error) {
  failed = true;
  console.error("smoke: FAILED", error);
  const page = app.windows()[0];

  if (page !== undefined) {
    console.error(`smoke: screen text:\n${await page.locator("body").innerText()}`);
    console.error(`smoke: renderer errors:\n${consoleErrors.join("\n")}`);
  }
} finally {
  await app.close();
  await daemon.stop();
  rmSync(home, { recursive: true, force: true });
}

process.exit(failed ? 1 : 0);
