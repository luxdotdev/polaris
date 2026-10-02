/**
 * Edit mode in the smoke test, on the open session's Workspace: ⌘3 shows the
 * explorer with the repository's files and the status bar's branch, Changes
 * lists what the bench Turn wrote, and, where the Daemon has `files.manage`,
 * a file is created, renamed and deleted from the tree. ⌘1 goes back.
 */
import type { Page } from "playwright-core";

interface ExplorerFlowOptions {
  readonly page: Page;
  readonly step: (message: string) => void;
  readonly shoot: (name: string) => Promise<void>;
}

const row = (page: Page, name: string) =>
  page.getByTestId("tree-row").filter({ has: page.getByText(name, { exact: true }) });

const manage = async ({ page, step }: ExplorerFlowOptions) => {
  await page.getByTestId("explorer-new").click();
  await page.getByRole("menuitem", { name: "New file" }).click();
  await page.getByTestId("tree-draft").locator("input").fill("smoke-explorer.txt");
  await page.keyboard.press("Enter");
  await row(page, "smoke-explorer.txt").waitFor({ timeout: 10_000 });
  step("explorer: created smoke-explorer.txt");

  await row(page, "smoke-explorer.txt").click();
  await page.keyboard.press("F2");
  await page.getByTestId("tree-draft").locator("input").fill("smoke-renamed.txt");
  await page.keyboard.press("Enter");
  await row(page, "smoke-renamed.txt").waitFor({ timeout: 10_000 });
  step("explorer: renamed it to smoke-renamed.txt");

  await row(page, "smoke-renamed.txt").click();
  await page.keyboard.press("Meta+Backspace");

  // A Host without a trash asks first; this Mac has one, but a CI runner may not.
  const confirm = page.getByTestId("confirm-delete");

  if (await confirm.isVisible({ timeout: 1500 }).catch(() => false)) {
    await confirm.getByRole("button", { name: "Delete" }).click();
  }

  await row(page, "smoke-renamed.txt").waitFor({ state: "detached", timeout: 10_000 });
  step("explorer: deleted it");
};

export const explorerFlow = async (options: ExplorerFlowOptions) => {
  const { page, step, shoot } = options;

  await page.keyboard.press("Meta+3");
  await page.getByTestId("explorer").waitFor({ timeout: 10_000 });
  await page.getByTestId("tree-row").first().waitFor({ timeout: 10_000 });
  const rows = await page.getByTestId("tree-row").count();
  const branch = (await page.getByTestId("status-branch").textContent({ timeout: 10_000 })) ?? "";

  step(`explorer: ${rows} rows, status bar on ${branch.trim()}`);
  await shoot("edit-explorer");

  await page.getByRole("radio", { name: /Changes/ }).click();
  const changes = await page.getByTestId("change-row").count();

  step(`explorer: Changes lists ${changes} file(s)`);
  await page.getByRole("radio", { name: /Files/ }).click();

  if (await page.getByTestId("explorer-new").isEnabled()) await manage(options);
  else step("explorer: the Daemon has no files.manage yet; create, rename and delete skipped");

  await page.keyboard.press("Meta+1");
};
