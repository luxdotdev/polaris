/**
 * Settings in the smoke test: Polaris → Settings… (⌘,) opens it over the
 * session, the theme and density change live and are saved, Harnesses and
 * Usage render, and esc returns to the session.
 */
import type { ElectronApplication, Page } from "playwright-core";

interface SettingsFlowInput {
  readonly app: ElectronApplication;
  readonly page: Page;
  readonly step: (message: string) => void;
  readonly shoot: (name: string) => Promise<void>;
}

const attached = (page: Page, selector: string) =>
  page.locator(selector).waitFor({ state: "attached", timeout: 5_000 });

export const settingsFlow = async ({ app, page, step, shoot }: SettingsFlowInput) => {
  await app.evaluate(({ Menu }) => {
    Menu.getApplicationMenu()?.getMenuItemById("settings")?.click();
  });
  await page.getByTestId("settings").waitFor({ timeout: 5_000 });
  step("⌘, opened Settings");

  await page.getByRole("radio", { name: /Dawn/ }).click();
  await attached(page, 'html[data-theme="light"]');
  await page.getByRole("radio", { name: /Night/ }).click();
  await attached(page, 'html[data-theme="dark"]');
  await page.getByRole("slider", { name: "Density" }).press("ArrowRight");
  await attached(page, 'html[data-density="balanced"]');
  await page.getByRole("switch").first().click();
  await attached(page, 'html[data-diff-palette="cvd"]');

  // SAFETY: settings.get returns SettingsView (src/shared/api.ts).
  const saved = (await page.evaluate(
    'window.polaris.request("settings.get", {}).then((r) => r.value)'
  )) as { theme: string; density: string; diffPalette: string };

  if (saved.theme !== "dark" || saved.density !== "balanced" || saved.diffPalette !== "cvd") {
    throw new Error(`settings not saved: ${JSON.stringify(saved)}`);
  }

  step("theme, density and diff palette changed live and saved");
  await shoot("settings-appearance");

  await page.getByRole("slider", { name: "Density" }).press("ArrowLeft");
  await attached(page, 'html[data-density="calm"]');
  await page.getByRole("switch").first().click();
  await attached(page, "html:not([data-diff-palette])");

  await page.getByRole("button", { name: "Harnesses" }).click();
  await page.getByTestId("harness-group").first().waitFor({ timeout: 5_000 });
  step(`Harnesses: ${await page.getByTestId("harness-group").count()} groups`);
  await shoot("settings-harnesses");

  await page.getByRole("button", { name: "Usage" }).click();
  await page.locator('[data-section="usage"]').waitFor({ timeout: 5_000 });
  await shoot("settings-usage");

  await page.keyboard.press("Escape");
  await page.getByTestId("settings").waitFor({ state: "detached", timeout: 5_000 });
  await page.getByTestId("session-panel").waitFor({ timeout: 5_000 });
  step("esc returned to the session");
};
