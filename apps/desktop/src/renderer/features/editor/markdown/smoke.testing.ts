import { strict as assert } from "node:assert";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir, loadavg } from "node:os";
import { join } from "node:path";
import { createServer } from "vite";
import { _electron } from "playwright-core";
import { stockElectronBinary } from "../../../../../scripts/lib/electron.ts";
import { Schema } from "effect";

const output = process.argv[2];

if (!output) throw new Error("Pass an evidence output directory");

await mkdir(output, { recursive: true });

console.error(
  "M1 bounded fixture started: rendered checks, six screenshots, 3 warm control/preview samples"
);

const temporary = await mkdtemp(join(tmpdir(), "m31-m1-electron-"));

const server = await createServer({
  configFile: join(import.meta.dirname, "../../../../../vite.config.ts"),
  root: import.meta.dirname,
  cacheDir: join(temporary, "vite-cache"),
  server: { port: 0, strictPort: false, host: "127.0.0.1", hmr: false, watch: null },
});

await server.listen();

const address = server.resolvedUrls?.local[0];

if (!address) throw new Error("Fixture server unavailable");

const entry = join(temporary, "main.cjs");

await writeFile(
  entry,
  `const {app,BrowserWindow}=require('electron');
app.setPath('userData',${JSON.stringify(join(temporary, "user-data"))});
app.whenReady().then(()=>{const w=new BrowserWindow({show:false,width:1000,height:1050,webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true}});w.loadURL(${JSON.stringify(`${address}evidence.html?plain=1`)});});`
);

const launched = performance.now();

const app = await _electron.launch({ executablePath: stockElectronBinary(), args: [entry] });

const Snapshot = Schema.Struct({
  calls: Schema.Array(Schema.String),
  created: Schema.Array(Schema.String),
  revoked: Schema.Array(Schema.String),
  mediaPaths: Schema.Array(Schema.String),
  mediaStats: Schema.Struct({ inFlight: Schema.Number, peak: Schema.Number }),
});

const errors: Array<string> = [];

const externalRequests: Array<string> = [];

const metrics: Record<string, Array<number>> = {};

try {
  const page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());

    if (url.protocol === "http:" && url.hostname === "127.0.0.1") return route.continue();

    if (url.protocol === "blob:" || url.protocol === "data:") return route.continue();
    externalRequests.push(url.href);

    return route.abort();
  });

  const snapshot = async () =>
    Schema.decodeUnknownSync(Snapshot)(await page.evaluate("window.fixture"));

  await page.getByRole("heading", { name: "Plain unsaved source" }).waitFor();

  const initialImports = await page.evaluate(() =>
    performance.getEntriesByType("resource").map((entry) => entry.name)
  );

  assert.equal(
    initialImports.some((name) =>
      /streamdown_(?:code|mermaid|math)|shiki|mermaid.*chunk/i.test(name)
    ),
    false
  );
  await page.getByRole("button", { name: "Full sample", exact: true }).click();
  await page.getByRole("heading", { name: "Unsaved preview" }).waitFor();
  await page
    .locator('[data-streamdown="mermaid-block"] svg[aria-roledescription]')
    .waitFor({ timeout: 30000 });
  metrics["fixture-cold-ready-ms"] = [performance.now() - launched];
  assert.equal(await page.locator("table").count(), 1);
  assert.equal(await page.locator('input[type="checkbox"]').count(), 2);
  assert.equal(await page.locator("del").count(), 1);
  assert.equal(await page.locator("script:not([type=module]),iframe").count(), 0);
  assert.equal(await page.evaluate("window.compromised === true"), false);
  assert.equal(
    (await snapshot()).calls.filter((x) => x === "languages.preview.external").length,
    0
  );
  await page.getByRole("link", { name: "Relative guide" }).click();
  assert.ok((await snapshot()).calls.includes("open:fake-linux:/fixture/docs/guide.md#intro"));
  await page.getByRole("link", { name: "Jump", exact: true }).focus();
  await page.keyboard.press("Enter");
  assert.equal(await page.evaluate("document.activeElement.id"), "preview-unsaved-preview");
  await page.getByRole("button", { name: "Load external images" }).click();
  await page.locator('img[alt="External image"]').waitFor();
  await page.locator('img[alt="External image"]').evaluate(async (image) => {
    if (image instanceof HTMLImageElement) await image.decode();
  });
  await page.waitForFunction(
    "window.fixture.calls.filter(x=>x==='languages.preview.external').length===2"
  );

  for (const theme of ["dark", "light"]) {
    for (const density of ["calm", "balanced", "compact"]) {
      await page.evaluate(
        ({ theme, density }) => {
          document.documentElement.dataset.theme = theme;
          document.documentElement.dataset.density = density;
          document.documentElement.dataset.diffPalette = "cvd";
        },
        { theme, density }
      );
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.screenshot({ path: join(output, `${theme}-${density}.png`) });
      assert.equal(
        await page
          .locator(".markdown-preview")
          .evaluate((node) => node.scrollWidth <= node.clientWidth),
        true
      );
    }
  }

  const images = (prefix: string) =>
    `# Concurrent images\n\n${Array.from({ length: 8 }, (_, index) => `![${prefix} ${index}](${prefix}-${index}.png)`).join("\n\n")}`;

  const sourceInput = page.getByRole("textbox", { name: "Current unsaved source" });
  await sourceInput.fill(images("small"));
  await page.waitForFunction("document.querySelectorAll('main img').length===8");
  await page.locator("main img").evaluateAll(async (nodes) => {
    await Promise.all(
      nodes.map(async (node) => {
        if (node instanceof HTMLImageElement) await node.decode();
      })
    );
  });
  assert.equal((await snapshot()).mediaPaths.filter((path) => path.startsWith("small-")).length, 8);
  assert.equal((await snapshot()).mediaStats.peak, 3);

  await page.evaluate("window.mediaControl.hold=true");
  await sourceInput.fill(images("old-source"));
  await page.waitForFunction(
    "window.fixture.mediaPaths.filter(x=>x.startsWith('old-source-')).length===3"
  );
  const beforeReplacement = (await snapshot()).created.length;
  await sourceInput.fill("# Changed source\n\n![Replacement](replacement.png)");
  await page.getByRole("heading", { name: "Changed source" }).waitFor();
  await page.evaluate("window.mediaControl.hold=false;window.flushMedia()");
  await page.locator('img[alt="Replacement"]').waitFor();
  await page.locator('img[alt="Replacement"]').evaluate(async (node) => {
    if (node instanceof HTMLImageElement) await node.decode();
  });
  assert.equal(
    (await snapshot()).mediaPaths.filter((path) => path.startsWith("old-source-")).length,
    3
  );
  assert.equal((await snapshot()).created.length - beforeReplacement, 1);

  await page.evaluate("window.mediaControl.hold=true");
  await sourceInput.fill(images("closed"));
  await page.waitForFunction(
    "window.fixture.mediaPaths.filter(x=>x.startsWith('closed-')).length===3"
  );
  const beforeClose = (await snapshot()).created.length;
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.evaluate("window.mediaControl.hold=false;window.flushMedia()");
  await page.waitForFunction(
    "window.fixture.mediaStats.inFlight===0 && window.fixture.created.length===window.fixture.revoked.length"
  );
  assert.equal(
    (await snapshot()).mediaPaths.filter((path) => path.startsWith("closed-")).length,
    3
  );
  assert.equal((await snapshot()).created.length, beforeClose);
  await page.getByRole("button", { name: "Preview", exact: true }).click();

  await page
    .getByRole("textbox", { name: "Current unsaved source" })
    .fill("# Updated unsaved source\n\n## **Duplicate**\n\n## Duplicate\n\n[Second](#duplicate-1)");
  await page.getByRole("heading", { name: "Updated unsaved source" }).waitFor();
  await page.getByRole("link", { name: "Second", exact: true }).click();
  assert.equal(await page.evaluate("document.activeElement.id"), "preview-duplicate-1");
  await page.getByRole("button", { name: "Toggle Host" }).click();
  await page.getByText("Images unavailable on Fake Linux", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.waitForFunction("window.fixture.created.length===window.fixture.revoked.length");
  assert.equal(externalRequests.length, 0);

  const content =
    "# Control document\n\n" + "A paragraph with **bold**, ~~removed~~ and `code`.\n\n".repeat(50);

  await page.getByRole("textbox", { name: "Current unsaved source" }).fill(content);
  await page.getByRole("button", { name: "Toggle Host" }).click();

  await page.getByRole("button", { name: "Control", exact: true }).click();
  await page.getByRole("heading", { name: "Control document" }).waitFor();
  await page.getByRole("button", { name: "Close", exact: true }).click();

  for (const mode of ["Control", "Preview"]) {
    const renders: Array<number> = [];
    const updates: Array<number> = [];
    const disposals: Array<number> = [];

    for (let run = 0; run < 3; run++) {
      const start = performance.now();
      await page.getByRole("button", { name: mode, exact: true }).click();
      await page.getByRole("heading", { name: "Control document" }).waitFor();
      renders.push(performance.now() - start);
      const update = performance.now();
      await page
        .getByRole("textbox", { name: "Current unsaved source" })
        .fill(content + `\nUpdate ${run}`);
      await page.getByText(`Update ${run}`, { exact: true }).waitFor();
      updates.push(performance.now() - update);
      const dispose = performance.now();
      await page.getByRole("button", { name: "Close", exact: true }).click();
      await page.locator("main").evaluate((node) => {
        if (node.children.length) throw new Error("Preview still mounted");
      });
      disposals.push(performance.now() - dispose);
      await page.getByRole("textbox", { name: "Current unsaved source" }).fill(content);
    }

    metrics[`${mode}-render-ms`] = renders;
    metrics[`${mode}-update-ms`] = updates;
    metrics[`${mode}-dispose-ms`] = disposals;
  }

  assert.deepEqual(errors, []);

  const imports = await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .filter((entry) => entry.name.includes("markdown") || entry.name.includes("streamdown"))
      .map((entry) => ({ name: entry.name, duration: entry.duration }))
  );

  const evidence = {
    imports,
    initialImports,
    fixture: await snapshot(),
    errors,
    externalRequests,
    metrics,
    load: loadavg(),
    note: "Existing session Markdown control; warm dev-server wall times include Playwright input and DOM waits. Standalone fake Host fixture, not whole Desktop/frame certification.",
  };

  await writeFile(join(output, "evidence.json"), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence));
} catch (error) {
  const page = await app.firstWindow();
  await writeFile(join(output, "failure.html"), await page.content());
  await page.screenshot({ path: join(output, "failure.png") });
  throw error;
} finally {
  await app.close();
  await server.close();
  await rm(temporary, { recursive: true, force: true });
  console.error("M1 Electron child/server stopped and own temporary profile/cache removed");
}
