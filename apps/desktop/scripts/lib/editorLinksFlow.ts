/**
 * Open in editor, ⌘P, ⌘L and ⌘I in the smoke test, from the open session: a file the bench
 * Turn wrote opens from its transcript row; ⌘P finds README.md; ⌘L adds two lines to the
 * session's composer; ⌘I asks the bench Harness and Accept puts its patch in the buffer.
 */
import type { Page } from "playwright-core";

interface EditorLinksFlowOptions {
  readonly page: Page;
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

const fromTranscript = async ({ page, step }: EditorLinksFlowOptions) => {
  const row = page.getByTestId("file-change").locator("> div").first();
  const path = ((await row.locator("span.flex-1").first().textContent()) ?? "").trim();

  await row.hover();
  await row.getByTestId("open-in-editor").click();

  try {
    await page.getByTestId("editor-pane").waitFor({ timeout: 15_000 });
  } catch (cause) {
    const seen = await page.evaluate(`({
      toasts: [...document.querySelectorAll("[data-sonner-toast]")].map((t) => t.textContent),
      edit: !!document.querySelector('[data-testid="explorer"]'),
      tabs: [...document.querySelectorAll('[data-testid="editor-tab"]')].map((t) => t.title),
    })`);

    step(`editor: open from ${path} failed: ${JSON.stringify(seen)}`);
    throw cause;
  }

  await waitForTab(page, path.split("/").at(-1) ?? path);
  step(`editor: ${path} opened from its transcript row`);
};

const findFile = async ({ page, step }: EditorLinksFlowOptions) => {
  await page.keyboard.press("Meta+P");
  await page.getByTestId("finder-input").fill("README");
  await page.getByTestId("finder-item").first().waitFor({ timeout: 15_000 });
  await page.keyboard.press("Enter");
  await waitForTab(page, "README.md");
  step("editor: ⌘P found README.md and opened it");
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
  await page.waitForFunction(
    `document.querySelector('[data-testid="composer-input"]')?.textContent?.includes("README.md")`,
    undefined,
    { timeout: 10_000 }
  );
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
  await page.waitForFunction(
    `[...document.querySelectorAll('[data-testid="editor-code"] .cm-content')].some((c) => c.textContent.includes("Inline bench proposal"))`,
    undefined,
    { timeout: 10_000 }
  );
  await activeTab(page).and(page.locator("[data-dirty]")).waitFor({ timeout: 5_000 });
  step(
    `editor: ⌘I on the bench Harness proposed a patch (${thought}); Accept put it in the buffer, unsaved`
  );
  await page.keyboard.press("Meta+Z");
};

export const editorLinksFlow = async (options: EditorLinksFlowOptions) => {
  await fromTranscript(options);
  await findFile(options);
  await addToSession(options);
  await inlineEdit(options);
  await options.page.keyboard.press("Meta+1");
};
