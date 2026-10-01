#!/usr/bin/env node
/**
 * Launches the packaged app (`bun run package` first) against a local Daemon and checks that
 * it calls itself Polaris, finds its Daemon builds and icon, and connects.
 *
 *   node scripts/packageCheck.ts [--screenshot <file.png>]
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron } from "playwright-core";
import { startDaemon } from "./lib/daemon.ts";
import { APP_DIR } from "./lib/electron.ts";

const args = process.argv.slice(2);

const at = args.indexOf("--screenshot");

const shot = at === -1 ? null : (args[at + 1] ?? null);

const bundle = join(APP_DIR, "out/dist/Polaris-darwin-arm64/Polaris.app");

const home = mkdtempSync(join(tmpdir(), "polaris-package-"));

const userData = join(home, "user-data");

mkdirSync(userData, { recursive: true });

writeFileSync(join(userData, "settings.json"), JSON.stringify({ welcomeSeen: true }));

const daemon = await startDaemon({ home, benchHarness: true, userHome: join(home, "user-home") });

const app = await electron.launch({
  executablePath: join(bundle, "Contents/MacOS/Polaris"),
  env: {
    ...process.env,
    POLARIS_DESKTOP_LOCAL_SOCKET: daemon.socketPath,
    POLARIS_DESKTOP_USER_DATA: userData,
  },
});

let failed = false;

const check = (what: string, ok: boolean, detail: string) => {
  console.log(`package: ${ok ? "ok" : "FAIL"} ${what}: ${detail}`);
  failed ||= !ok;
};

try {
  const page = await app.firstWindow();

  const facts = await app.evaluate(({ app: a, BrowserWindow }) => ({
    name: a.getName(),
    packaged: a.isPackaged,
    resources: process.resourcesPath,
    title: BrowserWindow.getAllWindows()[0]?.getTitle() ?? "",
    daemonBuilds: process
      .getBuiltinModule("node:fs")
      .existsSync(`${process.resourcesPath}/daemon/manifest.json`),
    icon: process.getBuiltinModule("node:fs").existsSync(`${process.resourcesPath}/icon.png`),
  }));

  const appMenu = await app.evaluate(
    ({ Menu }) => Menu.getApplicationMenu()?.items[0]?.label ?? ""
  );

  check("name", facts.name === "Polaris", facts.name);
  check("packaged", facts.packaged, String(facts.packaged));
  check("app menu", appMenu === "Polaris", appMenu);
  check("window title", facts.title === "Polaris", facts.title);
  check("resources", facts.resources.startsWith(bundle), facts.resources);
  check("Daemon builds", facts.daemonBuilds, "Resources/daemon/manifest.json");
  check("window icon", facts.icon, "Resources/icon.png");

  await page
    .locator('[data-host="local"][data-connection="connected"]')
    .first()
    .waitFor({ timeout: 30_000 });
  check("local Daemon", true, "connected");

  if (shot !== null) await page.screenshot({ path: shot });
} catch (error) {
  failed = true;
  console.error("package: FAILED", error);
} finally {
  await app.close();
  await daemon.stop();
  rmSync(home, { recursive: true, force: true });
}

process.exit(failed ? 1 : 0);
