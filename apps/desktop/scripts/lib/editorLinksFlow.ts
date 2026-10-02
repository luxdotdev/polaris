/**
 * Open in editor, ⌘P, ⌘L and ⌘I in the smoke test, from the open session: a file the bench
 * Turn wrote opens from its transcript row; ⌘P finds README.md; ⌘L adds two lines to the
 * session's composer; ⌘I asks the bench Harness and Accept puts its patch in the buffer.
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Page } from "playwright-core";

interface EditorLinksFlowOptions {
  readonly page: Page;
  /** The session's repository: the bench transcript names files it never writes. */
  readonly repo: string;
  readonly step: (message: string) => void;
  readonly shoot: (name: string) => Promise<void>;
}

const activeTab = (page: Page) => page.locator('[data-testid="editor-tab"][aria-selected="true"]');

const waitForTab = async (page: Page, ending: string) => {
  await page
    .locator(`[data-testid="editor-tab"][aria-selected="true"][title$="${ending}"]`)
    .waitFor({ timeout: 15_000 });
};

/** Selects the first two lines of the active editor. */
const selectTwoLines = async (page: Page) => {
  const code = page.locator('[data-testid="editor-code"]:visible .cm-content').first();

  await code.click();
  await page.keyboard.press("Meta+ArrowUp");
  await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.press("Shift+ArrowDown");
};

const fromTranscript = async (options: EditorLinksFlowOptions): Promise<() => Promise<void>> => {
  const { page, step } = options;
  const row = page.getByTestId("file-change").locator("> div").first();
  const path = ((await row.locator("span.flex-1").first().textContent()) ?? "").trim();
  const onDisk = join(options.repo, path);
  const made = !existsSync(onDisk);

  if (made) {
    mkdirSync(dirname(onDisk), { recursive: true });
    writeFileSync(onDisk, "export const smoke = 1;\n");
  }

  await row.hover();
  await row.getByTestId("open-in-editor").click();

  try {
    await page.getByTestId("editor-pane").waitFor({ timeout: 15_000 });
  } catch (cause) {
    const seen = await page.evaluate(`({
      toasts: [...document.querySelectorAll("[data-sonner-toast]")].map((t) => t.textContent),
      edit: !!document.querySelector('[data-testid="explorer"]'),
      tabs: [...document.querySelectorAll('[data-testid="editor-tab"]')].map((t) => t.title),
      request: window.__polarisOpenRequests?.last(),
    })`);

    step(`editor: open from ${path} failed: ${JSON.stringify(seen)}`);
    throw cause;
  }

  await waitForTab(page, path.split("/").at(-1) ?? path);
  step(`editor: ${path} opened from its transcript row`);

  // Closes its tab first: a file deleted under an open tab stays as unsaved, and quitting asks.
  return async () => {
    if (!made) return;
    await page.keyboard.press("Meta+3");
    await page.locator(`[data-testid="editor-tab"][title$="${path}"]`).click({ button: "middle" });
    await page
      .locator(`[data-testid="editor-tab"][title$="${path}"]`)
      .waitFor({ state: "detached", timeout: 5_000 });
    rmSync(onDisk);
    await page.keyboard.press("Meta+1");
  };
};

const findFile = async (options: EditorLinksFlowOptions) => {
  const { page, step } = options;

  await page.keyboard.press("Meta+P");
  await page.getByTestId("finder-input").fill("README");
  await page.getByTestId("finder-item").first().waitFor({ timeout: 15_000 });
  await page.keyboard.press("Enter");
  await waitForTab(page, "README.md");
  const opened = await activeTab(page).getAttribute("title");

  // The search reports real paths (/private/var/…); the tab keeps the Workspace's spelling.
  if (opened !== join(options.repo, "README.md"))
    throw new Error(`⌘P opened ${opened}, not ${join(options.repo, "README.md")}`);
  step("editor: ⌘P found README.md and opened it, spelled as the Workspace spells it");
};

const findInWorkspace = async ({ page, step, shoot }: EditorLinksFlowOptions) => {
  await page.keyboard.press("Meta+Shift+F");
  await page.getByTestId("search-input").fill("# smoke");
  await page.getByTestId("search-match").first().waitFor({ timeout: 15_000 });
  const count = ((await page.getByTestId("search-count").textContent()) ?? "").trim();

  await shoot("editor-search");
  await page.keyboard.press("Enter");
  await waitForTab(page, "README.md");
  step(`editor: ⌘⇧F found "# smoke" (${count}) and opened the match`);
};

const addToSession = async ({ page, step }: EditorLinksFlowOptions) => {
  await selectTwoLines(page);
  await page.getByTestId("selection-bar").waitFor({ timeout: 10_000 });
  await page.keyboard.press("Meta+L");
  await page.getByTestId("add-target").first().waitFor({ timeout: 10_000 });
  await page.keyboard.press("Enter");
  await page.getByTestId("add-target").waitFor({ state: "detached", timeout: 10_000 });
  await page.keyboard.press("Meta+1");
  const composer = page.getByTestId("composer-input");

  await composer.waitFor({ timeout: 10_000 });
  // Locators, not waitForFunction: the app's CSP forbids evaluating strings.
  await page
    .getByTestId("composer-input")
    .filter({ hasText: "README.md" })
    .waitFor({ timeout: 10_000 });
  step("editor: ⌘L put README.md's lines in the session's composer");
  await composer.click();
  await page.keyboard.press("Meta+A");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Meta+3");
  await page.getByTestId("editor-pane").waitFor({ timeout: 10_000 });
};

const inlineEdit = async ({ page, step, shoot }: EditorLinksFlowOptions) => {
  await selectTwoLines(page);
  await page.keyboard.press("Meta+I");
  const card = page.getByTestId("inline-card");

  await card.waitFor({ timeout: 10_000 });

  if ((await card.getByTestId("inline-notice").count()) > 0) {
    step("editor: ⌘I opened the card; the Daemon has no inline.propose yet, accept skipped");
    await page.keyboard.press("Escape");

    return;
  }

  await page.getByTestId("inline-prompt").fill("Add a heading note");
  await page.keyboard.press("Enter");
  await page.getByTestId("inline-accept").waitFor({ timeout: 30_000 });
  const thought = ((await page.getByTestId("inline-thought").textContent()) ?? "").trim();

  await shoot("editor-inline-proposed");
  await page.keyboard.press("Meta+Enter");
  await card.waitFor({ state: "detached", timeout: 10_000 });
  await page
    .locator('[data-testid="editor-code"] .cm-content')
    .filter({ hasText: "Inline bench proposal" })
    .first()
    .waitFor({ timeout: 10_000 });
  await activeTab(page).and(page.locator("[data-dirty]")).waitFor({ timeout: 5_000 });
  step(
    `editor: ⌘I on the bench Harness proposed a patch (${thought}); Accept put it in the buffer, unsaved`
  );
  await page.keyboard.press("Meta+Z");
  await page
    .locator('[data-testid="editor-tab"][data-dirty]')
    .waitFor({ state: "detached", timeout: 5_000 });
  step("editor: ⌘Z undid it; no unsaved files left");
};

export const editorLinksFlow = async (options: EditorLinksFlowOptions) => {
  const cleanUp = await fromTranscript(options);

  try {
    await findFile(options);
    await findInWorkspace(options);
    await addToSession(options);
    await inlineEdit(options);
    await options.page.keyboard.press("Meta+1");
  } finally {
    await cleanUp();
  }
};
