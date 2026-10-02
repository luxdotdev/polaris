/**
 * Worktree setup in the Constellation tab (C1-G2, on fixtures): a failed setup needs you with
 * Retry and "Open the log", the log is the worker's setup card, and Retry runs setup again.
 */
import type { Page } from "playwright-core";

const row = (page: Page, taskId: string) =>
  page.locator(`[data-testid="constellation-rail"] [data-task="${taskId}"]`);

export const constellationSetupFlow = async (page: Page, step: (m: string) => void) => {
  await page.evaluate(`location.hash = "#constellation/setup"; location.reload()`);
  await page.getByTestId("constellation-tab").waitFor({ timeout: 10_000 });

  const running = await row(page, "B7").textContent();

  if (running?.includes("setting up") !== true || !running.includes("bun install"))
    throw new Error(`B7's row doesn't say it is setting up: "${running}"`);

  const failed = row(page, "B8");

  await failed.getByText("setup failed", { exact: true }).waitFor({ timeout: 5_000 });

  if ((await failed.innerText()).replace(/\s+/g, " ").includes("bun install exited 1") !== true)
    throw new Error(`B8's row doesn't name the failed command: "${await failed.textContent()}"`);

  await failed.getByRole("button", { name: "Open the log" }).click();

  const card = page.locator('[data-testid="worktree-setup"][data-status="failed"]');

  await card.waitFor({ timeout: 5_000 });

  if ((await card.getAttribute("open")) === null)
    throw new Error("the failed setup card is folded");

  await page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("button").click();
  await failed.getByRole("button", { name: "Retry" }).click();
  await failed.getByText("setting up", { exact: true }).waitFor({ timeout: 5_000 });

  if ((await failed.getByRole("button", { name: "Retry" }).count()) > 0)
    throw new Error("Retry stayed after setup ran again");

  step("Constellation setup: failed row → log card → Retry → setting up");
};
