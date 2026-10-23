/**
 * `polaris://` links end to end (build first): node apps/desktop/scripts/deepLinkSmoke.ts. A link in
 * the launch's argv waits for the window and the local Host; links from a second instance navigate too.
 */
import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Schema } from "effect";
import { _electron as electron, type ElectronApplication, type Page } from "playwright-core";
import { startDaemon } from "./lib/daemon.ts";
import { APP_DIR, electronBinary } from "./lib/electron.ts";
import { MOCK_KEYCHAIN } from "./lib/githubFlow.ts";

// A short path: the Daemon's Unix socket lives under it.
const root = mkdtempSync(join(tmpdir(), "pdl-"));

const userData = join(root, "user-data");

const home = join(root, "home");

mkdirSync(userData, { recursive: true });

writeFileSync(join(userData, "settings.json"), JSON.stringify({ welcomeSeen: true }));

const daemon = await startDaemon({ home, benchHarness: true });

const hostId = readFileSync(join(home, "host-id"), "utf8").trim();

const env = {
  ...process.env,
  POLARIS_DESKTOP_LOCAL_SOCKET: daemon.socketPath,
  POLARIS_DESKTOP_USER_DATA: userData,
  POLARIS_DESKTOP_HIDDEN: "1",
};

const Field = Schema.optionalKey(Schema.NullOr(Schema.String));

/** The renderer's persisted navigation (routes/navigation.ts), written 300 ms after a change. */
const Navigation = Schema.fromJsonString(
  Schema.Struct({ hostKey: Field, workspaceId: Field, sessionId: Field })
);

type Navigation = typeof Navigation.Type;

const navigation = async (page: Page): Promise<Navigation> =>
  Schema.decodeUnknownSync(Navigation)(
    (await page.evaluate(`localStorage.getItem("polaris.navigation.v1")`)) ?? "{}"
  );

const until = async (page: Page, what: string, check: (nav: Navigation) => boolean) => {
  for (const end = Date.now() + 30_000; Date.now() < end;) {
    if (check(await navigation(page))) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`timed out waiting for ${what}: ${JSON.stringify(await navigation(page))}`);
};

/** Another launch with the link, as Windows and Linux deliver one; it hands over and exits. */
const secondInstance = (url: string) =>
  new Promise<number | null>((resolve) => {
    const child = spawn(electronBinary(), [APP_DIR, MOCK_KEYCHAIN, url], { env, stdio: "ignore" });

    child.once("exit", resolve);
  });

let app: ElectronApplication | null = null;

const logs: Array<string> = [];

try {
  app = await electron.launch({
    executablePath: electronBinary(),
    args: [APP_DIR, MOCK_KEYCHAIN, `polaris://workspace/${hostId}/w-smoke`],
    timeout: 30_000,
    env,
  });
  app.process().stderr?.on("data", (chunk: Buffer) => logs.push(String(chunk)));
  app.process().stdout?.on("data", (chunk: Buffer) => logs.push(String(chunk)));
  const page = await app.firstWindow();

  await until(page, "the launch link's Workspace", (nav) => nav.workspaceId === "w-smoke");
  assert.equal((await navigation(page)).hostKey, "local");
  console.log("deep link smoke: a link at launch opened its Workspace");

  assert.equal(await secondInstance(`polaris://session/${hostId}/s-smoke`), 0);
  await until(page, "the second instance's session", (nav) => nav.sessionId === "s-smoke");
  console.log("deep link smoke: a link from a second instance opened its session");

  await secondInstance(`polaris://approve/${hostId}/r1`);
  await new Promise((resolve) => setTimeout(resolve, 1000));
  assert.equal((await navigation(page)).sessionId, "s-smoke");
  assert.ok(
    logs.some((line) => line.includes("polaris: ignored a deep link (not a session or workspace")),
    logs.join("")
  );
  console.log("deep link smoke: an unknown link was ignored with a log line");
} finally {
  await app?.close();
  await daemon.stop();
  rmSync(root, { recursive: true, force: true });
}
