/**
 * The terminal in the smoke test, on the open session's Workspace: open the
 * drawer (⌃`), echo a round trip through the Daemon's PTY, hand the session
 * off to its terminal UI (the bench Harness runs `sh`) and take it back, and
 * paste an image into the composer so it is staged on the Host, and ⌥-drop a
 * file so it is copied into the Workspace.
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

/** The id of the terminal that has keyboard focus (xterm's helper textarea), or null. */
const FOCUSED = `document.activeElement?.closest("[data-terminal-id]")?.getAttribute("data-terminal-id") ?? null`;

/** Longer than the session menu's 160 ms close, after which Radix would restore focus. */
const FOCUS_HOLD_MS = 300;

/**
 * Waits until a terminal other than `except` is shown and has focus, and
 * still has it after a menu could have taken it back; typing is safe then.
 */
const focusedTerminal = async (page: Page, except: string | null = null) => {
  const deadline = Date.now() + 15_000;
  let id: string | null = null;

  // Polled with evaluate: the app's CSP forbids the eval behind waitForFunction(string).
  while (id === null || id === except) {
    if (Date.now() > deadline)
      throw new Error(`no terminal other than ${String(except)} took focus`);
    await page.waitForTimeout(50);
    id = await page.evaluate<string | null>(FOCUSED);
  }

  await page.waitForTimeout(FOCUS_HOLD_MS);

  const still = await page.evaluate<string | null>(FOCUSED);

  if (still !== id) throw new Error(`terminal ${id} lost focus to ${String(still)}`);

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

/** ⌥-drop a text file on the composer: it is copied into the session's directory on the Host. */
const ALT_DROP = `(() => {
  const data = new DataTransfer();
  data.items.add(new File(["hello from the smoke test\\n"], "smoke-note.txt", { type: "text/plain" }));
  const input = document.querySelector('[data-testid="composer-input"]');
  for (const type of ["dragenter", "dragover", "drop"])
    input.dispatchEvent(new DragEvent(type, { dataTransfer: data, altKey: true, bubbles: true, cancelable: true }));
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
  const shell = await focusedTerminal(page);

  step(`terminal ${shell} open`);
  await page.keyboard.type("echo polaris-$((6 * 7))\n");
  await waitForText(page, shell, "polaris-42");
  step("terminal echo round trip");
  await shoot("terminal");

  await page.getByTestId("session-menu").click();
  await page.getByTestId("open-in-terminal").click();
  await page.getByTestId("in-terminal").waitFor({ timeout: 15_000 });
  const handoff = await focusedTerminal(page, shell);

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
    .getByRole("button", { name: "Remove pasted-1.png" })
    .waitFor({ timeout: 10_000 });
  step("pasted image staged on the Host");

  await page.evaluate(ALT_DROP);
  await page.getByText("Copied smoke-note.txt").waitFor({ timeout: 10_000 });
  step("⌥-dropped file copied into the workspace");
};
