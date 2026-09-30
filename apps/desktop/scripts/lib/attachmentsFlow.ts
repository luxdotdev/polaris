/**
 * Settings → Attachments in the smoke test, after the terminal flow has
 * staged a pasted image and an ⌥-dropped file: the page shows what the local
 * Host holds, the default policy changes and is saved on the Host, and
 * "Clear now" (two steps) empties the staging directory.
 */
import type { ElectronApplication, Page } from "playwright-core";

interface AttachmentsFlowInput {
  readonly app: ElectronApplication;
  readonly page: Page;
  readonly step: (message: string) => void;
  readonly shoot: (name: string) => Promise<void>;
}

const DEFAULT_POLICY = `window.polaris.request("attachments.settings", { hostKey: "local" }).then((r) => JSON.stringify(r.ok ? r.value.settings.default : r.error))`;

export const attachmentsFlow = async ({ app, page, step, shoot }: AttachmentsFlowInput) => {
  await app.evaluate(({ Menu }) => {
    Menu.getApplicationMenu()?.getMenuItemById("settings.open")?.click();
  });
  await page.getByRole("button", { name: "Attachments" }).click();

  const local = page.locator('[data-testid="attachments-host"][data-host="local"]');
  const total = local.getByTestId("staged-total");

  await total.filter({ hasText: / in \d+ files? staged/ }).waitFor({ timeout: 10_000 });
  step(`Settings → Attachments: ${(await total.textContent()) ?? ""}`);
  await shoot("settings-attachments");

  await local.getByTestId("cleanup-default-local").click();
  await page.getByRole("option", { name: "After 7 days" }).click();

  const saved = await page.evaluate<string>(DEFAULT_POLICY);

  if (saved !== JSON.stringify({ kind: "after-days", days: 7 }))
    throw new Error(`the default policy wasn't saved on the host: ${saved}`);
  step("default cleanup policy saved on the host");

  await local.getByTestId("clear-attachments").click();
  await local.getByTestId("confirm-clear").click();
  await total.filter({ hasText: "Nothing staged" }).waitFor({ timeout: 10_000 });
  step("Clear now emptied the host's staging");

  await page.keyboard.press("Escape");
  await page.getByTestId("settings").waitFor({ state: "detached", timeout: 5_000 });
};
