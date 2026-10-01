#!/usr/bin/env node
/**
 * Screenshots of Review on fixtures (`#review/<scene>`) at the artboards' 1440×900, against
 * Paper R1 (1SM-0) and R2 (223-0): both themes, every density, the colourblind diff palette;
 * and the large-Review scenes (2,500 files collapsed, 12,000 files list-only).
 *
 * With `--findings`, only M2-F's scenes: the risk column and composer (R6), a Verdict (R1),
 * Submit review (R7) and an Agent Session's feedback (R8).
 *
 *   node scripts/reviewScreens.ts --out <dir> [--build] [--findings]
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

const home = mkdtempSync(join(tmpdir(), "polaris-review-"));

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

const appearance = async (page: Page, theme: string, density: string, palette = "default") => {
  await page.evaluate(
    `window.polaris.request("settings.setAppearance", { patch: { theme: "${theme}", density: "${density}", diffPalette: "${palette}" } })`
  );
  await page
    .locator(`html[data-theme="${theme}"][data-density="${density}"]`)
    .waitFor({ state: "attached" });
  await page.waitForTimeout(600);
};

const shoot = async (page: Page, name: string) => {
  const path = join(out, `${name}.png`);

  await page.screenshot({ path });
  console.log(`screens: ${path}`);
};

const open = async (page: Page, scene: string, testId: string) => {
  await page.evaluate(`location.hash = "#review/${scene}"; location.reload()`);
  await page.waitForLoadState("domcontentloaded");
  await page.getByTestId(testId).first().waitFor({ timeout: 20_000 });
  await page.waitForTimeout(1200);
};

/** M2-F: the composer, a Verdict and Submit review on #88, and a session's feedback. */
const findingScenes = async (page: Page) => {
  for (const theme of ["dark", "light"]) {
    await open(page, "pull-comments", "comment-composer");
    await appearance(page, theme, "balanced");
    await shoot(page, `findings-composer-${theme}`);

    await open(page, "pull-verdict", "verdict-down");
    await appearance(page, theme, "balanced");
    await page.getByTestId("verdict-down").first().click();
    await page.getByTestId("verdict-popover").waitFor();
    await page.waitForTimeout(400);
    await shoot(page, `findings-verdict-${theme}`);

    await open(page, "pull-submit", "submit-review-open");
    await appearance(page, theme, "balanced");
    await page.getByTestId("submit-review-open").click();
    await page.getByTestId("submit-review").waitFor();
    await page.waitForTimeout(400);
    await shoot(page, `findings-submit-${theme}`);

    await open(page, "session-feedback", "feedback-card");
    await appearance(page, theme, "balanced");
    await shoot(page, `findings-feedback-${theme}`);
  }

  for (const density of ["calm", "compact"]) {
    await open(page, "pull", "risk-finding");
    await appearance(page, "dark", density);
    await shoot(page, `findings-pull-dark-${density}`);

    await open(page, "pull-comments", "comment-composer");
    await appearance(page, "dark", density);
    await shoot(page, `findings-composer-dark-${density}`);

    await open(page, "pull-submit", "submit-review-open");
    await appearance(page, "dark", density);
    await page.getByTestId("submit-review-open").click();
    await page.getByTestId("submit-review").waitFor();
    await page.waitForTimeout(400);
    await shoot(page, `findings-submit-dark-${density}`);

    await open(page, "session-feedback", "feedback-card");
    await appearance(page, "dark", density);
    await shoot(page, `findings-feedback-dark-${density}`);
  }
};

/** M2-D: the pull request and session in every theme and density, and the large Reviews. */
const diffScenes = async (page: Page) => {
  for (const [scene, testId] of [
    ["pull", "review-file"],
    ["session", "turn-divider"],
  ] as const) {
    await open(page, scene, testId);

    for (const density of ["calm", "balanced", "compact"]) {
      for (const theme of ["dark", "light"]) {
        await appearance(page, theme, density);
        await shoot(page, `${scene}-${theme}-${density}`);
      }
    }

    await appearance(page, "dark", "calm", "cvd");
    await shoot(page, `${scene}-dark-calm-cvd`);
    await appearance(page, "dark", "calm");
  }

  for (const scene of ["large", "list-only"]) {
    await open(page, scene, "review-file-row");
    await shoot(page, `${scene}-dark`);
  }
};

try {
  const page = await app.firstWindow();

  await page.setViewportSize({ width: 1440, height: 900 });
  mkdirSync(out, { recursive: true });

  if (args.includes("--findings")) await findingScenes(page);
  else await diffScenes(page);
} finally {
  await app.close();
  await daemon.stop();
  rmSync(home, { recursive: true, force: true });
}
