/**
 * The pull request list in the smoke test, against the GitHub fake: the smoke Workspace's
 * own remotes reach `github.watch` (no request from the test), #42 shows under Review
 * requested in the list and in Needs You's Reviews group, opening it goes to Review, "Review
 * a PR by URL" opens another, and a new request makes one notification that opens it.
 */
import { execFileSync } from "node:child_process";
import type { ElectronApplication, Page } from "playwright-core";
import type { GitHubFake } from "./githubFake/index.ts";

interface PullsFlowInput {
  readonly app: ElectronApplication;
  readonly page: Page;
  readonly fake: GitHubFake;
  readonly step: (message: string) => void;
}

/** `git remote add` each one: the remotes the PR list reads from the Workspace's config. */
export const addRemotes = (dir: string, remotes: Readonly<Record<string, string>>) => {
  for (const [name, url] of Object.entries(remotes)) {
    execFileSync("git", ["remote", "add", name, url], { cwd: dir, stdio: "pipe" });
  }
};

const reviewTitle = (page: Page) => page.getByTestId("pull-review-title");

/** The review-request notifications planned in the main process (src/main/notifications). */
const planned = (app: ElectronApplication) =>
  app.evaluate(() => [...(globalThis.__polarisReviews?.planned() ?? [])]);

const waitForPlanned = async (app: ElectronApplication, key: string) => {
  for (let i = 0; i < 75; i++) {
    if ((await planned(app)).includes(key)) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  throw new Error(
    `no review-request notification for ${key}: ${JSON.stringify(await planned(app))}`
  );
};

export const pullsFlow = async ({ app, page, fake, step }: PullsFlowInput) => {
  await page.getByRole("radio", { name: /^Review/ }).click();
  await page.getByTestId("pulls-group-requested").getByText("Retry webhook deliveries").waitFor();

  const caption = await page.getByTestId("pulls-caption").textContent();
  const row = page.locator('[data-testid="pull-row"][data-pull="PR_kwDOacme42"]');
  const lane = await row.textContent();

  if (lane?.includes("smoke-repo") !== true) throw new Error(`#42's row has no workspace: ${lane}`);

  await page.locator('[data-testid="pulls-notice"][data-kind="blocked"]').waitFor();
  step(
    `PR list from the Workspace's remotes: ${caption}; #42 in smoke-repo; lockedorg/vault blocked`
  );

  await row.click();
  await reviewTitle(page).filter({ hasText: "Retry webhook deliveries with backoff" }).waitFor();
  await page.getByRole("button", { name: "Pull requests" }).click();
  await page.getByTestId("review-by-url").click();
  await page
    .getByTestId("review-by-url-input")
    .fill("https://github.com/mona/dotfiles/pull/7/files");
  await page.keyboard.press("Enter");
  await reviewTitle(page).filter({ hasText: "Add a zsh prompt for worktrees" }).waitFor();
  step("opened #42 from the list and mona/dotfiles#7 by URL in Review");

  await page.getByRole("radio", { name: /^Orchestrate/ }).click();
  await page.getByRole("radio", { name: /^Needs you/ }).click();
  await page.locator('[data-testid="review-card"][data-pull="PR_kwDOacme42"]').waitFor();
  step("Needs You's Reviews group lists #42");

  const before = await planned(app);

  if (before.length > 0) throw new Error(`requests there at launch notified: ${before.join(", ")}`);

  fake.requestReview("acme/widgets", 44, "mona");
  await page.evaluate(`window.polaris.request("github.refresh", {})`);
  await page.locator('[data-testid="review-card"][data-pull="PR_kwDOacme44"]').waitFor();
  await waitForPlanned(app, "PR_kwDOacme44");

  const clicked = await app.evaluate(
    () => globalThis.__polarisReviews?.click("PR_kwDOacme44") ?? false
  );

  if (!clicked) throw new Error("the review-request notification for #44 isn't standing");
  await reviewTitle(page).filter({ hasText: "Bump the parser to 4.2" }).waitFor();
  step(
    "a new request for #44: one notification (none for #42, requested before mona signed in); clicking it opened #44 in Review"
  );
  await page.getByRole("radio", { name: /^Orchestrate/ }).click();
  await page.getByRole("radio", { name: /^Sessions/ }).click();
};
