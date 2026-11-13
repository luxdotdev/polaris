#!/usr/bin/env node
/**
 * Screenshots of inline blame and the Origins card on fixtures (`#editor/origins…`) against
 * Paper O1–O3: the annotation alone, then the card opened by hovering it (F: a row hovered,
 * and ⌥B's keyboard focus), in both themes; `--all-densities` adds Balanced and Compact.
 *
 *   node scripts/originsScreens.ts --out <dir> [--build] [--all-densities]
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { type Page } from "playwright-core";
import { scriptedElectron as electron, APP_DIR, electronBinary } from "./lib/electron.ts";

const args = process.argv.slice(2);

const at = args.indexOf("--out");

const out = at === -1 ? null : (args[at + 1] ?? null);

if (out === null) throw new Error("--out <dir> is required");

if (args.includes("--build"))
  spawnSync("bun", [join(APP_DIR, "scripts/build.ts"), "--no-app"], { stdio: "inherit" });

const only = args.includes("--scenes") ? (args[args.indexOf("--scenes") + 1] ?? "") : null;

const ALL = [
  "origins",
  "origins-long",
  "origins-human",
  "origins-loading",
  "origins-offline",
  "origins-typed",
  "origins-live",
];

const SCENES = only === null ? ALL : ALL.filter((s) => only.split(",").includes(s));

const DENSITIES = args.includes("--all-densities") ? ["calm", "balanced", "compact"] : ["calm"];

const home = mkdtempSync(join(tmpdir(), "polaris-origins-screens-"));

const userData = join(home, "user-data");

mkdirSync(userData, { recursive: true });

writeFileSync(
  join(userData, "settings.json"),
  JSON.stringify({ welcomeSeen: true, local: { enabled: false } })
);

const app = await electron.launch({
  executablePath: electronBinary(),
  args: [APP_DIR],
  env: { ...process.env, POLARIS_DESKTOP_USER_DATA: userData, POLARIS_DESKTOP_HIDDEN: "1" },
});

const appearance = async (page: Page, theme: string, density: string) => {
  await page.evaluate(
    `window.polaris.request("settings.setAppearance", { patch: { theme: "${theme}", density: "${density}" } })`
  );
  await page
    .locator(`html[data-theme="${theme}"][data-density="${density}"]`)
    .waitFor({ state: "attached" });
  await page.waitForTimeout(300);
};

const open = async (page: Page, scene: string) => {
  await page.evaluate(`location.hash = "#editor/${scene}"; location.reload()`);
  await page.waitForLoadState("domcontentloaded");
  await page.locator(".cm-originAnnotation").waitFor({ timeout: 20_000 });
  await page.waitForTimeout(400);
};

const shoot = async (page: Page, name: string) => {
  const path = join(out, `${name}.png`);

  await page.screenshot({ path });
  console.log(`screens: ${path}`);
};

try {
  const page = await app.firstWindow();

  await page.setViewportSize({ width: 1440, height: 900 });
  mkdirSync(out, { recursive: true });

  for (const density of DENSITIES) {
    for (const theme of ["dark", "light"]) {
      await appearance(page, theme, density);

      for (const scene of SCENES) {
        await open(page, scene);
        await shoot(page, `${scene}-annotation-${theme}-${density}`);
        await page.locator(".cm-originAnnotation").hover();
        await page.getByTestId("origins-card").waitFor({ timeout: 5000 });
        await page.waitForTimeout(250);

        if (scene === "origins") await page.locator("[data-origin-row]").nth(1).hover();
        await shoot(page, `${scene}-card-${theme}-${density}`);
      }

      // F: a commit row hovered, the session row focused from the keyboard.
      await open(page, "origins-offline");
      await page
        .locator(".cm-line")
        .nth(19)
        .click({ position: { x: 4, y: 4 } });
      await page.waitForTimeout(400);
      await page.keyboard.press("Alt+b");

      try {
        await page.getByTestId("origins-card").waitFor({ timeout: 5000 });
      } catch (cause) {
        await shoot(page, `origins-focus-failed-${theme}-${density}`);
        throw cause;
      }

      await page.keyboard.press("ArrowDown");
      await page.locator("[data-origin-row]").first().hover();
      await page.waitForTimeout(250);
      await shoot(page, `origins-focus-${theme}-${density}`);
    }
  }
} finally {
  await app.close();
  rmSync(home, { recursive: true, force: true });
}
