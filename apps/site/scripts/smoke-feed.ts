import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Schema } from "effect";
import { dmg, fixture, zip } from "../app/api/update/_lib/fixtures.ts";

const site = resolve(import.meta.dir, "..");

const scratch = mkdtempSync(join(tmpdir(), "polaris-feed-smoke-"));

const trace = join(scratch, "events.jsonl");

const githubTrace = join(scratch, "github.txt");

const decodeEvent = Schema.decodeUnknownSync(
  Schema.Array(
    Schema.Struct({
      _time: Schema.String,
      event: Schema.Literals(["update_check", "download"]),
      route: Schema.String,
      version: Schema.NullOr(Schema.String),
      arch: Schema.Literal("arm64"),
      macos_version: Schema.String,
      install_id: Schema.String,
      country: Schema.String,
      status: Schema.Number,
    })
  ),
  { onExcessProperty: "error" }
);

const decodeUpdate = Schema.decodeUnknownSync(
  Schema.Struct({
    url: Schema.String,
    name: Schema.String,
    notes: Schema.String,
    pub_date: Schema.String,
  }),
  { onExcessProperty: "error" }
);

async function freePort() {
  const server = createServer();

  return new Promise<number>((resolvePort, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = Schema.decodeUnknownSync(Schema.Struct({ port: Schema.Number }))(
        server.address()
      );

      server.close((error) => {
        if (error) reject(error);
        else resolvePort(address.port);
      });
    });
  });
}

function writeFakeTransport() {
  const hook = join(scratch, "fake.cjs");
  writeFileSync(trace, "");
  writeFileSync(githubTrace, "");
  writeFileSync(
    hook,
    `
const fs = require('node:fs');
const fixture = ${JSON.stringify(fixture)};
globalThis.fetch = async (input, options) => {
  const url = typeof input === 'string' ? input : input.url || String(input);
  if (url === 'https://api.github.com/repos/luxdotdev/polaris/releases/latest') {
    fs.appendFileSync(${JSON.stringify(githubTrace)}, 'lookup\\n');
    return Response.json(fixture);
  }
  if (url === 'https://api.axiom.co/v1/ingest/fake-release-smoke') {
    fs.appendFileSync(${JSON.stringify(trace)}, options.body + '\\n');
    return Response.json({ ingested: 1, failed: 0 });
  }
  throw new Error('Smoke blocked external request');
};
`
  );

  return hook;
}

async function waitUntilReady(base: string) {
  for (let count = 0; count < 100; count++) {
    try {
      const response = await fetch(base, { signal: AbortSignal.timeout(500) });

      if (response.ok) return;
    } catch {
      /* The child may not be listening yet. */
    }

    await Bun.sleep(100);
  }

  throw new Error("Next.js did not start within 10 seconds");
}

async function checkResponses(base: string) {
  const cases = [
    ["/api/update/darwin-arm64/1.2.3", 204],
    ["/api/update/darwin-arm64/1.2.2", 200],
    ["/api/update/darwin-arm64/1.2.3-rc.1", 200],
    ["/api/update/darwin-arm64/1.3.0", 204],
    ["/api/update/darwin-arm64/malformed", 400],
    ["/download/mac", 307],
  ] satisfies [string, number][];

  for (const [path, status] of cases) {
    const response = await fetch(`${base}${path}?private=value`, {
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
      headers: {
        "X-Polaris-Install-ID": "6a00ec60-187a-4a97-818c-0d9d18961f06",
        "X-Polaris-macOS-Version": "26.0.1",
        "x-vercel-ip-country": "US",
        "x-forwarded-for": "203.0.113.10",
        "User-Agent": "Mac OS X 15_6 private-marker",
      },
    });

    assert.equal(response.status, status, path);
    assert.equal(response.headers.get("cache-control"), "no-store");

    if (status === 204) assert.equal(await response.text(), "");

    if (status === 200)
      assert.deepEqual(decodeUpdate(await response.json()), {
        url: zip,
        name: fixture.name,
        notes: fixture.body,
        pub_date: fixture.published_at,
      });

    if (status === 307) assert.equal(response.headers.get("location"), dmg);
    console.log(`${path}: ${status}`);
  }

  return cases.map(([, status]) => status);
}

async function checkEvents(statuses: number[]) {
  for (let count = 0; count < 50; count++) {
    const raw = readFileSync(trace, "utf8");

    const events = raw
      .trim()
      .split("\n")
      .filter(Boolean)
      .flatMap((line) => decodeEvent(JSON.parse(line)));

    if (events.length === statuses.length) {
      assert.deepEqual(
        events.map((event) => event.status),
        statuses
      );
      assert.equal(readFileSync(githubTrace, "utf8"), "lookup\n");

      for (const event of events) {
        assert.equal(event.macos_version, "26.0.1");
        assert.equal(event.country, "US");
        assert.equal(event.install_id, "6a00ec60-187a-4a97-818c-0d9d18961f06");
      }

      assert(!raw.includes("203.0.113.10") && !raw.includes("private"));

      return;
    }

    await Bun.sleep(100);
  }

  throw new Error("Expected exactly six Axiom events");
}

try {
  const port = await freePort();
  const hook = writeFakeTransport();

  const child = Bun.spawn(
    [
      "node",
      "--require",
      hook,
      join(site, "node_modules/next/dist/bin/next"),
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    {
      cwd: site,
      env: {
        ...process.env,
        AXIOM_TOKEN: "fake-token",
        AXIOM_DATASET: "fake-release-smoke",
        NEXT_TELEMETRY_DISABLED: "1",
      },
      stdout: "ignore",
      stderr: "inherit",
    }
  );

  try {
    const base = `http://127.0.0.1:${port}`;
    await waitUntilReady(base);
    const statuses = await checkResponses(base);
    await checkEvents(statuses);
    console.log(
      "Production HTTP smoke: 6 responses, 6 privacy-safe events, 1 cached GitHub lookup; no live network"
    );
  } finally {
    child.kill();
    await child.exited;
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
