/**
 * The terminal in the smoke test, on the open session's Workspace: open the
 * drawer (⌃`), echo a round trip through the Daemon's PTY, hand the session
 * off to its terminal UI (the bench Harness runs `sh`) and take it back, and
 * paste an image into the composer so it is staged on the Host.
 */
import type { Page } from "playwright-core";

const text = (page: Page, terminalId: string) =>
  page.evaluate<string | null>(
    `window.__polarisTerminal?.text(${JSON.stringify(terminalId)}) ?? null`
  );

const waitForText = async (page: Page, terminalId: string, needle: string, ms = 10_000) => {
  const deadline = Date.now() + ms;

  while (Date.now() < deadline) {
    if ((await text(page, terminalId))?.includes(needle) === true) return;
    await page.waitForTimeout(100);
  }

  throw new Error(
    `terminal ${terminalId} never showed "${needle}":\n${await text(page, terminalId)}`
  );
};

const activeTerminal = async (page: Page) => {
  const surface = page.getByTestId("terminal-surface");

  await surface.waitFor({ timeout: 10_000 });
  const id = await surface.getAttribute("data-terminal-id");

  if (id === null) throw new Error("the terminal surface has no terminal id");

  return id;
};

/** A 1×1 PNG, pasted as a file the way the clipboard hands images over. */
const PASTE_IMAGE = `(() => {
  const bytes = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="), (c) => c.charCodeAt(0));
  const data = new DataTransfer();
  data.items.add(new File([bytes], "", { type: "image/png" }));
  const input = document.querySelector('[data-testid="composer-input"]');
  input.focus();
  input.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
})()`;

export const terminalFlow = async ({
  page,
  step,
  shoot,
}: {
  readonly page: Page;
  readonly step: (message: string) => void;
  readonly shoot: (name: string) => Promise<void>;
}) => {
  await page.keyboard.press("Control+Backquote");
  const shell = await activeTerminal(page);

  step(`terminal ${shell} open`);
  await page.waitForTimeout(500);
  await page.keyboard.type("echo polaris-$((6 * 7))\n");
  await waitForText(page, shell, "polaris-42");
  step("terminal echo round trip");
  await shoot("terminal");

  await page.getByTestId("session-menu").click();
  await page.getByTestId("open-in-terminal").click();
  await page.getByTestId("in-terminal").waitFor({ timeout: 15_000 });
  const handoff = await activeTerminal(page);

  if (handoff === shell) throw new Error("the hand-off did not open its own terminal");
  step(`session handed off to terminal ${handoff}`);
  await page.keyboard.type("echo handed-$((1 + 1))\n");
  await waitForText(page, handoff, "handed-2");
  await shoot("in-terminal");

  await page.getByTestId("take-back").click();
  await page.getByTestId("in-terminal").waitFor({ state: "detached", timeout: 15_000 });
  step("session taken back");

  await page.keyboard.press("Control+Backquote");
  await page.getByTestId("terminal-drawer").waitFor({ state: "detached" });

  await page.evaluate(PASTE_IMAGE);
  await page
    .getByTestId("attachments")
    .getByRole("button", { name: /^Remove pasted/ })
    .waitFor({ timeout: 10_000 });
  step("pasted image staged on the Host");
};
