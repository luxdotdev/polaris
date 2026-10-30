/**
 * The CDP relay end to end (ENG-616): the real relay, a real Electron `WebContentsView` behind
 * the Desktop facade (`apps/desktop/src/main/browserCdp/smoke/electronMain.ts`), and the real
 * agent-browser binary driving a real page. Skipped without Electron or `AGENT_BROWSER_BIN`
 * (or `agent-browser` on PATH).
 */
import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  type ByteTransport,
  NO_DESKTOP_APP_MESSAGE,
  NoDesktopApp,
  SessionId,
} from "@polaris/protocol";
import { Context, Effect, Exit, Layer, Scope } from "effect";
import { shortTemp } from "../platform/testing.ts";
import { type BunSocketStream, socketHandlers } from "../transport/bunSocket.ts";
import { CdpRelay } from "./cdpRelay.ts";
import { BrowserHosting } from "./hosting.ts";

const repo = resolve(import.meta.dir, "../../../..");

const electron = join(repo, "apps/desktop/node_modules/.bin/electron");

const agentBrowser = process.env.AGENT_BROWSER_BIN ?? Bun.which("agent-browser");

const available = existsSync(electron) && agentBrowser !== null && process.env.CI === undefined;

const smoke = available ? test : test.skip;

const mine = SessionId.make("mine");

const page = `<!doctype html><title>Smoke page</title><h1>Hello Polaris</h1>
<button id="go" onclick="document.getElementById('out').textContent='clicked'">Go</button>
<p id="out">idle</p>`;

let root = "";

let socketPath = "";

let electronProcess: Bun.Subprocess<"pipe", "pipe", "pipe"> | null = null;

let server: ReturnType<typeof Bun.serve> | null = null;

const scope = Effect.runSync(Scope.make());

let relay: CdpRelay["Service"];

let hosted = true;

const electronLog: Array<string> = [];

const unused = () => Effect.die(new Error("not part of this smoke"));

const connectDesktop = (): Promise<ByteTransport> =>
  new Promise((resolvePromise, reject) => {
    Bun.connect<BunSocketStream | undefined>({
      unix: socketPath,
      socket: socketHandlers((transport) => resolvePromise(transport)),
    }).catch(reject);
  });

const fakeHosting = Layer.succeed(BrowserHosting)(
  BrowserHosting.of({
    register: unused,
    claim: unused,
    release: unused,
    accept: unused,
    close: unused,
    credit: unused,
    current: (sessionId) =>
      hosted ? Effect.succeed(1) : Effect.fail(new NoDesktopApp({ sessionId })),
    open: (sessionId) =>
      Effect.gen(function* () {
        if (!hosted) return yield* new NoDesktopApp({ sessionId });
        const transport = yield* Effect.promise(connectDesktop);
        yield* Effect.addFinalizer(() => transport.close);

        return transport;
      }),
  })
);

const readLines = async (stream: ReadableStream<Uint8Array>, onLine: (line: string) => void) => {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let rest = "";

  for (;;) {
    const { done, value } = await reader.read();

    if (done) return;
    rest += decoder.decode(value, { stream: true });
    const lines = rest.split("\n");
    rest = lines.pop() ?? "";
    lines.forEach(onLine);
  }
};

const until = async (condition: () => boolean, what: string, ms = 30_000) => {
  const deadline = Date.now() + ms;

  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(50);
  }
};

const run = async (args: ReadonlyArray<string>, session: string) => {
  const child = Bun.spawn([agentBrowser ?? "agent-browser", ...args], {
    cwd: root,
    env: { ...process.env, AGENT_BROWSER_SESSION: session, HOME: root },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);

  return { stdout, stderr, exitCode };
};

beforeAll(async () => {
  if (!available) return;
  root = mkdtempSync(shortTemp("polaris-cdp-smoke-"));
  socketPath = join(root, "desktop.sock");
  const bundle = join(root, "electronMain.mjs");

  const built = Bun.spawnSync(
    [
      "bun",
      "build",
      "apps/desktop/src/main/browserCdp/smoke/electronMain.ts",
      "--target=node",
      "--format=esm",
      "--external=electron",
      `--outfile=${bundle}`,
    ],
    { cwd: repo, stdout: "pipe", stderr: "pipe" }
  );

  if (built.exitCode !== 0)
    throw new Error(`bundling the smoke Desktop failed: ${built.stderr.toString()}`);
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response(page, { headers: { "content-type": "text/html" } }),
  });
  const { ELECTRON_RUN_AS_NODE: _node, ...env } = process.env;
  electronProcess = Bun.spawn([electron, bundle, "--use-mock-keychain"], {
    cwd: root,
    env: {
      ...env,
      POLARIS_SMOKE_SOCKET: socketPath,
      POLARIS_SMOKE_URL: `http://127.0.0.1:${server.port}/`,
    },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  void readLines(electronProcess.stdout, (line) => electronLog.push(line));
  void readLines(electronProcess.stderr, (line) => electronLog.push(`stderr: ${line}`));
  await until(() => electronLog.includes("READY"), "the smoke Desktop");
  relay = await Effect.runPromise(
    Layer.build(CdpRelay.layer({ home: root, version: "0.0.0-smoke" })).pipe(
      Effect.map((context) => Context.get(context, CdpRelay)),
      Effect.provide(fakeHosting),
      Scope.provide(scope)
    )
  );
}, 120_000);

afterAll(async () => {
  if (!available) return;
  await run(["close"], "polaris-smoke-drive").catch(() => undefined);
  await Effect.runPromise(Scope.close(scope, Exit.void));
  await server?.stop(true);

  if (electronProcess !== null) {
    void electronProcess.stdin.end();
    const exited = await Promise.race([electronProcess.exited, Bun.sleep(5000).then(() => null)]);

    if (exited === null) electronProcess.kill();
  }

  rmSync(root, { recursive: true, force: true });
}, 30_000);

smoke(
  "without a Desktop App, agent-browser fails with the product copy",
  async () => {
    hosted = false;
    const { url } = await Effect.runPromise(relay.issue(SessionId.make("unhosted")));
    const result = await run(["--cdp", url, "snapshot"], "polaris-smoke-unhosted");
    hosted = true;
    expect(result.exitCode).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain(NO_DESKTOP_APP_MESSAGE);
  },
  60_000
);

smoke(
  "agent-browser snapshots, clicks and screenshots the session's tab through the relay",
  async () => {
    const { url } = await Effect.runPromise(relay.issue(mine));
    const session = "polaris-smoke-drive";

    const snapshot = await run(["--cdp", url, "snapshot"], session);
    expect(snapshot.exitCode).toBe(0);
    expect(snapshot.stdout).toContain("Hello Polaris");
    const ref = /button "Go" \[ref=(e\d+)\]/.exec(snapshot.stdout)?.[1];
    expect(ref).toBeDefined();
    await until(
      () => electronLog.includes("DRIVING smoke-2 true"),
      "the agent-driving indicator",
      5000
    );

    const clicked = await run(["--cdp", url, "click", `@${ref}`], session);
    expect(clicked.exitCode).toBe(0);
    const text = await run(["--cdp", url, "get", "text", "#out"], session);
    expect(text.exitCode).toBe(0);
    expect(text.stdout.trim()).toBe("clicked");

    const file = join(root, "shot.png");
    const shot = await run(["--cdp", url, "screenshot", file], session);
    expect(shot.exitCode).toBe(0);
    const png = readFileSync(file);
    expect([...png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(png.byteLength).toBeGreaterThan(1000);

    // The other session's tab (smoke-1) was never attached.
    expect(electronLog.some((line) => line.startsWith("DRIVING smoke-1 "))).toBe(false);
  },
  120_000
);
