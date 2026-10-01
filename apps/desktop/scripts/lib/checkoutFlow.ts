/**
 * The Review Checkout chip in the smoke test, on #42's checkout from the local code host:
 * new commits on GitHub reach the Host and the chip offers Update; Update moves the worktree;
 * the menu opens a terminal in it; removing it with edits inside is blocked until the edits
 * are discarded; "Check out on" opens it again; and (`afterMerge`) merging #42 on GitHub
 * removes it on its own.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
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
 * Points the fake's pull request at real commits, as GitHub would report them. Only a push
 * (`base` absent) moves `updatedAt`: a fresh one would read as a new review request.
 */
export const setFakeHead = (fake: GitHubFake, number: number, head: string, base?: string) => {
  const pull = fake.world.pulls.find((p) => p.repo === "acme/widgets" && p.number === number);

  if (pull === undefined) throw new Error(`the fake has no acme/widgets#${number}`);
  pull.headRefOid = head;

  if (base === undefined) pull.updatedAt = new Date().toISOString();
  else pull.baseRefOid = base;
};

/** Another commit on #42 at the code host; returns its id. */
const pushCommit = (work: string, bare: string) => {
  writeFileSync(join(work, "src/webhooks/backoff.ts"), "export const backoff = async () => {};\n");
  git(work, "commit", "-qam", "Simplify backoff");
  git(work, "push", "-q", bare, "HEAD:refs/pull/42/head");

  return git(work, "rev-parse", "HEAD");
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
  const queued = page.getByTestId("review-queue-row").filter({ hasText: "#42" }).first();

  await row.or(queued).first().click();
  await page.getByTestId("pull-review-title").waitFor();
};

/** The chip once it reads `text` (a blocker replaces another without leaving `blocked`). */
const chipWith = async (page: Page, text: string, timeout = 60_000) => {
  await page.getByTestId("checkout-chip").filter({ hasText: text }).waitFor({ timeout });

  return (await chip(page).textContent()) ?? "";
};

const removeFromMenu = async (page: Page) => {
  await openMenu(page);
  await page.getByTestId("checkout-remove").click();
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

  // New commits: the code host has them, GitHub reports them, the publisher relays the head.
  const next = pushCommit(codeHost.work, codeHost.bare);

  setFakeHead(fake, 42, next);
  await refresh(page);

  const stale = await chipIn(page, "new-commits", 90_000);

  step(`new commits on GitHub reached the Host: "${stale}"`);
  await openMenu(page);
  await shoot("checkout-menu-new-commits");
  await page.getByTestId("checkout-update").click();

  const updated = await chipIn(page, "ready");

  if (!updated.includes(next.slice(0, 7)))
    throw new Error(`Update didn't reach ${next}: ${updated}`);
  step(`Update checkout: "${updated}"`);

  // A terminal in the checkout, in Orchestrate on its Workspace.
  await openMenu(page);

  const path = (await page.getByTestId("checkout-path").getAttribute("title")) ?? "";

  await page.getByTestId("checkout-terminal").click();
  await page.getByTestId("terminal-tab").filter({ hasText: "#42 checkout" }).waitFor();
  step(`"Open a terminal in the checkout": a tab in ${path}`);

  // The open terminal blocks removal; its fix shows it, and closing it lets removal go on.
  writeFileSync(join(path, "src/webhooks/deliver.ts"), "// edited during review\n");
  await openPull(page);
  await removeFromMenu(page);

  const inUse = await chipWith(page, "A terminal is open");

  step(`Remove checkout with a terminal open in it: "${inUse}"`);
  await page.getByTestId("checkout-chip-action").click();
  await page.getByRole("button", { name: "Close #42 checkout" }).click();
  step('"Show terminal" showed its tab; closed it');

  // Then the edit blocks it; discarding (after asking) lets removal go ahead.
  await openPull(page);
  await removeFromMenu(page);

  const blocked = await chipWith(page, "Edits in the checkout");

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
