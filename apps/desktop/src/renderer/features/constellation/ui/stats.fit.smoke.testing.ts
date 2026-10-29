/**
 * The Stats popover fits a 1280×720 window (ENG-507, rule/popover-fits-window): its header and
 * status line stay on screen and its body scrolls to the last row.
 *
 *   node src/renderer/features/constellation/ui/stats.fit.smoke.testing.ts [--out <dir>] [--tasks <n>]
 */
import { strict as assert } from "node:assert";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "vite";
import { _electron } from "playwright-core";
import { stockElectronBinary } from "../../../../../scripts/lib/electron.ts";

const WIDTH = 1280;

const HEIGHT = 720;

const EDGE = 12;

const at = process.argv.indexOf("--out");

const out = at === -1 ? null : (process.argv[at + 1] ?? null);

const tasksAt = process.argv.indexOf("--tasks");

const tasks = tasksAt === -1 ? "" : `&tasks=${process.argv[tasksAt + 1] ?? ""}`;

const root = await mkdtemp(join(tmpdir(), "stats-fit-"));

const server = await createServer({
  configFile: join(import.meta.dirname, "../../../../../vite.config.ts"),
  root: import.meta.dirname,
  cacheDir: join(root, "cache"),
  server: { port: 0, host: "127.0.0.1", strictPort: false, hmr: false, watch: null },
});

interface Box {
  readonly top: number;
  readonly bottom: number;
}

const box = (selector: string) =>
  `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; })()`;

try {
  await server.listen();
  const base = `${server.resolvedUrls!.local[0]}stats.fit.testing.html`;
  const main = join(root, "main.cjs");

  await writeFile(
    main,
    `const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(join(root, "data"))});app.whenReady().then(()=>{const w=new BrowserWindow({show:false,useContentSize:true,width:${WIDTH},height:${HEIGHT},webPreferences:{sandbox:true}});w.loadURL(${JSON.stringify(base)});});`
  );
  const app = await _electron.launch({ executablePath: stockElectronBinary(), args: [main] });

  try {
    const page = await app.firstWindow();
    const errors: string[] = [];

    page.on("pageerror", (e) => errors.push(e.message));
    await page.setViewportSize({ width: WIDTH, height: HEIGHT });

    for (const theme of ["dark", "midnight", "light"]) {
      await page.goto(`${base}?theme=${theme}${tasks}`);
      await page.getByTestId("stats-work").waitFor();
      await page.waitForTimeout(400);

      const card = await page.evaluate<Box>(box('[data-testid="stats-popover"]'));
      const status = await page.getByText(/^As of .* · revision 37$/i).boundingBox();

      assert.ok(card.bottom <= HEIGHT - EDGE + 0.5, `${theme}: the card ends at ${card.bottom}`);
      assert.ok(
        status !== null && status.y + status.height <= card.bottom,
        `${theme}: the status line is below the card, at ${status?.y}`
      );

      if (out !== null) {
        await mkdir(out, { recursive: true });
        await page.screenshot({
          path: join(out, `stats${tasks.replace(/\W+/g, "-")}-1280x720-${theme}.png`),
        });
      }

      // Scrolls whichever element scrolls, then checks the last well is inside it.
      const scroller = `[...document.querySelectorAll('[data-testid="stats-popover"], [data-testid="stats-popover"] *')].find((e) => e.scrollHeight > e.clientHeight && getComputedStyle(e).overflowY !== "visible")`;

      const view = await page.evaluate<Box | null>(
        `(() => { const e = ${scroller}; if (!e) return null; e.scrollTo(0, 1e6); const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; })()`
      );

      await page.waitForTimeout(100);
      const last = await page.evaluate<Box>(box('[data-testid="stats-work"]'));
      const bottom = Math.min(view?.bottom ?? HEIGHT, HEIGHT);

      assert.ok(
        last.bottom <= bottom + 0.5,
        `${theme}: the last row ends at ${last.bottom}, past ${bottom}`
      );

      const title = await page.getByLabel("Measure spend in").boundingBox();

      assert.ok(title !== null && title.y >= card.top, `${theme}: the header scrolled away`);

      if (out !== null)
        await page.screenshot({
          path: join(out, `stats${tasks.replace(/\W+/g, "-")}-1280x720-${theme}-end.png`),
        });
    }

    assert.deepEqual(errors, []);
    console.log(
      `Stats at ${WIDTH}×${HEIGHT}: the card ends ${EDGE}px clear of the window, the status line stays, the body scrolls to its last row.`
    );
  } finally {
    await app.close();
  }
} finally {
  await server.close();
  await rm(root, { recursive: true, force: true });
}
