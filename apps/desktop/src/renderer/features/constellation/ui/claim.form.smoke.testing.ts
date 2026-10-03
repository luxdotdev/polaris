import { strict as assert } from "node:assert";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "vite";
import { _electron } from "playwright-core";
import { stockElectronBinary } from "../../../../../scripts/lib/electron.ts";

const root = await mkdtemp(join(tmpdir(), "review-busy-accept-"));

const server = await createServer({
  configFile: join(import.meta.dirname, "../../../../../vite.config.ts"),
  root: import.meta.dirname,
  cacheDir: join(root, "cache"),
  server: { port: 0, host: "127.0.0.1", strictPort: false, hmr: false, watch: null },
});

try {
  await server.listen();
  const url = `${server.resolvedUrls!.local[0]}claim.form.testing.html`;
  const main = join(root, "main.cjs");
  await writeFile(
    main,
    `const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(join(root, "data"))});app.whenReady().then(()=>{const w=new BrowserWindow({show:false,webPreferences:{sandbox:true}});w.loadURL(${JSON.stringify(url)});});`
  );
  const app = await _electron.launch({ executablePath: stockElectronBinary(), args: [main] });

  try {
    const page = await app.firstWindow();
    const errors: string[] = [];

    page.on("pageerror", (e) => errors.push(e.message));
    await page.locator("#merged-head").waitFor();

    for (const [head, bump] of [
      ["edited-head", false],
      ["edited-head", true],
    ] as const) {
      await page.getByRole("checkbox").click();
      assert.equal(await page.getByRole("checkbox").getAttribute("aria-checked"), "false");
      await page.getByRole("button", { name: "Accept B1", exact: true }).click();
      await page.getByTestId("claim-refused").waitFor();
      await page.locator("#merged-head").fill("user input for old claim");
      await page.evaluate(`window.replaceClaim(${JSON.stringify(head)}, ${bump})`);
      await page.waitForFunction(
        (head) => document.querySelector<HTMLInputElement>("#merged-head")?.value === head,
        head
      );
      assert.equal(await page.getByRole("checkbox").getAttribute("aria-checked"), "true");
      assert.equal(await page.getByTestId("claim-refused").count(), 0);
    }

    assert.deepEqual(errors, []);
    console.log(
      "Mounted Accept form: head change and revision change reset head, receipts and refusal copy."
    );
  } finally {
    await app.close();
  }
} finally {
  await server.close();
  await rm(root, { recursive: true, force: true });
}
