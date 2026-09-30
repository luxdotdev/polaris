#!/usr/bin/env node
/**
 * Smoke test: starts a throwaway Daemon on the bench Harness, launches the
 * built app against it with a hidden window (Playwright's Electron support),
 * starts the proof session and asserts the screen shows it live, to the end.
 *
 *   node scripts/smoke.ts [--build] [--show] [--screenshots <dir>]
 *
 * Runs under Node: Playwright's Electron launcher does not connect under Bun.
 */
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, type Page } from "playwright-core";
import { spawnSync } from "node:child_process";
import { APP_DIR, electronBinary, OUT_DIR, REPO_ROOT } from "./lib/electron.ts";
import { probeSource } from "./lib/probe.ts";
import { startDaemon } from "./lib/daemon.ts";
import { machineFlow, prepareFakeHost } from "./lib/machineFlow.ts";
import { initRepo, sessionFlow } from "./lib/sessionFlow.ts";
import { settingsFlow } from "./lib/settingsFlow.ts";
import { terminalFlow } from "./lib/terminalFlow.ts";

const args = process.argv.slice(2);

const flag = (name: string) => args.includes(name);

const option = (name: string) => {
  const at = args.indexOf(name);

  return at === -1 ? null : (args[at + 1] ?? null);
};

const screenshots = option("--screenshots");

/** The renderer bundle: large enough that `files.read` sends it as a blob. */
const bigAsset = () => {
  const dir = join(OUT_DIR, "renderer/assets");
  // The largest chunk: lazy chunks (the session preview) are too small to be sent as blobs.

  const js = readdirSync(dir)
    .filter((f) => f.endsWith(".js"))
    .map((f) => join(dir, f))
    .toSorted((a, b) => statSync(b).size - statSync(a).size)[0];

  if (js === undefined) throw new Error("build the renderer first");

  return js;
};

const step = (message: string) => console.log(`smoke: ${message}`);

if (flag("--build")) {
  spawnSync("bun", [join(APP_DIR, "scripts/build.ts"), "--no-app"], { stdio: "inherit" });
}

const home = mkdtempSync(join(tmpdir(), "polaris-smoke-"));

const userData = join(home, "user-data");

const daemon = await startDaemon({ home, benchHarness: true });

const fakeHost = prepareFakeHost(join(home, "remote"));

const UNREACHABLE = "polaris-smoke.invalid";

// A remote Host that can't be reached: it must show a Connection State, never block the app.
mkdirSync(userData, { recursive: true });

writeFileSync(
  join(userData, "settings.json"),
  JSON.stringify({ hosts: [{ alias: UNREACHABLE, label: "Nowhere" }] })
);

step(`Daemon up at ${daemon.socketPath}`);

const app = await electron.launch({
  executablePath: electronBinary(),
  args: [APP_DIR],
  env: {
    ...process.env,
    POLARIS_DESKTOP_LOCAL_SOCKET: daemon.socketPath,
    POLARIS_DESKTOP_BENCH_HARNESS: "1",
    POLARIS_DESKTOP_USER_DATA: userData,
    POLARIS_DESKTOP_HIDDEN: flag("--show") ? "0" : "1",
    ...fakeHost.env,
  },
});

const SWITCHES = 40;

/** ⌃1 / ⌃2 back and forth; input → second frame after it, per routes/switchTimer.ts. M1: < 100 ms. */
const timeSwitches = async (page: Page) => {
  for (let i = 0; i < SWITCHES; i++) {
    await page.keyboard.press(i % 2 === 0 ? "Control+Digit1" : "Control+Digit2");
    await page.waitForTimeout(40);
  }

  await page.waitForTimeout(200);
  // SAFETY: switchTimes() returns an array of numbers (routes/switchTimer.ts).
  const times = (await page.evaluate("window.__polaris.switchTimes()")) as Array<number>;
  const sorted = [...times].sort((a, b) => a - b);

  const at = (q: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? NaN;

  step(
    `Workspace switch (${sorted.length}): p50 ${at(0.5).toFixed(1)} ms, p95 ${at(0.95).toFixed(1)} ms, max ${at(1).toFixed(1)} ms`
  );

  if (sorted.length < SWITCHES / 2)
    throw new Error("the Workspace switch timer recorded too few switches");

  if (at(0.95) > 100) throw new Error("Workspace switch p95 is over the 100 ms budget");
};

/** ⌘K, type the other Workspace's name, ↵: its session opens (Sessions rank first); then ⌘/ help. */
const jumpByTyping = async (page: Page) => {
  const chip = page.locator('[data-slot="chip"][aria-pressed="false"]').first();
  const name = ((await chip.textContent()) ?? "").replace(/\s*⌃\d.*$/, "").trim();

  await page.keyboard.press("Meta+K");
  const input = page.getByRole("combobox");

  await input.waitFor({ timeout: 5000 });
  await input.pressSequentially(name, { delay: 20 });
  await page.getByTestId("jump-item").first().waitFor();
  const first = (await page.getByTestId("jump-item").first().textContent()) ?? "";

  await page.keyboard.press("Enter");
  await page
    .locator('[data-slot="chip"][aria-pressed="true"]', { hasText: name })
    .waitFor({ timeout: 5000 });
  step(`jumped by typing "${name}" to: ${first.slice(0, 60)}`);

  await page.keyboard.press("Meta+Slash");
  await page.getByRole("dialog", { name: "Keyboard shortcuts" }).waitFor({ timeout: 5000 });
  await page.keyboard.press("Escape");
  // Closed at once (data-state), even while the fade-out still runs.
  await page
    .locator('[role="dialog"][data-state="open"]')
    .waitFor({ state: "detached", timeout: 5000 });
  step("shortcut help opens with ⌘/ and closes with esc");

  await page.keyboard.press("Meta+2");
  await page.getByText(/Review arrives/).waitFor({ timeout: 5000 });
  await page.keyboard.press("Meta+1");
  await page.getByTestId("session-panel").waitFor({ timeout: 5000 });
  step("⌘2 and ⌘1 switch views");
};

/** Develop → Start proof session, as the menu does it. */
const startProof = () =>
  app.evaluate(({ Menu }) => {
    Menu.getApplicationMenu()?.getMenuItemById("dev-proof")?.click();
  });

const setTheme = async (page: Page, theme: "dark" | "light") => {
  // What View → Appearance does (menu.ts): the setting, then data-theme on the root.
  await page.evaluate(`window.polaris.request("settings.setTheme", { theme: "${theme}" })`);
  await page.locator(`html[data-theme="${theme}"]`).waitFor({ state: "attached" });
  await page.waitForTimeout(300);
};

/** Saves `<name>-dark.png` and `<name>-light.png`, then leaves the app dark. */
const shoot = async (page: Page, name: string) => {
  if (screenshots === null) return;
  mkdirSync(screenshots, { recursive: true });

  for (const theme of ["dark", "light"] as const) {
    await setTheme(page, theme);
    const path = join(screenshots, `${name}-${theme}.png`);

    await page.screenshot({ path });
    step(`saved ${path}`);
  }

  await setTheme(page, "dark");
};

/** The main process's Needs You probe (src/main/notifications). */
const needsYouProbe = () =>
  app.evaluate(() => {
    const probe = globalThis.__polarisNeedsYou;

    return probe === undefined
      ? null
      : {
          count: probe.count(),
          tray: probe.trayTitle(),
          notified: probe.notified(),
          requests: [...probe.requests()],
        };
  });

interface Probe {
  readonly count: number;
  readonly tray: string;
  readonly notified: number;
  readonly requests: ReadonlyArray<string>;
}

const waitForProbe = async (want: (p: Probe) => boolean, what: string) => {
  for (let i = 0; i < 50; i++) {
    const probe = await needsYouProbe();

    if (probe !== null && want(probe)) return probe;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  throw new Error(`Needs You: ${what} never happened (${JSON.stringify(await needsYouProbe())})`);
};

/** The first approval shows in the inbox and the menu bar count; approving it there resolves it. */
const inboxCheck = async (page: Page) => {
  const before = await waitForProbe(
    (p) => p.count > 0 && p.tray === String(p.count),
    "the tray count"
  );

  step(`menu bar star: ${before.tray} waiting; ${before.notified} notification(s) planned`);
  await page.getByRole("radio", { name: /^Needs you/ }).click();
  const card = page.getByTestId("needs-you-card").first();

  await card.waitFor({ timeout: 5_000 });
  await shoot(page, "needs-you-inbox");
  await card.getByRole("button", { name: /^Approve/ }).click();
  const answered = before.requests[0];

  await waitForProbe((p) => !p.requests.includes(answered ?? ""), "the answer");
  step("approved from the inbox; the request left the menu bar summary");
  await page.getByRole("radio", { name: /^Sessions/ }).click();
};

let failed = false;

const consoleErrors: Array<string> = [];

try {
  const page = await app.firstWindow();

  page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));
  page.on("requestfailed", (request) =>
    console.log(`smoke: request failed: ${request.url()} ${request.failure()?.errorText ?? ""}`)
  );
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.setViewportSize({ width: 1280, height: 800 });
  // Playwright emulates a light colour scheme by default; follow the app's own theme instead.
  await page.emulateMedia({ colorScheme: null });
  await page
    .locator('[data-host="local"][data-connection="connected"]')
    .waitFor({ timeout: 15_000 });
  step("local Host connected");

  const remote = page.getByTestId(`connection-${UNREACHABLE}`);

  await remote.waitFor({ timeout: 20_000 });
  step(`unreachable remote Host: ${await remote.textContent()}`);

  // A second, idle Workspace first, so the Workspace switch can be timed.
  await startProof();
  await page
    .locator('[data-testid="row-state"][data-state="idle"]')
    .first()
    .waitFor({ timeout: 60_000 });
  await startProof();
  await page.getByTestId("session-panel").waitFor({ timeout: 15_000 });
  step("proof session open");

  await page.getByTestId("live-item").first().waitFor({ timeout: 15_000 });
  step("live deltas streaming");

  await page
    .getByTestId("session-state")
    .filter({ hasText: /^Working/ })
    .waitFor({ timeout: 15_000 });
  await shoot(page, "proof");

  await page.getByTestId("session-state").filter({ hasText: /^Idle/ }).waitFor({ timeout: 60_000 });
  const items = await page.getByTestId("turn-item").count();

  step(`turn finished: ${items} items`);

  if (items !== 6) throw new Error(`expected 6 items, saw ${items}`);

  const repo = join(home, "smoke-repo");

  initRepo(repo);
  await sessionFlow({
    page,
    repo,
    step,
    shoot: (name) => shoot(page, name),
    atFirstApproval: () => inboxCheck(page),
  });
  await settingsFlow({ app, page, step, shoot: (name) => shoot(page, name) });
  await terminalFlow({ page, step, shoot: (name) => shoot(page, name) });
  await timeSwitches(page);
  await jumpByTyping(page);

  const probe = await Promise.race([
    page.evaluate(probeSource({ bigFile: bigAsset(), repo: REPO_ROOT })),
    new Promise((_, reject) =>
      setTimeout(async () => {
        const steps = await page.evaluate("JSON.stringify(window.__probeSteps)");

        reject(new Error(`RPC probe timed out after ${String(steps)}`));
      }, 20_000)
    ),
  ]);

  step(`RPC round trips: ${JSON.stringify(probe)}`);

  if (!JSON.stringify(probe).includes('"terminal":true'))
    throw new Error("terminal output missing");

  const openHosts = async () => {
    await page.getByRole("button", { name: "Settings" }).click();
    await page
      .getByRole("navigation", { name: "Settings" })
      .getByRole("button", { name: "Hosts" })
      .click();
    await page.getByTestId("hosts-settings").waitFor({ timeout: 10_000 });

    return true;
  };

  await machineFlow({
    page,
    host: fakeHost,
    step,
    openHosts,
    shoot: (name) => shoot(page, name),
  });

  if (consoleErrors.length > 0) throw new Error(`renderer errors:\n${consoleErrors.join("\n")}`);
  step("ok");
} catch (error) {
  failed = true;
  console.error("smoke: FAILED", error);
  const page = app.windows()[0];

  if (page !== undefined) {
    const shot = join(tmpdir(), "polaris-smoke-failure.png");

    await page.screenshot({ path: shot }).catch(() => undefined);
    console.error(
      `smoke: screenshot at ${shot}; screen text:\n${await page.locator("body").innerText()}`
    );
    console.error(`smoke: renderer errors:\n${consoleErrors.join("\n")}`);
  }
} finally {
  await app.close();
  await daemon.stop();
  fakeHost.stop();
  rmSync(home, { recursive: true, force: true });
}

process.exit(failed ? 1 : 0);
