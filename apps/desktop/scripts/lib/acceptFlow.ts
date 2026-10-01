/**
 * Accepting an Agent Session's work in the smoke test (ENG-224): a second bench session in
 * the smoke repo edits two files; from Review, its accept action drafts the message (the
 * bench Harness answers the draft Turn), commits onto a new branch, pushes it to the local
 * code host (the `git@github.com:` remote is rewritten by `setupCodeHost`), opens the pull
 * request on the GitHub fake as mona and links it. Merging it on the fake archives the session.
 */
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import type { Page } from "playwright-core";
import type { GitHubFake } from "./githubFake/index.ts";

interface AcceptFlowInput {
  readonly page: Page;
  readonly fake: GitHubFake;
  readonly repo: string;
  readonly home: string;
  readonly step: (message: string) => void;
  readonly shoot: (name: string) => Promise<void>;
}

const PROMPT = `bench:${JSON.stringify({ items: 2, deltasPerItem: 2, touchFiles: 2, approvalEvery: 0, tag: "accept-smoke" })}`;

const git = (cwd: string, ...args: ReadonlyArray<string>) =>
  execFileSync("git", args, { cwd, stdio: "pipe" }).toString().trim();

const startSession = async (page: Page) => {
  await page.getByRole("radio", { name: /^Orchestrate/ }).click();
  await page
    .getByRole("button", { name: /smoke-repo/ })
    .first()
    .click();
  await page.getByRole("button", { name: "New session" }).first().click();
  await page.getByTestId("new-session").waitFor();
  await page.getByTestId("composer-input").fill(PROMPT);
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByTestId("session-panel").waitFor({ timeout: 15_000 });
  await page.getByTestId("session-state").filter({ hasText: /^Idle/ }).waitFor({ timeout: 60_000 });
};

/** ⌘↵ on a session in the jump menu opens its Turns in Review. */
const openInReview = async (page: Page) => {
  await page.keyboard.press("Meta+K");
  const input = page.getByRole("combobox");

  await input.waitFor({ timeout: 5000 });
  await input.pressSequentially("accept-smoke", { delay: 20 });
  await page.getByTestId("jump-item").first().waitFor();
  await page.keyboard.press("Meta+Enter");
  await page.getByTestId("accept-action").waitFor({ timeout: 15_000 });
};

/** The accept action, or "Accept anyway" when the Reviewer left a Critical finding open. */
const openPanel = async (page: Page) => {
  const primary = page.getByTestId("accept-primary");
  const label = (await primary.textContent()) ?? "";

  if (label.startsWith("Accept paused")) {
    await page.getByRole("button", { name: "More accept options" }).click();
    await page.getByRole("menuitem", { name: /^Accept anyway/ }).click();
  } else await primary.click();

  await page.getByTestId("accept-panel").waitFor();

  return label;
};

export const acceptFlow = async ({ page, fake, repo, home, step, shoot }: AcceptFlowInput) => {
  await startSession(page);
  step("a second bench session in the smoke repo edited two files");
  await openInReview(page);
  const label = await openPanel(page);

  step(`accept action: ${label}`);
  const submit = page.getByTestId("accept-submit");

  await submit.filter({ hasText: "Commit, push and open PR" }).waitFor({ timeout: 30_000 });
  const title = await page.getByTestId("accept-commit-title").inputValue();

  if (title !== "Update the bench files") {
    throw new Error(`the bench Harness's draft wasn't used: "${title}"`);
  }

  step(`drafted by the session's Harness: "${title}"`);
  const branch = await page.getByTestId("accept-branch-name").inputValue();

  await shoot("accept-panel");
  await submit.click();
  await page.getByTestId("accept-done").waitFor({ timeout: 60_000 });
  const done = await page.getByTestId("accept-done").innerText();

  step(`accepted: ${done.replace(/\n/g, " · ")}`);
  await shoot("accept-done");

  const pushed = git(
    join(home, "codehost", "acme", "widgets.git"),
    "log",
    "--format=%s",
    "-n",
    "1",
    branch
  );

  if (pushed !== title) throw new Error(`the code host has "${pushed}" on ${branch}`);

  const status = git(repo, "status", "--porcelain");

  step(
    `pushed ${branch} to the code host; working tree after: ${status === "" ? "clean" : status.split("\n").length + " entries"}`
  );
  const pull = fake.world.pulls.find((p) => p.headRefName === branch);

  if (pull === undefined) throw new Error(`no pull request for ${branch} on the fake`);

  if (pull.author !== "mona") throw new Error(`opened as ${pull.author}, not the routed mona`);
  step(`opened acme/widgets#${pull.number} as ${pull.author}: "${pull.title}"`);

  await page.keyboard.press("Escape");
  await page
    .getByTestId("accept-primary")
    .filter({ hasText: `Pull request #${pull.number}` })
    .waitFor({ timeout: 10_000 });
  step(`the session is linked to #${pull.number}`);

  fake.merge("acme/widgets", pull.number);
  await page.evaluate(`window.polaris.request("github.refresh", {})`);
  await page
    .locator('[data-testid="accept-action"][data-session-state="archived"]')
    .waitFor({ timeout: 30_000 });
  step(`#${pull.number} merged on GitHub: the session archived itself`);

  await page.getByRole("button", { name: "Pull requests" }).click();
  await page.getByRole("radio", { name: /^Orchestrate/ }).click();
};
