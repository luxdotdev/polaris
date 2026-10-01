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
import { _electron as electron, type Page } from "playwright-core";
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

const scenes = (
  option("--scenes") ?? "session,approval,question,interrupted,new,setup,picker,availability"
).split(",");

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

const SHOT_SCENES = new Map([
  ["picker", "interrupted"],
  ["availability", "new"],
  ["viewer", "attachments"],
  ["commands", "interrupted"],
  ["chip", "interrupted"],
  ["subagent-open", "subagents"],
]);

/** Opens what a shot shows, again after each theme or density change closes it. */
const open = async (page: Page, scene: string) => {
  // Close what's open first; esc elsewhere would leave the new-session page.
  if ((await page.locator('[role="dialog"], [role="menu"]').count()) > 0) {
    await page.keyboard.press("Escape");
    await page.locator('[role="dialog"], [role="menu"]').first().waitFor({ state: "detached" });
  }

  if (scene === "picker") {
    await page.getByTestId("model-picker").first().click();
    await page.getByTestId("plan-limits").waitFor();
  } else if (scene === "availability") {
    await page.getByTestId("other-harnesses").first().click();
    await page.getByTestId("availability-sheet").waitFor();
  } else if (scene === "commands" || scene === "chip") {
    const input = page.locator('[data-testid="composer-input"]:visible');

    await input.click();
    await page.keyboard.press("Meta+A");
    await page.keyboard.press("Backspace");
    await page.keyboard.type(scene === "commands" ? "/s" : "/simplify the parser, keep its API");
    await (scene === "commands"
      ? page.getByTestId("command-menu").waitFor()
      : page.locator(".composer-chip").first().waitFor());
  } else if (scene === "subagent-open") {
    for (const target of ['[data-testid="tool-run"] > button', '[data-testid="subagent"] > button'])
      if ((await page.locator(`${target}[aria-expanded="true"]`).count()) === 0)
        await page.locator(target).first().click();
    await page.getByTestId("subagent-transcript").first().waitFor();
  } else if (scene === "viewer") {
    await page.locator('[data-testid="sent-image"][data-state="ready"]').first().click();
    await page.getByTestId("attachment-viewer").locator("img").waitFor();
  }
};

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
    // Shots that open something: the chip's menu on the session, the availability sheet.
    const base = SHOT_SCENES.get(scene) ?? scene;

    await page.evaluate(`location.hash = "#preview/${base}"; location.reload()`);
    await page.waitForLoadState("domcontentloaded");
    const isNew = ["new", "setup", "none-ready"].includes(base);

    const ready = base.startsWith("usage-")
      ? "plan-meter"
      : isNew
        ? "new-session"
        : "session-panel";

    await page.getByTestId(ready).first().waitFor();

    // The setup scene's Codex needs sign-in: choose it to show its setup line.
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
        await open(page, scene);
        await page.waitForTimeout(200);
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
