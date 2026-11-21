#!/usr/bin/env node
/**
 * Screenshots of the Logbook tab on fixtures (`#constellation/logbook*`) at 1440×900 against
 * Paper L1–L3, in Moonlit, Midnight and light, and every density with `--all-densities`.
 *
 *   node scripts/logbookScreens.ts --out <dir> [--build] [--all-densities]
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
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

const SCENES = ["logbook", "logbook-lost", "logbook-feed", "logbook-long"];

const densities = args.includes("--all-densities") ? ["calm", "balanced", "compact"] : ["calm"];

const THEMES = [
  { name: "moonlit", theme: "dark", dark: "moonlit" },
  { name: "midnight", theme: "dark", dark: "midnight" },
  { name: "light", theme: "light", dark: "moonlit" },
] as const;

if (args.includes("--build"))
  spawnSync("bun", [join(APP_DIR, "scripts/build.ts"), "--no-app"], { stdio: "inherit" });

const home = mkdtempSync(join(tmpdir(), "polaris-logbook-"));

const daemon = await startDaemon({ home, benchHarness: true });

const app = await electron.launch({
  executablePath: electronBinary(),
  args: [APP_DIR, "--use-mock-keychain"],
  env: {
    ...process.env,
    POLARIS_DESKTOP_LOCAL_SOCKET: daemon.socketPath,
    POLARIS_DESKTOP_BENCH_HARNESS: "1",
    POLARIS_DESKTOP_USER_DATA: seenUserData(join(home, "user-data")),
    POLARIS_DESKTOP_HIDDEN: "1",
  },
});

const appearance = async (page: Page, t: (typeof THEMES)[number], density: string) => {
  await page.evaluate(
    `window.polaris.request("settings.setAppearance", { patch: { theme: "${t.theme}", darkTheme: "${t.dark}", density: "${density}" } })`
  );
  await page
    .locator(
      `html[data-theme="${t.theme}"][data-theme-dark="${t.dark}"][data-density="${density}"]`
    )
    .waitFor({ state: "attached" });
  await page.waitForTimeout(400);
};

/** Each scene's own steps before its shots: open a fold, move the feed's cursor, write a note. */
const prepare = async (page: Page, scene: string) => {
  if (scene === "logbook-lost")
    await page
      .getByRole("button", { name: /^Show \d+ entr/ })
      .first()
      .click();

  if (scene === "logbook-feed") {
    await page.getByTestId("logbook-tab").focus();

    for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowDown");
  }

  if (scene === "logbook-long") {
    await page.getByTestId("logbook-tab").focus();
    await page.keyboard.press("n");
    await page.keyboard.type("Re-run the replay on the Pi once B5 lands.");
    await page.keyboard.press("Meta+Enter");
    await page.getByText("Re-run the replay on the Pi once B5 lands.").waitFor();
  }
};

try {
  const page = await app.firstWindow();

  await page.setViewportSize({ width: 1440, height: 900 });
  mkdirSync(out, { recursive: true });
  page.on("pageerror", (error) => console.log(`screens: page error: ${error.message}`));

  for (const scene of SCENES) {
    await page.evaluate(`location.hash = "#constellation/${scene}"`);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByTestId("logbook-tab").waitFor();
    await page.waitForTimeout(300);
    await prepare(page, scene);

    for (const density of densities)
      for (const t of THEMES) {
        await appearance(page, t, density);
        const path = join(out, `${scene}-${t.name}-${density}.png`);

        await page.screenshot({ path });
        console.log(`screens: ${path}`);
      }
  }
} finally {
  await app.close();
  await daemon.stop();
  rmSync(home, { recursive: true, force: true });
}
