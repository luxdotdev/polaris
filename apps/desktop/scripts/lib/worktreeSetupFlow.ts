import type { Page } from "playwright-core";

/** Settings changes cross the real Host feed; remounting reads back the Workspace setting. */
export const worktreeSetupFlow = async (
  page: Page,
  step: (message: string) => void,
  shoot: (name: string) => Promise<void>
) => {
  const picker = page.getByRole("combobox", { name: /^Worktree setup for / }).first();
  await picker.waitFor({ timeout: 5_000 });
  await picker.click();
  await page.getByRole("option", { name: "Custom command", exact: true }).click();
  await page
    .getByRole("textbox", { name: /^Setup command for / })
    .first()
    .fill("printf smoke-setup");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Usage", exact: true }).click();
  await page.getByRole("button", { name: "Sessions", exact: true }).click();
  await page.waitForFunction(
    'document.querySelector(\'input[aria-label^="Setup command for "]\')?.value === "printf smoke-setup"',
    undefined,
    { timeout: 5_000 }
  );

  for (const density of ["calm", "balanced", "compact"] as const) {
    await page.evaluate(
      `window.polaris.request("settings.setDensity", { density: ${JSON.stringify(density)} })`
    );
    await page.locator(`html[data-density="${density}"]`).waitFor();
    await shoot(`worktree-setup-${density}`);
  }

  await picker.click();
  await page.getByRole("option", { name: "None", exact: true }).click();
  await picker.click();
  await page.getByRole("option", { name: "Detect from lockfile", exact: true }).click();
  await page.evaluate('window.polaris.request("settings.setTheme", { theme: "dark" })');
  await page.evaluate('window.polaris.request("settings.setDensity", { density: "calm" })');
  step(
    "Workspace setup: custom command saved through the Host feed, both themes/all densities rendered, then detection restored"
  );
};
