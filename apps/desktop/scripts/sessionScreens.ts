#!/usr/bin/env node
/**
 * Screenshots of the session view on fixtures (`#preview/<scene>`), at the
 * artboards' 1440×900, in both themes and every density, for comparing with
 * Paper's `11U-0` and `VG-0`.
 *
 *   node scripts/sessionScreens.ts --out <dir> [--build] [--scenes session,new]
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { _electron as electron } from "playwright-core";
import { APP_DIR, electronBinary } from "./lib/electron.ts";
import { startDaemon } from "./lib/daemon.ts";
import { frameStats } from "./lib/sessionFlow.ts";

const args = process.argv.slice(2);

const option = (name: string) => {
  const at = args.indexOf(name);

  return at === -1 ? null : (args[at + 1] ?? null);
};

const out = option("--out");

if (out === null) throw new Error("--out <dir> is required");

if (args.includes("--build"))
  spawnSync("bun", [join(APP_DIR, "scripts/build.ts"), "--no-app"], { stdio: "inherit" });

const scenes = (option("--scenes") ?? "session,approval,question,interrupted,new,setup").split(",");

/** Scroll the long scene's conversation at 4000 px/s for 5 s and report frame intervals. */
const scrollFrames = `new Promise((resolve) => {
  const el = document.querySelector('[data-testid="conversation"]');
  el.scrollTop = 0;
  const times = [];
  const start = performance.now();
  const tick = (t) => {
    times.push(t);
    el.scrollTop = ((t - start) / 1000) * 4000;
    if (t - start < 5000) requestAnimationFrame(tick); else resolve({ times, height: el.scrollHeight });
  };
  requestAnimationFrame(tick);
})`;

const densities = (option("--densities") ?? "calm,balanced,compact").split(",");

const home = mkdtempSync(join(tmpdir(), "polaris-screens-"));

const daemon = await startDaemon({ home, benchHarness: true });

const app = await electron.launch({
  executablePath: electronBinary(),
  args: [APP_DIR],
  env: {
    ...process.env,
    POLARIS_DESKTOP_LOCAL_SOCKET: daemon.socketPath,
    POLARIS_DESKTOP_BENCH_HARNESS: "1",
    POLARIS_DESKTOP_USER_DATA: join(home, "user-data"),
    POLARIS_DESKTOP_HIDDEN: "1",
  },
});

try {
  const page = await app.firstWindow();

  await page.setViewportSize({ width: 1440, height: 900 });
  mkdirSync(out, { recursive: true });

  if (args.includes("--frames")) {
    await page.evaluate(`location.hash = "#preview/long"; location.reload()`);
    await page.waitForLoadState("domcontentloaded");
    await page.getByTestId("session-panel").waitFor();
    await page.waitForTimeout(500);

    const { times, height } = await page.evaluate<{ times: ReadonlyArray<number>; height: number }>(
      scrollFrames
    );

    console.log(`screens: scroll frames ${JSON.stringify({ ...frameStats(times), height })}`);
  }

  for (const scene of scenes) {
    await page.evaluate(`location.hash = "#preview/${scene}"; location.reload()`);
    await page.waitForLoadState("domcontentloaded");
    const isNew = scene === "new" || scene === "setup";

    await page.getByTestId(isNew ? "new-session" : "session-panel").waitFor();

    // The setup scene shows a Harness that isn't installed: choose it to show its setup line.
    if (scene === "setup") await page.getByTestId("harness-codex").click();

    for (const density of densities) {
      for (const theme of ["dark", "light"]) {
        await page.evaluate(
          `Promise.all([window.polaris.request("settings.setTheme", { theme: "${theme}" }), window.polaris.request("settings.setDensity", { density: "${density}" })])`
        );
        await page.locator(`html[data-theme="${theme}"][data-density="${density}"]`).waitFor({
          state: "attached",
        });
        await page.waitForTimeout(400);
        const path = join(out, `${scene}-${theme}-${density}.png`);

        await page.screenshot({ path });
        console.log(`screens: ${path}`);
      }
    }
  }
} finally {
  await app.close();
  await daemon.stop();
  rmSync(home, { recursive: true, force: true });
}
