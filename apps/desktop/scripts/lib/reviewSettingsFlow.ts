/**
 * Settings for Review in the smoke test, after the GitHub fake signed mona in: GitHub
 * accounts lists mona as the default and lockedorg's access fix; Reviewer's "When it runs"
 * reaches the Host's settings (restored after); Sessions gives the smoke
 * Workspace its own accept-branch setting, then removes it.
 */
import type { Page } from "playwright-core";
import type { RequestInput, RequestMethod, RequestOutput } from "../../src/shared/api.ts";

interface ReviewSettingsFlowInput {
  readonly page: Page;
  readonly step: (message: string) => void;
}

const call = <M extends RequestMethod>(page: Page, method: M, input: RequestInput<M>) =>
  page.evaluate<
    RequestOutput<M>
  >(`window.polaris.request(${JSON.stringify(method)}, ${JSON.stringify(input)}).then((r) => {
    if (!r.ok) throw new Error(r.error.code + ": " + r.error.message);
    return r.value;
  })`);

const nav = (page: Page, name: string) =>
  page
    .getByRole("navigation", { name: "Settings" })
    .getByRole("button", { name, exact: true })
    .click();

const until = async (check: () => Promise<boolean>, what: string) => {
  for (let i = 0; i < 50; i++) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  throw new Error(`review settings: never saw ${what}`);
};

const github = async (page: Page, step: ReviewSettingsFlowInput["step"]) => {
  await nav(page, "GitHub accounts");
  await page
    .getByTestId("github-account")
    .filter({ hasText: "mona" })
    .filter({ hasText: "Default" })
    .waitFor({ timeout: 10_000 });
  await page
    .getByTestId("github-owner")
    .filter({ hasText: "lockedorg" })
    .getByRole("button", { name: "Get access" })
    .waitFor({ timeout: 10_000 });
  step("Settings → GitHub accounts: mona is the default; lockedorg offers its access fix");
};

const reviewer = async (page: Page, step: ReviewSettingsFlowInput["step"]) => {
  const before = await call(page, "review.reviewerSettings", {
    hostKey: "local",
    workspaceId: null,
  });

  await nav(page, "Reviewer");
  await page.getByTestId("reviewer-host").first().waitFor({ timeout: 10_000 });
  await page.getByRole("switch", { name: "When a pull request opens in Review" }).click();
  await page.getByRole("combobox", { name: "Ask first for large changes" }).click();
  await page.getByRole("option", { name: "Over 5,000 lines" }).click();
  await until(async () => {
    const now = await call(page, "review.reviewerSettings", {
      hostKey: "local",
      workspaceId: null,
    });

    return !now.settings.onPullRequests && now.settings.askAboveLines === 5000;
  }, "pull requests off and asking first over 5,000 lines on the host");
  await call(page, "review.setReviewerSettings", { hostKey: "local", settings: before.settings });
  step(
    "Settings → Reviewer: pull requests off, ask first over 5,000 lines, on the host (restored after)"
  );
};

const acceptBranch = async (page: Page, step: ReviewSettingsFlowInput["step"]) => {
  const overrides = async () =>
    (await call(page, "settings.get", {})).sessions.workspaceAcceptBranch;

  await nav(page, "Sessions");
  await page.getByRole("combobox", { name: /commit differently/ }).click();
  await page.getByRole("option", { name: /^smoke-repo/ }).click();
  await until(
    async () => Object.values(await overrides()).includes("current"),
    "the smoke Workspace committing to its current branch"
  );
  await page.getByRole("button", { name: /Remove the override for smoke-repo/ }).click();
  await until(async () => Object.keys(await overrides()).length === 0, "the override removed");
  step(
    "Settings → Sessions: smoke-repo committed to its current branch, then followed the default"
  );
};

export const reviewSettingsFlow = async ({ page, step }: ReviewSettingsFlowInput) => {
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByTestId("settings").waitFor({ timeout: 5_000 });
  await github(page, step);
  await reviewer(page, step);
  await acceptBranch(page, step);
  await page.keyboard.press("Escape");
  await page.getByTestId("settings").waitFor({ state: "detached", timeout: 5_000 });
};
