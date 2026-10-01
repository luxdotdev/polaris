/**
 * Sent images in the smoke test: paste a 320×200 PNG into an idle session,
 * send it, and see its thumbnail above the message in a box reserved from
 * the size the Host recorded; after a relaunch it is still there.
 */
import type { Page } from "playwright-core";

/** A 320×200 PNG drawn in the page, pasted the way the clipboard hands images over. */
const PASTE_SCREENSHOT = `(async () => {
  const canvas = new OffscreenCanvas(320, 200);
  const g = canvas.getContext("2d");
  g.fillStyle = "#4a5a80";
  g.fillRect(0, 0, 320, 200);
  const blob = await canvas.convertToBlob({ type: "image/png" });
  const data = new DataTransfer();
  data.items.add(new File([blob], "screen.png", { type: "image/png" }));
  const input = document.querySelector('[data-testid="composer-input"]');
  input.focus();
  input.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
})()`;

const SENT = '[data-testid="prompt"] [data-testid="sent-image"]';

/** The thumbnail is ready and sits in the 240×150 box its stored 320×200 reserves. */
const readyInItsBox = async (page: Page) => {
  const image = page.locator(`${SENT}[data-state="ready"]`).last();

  await image.waitFor({ timeout: 15_000 });
  const box = await image.boundingBox();

  if (box === null || Math.round(box.width) !== 240 || Math.round(box.height) !== 150)
    throw new Error(`the thumbnail's box is ${JSON.stringify(box)}, not 240×150`);
};

export const sendImage = async (page: Page, step: (m: string) => void) => {
  await page.evaluate(PASTE_SCREENSHOT);
  await page
    .getByTestId("attachments")
    .getByRole("button", { name: "Remove screen.png" })
    .waitFor({ timeout: 10_000 });
  await page.getByTestId("composer-input").fill(`bench:${JSON.stringify({ items: 1 })}`);
  await page.getByRole("button", { name: "Send" }).click();
  await readyInItsBox(page);
  await page.getByTestId("session-state").filter({ hasText: /^Idle/ }).waitFor({ timeout: 30_000 });
  step("pasted image sent: its thumbnail shows above the message, in its reserved box");
};

export const imageAfterRelaunch = async (page: Page, step: (m: string) => void) => {
  await readyInItsBox(page);
  await page.locator(SENT).last().click();
  await page.getByTestId("attachment-viewer").locator("img").waitFor({ timeout: 10_000 });
  await page.keyboard.press("Escape");
  await page.getByTestId("attachment-viewer").waitFor({ state: "detached" });
  step("after a relaunch the thumbnail is still there; it opens larger and esc closes it");
};
