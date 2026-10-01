/**
 * Review in the smoke test: pull request #42 from the GitHub fake, checked out on the local
 * Daemon from a local "code host" (the smoke repo's `git@github.com:` remote is rewritten to
 * a bare repository with `refs/pull/42/head`), its diff rendered by Pierre, a file marked
 * Viewed on the fake; then the smoke repo's Agent Session from the queue, grouped by Turn.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright-core";
import type { GitHubFake } from "./githubFake/index.ts";

const git = (cwd: string, ...args: ReadonlyArray<string>) =>
  execFileSync(
    "git",
    ["-c", "user.name=smoke", "-c", "user.email=smoke@polaris.invalid", ...args],
    { cwd, stdio: "pipe" }
  )
    .toString()
    .trim();

const write = (dir: string, path: string, text: string) => {
  mkdirSync(join(dir, path, ".."), { recursive: true });
  writeFileSync(join(dir, path), text);
};

const DELIVER_BEFORE = `export async function deliver(hook: Hook, body: string) {
  const response = await fetch(hook.url, { method: "POST", body });

  if (!response.ok) throw new Error(\`delivery failed: \${response.status}\`);
}
`;

const DELIVER_AFTER = `import { backoff } from "./backoff.ts";

export async function deliver(hook: Hook, body: string, attempt = 0) {
  const response = await fetch(hook.url, { method: "POST", body });

  if (response.ok) return;

  if (attempt >= 5) throw new Error(\`delivery failed: \${response.status}\`);

  await backoff(attempt);
  await deliver(hook, body, attempt + 1);
}
`;

/**
 * A bare `acme/widgets` with \`main\` and pull request #42 (three files, as the fake lists
 * them), and the smoke repo's GitHub remote pointed at it with \`insteadOf\`.
 */
export const setupCodeHost = (repo: string, home: string) => {
  const host = join(home, "codehost");
  const bare = join(host, "acme", "widgets.git");
  const work = mkdtempSync(join(home, "codehost-work-"));

  mkdirSync(bare, { recursive: true });
  git(bare, "init", "-q", "--bare", "-b", "main");
  git(work, "init", "-q", "-b", "main");
  write(work, "src/webhooks/deliver.ts", DELIVER_BEFORE);
  write(work, "test/webhooks/deliver.test.ts", 'test("delivers", () => {});\n');
  // What the checkout chip's Run starts (`bun run dev`), outside the pull request's diff.
  write(work, "package.json", JSON.stringify({ scripts: { dev: "echo serving && sleep 600" } }));
  write(work, "bun.lock", "");
  git(work, "add", ".");
  git(work, "commit", "-qm", "webhooks");
  git(work, "push", "-q", bare, "main");
  write(work, "src/webhooks/deliver.ts", DELIVER_AFTER);
  write(
    work,
    "src/webhooks/backoff.ts",
    "export const backoff = (attempt: number) =>\n  new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 100));\n"
  );
  write(
    work,
    "test/webhooks/deliver.test.ts",
    'test("delivers", () => {});\ntest("retries with backoff", () => {});\n'
  );
  git(work, "add", ".");
  git(work, "commit", "-qm", "Retry webhook deliveries with backoff");
  git(work, "push", "-q", bare, "HEAD:refs/pull/42/head");
  git(repo, "config", `url.${host}/.insteadOf`, "git@github.com:");

  return {
    root: host,
    work,
    bare,
    head: git(work, "rev-parse", "HEAD"),
    base: git(work, "rev-parse", "HEAD~1"),
  };
};

interface ReviewFlowInput {
  readonly page: Page;
  readonly fake: GitHubFake;
  readonly step: (message: string) => void;
  readonly shoot: (name: string) => Promise<void>;
}

const HIGHLIGHTED = `[...document.querySelectorAll("diffs-container")].some((c) => c.shadowRoot?.innerHTML.includes("var(--color-syntax-"))`;

const waitForHighlight = async (page: Page) => {
  for (let i = 0; i < 100; i++) {
    if ((await page.evaluate(HIGHLIGHTED)) === true) return;

    await page.waitForTimeout(200);
  }

  throw new Error("the diff isn't highlighted with the syntax tokens");
};

const progress = (page: Page) => page.getByTestId("review-progress").textContent();

const centre = (page: Page, tab: string) =>
  page.locator(`[data-testid="review-centre"][data-tab="${tab}"]`);

/**
 * A pull request opens on Overview with the fake's Suzuka summary; its Re-run asks once, then
 * posts `/review`; Comment now posts from Conversation; "Review changes →" jumps to Changes.
 */
const overviewSteps = async (page: Page, step: (message: string) => void) => {
  await centre(page, "overview").waitFor({ timeout: 60_000 });

  const verdict = page.getByTestId("bot-verdict");

  await verdict.waitFor({ timeout: 30_000 });
  // The cached detail is refreshed once on open; on a re-review the cards then move.
  await page.waitForTimeout(1500);
  await page.getByTestId("bot-summary-toggle").click();
  await page.getByTestId("bot-summary-full").waitFor();
  step(
    `#42 opened on Overview: suzuka's summary pinned, verdict ${(await verdict.textContent()) ?? "?"}, full GFM on demand`
  );

  await page.getByTestId("bot-menu-trigger").click();
  await page.getByTestId("bot-command-review").click();
  await page.getByTestId("bot-confirm-post").click();
  await page.getByTestId("bot-confirm").waitFor({ state: "detached", timeout: 15_000 });
  step("Re-run asked once, then posted /review as the viewer");

  await page.getByTestId("review-tab-conversation").click();
  await page.getByTestId("conversation").waitFor({ timeout: 30_000 });
  await page.getByTestId("timeline").getByText("/review").first().waitFor({ timeout: 30_000 });
  await page
    .getByTestId("conversation-composer")
    .locator("textarea")
    .fill("Overview smoke: comment now");
  await page.getByTestId("conversation-comment-now").click();
  await page
    .getByTestId("timeline")
    .getByText("Overview smoke: comment now")
    .waitFor({ timeout: 30_000 });
  await page.getByRole("radio", { name: "Bots", exact: true }).click();
  await page.getByRole("radio", { name: "Bots", exact: true, checked: true }).waitFor();
  await page
    .getByTestId("timeline")
    .getByText("Overview smoke: comment now")
    .waitFor({ state: "detached" });
  step("Conversation: /review in the timeline, Comment now posted, Bots hides people's comments");

  await page.getByTestId("review-tab-overview").click();
  await page.getByTestId("review-jump-changes").click();
  await centre(page, "changes").waitFor();
  step("Review changes → jumped from Overview to Changes");
};

/** ⌃2 opens the queue's second review, in its visible order. */
const queueDigit = async (page: Page, step: (message: string) => void) => {
  const second = page.getByTestId("review-queue-row").nth(1);
  const id = await second.getAttribute("data-row");

  await page.keyboard.press("Control+Digit2");
  await page
    .locator(`[data-testid="review-queue-row"][data-row="${id ?? ""}"][aria-current="page"]`)
    .waitFor({ timeout: 10_000 });
  step(`⌃2 opened the queue's second review (${id ?? "?"})`);
};

export const reviewFlow = async ({ page, fake, step, shoot }: ReviewFlowInput) => {
  await page.getByRole("radio", { name: /^Review/ }).click();
  // pullsFlow left #44 open: #42 is in the queue beside it.
  await page.getByTestId("review-queue-row").filter({ hasText: "#42" }).click();
  await overviewSteps(page, step);

  const deliver = page.locator('[data-testid="review-file"][data-path="src/webhooks/deliver.ts"]');

  await deliver.waitFor({ timeout: 60_000 });
  await page.getByTestId("review-file-row").nth(2).waitFor();

  const files = await page.getByTestId("review-file-row").count();

  if (files !== 3) throw new Error(`#42 should list 3 files, saw ${files}`);

  // Highlighting arrives from the worker pool after the plain text paints.
  await waitForHighlight(page);

  step(`#42 checked out on the local Daemon from the code host; ${files} files, highlighted`);
  await shoot("review-pull");

  const before = await progress(page);

  await deliver.getByText("Viewed").click();
  await page.getByTestId("review-progress").filter({ hasText: "1 of 3 viewed" }).waitFor();

  // The mark shows at once; its GitHub write follows.
  const sent = () =>
    fake.requests.some((r) => r.kind === "graphql" && r.name === "MarkFileAsViewed");

  for (let i = 0; i < 50 && !sent(); i++) await page.waitForTimeout(200);

  if (!sent()) throw new Error("Viewed didn't reach GitHub (no MarkFileAsViewed)");

  step(`Viewed: ${before ?? ""} → 1 of 3 viewed, sent to GitHub as MarkFileAsViewed`);

  const session = page
    .getByTestId("review-queue-row")
    .filter({ hasText: "smoke-repo" })
    .filter({ hasNotText: "Reviewer ·" })
    .filter({ hasNotText: "Walkthrough ·" });

  if ((await session.count()) > 0) {
    await session.first().click();
    await page.locator('[data-testid="review-centre"][data-tab="overview"]').waitFor();
    await page.getByTestId("review-tab-changes").click();
    await page.getByTestId("turn-divider").first().waitFor({ timeout: 30_000 });
    step(
      `an Agent Session from the queue: ${await page.getByTestId("turn-divider").count()} Turn dividers`
    );
    await shoot("review-session");
  } else step("no Agent Session ready for review in the queue");

  await queueDigit(page, step);
  await page.getByRole("button", { name: "Pull requests" }).click();
  await page.getByRole("radio", { name: /^Orchestrate/ }).click();
};
