/** Real main/preload/renderer, download, verification and loopback feed; only Squirrel is a stand-in. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import {
  createReadStream,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { type ElectronApplication, type Page } from "playwright-core";
import { Schema } from "effect";
import { scriptedElectron as electron, electronBinary, OUT_DIR } from "./lib/electron.ts";
import { startDaemon } from "./lib/daemon.ts";
import { MOCK_KEYCHAIN } from "./lib/githubFlow.ts";
import { takeScriptLease } from "../../../tooling/leases.ts";
import type { PolarisApi } from "../src/shared/api.ts";
import type { AppUpdateView } from "../src/shared/appUpdates.ts";

declare const window: { readonly polaris: PolarisApi };

await takeScriptLease("smoke");

const root = mkdtempSync(join(tmpdir(), "polaris-app-update-smoke-"));

const entry = join(OUT_DIR, "main", "app-update-smoke.mjs");

const Receipt = Schema.Struct({
  installs: Schema.Number,
  downloaded: Schema.Boolean,
  loopback: Schema.Boolean,
});

// The Update is the running dev app itself: signed ad hoc, so it meets its own requirement.
const bundle = join(dirname(electronBinary()), "../..");

const zipPath = join(root, "Polaris-0.5.0-arm64-mac.zip");

assert.equal(
  spawnSync("/usr/bin/ditto", ["-c", "-k", "--keepParent", bundle, zipPath]).status,
  0,
  "ditto could not archive the dev app"
);

const zipBytes = statSync(zipPath).size;

const requests: Array<{
  path: string;
  id: string | string[] | undefined;
  os: string | string[] | undefined;
}> = [];

let offer = false;

const server = createServer((request, response) => {
  const path = request.url ?? "";
  requests.push({
    path,
    id: request.headers["x-polaris-install-id"],
    os: request.headers["x-polaris-macos-version"],
  });

  if (path.endsWith(".zip")) {
    response.writeHead(200, { "Content-Length": zipBytes });
    createReadStream(zipPath).pipe(response);

    return;
  }

  if (!offer) {
    response.writeHead(204);
    response.end();

    return;
  }

  response.setHeader("Content-Type", "application/json");
  response.end(
    JSON.stringify({
      url: "https://polaris.lux.dev/download/Polaris-0.5.0-arm64-mac.zip",
      name: "October release",
      notes: "fake",
      pub_date: "2026-10-02T00:00:00Z",
    })
  );
});

await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

const address = Schema.decodeUnknownSync(Schema.Struct({ port: Schema.Number }))(server.address());

const origin = `http://127.0.0.1:${address.port}`;

// This fixture answers polaris.lux.dev from the local server and stands in for Squirrel only;
// the bundled production main downloads, verifies and serves the loopback feed unchanged.
writeFileSync(
  entry,
  `
import { app, autoUpdater, net, protocol } from 'electron';
import { writeFileSync } from 'node:fs';
Object.defineProperty(app, 'isPackaged', { get: () => true });
const ORIGIN = ${JSON.stringify(origin)};
void app.whenReady().then(() => protocol.handle('https', (request) => {
  const url = new URL(request.url);
  return url.origin === 'https://polaris.lux.dev'
    ? net.fetch(ORIGIN + url.pathname, { headers: request.headers, bypassCustomProtocolHandlers: true })
    : net.fetch(request, { bypassCustomProtocolHandlers: true });
}));
let feed; let downloaded = false; let loopback = false; let installs = 0;
autoUpdater.setFeedURL = (value) => { feed = value; };
autoUpdater.checkForUpdates = () => {
  void (async () => {
    const url = new URL(feed.url);
    if (url.hostname !== '127.0.0.1' || url.origin === ORIGIN) throw new Error('not the loopback feed');
    const release = await (await fetch(feed.url)).json();
    if (!release.url.startsWith(url.origin + '/')) throw new Error('unexpected ZIP origin');
    const zip = await fetch(release.url);
    const bytes = (await zip.arrayBuffer()).byteLength;
    if (!zip.ok || bytes !== ${zipBytes}) throw new Error('the loopback feed served another file');
    downloaded = true; loopback = true;
    autoUpdater.emit('update-downloaded', {}, release.notes, release.name, new Date(release.pub_date), release.url);
  })().catch(() => autoUpdater.emit('error', new Error('fake Squirrel failed')));
};
autoUpdater.quitAndInstall = () => { if (!downloaded) throw new Error('not downloaded'); installs++; app.quit(); };
app.on('quit', () => writeFileSync(process.env.POLARIS_UPDATE_RECEIPT, JSON.stringify({ installs, downloaded, loopback })));
await import('./index.js');
`
);

writeFileSync(
  join(root, "package.json"),
  JSON.stringify({ name: "polaris-update-fixture", version: "0.4.0", type: "module", main: entry })
);

const daemon = await startDaemon({ home: join(root, "daemon"), benchHarness: true });

let app: ElectronApplication | null = null;

/** Polls main's update state from here: a page-side async predicate is truthy as a Promise. */
const updatesReach = async (page: Page, reached: (view: AppUpdateView) => boolean) => {
  let last = "no answer";

  for (let waited = 0; waited < 120_000; waited += 100) {
    const result = await page.evaluate(() => window.polaris.request("updates.get", {}));

    if (result.ok && reached(result.value)) return;
    last = JSON.stringify(result.ok ? result.value : result.error);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`the update state never arrived; last: ${last}`);
};

const run = async (restart: boolean) => {
  const userData = join(root, "app-data");

  if (restart) {
    mkdirSync(userData, { recursive: true });
    writeFileSync(join(userData, "settings.json"), JSON.stringify({ welcomeSeen: true }));
  }

  const receiptPath = join(root, restart ? "restart.json" : "quit.json");
  offer = false;
  const before = requests.length;
  app = await electron.launch({
    executablePath: electronBinary(),
    args: [root, MOCK_KEYCHAIN],
    env: {
      ...process.env,
      POLARIS_DESKTOP_USER_DATA: userData,
      POLARIS_DESKTOP_LOCAL_SOCKET: daemon.socketPath,
      POLARIS_DESKTOP_BENCH_HARNESS: "1",
      POLARIS_DESKTOP_HIDDEN: "1",
      POLARIS_UPDATE_RECEIPT: receiptPath,
    },
  });
  app.process().stdout?.on("data", (chunk: Buffer) => console.log(chunk.toString().trim()));
  app.process().stderr?.on("data", (chunk: Buffer) => console.log(chunk.toString().trim()));
  const page = await app.firstWindow();
  page.setDefaultTimeout(10_000);
  console.log("App update smoke: window opened");

  if (!restart) {
    await updatesReach(page, (view) => !view.automatic && view.phase === "idle");
    assert.equal(requests.length, before);
    assert.equal(readFileSync(join(userData, "install-id"), "utf8").trim(), requests[0]?.id);
    await page.evaluate(() => window.polaris.request("updates.check", {}));
  }

  await updatesReach(page, (view) => view.phase === "current");
  assert.equal(requests[before]?.path, "/api/update/darwin-arm64/0.4.0");
  console.log("App update smoke: launch check current");

  if (restart)
    assert.match(
      String(requests[before]?.id),
      /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/
    );
  else assert.equal(requests[before]?.id, undefined);
  assert.match(String(requests[before]?.os), /^\d+\.\d+/);
  assert.equal(requests[0]?.id, readFileSync(join(userData, "install-id"), "utf8").trim());
  await page.evaluate(() => window.polaris.request("updates.setAutomatic", { enabled: false }));
  await page.evaluate(() => window.polaris.request("updates.check", {}));
  await updatesReach(page, (view) => view.phase === "current");
  assert.equal(requests[before + 1]?.id, undefined);
  offer = true;

  // Every download state main publishes while the real download, verification and handover run.
  const seen = await page.evaluateHandle(() => {
    const downloads: Array<{ receivedBytes: number; totalBytes: number | null }> = [];

    window.polaris.onAppEvent((event) => {
      if (event.kind === "updates" && event.updates.download !== null)
        downloads.push(event.updates.download);
    });

    return downloads;
  });

  await page.evaluate(() => window.polaris.request("updates.check", {}));
  await updatesReach(page, (view) => view.phase === "ready" && view.readyVersion === "0.5.0");

  const downloads = await seen.jsonValue();

  // macOS's feed names no size: the total is unknown until the asset's server answers.
  const sized = downloads.filter((download) => download.totalBytes !== null);

  assert(sized.length >= 2, "the download published progress");
  assert(sized.every((download) => download.totalBytes === zipBytes));
  assert.equal(downloads.at(-1)?.receivedBytes, zipBytes);
  assert.equal(requests.at(-1)?.path, "/download/Polaris-0.5.0-arm64-mac.zip");

  const labels = await app.evaluate(({ Menu }) =>
    Menu.getApplicationMenu()?.items[0]?.submenu?.items.map((item) => item.label)
  );

  console.log("App update smoke: downloaded and ready");

  assert(labels?.includes("Restart to update to 0.5.0"));
  assert(labels?.includes("Quit and update"));
  await page.keyboard.press("Meta+Shift+p");
  await page.getByRole("dialog", { name: "Command Palette" }).waitFor();
  await page
    .getByRole("dialog", { name: "Command Palette" })
    .getByText("Restart to update", { exact: true })
    .waitFor();
  await page.keyboard.press("Escape");
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
  console.log("App update smoke: unsaved quit cancelled");
  assert.equal(
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible()),
    false
  );
  await page.evaluate(() =>
    window.polaris.request("editor.publishDirty", {
      files: [{ hostKey: "local", path: "/tmp/unsaved.txt", unkept: false }],
    })
  );
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 2, checkboxChecked: false });
  });
  await page.evaluate(() => window.polaris.request("updates.restart", {}));
  // Flush main's cancelled prompt before another quit request.
  await app.evaluate(async () => {
    await new Promise<void>((resolve) => setImmediate(resolve));
  });
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
  });
  const closed = new Promise<void>((resolve) => app?.once("close", () => resolve()));

  if (restart) await page.evaluate(() => window.polaris.request("updates.restart", {}));
  else await app.evaluate(({ app: nativeApp }) => nativeApp.quit());
  await closed;
  app = null;

  const receipt = Schema.decodeUnknownSync(Schema.fromJsonString(Receipt))(
    readFileSync(receiptPath, "utf8")
  );

  assert.equal(receipt.downloaded, true);
  assert.equal(receipt.loopback, true);
  assert.equal(receipt.installs, restart ? 1 : 0);
  console.log(
    `App update smoke: ${restart ? "restart" : "quit without relaunch"}, cancel unsaved quit, hide window, ID opt-out: ok`
  );
};

try {
  await run(true);
  await run(false);
} finally {
  // SAFETY: run mutates app across awaits; TypeScript only sees its initial null.
  const active = app as ElectronApplication | null;

  if (active !== null) {
    await active
      .evaluate(({ dialog }) => {
        dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
      })
      .catch(() => {});
    await active.close();
  }

  await daemon.stop();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
  rmSync(entry, { force: true });
  rmSync(root, { recursive: true, force: true });
}
