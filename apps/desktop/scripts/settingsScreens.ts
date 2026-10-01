#!/usr/bin/env node
/**
 * Screenshots of Settings against Paper's S1 Harnesses (dark), S2 Usage (dark)
 * and S3 Appearance (light), with four local Daemons standing in for four
 * machines. Needs a built app.
 *
 *   node scripts/settingsScreens.ts <out dir>
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { _electron as electron, type Page } from "playwright-core";
import { startDaemon } from "./lib/daemon.ts";
import { APP_DIR, electronBinary, sizeWindow } from "./lib/electron.ts";

const out = process.argv[2] ?? join(tmpdir(), "polaris-settings-screens");

mkdirSync(out, { recursive: true });

const MACHINES = [
  { key: "studio", label: "Mac Studio" },
  { key: "vm", label: "Linux VM" },
  { key: "pi", label: "Raspberry Pi 4" },
] as const;

const home = mkdtempSync(join(tmpdir(), "polaris-settings-screens-"));

/**
 * The Pi runs a real probe against a fake Claude Code 2.1.272 (what the real Pi ran): usable
 * but older than tested, so S1 shows the quiet note. Nothing else is on its PATH.
 */
const olderClaude = (root: string) => {
  const bin = join(root, "bin");
  const userHome = join(root, "user");
  mkdirSync(bin, { recursive: true });
  mkdirSync(userHome, { recursive: true });
  writeFileSync(join(userHome, ".claude.json"), "{}");
  writeFileSync(
    join(bin, "claude"),
    `#!/bin/sh\ncase "$1" in --version) echo "2.1.272 (Claude Code)";; *) echo '{"loggedIn":true}';; esac\n`,
    { mode: 0o755 }
  );

  return {
    userHome,
    // Bun's own directory too: `spawn` finds the Daemon's `bun` through this PATH.
    env: {
      PATH: `${bin}:${dirname(execFileSync("which", ["bun"]).toString().trim())}:/usr/bin:/bin`,
      POLARIS_USER_PATH: "off",
    },
  };
};

/**
 * S2's figures: the Studio's HOME holds 30 days of Claude Code transcript lines on two Models
 * (`projects/**\/*.jsonl`, the shape its Usage index reads), so Usage isn't empty.
 */
const claudeLogs = (root: string) => {
  const dir = join(root, ".claude", "projects", "-Users-demo-polaris");
  const day = 86_400_000;
  const now = Date.now();

  mkdirSync(dir, { recursive: true });

  const lines = Array.from({ length: 30 }, (_, d) =>
    [0, 1, 2].map((i) => {
      const n = ((d * 7 + i * 3) % 11) + 2;
      const model = i === 2 ? "claude-sonnet-5" : "claude-opus-5";

      return JSON.stringify({
        type: "assistant",
        sessionId: `demo-${d}`,
        timestamp: new Date(now - (29 - d) * day - i * 3_600_000).toISOString(),
        version: "2.1.284",
        requestId: `req_${d}_${i}`,
        message: {
          id: `msg_${d}_${i}`,
          model,
          role: "assistant",
          content: [{ type: "text", text: "demo" }],
          usage: {
            input_tokens: n * 1_000,
            output_tokens: n * 4_000,
            cache_read_input_tokens: n * 90_000,
            cache_creation_input_tokens: n * 6_000,
          },
        },
      });
    })
  ).flat();

  writeFileSync(join(dir, "demo.jsonl"), `${lines.join("\n")}\n`);

  return root;
};

const startHost = (key: string) => {
  if (key === "pi") {
    return startDaemon({
      home: join(home, key),
      benchHarness: false,
      ...olderClaude(join(home, "pi-host")),
    });
  }

  if (key === "studio") {
    return startDaemon({
      home: join(home, key),
      benchHarness: true,
      userHome: claudeLogs(join(home, "studio-user")),
    });
  }

  return startDaemon({ home: join(home, key), benchHarness: true });
};

const daemons = await Promise.all(["local", ...MACHINES.map((m) => m.key)].map(startHost));

const [local, ...rest] = daemons;

const userData = join(home, "user-data");

mkdirSync(userData, { recursive: true });

writeFileSync(
  join(userData, "settings.json"),
  JSON.stringify({ theme: "dark", welcomeSeen: true })
);

const app = await electron.launch({
  executablePath: electronBinary(),
  args: [APP_DIR],
  env: {
    ...process.env,
    POLARIS_DESKTOP_LOCAL_SOCKET: local?.socketPath ?? "",
    POLARIS_DESKTOP_BENCH_HARNESS: "1",
    POLARIS_DESKTOP_LOCAL_LABEL: "MacBook Pro",
    POLARIS_DESKTOP_EXTRA_HOSTS: JSON.stringify(
      MACHINES.map((m, i) => ({ ...m, socket: rest[i]?.socketPath ?? "" }))
    ),
    POLARIS_DESKTOP_USER_DATA: userData,
    POLARIS_DESKTOP_HIDDEN: "1",
  },
});

const setAppearance = async (page: Page, patch: Record<string, string>) => {
  await page.evaluate(
    `window.polaris.request("settings.setAppearance", { patch: ${JSON.stringify(patch)} })`
  );
  await page.waitForTimeout(400);
};

/** The chart's tooltip: hover the busiest day, then the keyboard (focus, ←), both themes. */
const usageTooltip = async (page: Page) => {
  const chart = page.getByTestId("usage-chart");
  const box = await chart.boundingBox();

  if (box === null) throw new Error("no usage chart");
  await page.mouse.move(box.x + box.width - 4, box.y + box.height - 4);
  await page.getByTestId("usage-tooltip").waitFor({ timeout: 5_000 });
  const tip = (await page.getByTestId("usage-tooltip").textContent()) ?? "";

  if (!tip.startsWith("Today") || !tip.includes("Total"))
    throw new Error(`the usage tooltip reads: ${tip}`);
  console.log(`settings-screens: tooltip ${tip}`);
  await shoot(page, "S2-usage-tooltip-dark");
  await setAppearance(page, { theme: "light" });
  await page.mouse.move(box.x + box.width - 6, box.y + box.height - 4);
  await shoot(page, "S2-usage-tooltip-light");
  await setAppearance(page, { theme: "dark" });
  await page.mouse.move(0, 0);
  await chart.focus();
  await page.keyboard.press("ArrowLeft");
  await page.getByTestId("usage-tooltip").waitFor({ timeout: 5_000 });
  await shoot(page, "S2-usage-tooltip-keyboard-dark");
};

const shoot = async (page: Page, name: string) => {
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(out, `${name}.png`) });
  console.log(`settings-screens: saved ${name}.png`);
};

try {
  const page = await app.firstWindow();

  await sizeWindow(app, 1440, 900);
  await page.emulateMedia({ colorScheme: null });
  await page
    .locator('[data-host="local"][data-connection="connected"]')
    .waitFor({ timeout: 20_000 });
  await app.evaluate(({ Menu }) => {
    Menu.getApplicationMenu()?.getMenuItemById("settings.open")?.click();
  });
  await page.getByTestId("settings").waitFor({ timeout: 5_000 });

  // S3: Appearance, light.
  await setAppearance(page, { theme: "light" });
  await shoot(page, "S3-appearance-light-calm");

  for (const density of ["balanced", "compact"]) {
    await setAppearance(page, { density });
    await shoot(page, `S3-appearance-light-${density}`);
  }

  await setAppearance(page, { density: "calm", theme: "dark" });
  await shoot(page, "S3-appearance-dark-calm");

  // Sessions, both themes.
  await page.getByRole("button", { name: "Sessions" }).click();
  await page.locator('[data-section="sessions"]').waitFor({ timeout: 5_000 });
  await shoot(page, "sessions-dark");
  await setAppearance(page, { theme: "light" });
  await shoot(page, "sessions-light");
  await setAppearance(page, { theme: "dark" });

  // S1: Harnesses, dark.
  await page.getByRole("button", { name: "Harnesses", exact: true }).click();
  await page.getByTestId("harness-group").first().waitFor({ timeout: 10_000 });
  await page.waitForTimeout(3_000);
  await shoot(page, "S1-harnesses-dark-collapsed");
  // A Harness ready everywhere folds; open Claude Code's if it did.
  const folded = page.locator('button[aria-expanded="false"]', { hasText: "Claude Code" });

  if ((await folded.count()) > 0) await folded.click();
  await shoot(page, "S1-harnesses-dark");
  await setAppearance(page, { theme: "light" });
  await shoot(page, "S1-harnesses-light");

  // S2: Usage, dark.
  await setAppearance(page, { theme: "dark" });
  await page.getByRole("button", { name: "Usage" }).click();
  await page.getByText(/tokens on \d+ host/).waitFor({ timeout: 30_000 });
  await shoot(page, "S2-usage-dark");
  const figures = (await page.getByTestId("usage-figures").innerText()).split("\n");

  // Paper S2 (6R2-1): tokens, cost, share, each a figure with its caption.
  if (figures.length !== 6 || !figures[3]?.startsWith("API-equivalent"))
    throw new Error(`usage figures: ${figures.join(" | ")}`);
  console.log(`settings-screens: figures ${figures.join(" | ")}`);
  await setAppearance(page, { theme: "light" });
  await shoot(page, "S2-usage-light");
  await setAppearance(page, { theme: "dark" });
  await usageTooltip(page);

  // The gear in the sidebar footer and the K menu's Settings actions.
  await page.keyboard.press("Escape");
  await page.getByTestId("settings").waitFor({ state: "detached" });
  await page.getByRole("button", { name: "Settings" }).hover();
  await shoot(page, "entry-sidebar-gear-dark");
  await page.keyboard.press("Meta+k");
  await page.keyboard.type("settings");
  await shoot(page, "entry-k-menu-dark");
} finally {
  await app.close();
  await Promise.all(daemons.map((d) => d.stop()));
  rmSync(home, { recursive: true, force: true });
}
