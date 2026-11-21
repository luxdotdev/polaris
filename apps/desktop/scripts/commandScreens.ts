#!/usr/bin/env node
/** ENG-1021: real command links in a disposable home, captured before and after installation. */
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Result } from "../src/shared/api.ts";
import type { CommandInstallView } from "../src/shared/commandInstall.ts";
import { spawnSync } from "node:child_process";
import { startDaemon } from "./lib/daemon.ts";
import {
  scriptedElectron as electron,
  APP_DIR,
  electronBinary,
  sizeWindow,
} from "./lib/electron.ts";

const out = process.argv[2] ?? join(tmpdir(), "polaris-command-screens");

mkdirSync(out, { recursive: true });

const home = mkdtempSync(join(tmpdir(), "polaris-command-screens-home-"));

const userData = join(home, "user-data");

mkdirSync(userData);

writeFileSync(
  join(userData, "settings.json"),
  JSON.stringify({ theme: "dark", welcomeSeen: true, automaticAppUpdates: false })
);

const bin = join(home, ".polaris/bin");

for (const version of ["1.0.0", "2.0.0"]) {
  mkdirSync(join(bin, version), { recursive: true });
  const binary = join(bin, version, "polaris");
  writeFileSync(binary, `#!/bin/sh\necho polaris ${version}\n`);
  chmodSync(binary, 0o755);
}

symlinkSync("1.0.0", join(bin, "current"));

const daemon = await startDaemon({
  home: join(home, "daemon"),
  userHome: home,
  benchHarness: true,
  fileSecrets: true,
});

let app;

try {
  app = await electron.launch({
    executablePath: electronBinary(),
    args: ["--use-mock-keychain", APP_DIR],
    env: {
      ...process.env,
      HOME: home,
      POLARIS_HOME: join(home, ".polaris"),
      POLARIS_DESKTOP_LOCAL_SOCKET: daemon.socketPath,
      POLARIS_DESKTOP_BENCH_HARNESS: "1",
      POLARIS_DESKTOP_USER_DATA: userData,
      POLARIS_DESKTOP_HIDDEN: "1",
    },
  });
  const page = await app.firstWindow();
  await sizeWindow(app, 1440, 1000);
  await page.getByRole("region", { name: "Command line setup" }).waitFor({ timeout: 20_000 });

  const status = await page.evaluate<Result<CommandInstallView>>(
    'window.polaris.request("commandInstall.get", {})'
  );

  if (
    !status.ok ||
    !status.value.links.every((link) => link.location !== "user" || link.path.startsWith(home))
  )
    throw new Error("screenshot home is not isolated");
  await page.screenshot({ path: join(out, "first-run-dark.png") });
  await app.evaluate(({ Menu }) => {
    Menu.getApplicationMenu()?.getMenuItemById("settings.open")?.click();
  });
  await page.getByRole("button", { name: /About Polaris/ }).click();
  const card = page.getByTestId("command-install-card");
  await card.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(out, "before-install-dark.png") });
  await card.getByRole("button", { name: "Install", exact: true }).click();
  await card.getByRole("button", { name: "Uninstall", exact: true }).waitFor();
  const command = join(home, ".local/bin/polaris");

  if (readlinkSync(command) !== join(bin, "current/polaris"))
    throw new Error("wrong command target");

  const shell = () =>
    spawnSync(
      "/bin/sh",
      ["-lc", `PATH='${home}/.local/bin:/usr/bin:/bin'; which polaris; polaris version`],
      { encoding: "utf8" }
    );

  if (!shell().stdout.includes("polaris 1.0.0"))
    throw new Error("new shell did not resolve command");
  rmSync(join(bin, "current"));
  symlinkSync("2.0.0", join(bin, "current"));

  if (!shell().stdout.includes("polaris 2.0.0")) throw new Error("command did not follow upgrade");

  for (const theme of ["dark", "light"] as const) {
    for (const density of ["calm", "balanced", "compact"] as const) {
      await page.evaluate(
        `window.polaris.request("settings.setAppearance", { patch: ${JSON.stringify({ theme, density, motion: "reduce", diffPalette: "cvd" })} })`
      );
      await card.scrollIntoViewIfNeeded();
      await page.waitForTimeout(150);
      await page.screenshot({ path: join(out, `installed-${theme}-${density}.png`) });
    }
  }

  await page.keyboard.press("Meta+Shift+p");
  await page.getByRole("combobox").fill("polaris command");
  await page.getByText("Uninstall polaris command", { exact: true }).waitFor();
  await page.screenshot({ path: join(out, "command-menu-light.png") });
  await page.keyboard.press("Escape");
  await card.getByRole("button", { name: "Uninstall", exact: true }).click();
  await card.getByRole("button", { name: "Install", exact: true }).waitFor();
  console.log(
    JSON.stringify({
      home,
      screenshotDirectory: out,
      shellResolved: true,
      upgradeFollowed: true,
      uninstallCompleted: true,
    })
  );
} finally {
  await app?.close();
  await daemon.stop();
  rmSync(home, { recursive: true, force: true });
}
