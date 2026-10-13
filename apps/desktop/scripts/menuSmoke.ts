#!/usr/bin/env node
/**
 * Right-click menus (DESIGN.md, Menus; Paper M1–M5) on a real Daemon with bench sessions:
 * each surface's menu opens with the expected items, screenshotted in both themes.
 *
 *   node scripts/menuSmoke.ts --out <dir> [--build]
 */
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { _electron as electron, type Locator, type Page } from "playwright-core";
import { APP_DIR, electronBinary } from "./lib/electron.ts";
import { startDaemon } from "./lib/daemon.ts";
import { seedSource } from "./lib/seed.ts";
import { seenUserData } from "./lib/userData.ts";

const args = process.argv.slice(2);

const at = args.indexOf("--out");

const out = at === -1 ? null : (args[at + 1] ?? null);

if (out === null) throw new Error("--out <dir> is required");

if (args.includes("--build"))
  spawnSync("bun", [join(APP_DIR, "scripts/build.ts"), "--no-app"], { stdio: "inherit" });

const home = mkdtempSync(join(tmpdir(), "polaris-menus-"));

const daemon = await startDaemon({ home, benchHarness: true });

const app = await electron.launch({
  executablePath: electronBinary(),
  args: [APP_DIR],
  env: {
    ...process.env,
    POLARIS_DESKTOP_LOCAL_SOCKET: daemon.socketPath,
    POLARIS_DESKTOP_BENCH_HARNESS: "1",
    POLARIS_DESKTOP_USER_DATA: seenUserData(join(home, "user-data")),
    POLARIS_DESKTOP_HIDDEN: "1",
  },
});

const failures: Array<string> = [];

const theme = async (page: Page, name: string) => {
  await page.evaluate(`window.polaris.request("settings.setTheme", { theme: "${name}" })`);
  await page.locator(`html[data-theme="${name}"]`).waitFor({ state: "attached" });
  await page.waitForTimeout(250);
};

/** Each row's label and its shortcut lane, "Approve ⇧⌘A", one per row; "—" for a separator. */
const menuRows = async (menu: Locator) => {
  const rows: Array<string> = [];

  for (const el of await menu.locator('[role="menuitem"], [role="separator"]').all()) {
    if ((await el.getAttribute("role")) === "separator") {
      rows.push("—");
      continue;
    }

    const label = (await el.locator("span").first().textContent()) ?? "";
    const lane = el.locator("kbd");
    const shortcut = (await lane.count()) > 0 ? await lane.first().textContent() : null;

    rows.push(shortcut === null ? label : `${label} ${shortcut}`);
  }

  return rows;
};

export interface MenuCheck {
  readonly name: string;
  readonly target: (page: Page) => Locator;
  readonly menu: string;
  readonly expected: ReadonlyArray<string>;
}

/** Right-clicks the target in each theme, compares its rows, and screenshots it. */
const check = async (page: Page, c: MenuCheck) => {
  for (const name of ["dark", "light"]) {
    await theme(page, name);
    await c.target(page).click({ button: "right" });
    const menu = page.getByTestId(c.menu);

    await menu.waitFor();
    await page.waitForTimeout(200);
    const rows = await menuRows(menu);

    if (JSON.stringify(rows) !== JSON.stringify(c.expected))
      failures.push(`${c.name} (${name}): ${JSON.stringify(rows)}`);
    await page.screenshot({ path: join(out, `${c.name}-${name}.png`) });
    await page.keyboard.press("Escape");
    await menu.waitFor({ state: "detached" });
  }

  console.log(`menus: ${c.name}`);
};

const sidebar = (page: Page) => page.getByRole("complementary", { name: "Sessions" });

const row = (title: string) => (page: Page) =>
  sidebar(page).locator("[data-session-row]", { hasText: title }).first();

const chip = (name: string) => (page: Page) =>
  page
    .getByRole("navigation", { name: "Workspaces" })
    .getByRole("button", { name: new RegExp(name) });

try {
  const page = await app.firstWindow();

  page.on("pageerror", (error) => {
    console.error(`menus: page error ${String(error)}`);
    failures.push(String(error));
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  mkdirSync(out, { recursive: true });

  await page.evaluate(
    seedSource([
      {
        hostKey: "local",
        name: "polaris",
        sessions: [
          { title: "Glossary first pass", state: "idle" },
          { title: "Spike GPUI review screen", state: "needs-you" },
        ],
      },
    ])
  );
  await row("Glossary first pass")(page).waitFor();
  await row("Spike GPUI review screen")(page).waitFor();
  await page.waitForTimeout(1500);
  await row("Glossary first pass")(page).click();

  await check(page, {
    name: "session-row",
    target: row("Glossary first pass"),
    menu: "session-context-menu",
    expected: [
      "Pin to top",
      "Rename…",
      "—",
      "Open in Review",
      "Open in terminal",
      "Fork…",
      "—",
      "Copy session ID",
      "—",
      "Archive",
    ],
  });

  await check(page, {
    name: "workspace-chip",
    target: chip("polaris"),
    menu: "workspace-context-menu",
    expected: [
      "New session ⌘N",
      "Open in Edit ⌘3",
      "Open terminal here",
      "—",
      "Copy path",
      "Reveal in Finder",
    ],
  });

  await check(page, {
    name: "host-label",
    target: (p) => p.getByRole("navigation", { name: "Workspaces" }).locator("[data-host]").first(),
    menu: "host-context-menu",
    expected: ["New session on This Mac…", "—", "Host details"],
  });

  await sidebar(page)
    .getByRole("radio", { name: /Needs you/ })
    .click();
  await check(page, {
    name: "needs-you-card",
    target: (p) => p.getByTestId("needs-you-card").first(),
    menu: "needs-you-context-menu",
    expected: [
      "Open session",
      "—",
      "Approve",
      "Always allow",
      "Deny",
      "—",
      "Dismiss on this Mac",
      "Archive session",
    ],
  });

  await page.evaluate(`location.hash = "#constellations/sidebar"; location.reload()`);
  await page.waitForLoadState("domcontentloaded");
  await page.getByTestId("worker-row").first().waitFor();
  await check(page, {
    name: "worker-row",
    target: (p) => p.getByTestId("worker-row").first(),
    menu: "worker-context-menu",
    expected: [
      "Focus worktree-setup-retry-on-reconnect",
      "Open in Review",
      "—",
      "Message the lead about this",
      "Copy task ID",
    ],
  });
} finally {
  await app.close();
  await daemon.stop();
}

if (failures.length > 0) {
  console.error(`menus: ${failures.length} failed\n${failures.join("\n")}`);
  process.exit(1);
}

console.log("menus: ok");
