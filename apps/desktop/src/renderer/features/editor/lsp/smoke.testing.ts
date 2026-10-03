import { Schema } from "effect";
import { createServer } from "vite";
import { _electron, type ElectronApplication } from "playwright-core";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir, loadavg } from "node:os";
import { stockElectronBinary } from "../../../../../scripts/lib/electron.ts";

const output = process.argv[2];

if (!output) throw new Error("Pass isolated evidence directory");

await mkdir(output, { recursive: true });

const temporary = await mkdtemp(join(tmpdir(), "m31-e1-electron-"));

const Proof = Schema.Struct({
  facts: Schema.Array(Schema.String),
  requests: Schema.Array(Schema.String),
  notifications: Schema.Number,
});

let launched: ElectronApplication | null = null;

const server = await createServer({
  configFile: join(import.meta.dirname, "../../../../../vite.config.ts"),
  root: import.meta.dirname,
  cacheDir: join(temporary, "vite"),
  server: { port: 0, host: "127.0.0.1", strictPort: false, hmr: false, watch: null },
});

const errors: string[] = [];

const external: string[] = [];

try {
  await server.listen();
  const address = server.resolvedUrls?.local[0];

  if (!address) throw new Error("Fixture loopback unavailable");
  const main = join(temporary, "main.cjs");
  await writeFile(
    main,
    `const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(join(temporary, "profile"))});app.whenReady().then(()=>{const w=new BrowserWindow({show:false,width:1100,height:720,webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true}});w.loadURL(${JSON.stringify(`${address}evidence.html`)});});`
  );
  launched = await _electron.launch({ executablePath: stockElectronBinary(), args: [main] });
  const page = await launched.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());

    if (url.hostname === "127.0.0.1" || url.protocol === "data:" || url.protocol === "blob:")
      return route.continue();
    external.push(url.origin);

    return route.abort();
  });
  await page.waitForFunction("window.languageProof !== undefined");
  const proof = Schema.decodeUnknownSync(Proof)(await page.evaluate("window.languageProof.run()"));
  await page.locator(".cm-content").first().click();
  await page.keyboard.press("Control+Shift+Space");
  await page.getByText("fixture · fixture(value: string)", { exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await page.locator(".cm-line").first().hover();
  await page.getByText("Unsaved fixture hover", { exact: true }).waitFor();
  await page.locator(".cm-content").first().click();
  await page.keyboard.press("F12");
  await page.keyboard.press("Alt+ArrowLeft");
  await page.getByLabel("File language", { exact: true }).selectOption("python");
  await page.getByLabel("File language", { exact: true }).selectOption("auto");
  await page.getByLabel("Language action", { exact: true }).selectOption("symbols");
  await page.getByRole("button", { name: "Go", exact: true }).click();
  await page.getByText("fixtureSymbol", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Close", exact: true }).last().focus();
  await page.keyboard.press("Escape");

  for (const theme of ["dark", "light"] satisfies ("dark" | "light")[])
    for (const density of ["calm", "balanced", "compact"]) {
      await page.emulateMedia({ reducedMotion: "reduce", colorScheme: theme });
      await page.evaluate(
        ({ theme, density }) => {
          document.documentElement.dataset.theme = theme;
          document.documentElement.dataset.density = density;
          document.documentElement.dataset.motion = "reduce";
          document.documentElement.dataset.diffPalette = "colourblind";
        },
        { theme, density }
      );
      await page.getByLabel("Language action", { exact: true }).selectOption("symbols");
      await page.getByRole("button", { name: "Go", exact: true }).click();
      await page.getByText("fixtureSymbol", { exact: true }).waitFor();
      await page.screenshot({ path: join(output, `${theme}-${density}.png`) });
    }

  const cleanup = Schema.decodeUnknownSync(
    Schema.Struct({ watches: Schema.Number, contexts: Schema.Number, subscriptions: Schema.Number })
  )(await page.evaluate("window.languageProof.cleanup()"));

  if (cleanup.watches !== 0 || cleanup.contexts !== 0 || cleanup.subscriptions !== 0)
    throw new Error("Fixture cleanup retained ownership");

  await writeFile(
    join(output, "evidence.json"),
    JSON.stringify({ proof, cleanup, errors, external, load: loadavg() }, null, 2)
  );

  if (errors.length || external.length) throw new Error("Fixture page/external request failures");
} finally {
  await launched?.close();
  await server.close();
  await rm(temporary, { recursive: true, force: true });
}
