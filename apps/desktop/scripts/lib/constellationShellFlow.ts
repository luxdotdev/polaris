/**
 * The shell's Constellation parts in the smoke test (C1-U2): Settings → Constellations saves a
 * role's worker default and resets it, and a Constellation request crosses the IPC bridge to
 * the Daemon and back (refused while no Constellation exists, with its code); Settings → Hosts
 * declares, caps and removes through the real Daemon, and the page follows the Host feed.
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

/** The local Host's copy of the UI role's default (`constellation.defaults.get`), once it is `harness`. */
const hostUiBecomes = (page: Page, harness: string) =>
  page.waitForFunction(
    `window.polaris.request("constellation.defaults.get", { hostKey: "local" }).then((r) => r.ok && r.value.settings.ui?.harness === ${JSON.stringify(harness)})`,
    undefined,
    { timeout: 10_000, polling: 250 }
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
  await hostUiBecomes(page, "codex");
  await page
    .getByTestId("defaults-sync")
    .filter({ hasText: /^Saved on / })
    .waitFor({ timeout: 5_000 });
  await shoot("settings-constellations");
  await page.getByRole("button", { name: "Reset" }).click();
  await page.waitForTimeout(300);

  const reset = await savedUi(page);

  if (reset.harness !== "claude" || reset.model !== before.model)
    throw new Error(`Reset didn't restore the UI default: ${JSON.stringify(reset)}`);
  await hostUiBecomes(page, "claude");
  step(
    "Constellations: the UI workers' default saved as Codex here and on the local Host, then reset on both"
  );
};

const bridge = async ({ page, step }: FlowInput) => {
  const result = await page.evaluate<{ ok: boolean; error?: { code: string } }>(
    'window.polaris.request("constellation.status", { hostKey: "local", constellationId: "smoke-none" })'
  );

  if (result.ok || result.error === undefined)
    throw new Error(`constellation.status answered for a Constellation that doesn't exist`);
  step(`constellation.status crossed the bridge and was refused (${result.error.code})`);

  const stats = await page.evaluate<{ ok: boolean; error?: { code: string } }>(
    'window.polaris.request("constellation.stats", { hostKey: "local", constellationId: "smoke-none" })'
  );

  if (stats.ok || stats.error === undefined)
    throw new Error("constellation.stats answered for a Constellation that doesn't exist");
  step(`constellation.stats crossed the bridge and was refused (${stats.error.code})`);
};

interface Snapshot {
  readonly resources: ReadonlyArray<{ readonly name: string; readonly capacity: number }>;
  readonly workerCap: { readonly cap: number; readonly default: number };
}

/** What the smoke sends: a command id, a resource name and capacity, or a cap. */
interface CallInput {
  readonly commandId?: string;
  readonly name?: string;
  readonly capacity?: number;
  readonly cap?: number | null;
}

const resourcesCall = (page: Page, method: string, input: CallInput) =>
  page.evaluate<Snapshot>(
    `window.polaris.request(${JSON.stringify(method)}, ${JSON.stringify({ hostKey: "local", ...input })}).then((r) => { if (!r.ok) throw new Error(r.error.code + ": " + r.error.message); return r.value; })`
  );

const commandId = () => `smoke-${crypto.randomUUID()}`;

/** Settings → Hosts on This Mac: resources and the worker cap through the real Daemon, then the page. */
const hostsPage = async ({ page, step, shoot }: FlowInput) => {
  const before = await resourcesCall(page, "host.resources.get", {});

  const declared = await resourcesCall(page, "host.resources.declare", {
    commandId: commandId(),
    name: "smoke-u2",
    capacity: 2,
  });

  if (!declared.resources.some((r) => r.name === "smoke-u2" && r.capacity === 2))
    throw new Error(`declare didn't add smoke-u2: ${JSON.stringify(declared.resources)}`);

  const capped = await resourcesCall(page, "host.workers.setCap", {
    commandId: commandId(),
    cap: 1,
  });

  const reset = await resourcesCall(page, "host.workers.setCap", {
    commandId: commandId(),
    cap: null,
  });

  if (capped.workerCap.cap !== 1 || reset.workerCap.cap !== before.workerCap.default)
    throw new Error(
      `worker cap didn't set and reset: ${JSON.stringify([capped.workerCap, reset.workerCap])}`
    );

  await page.getByRole("button", { name: "Hosts" }).click();
  await page
    .getByRole("button", { name: /^This Mac/ })
    .first()
    .click();
  await page
    .locator('[data-testid="host-resource"][data-resource="smoke-u2"]')
    .waitFor({ timeout: 5_000 });
  await shoot("settings-hosts-resources");

  const removed = await resourcesCall(page, "host.resources.remove", {
    commandId: commandId(),
    name: "smoke-u2",
  });

  if (removed.resources.some((r) => r.name === "smoke-u2"))
    throw new Error("smoke-u2 wasn't removed");
  await page
    .locator('[data-testid="host-resource"][data-resource="smoke-u2"]')
    .waitFor({ state: "detached", timeout: 5_000 });
  step(
    `Hosts: smoke-u2 declared, shown on This Mac and removed live; worker cap set to 1 and back to ${reset.workerCap.default}`
  );
};

/** Runs inside Settings; leaves it open. */
export const constellationShellFlow = async (input: FlowInput) => {
  await defaultsPage(input);
  await bridge(input);
  await hostsPage(input);
};
