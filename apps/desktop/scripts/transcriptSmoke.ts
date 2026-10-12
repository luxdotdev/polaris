/**
 * The transcript's structure in the real app, on the bench Harness: node
 * apps/desktop/scripts/transcriptSmoke.ts (build first). A new Turn never folds
 * the one being read, a Turn folds and opens by hand, Turns show their time, and
 * ⌘F finds text in folded and open Turns. Screenshots in both themes go to
 * `.dagr/evidence/tstruct`.
 */
import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, type Page } from "playwright-core";
import { startDaemon } from "./lib/daemon.ts";
import { APP_DIR, REPO_ROOT, sizeWindow, stockElectronBinary } from "./lib/electron.ts";
import { seedSource } from "./lib/seed.ts";

const home = realpathSync(mkdtempSync(join(tmpdir(), "polaris-transcript-")));

const userData = join(home, "user-data");

const evidence = join(REPO_ROOT, ".dagr/evidence/tstruct");

for (const path of [userData, evidence]) mkdirSync(path, { recursive: true });

writeFileSync(join(userData, "settings.json"), JSON.stringify({ welcomeSeen: true }));

const bench = (script: Record<string, number>) => `bench:${JSON.stringify(script)}`;

const appearance = async (page: Page, theme: string) => {
  await page.evaluate(
    `window.polaris.request("settings.setAppearance", { patch: { theme: "${theme}", density: "balanced" } })`
  );
  await page.locator(`html[data-theme="${theme}"]`).waitFor({ state: "attached" });
  await page.waitForTimeout(250);
};

const shoot = async (page: Page, name: string) => {
  for (const theme of ["dark", "light"]) {
    await appearance(page, theme);
    await page.screenshot({ path: join(evidence, `${name}-${theme}.png`) });
  }

  await appearance(page, "dark");
  console.log(`shot: ${name}`);
};

const idle = (page: Page) =>
  page.getByTestId("session-state").filter({ hasText: /^Idle/ }).waitFor({ timeout: 60_000 });

const send = async (page: Page, text: string) => {
  const input = page.getByTestId("composer-input");

  await input.click();
  await input.fill(text);
  await input.press("Enter");
  await page.getByTestId("prompt").filter({ hasText: text }).first().waitFor();
};

const counts = async (page: Page) => ({
  prompts: await page.getByTestId("prompt").count(),
  summaries: await page.getByTestId("turn-summary").count(),
});

let daemon: Awaited<ReturnType<typeof startDaemon>> | undefined;

let app: Awaited<ReturnType<typeof electron.launch>> | undefined;

try {
  daemon = await startDaemon({ home, benchHarness: true });
  app = await electron.launch({
    executablePath: stockElectronBinary(),
    args: [APP_DIR],
    env: {
      ...process.env,
      POLARIS_DESKTOP_LOCAL_SOCKET: daemon.socketPath,
      POLARIS_DESKTOP_BENCH_HARNESS: "1",
      POLARIS_DESKTOP_USER_DATA: userData,
      POLARIS_DESKTOP_HIDDEN: "1",
    },
  });

  const page = await app.firstWindow();

  await sizeWindow(app, 1280, 900);
  await page.evaluate(
    seedSource([
      { hostKey: "local", name: "proof", sessions: [{ title: "Transcript proof", state: "idle" }] },
    ])
  );
  await page.locator('[data-slot="chip"]', { hasText: "proof" }).first().click();
  await page.getByText("Transcript proof", { exact: true }).first().click();
  await idle(page);

  // C5: the Turn's time sits beside its Model under the prompt.
  const time = await page.getByTestId("turn-time").first().textContent();

  assert.match(time ?? "", /^\d{2}:\d{2}$/, `turn time reads ${time}`);
  console.log(`ok: turn time ${time}`);

  // C2: the Turn being read stays open while newer Turns arrive.
  await send(page, "Second turn: keep the first one open");
  await idle(page);
  await send(page, bench({ items: 2, deltasPerItem: 2, deltaIntervalMs: 5 }));
  await idle(page);
  assert.deepEqual(await counts(page), { prompts: 3, summaries: 0 });
  console.log("ok: three Turns, none folded by the newer ones");
  await shoot(page, "c2-turns-stay-open");

  // C2: fold the first Turn by hand; it stays folded, then opens again.
  const first = page.getByTestId("prompt").first();

  await first.hover();
  await first.getByTestId("turn-fold").click();
  await page.getByTestId("turn-summary").first().waitFor();
  assert.deepEqual(await counts(page), { prompts: 2, summaries: 1 });
  await shoot(page, "c2-folded-by-hand");
  await send(page, "Fourth turn: the folded one stays folded");
  await idle(page);
  assert.deepEqual(await counts(page), { prompts: 3, summaries: 1 });
  await page.getByTestId("turn-summary").first().click();
  assert.deepEqual(await counts(page), { prompts: 4, summaries: 0 });
  console.log("ok: fold and open by hand");

  await shoot(page, "c5-turn-times");

  // C4: ⌘F finds in a folded Turn, opens it, lights the match and steps through the rest.
  const second = page.getByTestId("prompt").nth(1);

  await second.hover();
  await second.getByTestId("turn-fold").click();
  await page.getByTestId("turn-summary").first().waitFor();
  await page.getByTestId("composer-input").click();
  await page.keyboard.press("Meta+KeyF");

  const field = page.getByTestId("transcript-search-input");
  const count = page.getByTestId("transcript-search-count");

  await field.waitFor();
  await field.fill("keep the first");
  await count.filter({ hasText: "1 of 1" }).waitFor();
  assert.deepEqual(await counts(page), { prompts: 4, summaries: 0 });

  const lit = () =>
    page.evaluate(
      `[CSS.highlights.get("transcript-match")?.size ?? 0, CSS.highlights.get("transcript-current")?.size ?? 0]`
    );

  await page.waitForTimeout(200);
  assert.deepEqual(await lit(), [1, 1]);
  console.log("ok: ⌘F opened the folded Turn and lit its match");
  await shoot(page, "c4-find-in-folded-turn");

  await field.fill("turn");
  await count.filter({ hasText: /^1 of \d+$/ }).waitFor();
  await field.press("Enter");
  await count.filter({ hasText: /^2 of \d+$/ }).waitFor();
  await field.press("Shift+Enter");
  await count.filter({ hasText: /^1 of \d+$/ }).waitFor();
  await field.fill("nothing like this anywhere");
  await count.filter({ hasText: "No matches" }).waitFor();
  await shoot(page, "c4-no-matches");
  await field.press("Escape");
  await page.getByTestId("transcript-search").waitFor({ state: "detached" });
  assert.deepEqual(await lit(), [0, 0]);
  console.log("ok: ↵ and ⇧↵ step, esc closes and clears");
} finally {
  await app?.close().catch(() => undefined);
  await daemon?.stop();
  rmSync(home, { recursive: true, force: true });
}
