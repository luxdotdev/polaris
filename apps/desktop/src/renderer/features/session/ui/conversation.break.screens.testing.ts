/**
 * The break-UI pass on the conversation and its popovers (ENG-499): each worst-case scene
 * (preview/worstConversation.ts) at rest and with each card open, in Moonlit, Midnight and light.
 *
 *   node src/renderer/features/session/ui/conversation.break.screens.testing.ts --out <dir>
 *     [--scenes worst-turns,…] [--themes moonlit,…] [--size 1280x720] [--open context,picker,…]
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "vite";
import { _electron, type Page } from "playwright-core";
import { stockElectronBinary } from "../../../../../scripts/lib/electron.ts";

const option = (name: string) => {
  const at = process.argv.indexOf(name);

  return at === -1 ? null : (process.argv[at + 1] ?? null);
};

const out = option("--out");

if (out === null) throw new Error("--out <dir> is required");

const [WIDTH = 1280, HEIGHT = 720] = (option("--size") ?? "1280x720").split("x").map(Number);

const scenes = (
  option("--scenes") ??
  "worst-turns,worst-context-zero,worst-context-unknown,worst-context-huge,worst-supervised"
).split(",");

const themes = (option("--themes") ?? "moonlit,midnight,light").split(",");

const click = (testId: string) => (page: Page) => page.getByTestId(testId).first().click();

const OPENERS = {
  rest: async () => undefined,
  context: click("session-context"),
  picker: click("model-picker"),
  // The first model has eight efforts, two of them unknown to this build.
  "picker-efforts": async (page: Page) => {
    await click("model-picker")(page);
    await page.getByTestId("model-option").first().click();
  },
  permission: click("composer-permission"),
  subagents: click("composer-subagents"),
  notices: click("notice-more"),
  hosts: click("hosts-trigger"),
  "needs-you": click("needs-you-trigger"),
  // The oldest requests: the long and the multi-line command.
  "needs-you-end": async (page: Page) => {
    await click("needs-you-trigger")(page);
    await page.getByTestId("needs-you-inbox").locator("li").last().scrollIntoViewIfNeeded();
  },
  jump: async (page: Page) => {
    await page.getByText("Jump to a session or workspace").click();
    await page.keyboard.type("zzqx nothing matches this");
  },
  toasts: (page: Page) => page.evaluate<void>("window.__showToasts()"),
  "toasts-hover": async (page: Page) => {
    await page.evaluate<void>("window.__showToasts()");
    await page.waitForTimeout(400);
    await page.locator("[data-sonner-toast]").first().hover();
  },
} satisfies Record<string, (page: Page) => Promise<void>>;

const opens = (option("--open") ?? Object.keys(OPENERS).join(",")).split(",");

const root = await mkdtemp(join(tmpdir(), "conversation-break-"));

const server = await createServer({
  configFile: join(import.meta.dirname, "../../../../../vite.config.ts"),
  root: import.meta.dirname,
  cacheDir: join(root, "cache"),
  server: { port: 0, host: "127.0.0.1", strictPort: false, hmr: false, watch: null },
});

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

    page.on("pageerror", (e) => console.error(`page error: ${e.message}`));
    await page.setViewportSize({ width: WIDTH, height: HEIGHT });
    await mkdir(out, { recursive: true });

    for (const scene of scenes)
      for (const theme of themes)
        for (const name of opens) {
          await page.goto(`${base}?theme=${theme}&scene=${scene}`);
          await page.getByTestId("session-panel").waitFor();
          await page.waitForTimeout(300);

          try {
            await Object.entries(OPENERS).find(([n]) => n === name)?.[1](page);
          } catch (error) {
            console.error(`${scene} ${theme} ${name}: couldn't open (${String(error)})`);
            continue;
          }

          await page.waitForTimeout(400);
          const path = join(out, `${scene}-${name}-${theme}-${WIDTH}x${HEIGHT}.png`);

          await page.screenshot({ path });
          console.log(`screens: ${path}`);
        }
  } finally {
    await app.close();
  }
} finally {
  await server.close();
  await rm(root, { recursive: true, force: true });
}
