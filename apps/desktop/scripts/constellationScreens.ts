#!/usr/bin/env node
/**
 * Screenshots of the Constellation tab on fixtures (`#constellation/<scene>`) at 1440×900
 * against Paper C1–C9, both themes and every density; `--frames` scrolls the 128-Task scene.
 *
 *   node scripts/constellationScreens.ts --out <dir> [--build] [--scenes lead,focus] [--frames]
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

const flag = (name: string) => {
  const at = args.indexOf(name);

  return at === -1 ? null : (args[at + 1] ?? null);
};

const out = flag("--out");

if (out === null) throw new Error("--out <dir> is required");

const ALL = ["lead", "menu", "focus", "handed", "paused", "empty", "large", "handover"];

const scenes = flag("--scenes")?.split(",") ?? ALL;

const densities = args.includes("--all-densities") ? ["calm", "balanced", "compact"] : ["calm"];

if (args.includes("--build"))
  spawnSync("bun", [join(APP_DIR, "scripts/build.ts"), "--no-app"], { stdio: "inherit" });

const home = mkdtempSync(join(tmpdir(), "polaris-constellation-"));

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

/** Frame intervals while the 128-Task rail scrolls end to end and back. */
const frames = async (page: Page) => {
  const result = await page.evaluate(`(async () => {
    const list = document.querySelector('[data-testid="constellation-rail"]');
    const times = [];
    let last = performance.now();
    let running = true;
    const tick = (t) => { times.push(t - last); last = t; if (running) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    for (let i = 0; i < 120; i++) {
      list.scrollTop = (i % 60) * 40;
      await new Promise((r) => requestAnimationFrame(r));
    }
    running = false;
    const sorted = times.slice(5).sort((a, b) => a - b);
    return { n: sorted.length, p50: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.floor(sorted.length * 0.95)], max: sorted[sorted.length - 1] };
  })()`);

  console.log(`screens: large scroll frames ${JSON.stringify(result)}`);
};

try {
  const page = await app.firstWindow();

  await page.setViewportSize({ width: 1440, height: 900 });
  mkdirSync(out, { recursive: true });
  page.on("pageerror", (error) => console.log(`screens: page error: ${error.message}`));

  for (const scene of scenes) {
    await page.evaluate(`location.hash = "#constellation/${scene}"`);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByTestId("constellation-tab").waitFor();

    for (const density of densities) {
      for (const theme of ["dark", "light"]) {
        await appearance(page, theme, density);
        const path = join(out, `${scene}-${theme}-${density}.png`);

        await page.screenshot({ path });
        console.log(`screens: ${path}`);
      }
    }

    if (scene === "large" && args.includes("--frames")) await frames(page);
  }
} finally {
  await app.close();
  await daemon.stop();
  rmSync(home, { recursive: true, force: true });
}
