#!/usr/bin/env node
/**
 * Settings → Hosts on fixtures (`#hosts/<scene>`): screenshots of every daemon
 * update state in both themes (every density for "all"), the row's update menu,
 * and a checked walk through Update on `#hosts/live`. Nothing is installed.
 *
 *   node scripts/hostsScreens.ts --out <dir> [--build]
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { _electron as electron, type Page } from "playwright-core";
import { APP_DIR, electronBinary } from "./lib/electron.ts";
import { seenUserData } from "./lib/userData.ts";
import { startDaemon } from "./lib/daemon.ts";

const args = process.argv.slice(2);

const at = args.indexOf("--out");

const out = at === -1 ? null : (args[at + 1] ?? null);

if (out === null) throw new Error("--out <dir> is required");

if (args.includes("--build"))
  spawnSync("bun", [join(APP_DIR, "scripts/build.ts"), "--no-app"], { stdio: "inherit" });

const home = mkdtempSync(join(tmpdir(), "polaris-hosts-"));

const daemon = await startDaemon({ home, benchHarness: true });

const app = await electron.launch({
  executablePath: electronBinary(),
  args: [APP_DIR],
  env: {
    ...process.env,
    POLARIS_DESKTOP_LOCAL_SOCKET: daemon.socketPath,
    POLARIS_DESKTOP_BENCH_HARNESS: "1",
    POLARIS_DESKTOP_USER_DATA: seenUserData(join(home, "user-data")),
    POLARIS_DESKTOP_HIDDEN: "1",
  },
});

const appearance = async (page: Page, theme: string, density: string) => {
  await page.evaluate(
    `Promise.all([window.polaris.request("settings.setTheme", { theme: "${theme}" }), window.polaris.request("settings.setDensity", { density: "${density}" })])`
  );
  await page
    .locator(`html[data-theme="${theme}"][data-density="${density}"]`)
    .waitFor({ state: "attached" });
  await page.waitForTimeout(400);
};

const open = async (page: Page, scene: string) => {
  await page.evaluate(`location.hash = "#hosts/${scene}"; location.reload()`);
  await page.waitForLoadState("domcontentloaded");
  await page.getByTestId("keep-daemons-up-to-date").waitFor();
};

const shot = async (page: Page, name: string) => {
  const path = join(out, `${name}.png`);

  await page.screenshot({ path });
  console.log(`screens: ${path}`);
};

const expectText = async (page: Page, text: string) => {
  await page.getByText(text).first().waitFor({ timeout: 10_000 });
  console.log(`hosts: saw "${text}"`);
};

try {
  const page = await app.firstWindow();

  await page.setViewportSize({ width: 1440, height: 900 });
  mkdirSync(out, { recursive: true });

  for (const scene of ["all", "failures", "current"]) {
    await open(page, scene);

    for (const density of scene === "all" ? ["calm", "balanced", "compact"] : ["calm"]) {
      for (const theme of ["dark", "light"]) {
        await appearance(page, theme, density);
        await shot(page, `${scene}-${theme}-${density}`);
      }
    }
  }

  // This Mac first, every state in words.
  await open(page, "all");
  await appearance(page, "dark", "calm");
  const first = await page.locator('[data-testid^="machine-"]').first().getAttribute("data-testid");

  if (first !== "machine-local") throw new Error(`This Mac isn't first: ${first}`);

  for (const text of [
    "Update available · 0.4.1 → 0.5.0",
    "Copying polaris 0.5.0 · 7.3 of 18.6 MB",
    "Switching to 0.5.0; agent sessions keep going",
    "Checking NUC",
    "Updates once Old laptop is connected",
    "Updated to 0.5.0 · 3m ago",
  ])
    await expectText(page, text);

  // The row menu's override, and a host that keeps its own choice says so.
  await page.getByRole("button", { name: "Mac Studio actions" }).click();
  await expectText(page, "Daemon updates");
  await page.waitForTimeout(400);
  await shot(page, "menu-dark");
  await page.keyboard.press("Escape");
  await open(page, "current");
  await expectText(page, "Keeps its daemon up to date on its own");

  // Update walks through checking, copying and switching to done; the switch turns off.
  await open(page, "live");
  await appearance(page, "light", "calm");
  const studio = page.getByTestId("machine-studio");

  await studio.getByRole("button", { name: "Update" }).click();
  await expectText(page, "Checking Mac Studio");
  await page.getByRole("progressbar").waitFor();
  await shot(page, "live-uploading-light");
  await expectText(page, "Switching to 0.5.0");
  await expectText(page, "Updated to 0.5.0");
  await shot(page, "live-done-light");
  await page.getByRole("switch", { name: "Keep daemons up to date" }).click();
  await page
    .locator('[data-testid="keep-daemons-up-to-date"] [role="switch"][data-state="unchecked"]')
    .waitFor();
  console.log("hosts: ok");
} finally {
  await app.close();
  await daemon.stop();
  rmSync(home, { recursive: true, force: true });
}
