#!/usr/bin/env node
/**
 * Settings → About's Channel row on fixtures (Paper U2): on Nightly (`#updates/nightly`), then
 * after choosing Stable there, waiting for a newer Stable. Moonlit and Light. Nothing is installed.
 *
 *   node scripts/updateChannelScreens.ts --out <dir> [--build]
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { type Page } from "playwright-core";
import { scriptedElectron as electron, APP_DIR, electronBinary } from "./lib/electron.ts";
import { seenUserData } from "./lib/userData.ts";
import { startDaemon } from "./lib/daemon.ts";

const args = process.argv.slice(2);

const at = args.indexOf("--out");

const out = at === -1 ? null : (args[at + 1] ?? null);

if (out === null) throw new Error("--out <dir> is required");

if (args.includes("--build"))
  spawnSync("bun", [join(APP_DIR, "scripts/build.ts"), "--no-app"], { stdio: "inherit" });

// A short path: the Daemon's Unix socket lives under it.
const home = mkdtempSync("/tmp/puc-");

const daemon = await startDaemon({ home, benchHarness: true });

const app = await electron.launch({
  executablePath: electronBinary(),
  args: ["--use-mock-keychain", APP_DIR],
  env: {
    ...process.env,
    POLARIS_DESKTOP_LOCAL_SOCKET: daemon.socketPath,
    POLARIS_DESKTOP_BENCH_HARNESS: "1",
    POLARIS_DESKTOP_USER_DATA: seenUserData(join(home, "user-data")),
    POLARIS_DESKTOP_HIDDEN: "1",
  },
});

const look = async (page: Page, theme: "dark" | "light") => {
  await page.evaluate(
    `window.polaris.request("settings.setAppearance", { patch: { theme: "${theme}" } })`
  );
  await page.locator(`html[data-theme="${theme}"]`).waitFor({ state: "attached" });
  await page.waitForTimeout(300);
};

try {
  const page = await app.firstWindow();

  await page.setViewportSize({ width: 1440, height: 1100 });
  mkdirSync(out, { recursive: true });

  const shoot = async (name: string) => {
    const card = page.getByTestId("about-updates");
    const path = join(out, `${name}.png`);

    await card.scrollIntoViewIfNeeded();
    await page.screenshot({ path });
    await card.screenshot({ path: join(out, `${name}-card.png`) });
    console.log(`screens: ${path}`);
  };

  for (const theme of ["dark", "light"] as const) {
    await page.evaluate(`location.hash = "#updates/nightly"; location.reload()`);
    await page.waitForLoadState("domcontentloaded");
    await page.getByTestId("about-updates").waitFor();
    await look(page, theme);
    await shoot(`nightly-${theme}`);

    // Choosing Stable checks the feed; a Nightly stays until a Stable Release is newer.
    await page.getByTestId("app-update-channel").getByRole("radio", { name: "Stable" }).click();
    await page.getByText("Waiting for Stable 0.12.0").waitFor();
    await page.waitForTimeout(300);
    await shoot(`switched-to-stable-${theme}`);
  }
} finally {
  await app.close();
  await daemon.stop();
  rmSync(home, { recursive: true, force: true });
}
