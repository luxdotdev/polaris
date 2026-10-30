#!/usr/bin/env node
/**
 * Settings → Hosts on fixtures (`#hosts/<scene>`): the host list (HS-D2) and Mac Studio's
 * host page (HS-D) in both themes and every density, each card on its own, every daemon
 * update state on its host's page, and a checked walk through Upgrade on `#hosts/live`.
 * Nothing is installed.
 *
 *   node scripts/hostsScreens.ts --out <dir> [--build]
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { _electron as electron, type Page } from "playwright-core";
import { APP_DIR, electronBinary } from "./lib/electron.ts";
import { seenUserData } from "./lib/userData.ts";
import { startDaemon } from "./lib/daemon.ts";

const args = process.argv.slice(2);

const at = args.indexOf("--out");

const out = at === -1 ? null : (args[at + 1] ?? null);

if (out === null) throw new Error("--out <dir> is required");

if (args.includes("--build"))
  spawnSync("bun", [join(APP_DIR, "scripts/build.ts"), "--no-app"], { stdio: "inherit" });

const home = mkdtempSync(join(tmpdir(), "polaris-hosts-"));

const daemon = await startDaemon({ home, benchHarness: true });

const app = await electron.launch({
  executablePath: electronBinary(),
  args: ["--use-mock-keychain", APP_DIR],
  env: {
    ...process.env,
    POLARIS_DESKTOP_LOCAL_SOCKET: daemon.socketPath,
    POLARIS_DESKTOP_BENCH_HARNESS: "1",
    POLARIS_DESKTOP_USER_DATA: seenUserData(join(home, "user-data")),
    POLARIS_DESKTOP_HIDDEN: "1",
  },
});

const appearance = async (page: Page, theme: string, density: string) => {
  await page.evaluate(
    `Promise.all([window.polaris.request("settings.setTheme", { theme: "${theme}" }), window.polaris.request("settings.setDensity", { density: "${density}" })])`
  );
  await page
    .locator(`html[data-theme="${theme}"][data-density="${density}"]`)
    .waitFor({ state: "attached" });
  await page.waitForTimeout(400);
};

const open = async (page: Page, scene: string) => {
  await page.evaluate(`location.hash = "#hosts/${scene}"; location.reload()`);
  await page.waitForLoadState("domcontentloaded");
  await page.getByTestId("hosts-settings").waitFor();
};

/** Opens a host's page from its list row; esc goes back to the list. */
const host = async (page: Page, key: string) => {
  await page.getByTestId(`machine-${key}`).getByRole("button").click();
  await page.getByTestId("host-page").waitFor();
};

const back = async (page: Page) => {
  await page.keyboard.press("Escape");
  await page.getByTestId("hosts-settings").waitFor();
};

const shot = async (page: Page, name: string) => {
  const path = join(out, `${name}.png`);

  await page.screenshot({ path });
  console.log(`screens: ${path}`);
};

const card = async (page: Page, testId: string, name: string) => {
  const path = join(out, `${name}.png`);
  const element = page.getByTestId(testId);

  await element.scrollIntoViewIfNeeded();
  await element.screenshot({ path });
  console.log(`screens: ${path}`);
};

const expectText = async (page: Page, text: string) => {
  await page.getByText(text).first().waitFor({ timeout: 10_000 });
  console.log(`hosts: saw "${text}"`);
};

const THEMES = ["dark", "light"];

const DENSITIES = ["calm", "balanced", "compact"];

try {
  const page = await app.firstWindow();

  await page.setViewportSize({ width: 1440, height: 900 });
  mkdirSync(out, { recursive: true });

  for (const density of DENSITIES)
    for (const theme of THEMES) {
      await open(page, "states");
      await appearance(page, theme, density);
      await shot(page, `list-${theme}-${density}`);
      await host(page, "studio");
      await expectText(page, "Polaris Relay");
      await shot(page, `host-${theme}-${density}`);
      await page.getByTestId("harness-claude").waitFor();
      await card(page, "harnesses-card", `harnesses-${theme}-${density}`);
      await card(page, "capacity-card", `capacity-${theme}-${density}`);
      await card(page, "remote-access-card", `remote-access-${theme}-${density}`);
    }

  // Every Harness name in full and clear of its neighbours, at the narrowest density.
  const names = page
    .getByTestId("harnesses-card")
    .locator('[data-testid^="harness-"] > span:nth-child(2)');

  const clash = String(
    await page.evaluate(`(() => {
      const spans = [...document.querySelectorAll('[data-testid^="harness-"] > span:nth-child(2)')];
      const cut = spans.find((el) => el.scrollWidth > el.clientWidth);
      if (cut) return cut.textContent + " is cut off";
      const rects = spans.map((el) => el.getBoundingClientRect());
      const i = rects.findIndex((r, j) => j > 0 && r.top === rects[j - 1].top && r.left < rects[j - 1].right);
      return i === -1 ? "" : spans[i - 1].textContent + " runs into " + spans[i].textContent;
    })()`)
  );

  if (clash !== "") throw new Error(`the Harnesses card: ${clash}`);
  console.log(`hosts: harness names in full: ${(await names.allTextContents()).join(", ")}`);

  // Resources… opens the resources alone: Workers at once stays Capacity's one stepper.
  await page.getByRole("button", { name: "Resources…" }).click();
  await page.getByTestId("resources-card").waitFor();

  const steppers = await page
    .getByRole("button", { name: /more workers|increase workers/i })
    .count();

  if (steppers !== 1) throw new Error(`${steppers} Workers at once steppers on the host page`);
  await card(page, "resources-card", "resources-light-compact");

  // Tailscale turns on and says where extensions connect; the relay's address is the footer.
  await appearance(page, "dark", "calm");
  const remote = page.getByTestId("remote-access-card");

  await expectText(page, "wss://relay.lux.dev/v1");
  await remote.getByRole("switch", { name: "Tailscale" }).click();
  await expectText(page, "Extensions connect to wss://studio.tail1234.ts.net/polaris/rpc");
  await card(page, "remote-access-card", "remote-access-tailscale-on-dark-calm");

  // This Mac first; every update state in words, each on its host's page.
  await open(page, "all");

  const keys = String(
    await page.evaluate(
      `[...document.querySelectorAll('[data-testid^="machine-"]')].map((row) => row.dataset.testid.slice(8)).join(" ")`
    )
  ).split(" ");

  if (keys[0] !== "local") throw new Error(`This Mac isn't first: ${keys[0]}`);
  const seen: Array<string> = [];

  for (const key of keys) {
    await host(page, key);
    seen.push(...(await page.getByTestId("daemon-update").allTextContents()));
    await back(page);
  }

  for (const text of [
    "0.5.0 available · upgrades its daemon only when you ask",
    "Copying polaris 0.5.0 · 7.3 of 18.6 MB",
    "Switching to 0.5.0; agent sessions keep going",
    "Checking NUC",
    "Upgrades to 0.5.0 when it connects",
    "Upgraded to 0.5.0 · 3m ago",
  ]) {
    if (!seen.some((line) => line.includes(text))) throw new Error(`no host page said "${text}"`);
    console.log(`hosts: saw "${text}"`);
  }

  // The host page's own upgrade choice, and a host that keeps its own choice says so.
  await host(page, "studio");
  await expectText(page, "Daemon upgrades");
  await card(page, "daemon-card", "daemon-dark-calm");
  await open(page, "current");
  await host(page, "studio");
  await expectText(page, "Keeps its daemon up to date on its own");

  // Upgrade walks through checking, copying and switching to done; the switch turns off.
  await open(page, "live");
  await appearance(page, "light", "calm");
  await host(page, "studio");
  await page.getByRole("button", { name: "Upgrade" }).click();
  await expectText(page, "Checking Mac Studio");
  await page.getByRole("progressbar").waitFor();
  await shot(page, "live-uploading-light");
  await expectText(page, "Switching to 0.5.0");
  await expectText(page, "Upgraded to 0.5.0");
  await shot(page, "live-done-light");
  await back(page);
  await page.getByRole("switch", { name: "Keep daemons up to date" }).click();
  await page
    .locator('[data-testid="keep-daemons-up-to-date"] [role="switch"][data-state="unchecked"]')
    .waitFor();
  console.log("hosts: ok");
} finally {
  await app.close();
  await daemon.stop();
  rmSync(home, { recursive: true, force: true });
}
