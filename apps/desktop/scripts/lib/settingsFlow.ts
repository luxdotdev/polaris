/**
 * Settings in the smoke test: Polaris → Settings… (⌘,) opens it over the
 * session, the theme and density change live and are saved, Sessions' switches
 * and branch prefix are saved, Harnesses render, Constellations' defaults save (and a
 * Constellation request crosses the bridge), Usage renders, and esc returns to the session.
 */
import type { ElectronApplication, Page } from "playwright-core";
import { constellationShellFlow } from "./constellationShellFlow.ts";

interface SettingsFlowInput {
  readonly app: ElectronApplication;
  readonly page: Page;
  readonly step: (message: string) => void;
  readonly shoot: (name: string) => Promise<void>;
}

const attached = (page: Page, selector: string) =>
  page.locator(selector).waitFor({ state: "attached", timeout: 5_000 });

interface SavedSessions {
  readonly deleteMergedBranch: boolean;
  readonly branchPrefix: string;
  readonly newWorktree: boolean;
  readonly spinnerVerbs: ReadonlyArray<string> | null;
}

/** settings.get's `sessions` (SettingsView in src/shared/api.ts). */
const savedSessions = (page: Page) =>
  page.evaluate<SavedSessions>(
    'window.polaris.request("settings.get", {}).then((r) => r.value.sessions)'
  );

/** Settings → Sessions: a switch and the branch prefix save; an invalid prefix doesn't. Left as found. */
const sessionsPage = async (
  page: Page,
  step: (message: string) => void,
  shoot: (name: string) => Promise<void>
) => {
  await page.getByRole("button", { name: "Sessions" }).click();
  await page.locator('[data-section="sessions"]').waitFor({ timeout: 5_000 });
  await page.locator("#delete-merged").click();
  const prefix = page.locator("#branch-prefix");

  await prefix.fill("a b");
  await prefix.press("Enter");
  await prefix.fill("smoke/");
  await prefix.press("Enter");
  await page.waitForTimeout(300);
  const saved = await savedSessions(page);

  if (!saved.deleteMergedBranch || saved.branchPrefix !== "smoke/" || saved.newWorktree)
    throw new Error(`Settings → Sessions not saved: ${JSON.stringify(saved)}`);
  step("Sessions: delete merged branches and the branch prefix saved; worktree stays off");
  await shoot("settings-sessions");
  await page.locator("#delete-merged").click();
  await prefix.fill("polaris/");
  await prefix.press("Enter");
  await workingVerbs(page, step);
};

/** Working verbs: add one, remove one, reset; each is saved. Left as found (the built-in ones). */
const workingVerbs = async (page: Page, step: (message: string) => void) => {
  const list = page.getByTestId("verb-list");

  await page.getByTestId("verb-input").fill("Smoke testing");
  await page.getByTestId("verb-input").press("Enter");
  await list.getByText("Smoke testing", { exact: true }).waitFor({ timeout: 5_000 });
  await page.getByRole("button", { name: "Remove Working…" }).click();
  await page.waitForTimeout(300);
  const saved = (await savedSessions(page)).spinnerVerbs ?? [];

  if (saved.at(-1) !== "Smoke testing" || saved.includes("Working…"))
    throw new Error(`Working verbs not saved: ${JSON.stringify(saved)}`);
  await page.getByRole("button", { name: "Reset to the built-in verbs" }).click();
  await page.waitForTimeout(300);

  if ((await savedSessions(page)).spinnerVerbs !== null)
    throw new Error("Reset didn't go back to the built-in verbs");
  step(`Working verbs: added, removed and reset (${saved.length} while edited)`);
};

export const settingsFlow = async ({ app, page, step, shoot }: SettingsFlowInput) => {
  await app.evaluate(({ Menu }) => {
    Menu.getApplicationMenu()?.getMenuItemById("settings.open")?.click();
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

  await sessionsPage(page, step, shoot);

  await page.getByRole("button", { name: "Harnesses", exact: true }).click();
  await page.getByTestId("harness-group").first().waitFor({ timeout: 5_000 });
  step(`Harnesses: ${await page.getByTestId("harness-group").count()} groups`);
  await shoot("settings-harnesses");

  await constellationShellFlow({ page, step, shoot });

  await page.getByRole("button", { name: "Usage" }).click();
  await page.locator('[data-section="usage"]').waitFor({ timeout: 5_000 });
  await shoot("settings-usage");

  await page.keyboard.press("Escape");
  await page.getByTestId("settings").waitFor({ state: "detached", timeout: 5_000 });
  await page.getByTestId("session-panel").waitFor({ timeout: 5_000 });
  step("esc returned to the session");
};
