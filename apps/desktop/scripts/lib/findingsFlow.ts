/**
 * The Risk Summary and comments in the smoke test (M2-F), on the GitHub fake and the real
 * Daemon with the bench Reviewer: #42's summary runs when it opens; "Comment on this" adds
 * a draft to GitHub's pending review; a thumbs-down moves the finding to Dismissed; the
 * review is submitted. Then the smoke session's feedback goes out as one Turn.
 */
import type { Page } from "playwright-core";
import type { GitHubFake } from "./githubFake/index.ts";

interface FindingsFlowInput {
  readonly page: Page;
  readonly fake: GitHubFake;
  readonly step: (message: string) => void;
  readonly shoot: (name: string) => Promise<void>;
}

const sent = (fake: GitHubFake, name: string) =>
  fake.requests.some((r) => r.kind === "graphql" && r.name === name);

const until = async (what: string, check: () => boolean | Promise<boolean>, ms = 30_000) => {
  for (let waited = 0; waited < ms; waited += 200) {
    if (await check()) return;

    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  throw new Error(`timed out waiting for ${what}`);
};

/** Waits for the open subject's summary to finish and to flag something. */
const summaryWithFindings = async (page: Page) => {
  await page
    .locator('[data-testid="risk-summary"][data-state="ready"]')
    .waitFor({ timeout: 90_000 });
  await page.getByTestId("risk-finding").first().waitFor({ timeout: 90_000 });

  return (await page.getByTestId("risk-caption").textContent()) ?? "";
};

/** Expands the first finding and drafts a comment from it. */
const commentOnFirst = async (page: Page, add: string) => {
  await page.getByTestId("risk-finding").first().locator("button").first().click();
  await page.getByRole("button", { name: "Comment on this" }).click();

  const text = page.getByTestId("composer-text");

  await text.waitFor();
  await text.fill(`${await text.inputValue()} (smoke)`.trim());
  await page.getByTestId("composer-add").filter({ hasText: add }).click();
  await page.getByTestId("comment-composer").waitFor({ state: "detached", timeout: 15_000 });
};

const pullRequest = async ({ page, fake, step, shoot }: FindingsFlowInput) => {
  await page.getByRole("radio", { name: /^Review/ }).click();
  // reviewFlow went back to the list: open #42 from it.
  await page.locator('[data-testid="pull-row"][data-pull="PR_kwDOacme42"]').click();

  const caption = await summaryWithFindings(page);
  const findings = await page.getByTestId("risk-finding").count();

  step(`#42's risk summary: "${caption}", ${findings} finding(s)`);

  await commentOnFirst(page, "Add to review");
  await until("AddPullRequestReviewThread on the fake", () =>
    sent(fake, "AddPullRequestReviewThread")
  );
  await page
    .getByRole("button", { name: /^Submit review/ })
    .filter({ hasText: "1" })
    .waitFor({ timeout: 15_000 });
  step(
    "Comment on this: a draft in GitHub's pending review (AddPullRequestReviewThread), Submit review shows 1"
  );
  await shoot("findings-pull");

  await page.getByTestId("verdict-down").first().click();
  await page.getByTestId("verdict-popover").getByRole("button", { name: "False positive" }).click();
  await page.getByTestId("verdict-popover").getByRole("button", { name: "Save verdict" }).click();
  await page
    .locator('[data-testid="risk-group"][data-group="Dismissed"]')
    .waitFor({ timeout: 15_000 });
  step("thumbs-down with a reason: the finding moved to Dismissed");

  await page.getByTestId("submit-review-open").click();
  await page.getByTestId("submit-review").waitFor();
  await page.getByTestId("submit-review-send").click();
  await until("SubmitPullRequestReview on the fake", () => sent(fake, "SubmitPullRequestReview"));
  step("Submit review → Comment: SubmitPullRequestReview on the fake");
};

const session = async ({ page, step, shoot }: FindingsFlowInput) => {
  const row = page
    .getByTestId("review-queue-row")
    .filter({ hasText: "smoke-repo" })
    .filter({ hasNotText: "Reviewer ·" });

  if ((await row.count()) === 0) {
    step("no Agent Session ready for review: feedback not exercised");

    return;
  }

  await row.first().click();
  const caption = await summaryWithFindings(page);

  step(`the smoke session's risk summary: "${caption}"`);

  await commentOnFirst(page, "Add to feedback");
  await page.getByTestId("feedback-card").waitFor();
  await shoot("findings-feedback");
  await page.getByTestId("feedback-send").click();
  await page.getByTestId("feedback-card").waitFor({ state: "detached", timeout: 15_000 });
  await page.getByTestId("feedback-sent").first().waitFor({ timeout: 30_000 });
  step(
    `feedback sent as one Turn: "${(await page.getByTestId("feedback-sent").first().textContent()) ?? ""}"`
  );
};

export const findingsFlow = async (input: FindingsFlowInput) => {
  await pullRequest(input);
  await session(input);
  await input.page.getByRole("button", { name: "Pull requests" }).click();
  await input.page.getByRole("radio", { name: /^Orchestrate/ }).click();
};
