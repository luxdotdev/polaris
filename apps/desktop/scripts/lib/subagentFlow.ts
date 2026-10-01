/**
 * Subagents in the smoke test, through the real Daemon on the bench Harness:
 * a Turn whose Subagent streams and completes its report keeps that report
 * under its card once the Subagent and the Turn have ended (R6: it used to
 * disappear), and still shows it after a relaunch.
 */
import type { Page } from "playwright-core";

const REPORT = "Bench subagent report: all clear.";

const reportShown = async (page: Page) => {
  await page
    .locator('[data-testid="subagent"][data-status="completed"] [data-testid="subagent-report"]')
    .filter({ hasText: REPORT })
    .last()
    .waitFor({ timeout: 15_000 });
};

export const runSubagent = async (page: Page, step: (m: string) => void) => {
  await page
    .getByTestId("composer-input")
    .fill(`bench:${JSON.stringify({ items: 2, subagents: 1 })}`);
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByTestId("session-state").filter({ hasText: /^Idle/ }).waitFor({ timeout: 30_000 });
  await reportShown(page);
  step("a Subagent's report stays under its card after it and its Turn end");
};

/** Its Turn is an earlier one by now: unfold it, then find the report. */
export const subagentAfterRelaunch = async (page: Page, step: (m: string) => void) => {
  await page.getByTestId("turn-summary").last().click();
  await reportShown(page);
  step("after a relaunch the Subagent's report is still there");
};
