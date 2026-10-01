/**
 * The shell's Constellation parts in the smoke test (C1-U2): Settings → Constellations saves a
 * role's worker default and resets it, and a Constellation request crosses the IPC bridge to
 * the Daemon and back (refused while no Constellation exists, with its code).
 */
import type { Page } from "playwright-core";

interface FlowInput {
  readonly page: Page;
  readonly step: (message: string) => void;
  readonly shoot: (name: string) => Promise<void>;
}

interface Role {
  readonly harness: string;
  readonly model: string | null;
}

const savedUi = (page: Page) =>
  page.evaluate<Role>(
    'window.polaris.request("settings.get", {}).then((r) => r.value.sessions.constellationDefaults.ui)'
  );

const defaultsPage = async ({ page, step, shoot }: FlowInput) => {
  await page.getByRole("button", { name: "Constellations" }).click();
  await page.getByTestId("constellation-defaults").waitFor({ timeout: 5_000 });

  const before = await savedUi(page);

  if (before.harness !== "claude")
    throw new Error(`UI workers don't default to Claude Code: ${JSON.stringify(before)}`);

  await page.getByRole("combobox", { name: "Harness" }).nth(1).click();
  await page.getByRole("option", { name: "Codex" }).click();
  await page.waitForTimeout(300);

  const changed = await savedUi(page);

  if (changed.harness !== "codex")
    throw new Error(`UI default not saved: ${JSON.stringify(changed)}`);
  await shoot("settings-constellations");
  await page.getByRole("button", { name: "Reset" }).click();
  await page.waitForTimeout(300);

  const reset = await savedUi(page);

  if (reset.harness !== "claude" || reset.model !== before.model)
    throw new Error(`Reset didn't restore the UI default: ${JSON.stringify(reset)}`);
  step("Constellations: the UI workers' default saved as Codex, then reset to Claude Code");
};

const bridge = async ({ page, step }: FlowInput) => {
  const result = await page.evaluate<{ ok: boolean; error?: { code: string } }>(
    'window.polaris.request("constellation.status", { hostKey: "local", constellationId: "smoke-none" })'
  );

  if (result.ok || result.error === undefined)
    throw new Error(`constellation.status answered for a Constellation that doesn't exist`);
  step(`constellation.status crossed the bridge and was refused (${result.error.code})`);
};

/** Runs inside Settings; leaves it open where it found it. */
export const constellationShellFlow = async (input: FlowInput) => {
  await defaultsPage(input);
  await bridge(input);
};
