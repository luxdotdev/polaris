/**
 * The language status pill, its popover, the log tab and Settings → Editor → Languages in the
 * real app on an isolated profile: node apps/desktop/scripts/languageStatusSmoke.ts (build first).
 * First open sets up then reads ready; three server kills stop it; Restart recovers; Show log
 * opens the tab; Settings lists the Host's languages. Screenshots: both themes, three densities.
 */
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, type Page } from "playwright-core";
import { startDaemon } from "./lib/daemon.ts";
import { APP_DIR, REPO_ROOT, stockElectronBinary } from "./lib/electron.ts";

const profile = realpathSync(mkdtempSync(join(tmpdir(), "polaris-language-status-")));

const userData = join(profile, "user-data");

const evidence = join(REPO_ROOT, ".dagr/evidence/slice-4c");

const name = "language-status-acceptance.ts";

const path = join(REPO_ROOT, name);

assert.equal(existsSync(path), false, "Never overwrite an existing file");

mkdirSync(userData);

mkdirSync(evidence, { recursive: true });

writeFileSync(path, "export const value: string = 123;\nexport const other = value;\n");

writeFileSync(join(userData, "settings.json"), JSON.stringify({ welcomeSeen: true }));

let daemon: Awaited<ReturnType<typeof startDaemon>> | undefined;

let app: Awaited<ReturnType<typeof electron.launch>> | undefined;

const launch = async () => {
  if (daemon === undefined) throw new Error("Daemon missing");
  app = await electron.launch({
    executablePath: stockElectronBinary(),
    args: [APP_DIR],
    env: {
      ...process.env,
      POLARIS_DESKTOP_LOCAL_SOCKET: daemon.socketPath,
      POLARIS_DESKTOP_BENCH_HARNESS: "1",
      POLARIS_DESKTOP_USER_DATA: userData,
      POLARIS_DESKTOP_HIDDEN: "1",
    },
  });

  const page = await app.firstWindow();

  await page.setViewportSize({ width: 1440, height: 900 });
  await page
    .locator('[data-host="local"][data-connection="connected"]')
    .waitFor({ timeout: 20_000 });

  return page;
};

const until = async (
  what: string,
  check: () => Promise<boolean>,
  seen?: () => Promise<string>,
  ms = 120_000
) => {
  for (const end = Date.now() + ms; Date.now() < end;) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Timed out waiting for ${what}`, { cause: await seen?.() });
};

const pill = (page: Page) => page.getByTestId("language-pill");

const kind = async (page: Page) =>
  (await pill(page).count()) === 0 ? "" : ((await pill(page).getAttribute("data-kind")) ?? "");

const shot = (page: Page, file: string) => page.screenshot({ path: join(evidence, file) });

const appearance = async (page: Page, theme: string, density: string) => {
  await page.evaluate(
    `window.polaris.request("settings.setAppearance", { patch: { theme: "${theme}", density: "${density}" } })`
  );
  await page
    .locator(`html[data-theme="${theme}"][data-density="${density}"]`)
    .waitFor({ state: "attached" });
  await page.waitForTimeout(300);
};

/** Every theme and density, with the page as it is now. */
const everyLook = async (page: Page, prefix: string, reopen?: () => Promise<void>) => {
  for (const theme of ["dark", "light"])
    for (const density of ["calm", "balanced", "compact"]) {
      await appearance(page, theme, density);
      await reopen?.();
      await shot(page, `${prefix}-${theme}-${density}.png`);
    }

  await appearance(page, "dark", "balanced");
};

const openPopover = async (page: Page) => {
  if ((await page.getByTestId("language-popover").count()) === 0) await pill(page).click();
  await page.getByTestId("language-popover").waitFor({ timeout: 5_000 });
};

const closePopover = async (page: Page) => {
  if ((await page.getByTestId("language-popover").count()) > 0) await page.keyboard.press("Escape");
  await page.getByTestId("language-popover").waitFor({ state: "detached", timeout: 5_000 });
};

/** The managed TypeScript server this profile's Daemon runs: Polaris's private Node with tsls. */
const serverPids = () => {
  try {
    return execFileSync("pgrep", ["-f", `${profile}/languages/.*/lib/cli\\.mjs --stdio`], {
      encoding: "utf8",
    })
      .trim()
      .split("\n")
      .filter((pid) => pid !== "")
      .map(Number);
  } catch {
    return [];
  }
};

try {
  daemon = await startDaemon({ home: profile, benchHarness: true });
  const page = await launch();
  await page.evaluate(
    `window.polaris.request("dispatch", { hostKey: "local", commandId: crypto.randomUUID(), command: { _tag: "RegisterWorkspace", path: ${JSON.stringify(REPO_ROOT)}, name: "polaris" } })`
  );

  await page.keyboard.press("Meta+3");
  await page.getByTestId("explorer").waitFor({ timeout: 15_000 });
  await page
    .getByTestId("tree-row")
    .filter({ has: page.getByText(name, { exact: true }) })
    .click({ timeout: 15_000 });
  await page.locator(".cm-content").first().waitFor({ timeout: 15_000 });

  // 1. First open: setting up (the tools download into this fresh profile), then ready.
  await until("the pill", async () => (await pill(page).count()) > 0);
  const first = await kind(page);
  console.log(`First pill: ${first} (${await pill(page).textContent()})`);
  assert.equal(first, "setting-up", "A fresh Host sets up before the server is ready");
  await openPopover(page);
  await shot(page, "setting-up-dark.png");
  await closePopover(page);

  // The Trust card asks about the repo's own TypeScript; Not now keeps the bundled one.
  await page.getByTestId("trust-card").waitFor({ timeout: 180_000 });
  await page.getByTestId("trust-card").getByRole("button", { name: "Not now" }).click();
  await until(
    "ready, bundled",
    async () => ["bundled", "ready"].includes(await kind(page)),
    async () => `${await kind(page)}: ${await pill(page).textContent()}`,
    240_000
  );
  console.log(`Ready: ${await pill(page).textContent()}`);
  assert.equal(await pill(page).textContent(), "TypeScript · bundled");
  await everyLook(page, "bundled", () => openPopover(page));
  await closePopover(page);

  // 2. Kill the server three times: the Daemon restarts it twice, then stops it.
  for (let kill = 1; kill <= 3; kill++) {
    let pids: number[] = [];
    await until(
      "a running server",
      async () => (pids = serverPids()).length > 0,
      async () =>
        execFileSync("ps", ["-axo", "pid,command"], { encoding: "utf8" })
          .split("\n")
          .filter((line) => line.includes(profile))
          .join("\n"),
      20_000
    );
    console.log(`Kill ${kill}: ${pids.join(", ")}`);
    execFileSync("kill", ["-9", ...pids.map(String)]);

    if (kill < 3)
      await until(
        "the restarted server",
        async () => serverPids().some((pid) => !pids.includes(pid)),
        async () => `${await kind(page)}`,
        30_000
      );
  }

  await until(
    "stopped",
    async () => (await kind(page)) === "crashed",
    async () => kind(page),
    30_000
  );
  assert.equal(await pill(page).textContent(), "TypeScript · stopped");
  await openPopover(page);
  assert.equal(
    await page.getByTestId("language-popover").getByRole("heading").textContent(),
    "TypeScript stopped"
  );
  await everyLook(page, "stopped", () => openPopover(page));
  console.log("Three kills: pill reads stopped, popover offers Restart and Show log");

  // 3. Show log opens the log tab, with the lines this Client saw.
  await openPopover(page);
  await page.getByRole("menuitem", { name: "Show language server log" }).click();
  await page.getByTestId("language-log").waitFor({ timeout: 10_000 });
  assert.equal(
    await page.getByRole("tab", { selected: true }).getByText("TypeScript log").count(),
    1
  );
  await everyLook(page, "log");
  console.log(
    `Log tab: ${await page.getByTestId("language-log").getByRole("toolbar").textContent()}`
  );

  // Back to the file, then Restart recovers.
  await page.getByTestId("editor-tab").filter({ hasText: name }).click();
  await openPopover(page);
  await page.getByRole("menuitem", { name: "Restart TypeScript server" }).click();
  await until(
    "ready after Restart",
    async () => ["bundled", "ready"].includes(await kind(page)),
    async () => `${await kind(page)}: ${await pill(page).textContent()}`,
    60_000
  );
  await closePopover(page).catch(() => undefined);
  await shot(page, "restarted-dark.png");
  console.log(`Restart recovered: ${await pill(page).textContent()}`);

  // 4. Settings → Editor → Languages lists the Host's integrations.
  await page.keyboard.press("Meta+,");
  await page.getByRole("button", { name: "Editor" }).first().click();
  await page.getByText("What each language has on the host you pick.").waitFor({ timeout: 15_000 });
  await page.getByText("TypeScript and JavaScript").first().waitFor({ timeout: 30_000 });
  await everyLook(page, "settings");
  console.log("Settings → Editor → Languages lists TypeScript and JavaScript");
  console.log("PASS");
} finally {
  await app?.evaluate(({ app: electronApp }) => electronApp.exit()).catch(() => undefined);
  await daemon?.stop();
  rmSync(path, { force: true });
  rmSync(profile, { recursive: true, force: true });
}
