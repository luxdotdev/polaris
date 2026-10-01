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

const sent = (fake: GitHubFake, name: string) => count(fake, name) > 0;

const count = (fake: GitHubFake, name: string) =>
  fake.requests.filter((r) => r.kind === "graphql" && r.name === name && r.status < 400).length;

const PULL_ID = "PR_kwDOacme42";

const TEST_FILE = "test/webhooks/deliver.test.ts";

/** The line-number cells of one file's diff (Pierre's shadow DOM; Playwright pierces it). */
const lineNumber = (page: Page, path: string, line: number) =>
  page
    .locator("diffs-container", {
      has: page.locator(`[data-testid="review-file"][data-path="${path}"]`),
    })
    .locator("[data-column-number]")
    .filter({ hasText: new RegExp(`^${line}$`) })
    .first();

/** Opens #42 again, so its detail is fetched fresh from the fake. */
const reopen = async (page: Page) => {
  await page.getByRole("button", { name: "Pull requests" }).click();
  await page.locator(`[data-testid="pull-row"][data-pull="${PULL_ID}"]`).click();
  await page
    .locator('[data-testid="risk-summary"][data-state="ready"]')
    .waitFor({ timeout: 60_000 });
};

/** Makes a thread outdated on the fake without moving the head, as a push would. */
const outdate = (
  fake: GitHubFake,
  match: (t: GitHubFake["world"]["threads"][number]) => boolean
) => {
  const thread = fake.world.threads.find(
    (t) => t.pullId === PULL_ID && t.line !== null && match(t)
  );

  if (thread === undefined) throw new Error("no thread to make outdated on the fake");
  thread.line = null;
};

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

const pullRequest = async (input: FindingsFlowInput) => {
  const { page, fake, step, shoot } = input;

  await page.getByRole("radio", { name: /^Review/ }).click();
  // reviewFlow went back to the list: open #42 from it.
  await page.locator('[data-testid="pull-row"][data-pull="PR_kwDOacme42"]').click();

  const caption = await summaryWithFindings(page);
  const findings = await page.getByTestId("risk-finding").count();

  step(`#42's risk summary: "${caption}", ${findings} finding(s)`);

  const cost = (await page.getByTestId("risk-cost").textContent()) ?? "";

  if (!cost.startsWith("Reviewed by ")) throw new Error(`no cost line: "${cost}"`);
  await page.getByTestId("risk-reviewer-settings").click();
  await page.getByTestId("reviewer-card").waitFor({ timeout: 15_000 });
  await page.keyboard.press("Escape");
  await page.getByRole("radio", { name: /^Review/ }).click();
  await page.locator('[data-testid="risk-summary"][data-state="ready"]').waitFor();
  step(`cost line "${cost}"; its Change opened Settings → Reviewer`);

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
  await threads(input);
  await rangeAndOutdated(input);
  await decisions(input);
};

/** Reply to the published thread, then resolve it. */
const threads = async ({ page, fake, step }: FindingsFlowInput) => {
  const thread = page.getByTestId("review-thread").filter({ hasText: "(smoke)" }).first();

  await thread.getByRole("button", { name: "Reply", exact: true }).click();
  await thread.getByRole("textbox", { name: "Reply" }).fill("Replying from the smoke");
  await thread.getByRole("button", { name: /^Reply ⌘/ }).click();
  await until("a reply on the fake", () => sent(fake, "AddPullRequestReviewThreadReply"));
  await thread.getByRole("button", { name: "Resolve", exact: true }).click();
  await until("ResolveReviewThread on the fake", () => sent(fake, "ResolveReviewThread"));
  await page.getByTestId("review-thread").filter({ hasText: "Resolved" }).first().waitFor();
  step(
    "reply and resolve on the published thread (AddPullRequestReviewThreadReply, ResolveReviewThread)"
  );
};

/** A range comment from the line numbers; made outdated, moved to the selection, then discarded. */
const rangeAndOutdated = async ({ page, fake, step }: FindingsFlowInput) => {
  await lineNumber(page, TEST_FILE, 1).click();
  await lineNumber(page, TEST_FILE, 2).click({ modifiers: ["Shift"] });
  await page.getByTestId("comment-composer").filter({ hasText: "Lines 1–2" }).waitFor();
  await page.getByTestId("composer-text").fill("Range comment from the smoke");
  await page.getByTestId("composer-add").click();
  await until("the range thread on the fake", () =>
    fake.world.threads.some((t) => t.path === TEST_FILE && t.startLine === 1 && t.line === 2)
  );
  step("selected lines 1–2 by their numbers: a range draft (startLine 1, line 2) on the fake");

  outdate(fake, (t) => t.path === TEST_FILE && t.startLine === 1);
  await reopen(page);
  await page.locator('[data-testid="comments-group"][data-group="Outdated drafts"]').waitFor();

  const deletesBefore = count(fake, "DeletePullRequestReviewComment");

  await lineNumber(page, TEST_FILE, 2).click();
  await page.getByTestId("comment-composer").waitFor();
  await page.getByRole("button", { name: "Move to selection" }).click();
  await page.getByTestId("comment-composer").filter({ hasText: "replaces your draft" }).waitFor();
  await page.getByTestId("composer-add").click();
  await until(
    "the moved draft (new thread, old comment deleted)",
    () =>
      count(fake, "DeletePullRequestReviewComment") === deletesBefore + 1 &&
      fake.world.threads.some((t) => t.path === TEST_FILE && t.startLine === null && t.line === 2)
  );
  step("an outdated draft moved to the selected line: re-added there, the old one deleted");

  outdate(fake, (t) => t.path === TEST_FILE && t.startLine === null && t.line === 2);
  await reopen(page);

  const outdated = page.locator('[data-testid="comments-group"][data-group="Outdated drafts"]');

  await outdated.getByRole("button", { name: "Discard", exact: true }).click();
  await until(
    "the discarded draft deleted",
    () => count(fake, "DeletePullRequestReviewComment") === deletesBefore + 2
  );
  await outdated.waitFor({ state: "detached", timeout: 15_000 });
  step("an outdated draft discarded (DeletePullRequestReviewComment)");
};

const submitAs = async (page: Page, event: "request-changes" | "approve", body: string) => {
  await page.getByTestId("submit-review-open").click();
  await page.getByTestId("submit-review").waitFor();
  await page.locator(`[data-testid="submit-choice"][data-event="${event}"]`).click();
  await page.getByTestId("submit-review").getByRole("textbox", { name: "Summary" }).fill(body);
  await page.getByTestId("submit-review-send").click();
  await page.getByTestId("submit-review").waitFor({ state: "detached", timeout: 15_000 });
};

/** Request changes, then approve, as mona (not the author). */
const decisions = async ({ page, fake, step }: FindingsFlowInput) => {
  const states = () =>
    fake.world.reviews
      .filter((r) => r.author === "mona" && r.pullId === PULL_ID)
      .map((r) => r.state);

  await submitAs(page, "request-changes", "Cap the retries before this merges.");
  await until("CHANGES_REQUESTED on the fake", () => states().includes("CHANGES_REQUESTED"));
  await submitAs(page, "approve", "");
  await until("APPROVED on the fake", () => states().includes("APPROVED"));
  step("Submit review → Request changes, then Approve: CHANGES_REQUESTED and APPROVED on the fake");
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
