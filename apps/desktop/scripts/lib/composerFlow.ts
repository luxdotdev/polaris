/**
 * The composer, on an Idle session against the bench Harness: the `/` menu
 * and its chips, a command Polaris runs itself, undo, IME composition, a
 * draft kept per session, and ⌘↵ queueing a follow-up while Working.
 */
import type { Page } from "playwright-core";

const input = (page: Page) => page.locator('[data-testid="composer-input"]:visible');

const textOf = async (page: Page) => (await input(page).innerText()).replace(/\n$/, "");

const clear = async (page: Page) => {
  await input(page).click();
  await page.keyboard.press("Meta+A");
  await page.keyboard.press("Backspace");
};

const expectText = async (page: Page, want: string, what: string) => {
  const got = await textOf(page);

  if (got !== want) throw new Error(`${what}: the composer reads ${JSON.stringify(got)}`);
};

const menuAndChips = async (page: Page, step: (m: string) => void) => {
  await clear(page);
  await page.keyboard.type("/");
  await page.getByTestId("command-menu").waitFor({ timeout: 10_000 });
  await page.keyboard.type("comp");
  await page.keyboard.press("Enter");
  await input(page).locator(".composer-chip").first().waitFor({ timeout: 2_000 });
  await page.keyboard.type("keep the tests");
  await expectText(page, "compact keep the tests", "after picking /compact");

  if ((await page.getByTestId("command-menu").count()) > 0) throw new Error("the menu stayed open");
  // A chip is atomic: one Backspace after it takes it whole. Keys at a person's pace:
  // the editor follows the caret through selectionchange, which lands after the keydown.

  for (const key of ["Meta+ArrowLeft", "ArrowRight", "Backspace"]) {
    await page.keyboard.press(key);
    await page.waitForTimeout(50);
  }

  if ((await input(page).locator(".composer-chip").count()) !== 0)
    throw new Error(`Backspace after the chip left part of it: ${await textOf(page)}`);
  step("/ menu: filtered, ↵ inserts a chip, Backspace takes it whole");

  await clear(page);
  await page.keyboard.type("/mod");
  await page.keyboard.press("Enter");
  await page.locator('[role="menu"]').waitFor({ timeout: 2_000 });
  await page.keyboard.press("Escape");
  await page.locator('[role="menu"]').waitFor({ state: "detached" });
  await expectText(page, "", "after /model");
  step("/model opens the Model menu and leaves no text");
};

const undoAndIme = async (page: Page, step: (m: string) => void) => {
  await clear(page);
  await page.keyboard.type("abc", { delay: 20 });
  await page.waitForTimeout(500);
  await page.keyboard.type(" def", { delay: 20 });
  await page.keyboard.press("Meta+Z");
  await expectText(page, "abc", "after ⌘Z");
  await page.keyboard.press("Meta+Shift+Z");
  await expectText(page, "abc def", "after ⇧⌘Z");
  step("undo and redo step back by typing bursts");

  const cdp = await page.context().newCDPSession(page);

  await clear(page);
  await cdp.send("Input.imeSetComposition", { text: "にほん", selectionStart: 3, selectionEnd: 3 });
  await cdp.send("Input.insertText", { text: "日本" });
  await page.waitForTimeout(100);
  await expectText(page, "日本", "after an IME composition");
  await cdp.detach();
  step("IME: a composition commits its text");
};

const draftPerSession = async (page: Page, step: (m: string) => void) => {
  await clear(page);
  await page.keyboard.type("A draft for later");
  const title = await page.locator('[data-testid="session-title"]:visible').textContent();
  const workspace = page.locator('[data-slot="chip"][aria-pressed="true"]');
  const name = (await workspace.textContent())?.replace(/\^\d+$/, "").trim() ?? "";

  // To the first workspace and back to this one.
  await page.keyboard.press("Control+1");
  await page
    .locator('[data-testid="session-title"]:visible')
    .filter({ hasText: title ?? "" })
    .waitFor({ state: "detached" });
  await page.locator('[data-slot="chip"]').filter({ hasText: name }).first().click();
  await page
    .locator('[data-testid="session-title"]:visible')
    .filter({ hasText: title ?? "" })
    .waitFor();
  await expectText(page, "A draft for later", "back on the session");
  await clear(page);
  step("the draft stays with its session across a workspace switch");
};

const queueWhileWorking = async (page: Page, step: (m: string) => void) => {
  const FOLLOW_UP = "Then summarise what changed";

  await clear(page);
  await page.keyboard.type(
    `bench:${JSON.stringify({ items: 20, deltasPerItem: 60, deltaBytes: 32, deltaIntervalMs: 10 })}`
  );
  await page.keyboard.press("Enter");
  await page
    .locator('[data-testid="session-state"]:visible')
    .filter({ hasText: /^Working/ })
    .waitFor({ timeout: 15_000 });
  await input(page).click();
  await page.keyboard.type(FOLLOW_UP);
  await page.keyboard.press("Meta+Enter");
  await page
    .locator('[data-testid="outgoing"]:visible')
    .filter({ hasText: FOLLOW_UP })
    .waitFor({ timeout: 2_000 });
  await expectText(page, "", "after ⌘↵");
  step("⌘↵ while Working queues the follow-up and clears the composer");
  await page.keyboard.press("Escape");
  await page.getByTestId("prompt").filter({ hasText: FOLLOW_UP }).first().waitFor({
    timeout: 30_000,
  });
  await page
    .locator('[data-testid="session-state"]:visible')
    .filter({ hasText: /^Idle/ })
    .waitFor({ timeout: 60_000 });
  step("esc stopped the Turn; the queued follow-up ran next");
};

export const composerFlow = async ({
  page,
  step,
}: {
  readonly page: Page;
  readonly step: (m: string) => void;
}) => {
  await menuAndChips(page, step);
  await undoAndIme(page, step);
  await draftPerSession(page, step);
  await queueWhileWorking(page, step);
};
