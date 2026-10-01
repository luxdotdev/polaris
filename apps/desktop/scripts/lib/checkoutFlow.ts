/**
 * The Review Checkout chip in the smoke test, on #42's checkout from the local code host:
 * Run starts its dev script; new commits on GitHub reach the Host, counted and listed, and
 * the chip offers Update; Update moves the worktree and starts the run again; Stop ends it;
 * the menu opens a terminal in it; removing it with edits inside is blocked until the edits
 * are discarded; "Check out on" opens it again; and (`afterMerge`) merging #42 on GitHub
 * removes it on its own.
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

/**
 * Points the fake's pull request at the code host's real commits, as GitHub would report
 * them; `updatedAt` stays, or it would read as a new review request.
 */
export const setFakeHead = (
  fake: GitHubFake,
  number: number,
  head: string,
  base: string,
  repo = "acme/widgets"
) => {
  const pull = fake.world.pulls.find((p) => p.repo === repo && p.number === number);

  if (pull === undefined) throw new Error(`the fake has no ${repo}#${number}`);
  pull.headRefOid = head;
  pull.baseRefOid = base;
  fake.world.commits.set(pull.id, [{ oid: head, message: pull.title, date: pull.updatedAt }]);
};

const PUSHED = "Simplify backoff";

/** Another commit on #42 at the code host, which GitHub then reports; returns its id. */
const pushCommit = (fake: GitHubFake, work: string, bare: string) => {
  writeFileSync(join(work, "src/webhooks/backoff.ts"), "export const backoff = async () => {};\n");
  git(work, "commit", "-qam", PUSHED);
  git(work, "push", "-q", bare, "HEAD:refs/pull/42/head");

  const oid = git(work, "rev-parse", "HEAD");

  fake.pushCommit("acme/widgets", 42, oid, PUSHED);

  return oid;
};

interface CheckoutFlowInput {
  readonly page: Page;
  readonly fake: GitHubFake;
  readonly codeHost: { readonly work: string; readonly bare: string };
  readonly step: (message: string) => void;
  readonly shoot: (name: string) => Promise<void>;
}

const chip = (page: Page) => page.getByTestId("checkout-chip");

const chipIn = async (page: Page, state: string, timeout = 60_000) => {
  await page.locator(`[data-testid="checkout-chip"][data-state="${state}"]`).waitFor({ timeout });

  return (await chip(page).textContent()) ?? "";
};

const refresh = (page: Page) =>
  page.evaluate(`window.polaris.request("github.refresh", {}).then((r) => {
    if (!r.ok) throw new Error(r.error.code + ": " + r.error.message);
  })`);

/** Review → #42: from the pull request list, or from the queue when a subject is open. */
const openPull = async (page: Page) => {
  await page.getByRole("radio", { name: /^Review/ }).click();

  const row = page.locator('[data-testid="pull-row"][data-pull="PR_kwDOacme42"]');
  // Once reviewed (findingsFlow submits one), #42 leaves "Review requested" for a compact group.
  const queued = page.locator('[data-testid="review-queue-row"][data-row="PR_kwDOacme42"]');

  await row.or(queued).first().click();
  await page.getByTestId("pull-review-title").waitFor();
};

const removeFromMenu = async (page: Page) => {
  await openMenu(page);
  await page.getByTestId("checkout-remove").click();
};

/**
 * Removes, then waits for `text`. A Reviewer session can still be ending its Turn inside the
 * checkout just after its summary ends; that refusal ("A session is working…") is retried.
 */
const removeUntil = async (page: Page, text: string) => {
  for (let attempt = 0; attempt < 10; attempt++) {
    await removeFromMenu(page);
    const settled = page.getByTestId("checkout-chip").filter({ hasText: text });
    const busy = page.getByTestId("checkout-chip").filter({ hasText: "A session is working" });

    await settled.or(busy).first().waitFor({ timeout: 60_000 });

    if ((await settled.count()) > 0) return (await chip(page).textContent()) ?? "";

    await page.waitForTimeout(1000);
  }

  throw new Error(`removing the checkout never reached "${text}"`);
};

const openMenu = async (page: Page) => {
  await page.getByTestId("checkout-chip-trigger").click();
  await page.getByTestId("checkout-menu").waitFor();
};

export const checkoutFlow = async ({ page, fake, codeHost, step, shoot }: CheckoutFlowInput) => {
  await openPull(page);

  const ready = await chipIn(page, "ready");

  step(`checkout chip: "${ready}"`);
  await shoot("checkout-ready");

  // Run: the checkout's dev script, from its package.json and bun.lock, in a terminal tab.
  await page.getByTestId("checkout-chip-action").filter({ hasText: "Run" }).click();

  const running = await chipIn(page, "running");

  if (!running.includes("bun run dev")) throw new Error(`Run didn't start bun run dev: ${running}`);
  step(`Run: "${running}"`);
  await shoot("checkout-running");

  // New commits: the code host has them, GitHub reports them, the publisher relays the head.
  const next = pushCommit(fake, codeHost.work, codeHost.bare);

  await refresh(page);

  const stale = await chipIn(page, "new-commits", 90_000);

  if (!stale.includes("1 new commit"))
    throw new Error(`the chip doesn't count the commit: ${stale}`);
  await openMenu(page);
  await page.getByTestId("checkout-commit").filter({ hasText: PUSHED }).waitFor();
  step(`new commits on GitHub reached the Host: "${stale}", the menu lists "${PUSHED}"`);
  await shoot("checkout-menu-new-commits");
  await page.getByTestId("checkout-update").click();

  // The run stops for the update and starts again at the new head.
  await chipIn(page, "updating").catch(() => undefined);
  await chipIn(page, "running");
  step("Update checkout stopped the run and started it again at the new head");
  await page.getByTestId("checkout-chip-action").filter({ hasText: "Stop" }).click();

  const updated = await chipIn(page, "ready");

  if (!updated.includes(next.slice(0, 7)))
    throw new Error(`Update didn't reach ${next}: ${updated}`);
  step(`Stop, then: "${updated}"`);

  // A terminal in the checkout, in Orchestrate on its Workspace.
  await openMenu(page);

  const path = (await page.getByTestId("checkout-path").getAttribute("title")) ?? "";

  await page.getByTestId("checkout-terminal").click();
  await page.getByTestId("terminal-tab").filter({ hasText: "#42 checkout" }).waitFor();
  step(`"Open a terminal in the checkout": a tab in ${path}`);

  // The open terminal blocks removal; its fix shows it, and closing it lets removal go on.
  writeFileSync(join(path, "src/webhooks/deliver.ts"), "// edited during review\n");
  await openPull(page);
  // The update started an incremental Risk Summary; its Reviewer runs inside the checkout.
  await page.getByTestId("risk-caption").filter({ hasNotText: "…" }).waitFor({ timeout: 90_000 });
  const inUse = await removeUntil(page, "A terminal is open");

  step(`Remove checkout with a terminal open in it: "${inUse}"`);
  await page.getByTestId("checkout-chip-action").click();
  await page.getByRole("button", { name: "Close #42 checkout" }).click();
  step('"Show terminal" showed its tab; closed it');

  // Then the edit blocks it; discarding (after asking) lets removal go ahead.
  await openPull(page);

  const blocked = await removeUntil(page, "Edits in the checkout");

  step(`Remove checkout with an edit inside: "${blocked}"`);
  await shoot("checkout-blocked-dirty");
  await page.getByTestId("checkout-chip-action").click();
  await page.getByTestId("checkout-fix-confirm").waitFor();
  await shoot("checkout-menu-blocked");
  await page.getByTestId("checkout-fix-confirm").click();

  const removed = await chipIn(page, "removed");

  step(`Discard edits and remove: "${removed}"`);

  // "Check out on" opens it again on the Host the menu lists.
  await openMenu(page);
  await page.getByTestId("checkout-host").first().click();
  step(`Check out on again: "${await chipIn(page, "ready")}"`);
  await page.getByRole("radio", { name: /^Orchestrate/ }).click();
};

/** After githubFlow merged #42 on GitHub: its checkout goes on its own. */
export const afterMerge = async ({
  page,
  step,
  shoot,
}: Pick<CheckoutFlowInput, "page" | "step" | "shoot">) => {
  // Merged, #42 has left the open list: by URL, as anyone would reach it.
  await page.getByRole("radio", { name: /^Review/ }).click();

  const back = page.getByRole("button", { name: "Pull requests" });

  if ((await back.count()) > 0) await back.click();
  await page.getByTestId("review-by-url").click();
  await page.getByTestId("review-by-url-input").fill("https://github.com/acme/widgets/pull/42");
  await page.keyboard.press("Enter");
  await page.getByTestId("pull-review-title").waitFor();

  const merged = await chipIn(page, "removed", 90_000);

  if (!merged.startsWith("Merged")) throw new Error(`expected a merged removal, saw "${merged}"`);
  step(`merging #42 on GitHub removed its checkout: "${merged}"`);
  await shoot("checkout-merged");
  await page.getByRole("radio", { name: /^Orchestrate/ }).click();
};

interface CloneFlowInput extends Pick<CheckoutFlowInput, "page" | "fake" | "step" | "shoot"> {
  /** The local code host's root, which `git@github.com:` resolves to on the smoke Daemon. */
  readonly codeHostRoot: string;
  /** The smoke Daemon's `HOME`, whose git config gets that mapping. */
  readonly userHome: string;
}

/** mona/dotfiles with pull request #7 at the code host; returns #7's head and base. */
const dotfilesAtCodeHost = (root: string) => {
  const bare = join(root, "mona", "dotfiles.git");
  const work = mkdtempSync(join(root, "dotfiles-work-"));

  mkdirSync(bare, { recursive: true });
  git(bare, "init", "-q", "--bare", "-b", "main");
  git(work, "init", "-q", "-b", "main");
  writeFileSync(join(work, ".zshrc"), "export EDITOR=vim\n");
  git(work, "add", ".");
  git(work, "commit", "-qm", "zsh");
  git(work, "push", "-q", bare, "main");

  const base = git(work, "rev-parse", "HEAD");

  writeFileSync(join(work, ".zshrc"), "export EDITOR=vim\nPROMPT='%~ %# '\n");
  git(work, "commit", "-qam", "Add a zsh prompt for worktrees");
  git(work, "push", "-q", bare, "HEAD:refs/pull/7/head");

  return { head: git(work, "rev-parse", "HEAD"), base };
};

/**
 * "Clone on…": mona/dotfiles#7, which no Workspace holds, is cloned into ~/code on the local
 * Host, becomes a Workspace the PR list matches, and is checked out there.
 */
export const cloneFlow = async ({
  page,
  fake,
  codeHostRoot,
  userHome,
  step,
  shoot,
}: CloneFlowInput) => {
  const { head, base } = dotfilesAtCodeHost(codeHostRoot);

  setFakeHead(fake, 7, head, base, "mona/dotfiles");
  writeFileSync(
    join(userHome, ".gitconfig"),
    `[url "${codeHostRoot}/"]\n\tinsteadOf = git@github.com:\n`
  );

  await page.getByRole("radio", { name: /^Review/ }).click();

  const back = page.getByRole("button", { name: "Pull requests" });

  if ((await back.count()) > 0) await back.click();
  await page.getByTestId("review-by-url").click();
  await page.getByTestId("review-by-url-input").fill("https://github.com/mona/dotfiles/pull/7");
  await page.keyboard.press("Enter");

  const none = await chipIn(page, "none");

  step(`a pull request no Workspace holds: "${none}"`);
  await page.getByTestId("checkout-chip-action").click();
  await page.getByTestId("checkout-clone-host").first().waitFor();
  await shoot("checkout-menu-clone");
  await page.getByTestId("checkout-clone-host").first().click();

  // git clone, the new Workspace's remotes reach the PR list, then the checkout opens there.
  for (let i = 0; i < 45; i++) {
    if ((await page.locator('[data-testid="checkout-chip"][data-state="ready"]').count()) > 0)
      break;
    await refresh(page);
    await page.waitForTimeout(2000);
  }

  const ready = await chipIn(page, "ready", 10_000);

  step(`Clone on…: cloned into ~/code/dotfiles, added as a workspace, then "${ready}"`);
  await page.getByRole("radio", { name: /^Orchestrate/ }).click();
};
