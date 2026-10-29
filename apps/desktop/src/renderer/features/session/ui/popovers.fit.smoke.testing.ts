/**
 * Paper X-F's menus and popovers fit a 1280×720 window (ENG-517, rule/popover-fits-window):
 * each stays 12px clear of the window's edges in Moonlit, Midnight and light.
 *
 *   node src/renderer/features/session/ui/popovers.fit.smoke.testing.ts [--out <dir>]
 */
import { strict as assert } from "node:assert";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "vite";
import { _electron, type Page } from "playwright-core";
import { stockElectronBinary } from "../../../../../scripts/lib/electron.ts";

const WIDTH = 1280;

const HEIGHT = 720;

const EDGE = 12;

const at = process.argv.indexOf("--out");

const out = at === -1 ? null : (process.argv[at + 1] ?? null);

const root = await mkdtemp(join(tmpdir(), "popovers-fit-"));

const server = await createServer({
  configFile: join(import.meta.dirname, "../../../../../vite.config.ts"),
  root: import.meta.dirname,
  cacheDir: join(root, "cache"),
  server: { port: 0, host: "127.0.0.1", strictPort: false, hmr: false, watch: null },
});

interface Box {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
}

interface Surface {
  readonly name: string;
  /** What shows it, as a user would. */
  readonly open: (page: Page) => Promise<void>;
  readonly card: string;
}

const click = (testId: string) => (page: Page) => page.getByTestId(testId).first().click();

/** Paper X-F's rows, each opened as a user would. */
const SURFACES: ReadonlyArray<Surface> = [
  { name: "context", open: click("session-context"), card: "context-card" },
  { name: "picker", open: click("model-picker"), card: "model-card" },
  { name: "hosts", open: click("hosts-trigger"), card: "hosts-card" },
  { name: "needs-you", open: click("needs-you-trigger"), card: "needs-you-inbox" },
  {
    name: "session-menu",
    open: (page) => page.locator("[data-session-row]").first().click({ button: "right" }),
    card: "session-context-menu",
  },
  {
    name: "jump",
    open: async (page) => {
      await page.getByText("Jump to a session or workspace").click();
      await page.keyboard.type("pol");
    },
    card: "jump-menu",
  },
  {
    name: "toast",
    open: async (page) => {
      await page.evaluate("window.__showToast()");
    },
    card: "toast",
  },
];

const measure = (page: Page, testId: string) =>
  page.evaluate<Box>(
    `(() => { const r = document.querySelector('[data-testid="${testId}"], [data-slot="${testId}"]').getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; })()`
  );

try {
  await server.listen();
  const base = `${server.resolvedUrls!.local[0]}popovers.fit.testing.html`;
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
    page.on("console", (m) => {
      if (m.type() === "error") console.error(`page: ${m.text()}`);
    });
    await page.setViewportSize({ width: WIDTH, height: HEIGHT });

    for (const theme of ["moonlit", "midnight", "light"])
      for (const { name, open, card } of SURFACES) {
        await page.goto(`${base}?theme=${theme}`);
        await page.getByTestId("session-panel").waitFor();
        await open(page);
        await page.locator(`[data-testid="${card}"], [data-slot="${card}"]`).first().waitFor();
        await page.waitForTimeout(400);

        const box = await measure(page, card);

        for (const [edge, ok] of [
          ["top", box.top >= EDGE - 0.5],
          ["bottom", box.bottom <= HEIGHT - EDGE + 0.5],
          ["left", box.left >= EDGE - 0.5],
          ["right", box.right <= WIDTH - EDGE + 0.5],
        ] as const)
          assert.ok(
            ok,
            `${theme} ${name}: the card's ${edge} is past the edge (${JSON.stringify(box)})`
          );

        if (out !== null) {
          await mkdir(out, { recursive: true });
          await page.screenshot({ path: join(out, `${name}-1280x720-${theme}.png`) });
        }
      }

    assert.deepEqual(errors, []);
    console.log(
      `${SURFACES.length} menus and popovers at ${WIDTH}×${HEIGHT}: each stays ${EDGE}px clear of the window in every theme.`
    );
  } finally {
    await app.close();
  }
} finally {
  await server.close();
  await rm(root, { recursive: true, force: true });
}
