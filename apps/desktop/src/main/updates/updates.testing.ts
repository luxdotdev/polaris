/** Test doubles at the boundary: the internet feed, and Squirrel reading the real loopback feed. */
import { EventEmitter } from "node:events";
import { request } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FeedURLOptions } from "electron";
import { Schema } from "effect";
import type { AppUpdateView } from "../../shared/appUpdates.ts";
import { createAppUpdates, type UpdateInput } from "./index.ts";

/** A loopback GET as Squirrel makes it; rejects when nothing listens. */
export const get = (url: string, method = "GET") =>
  new Promise<{ status: number; length: string | undefined; body: Uint8Array }>(
    (resolve, reject) => {
      request(url, { method }, (response) => {
        const chunks: Array<Buffer> = [];

        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            length: response.headers["content-length"],
            body: new Uint8Array(Buffer.concat(chunks)),
          })
        );
      })
        .on("error", reject)
        .end();
    }
  );

const text = (body: Uint8Array) => new TextDecoder().decode(body);

const MacFeed = Schema.Struct({ url: Schema.String, name: Schema.String, notes: Schema.String });

/** What Squirrel does with a feed: read the manifest, fetch the package it names, report. */
export class FakeSquirrel extends EventEmitter {
  feed: FeedURLOptions | null = null;
  checks = 0;
  installs = 0;
  /** The package bytes Squirrel was served, and the URLs it asked for. */
  received: Uint8Array | null = null;
  asked: Array<string> = [];
  rejects = false;
  /** Squirrel has read the package but reports it only once this resolves. */
  hold: Promise<void> | null = null;
  /** The address Squirrel says it finished, when not the one it read. */
  claims: string | null = null;
  done: Promise<void> = Promise.resolve();
  constructor(readonly platform: string = "darwin") {
    super();
  }
  getFeedURL() {
    return this.feed?.url ?? "";
  }
  setFeedURL(feed: FeedURLOptions) {
    this.feed = feed;
  }
  checkForUpdates() {
    this.checks++;
    this.done = this.read().catch(() => {
      this.emit("error", new Error("private Squirrel detail"));
    });
  }
  quitAndInstall() {
    this.installs++;
  }
  private async get(url: string) {
    this.asked.push(url);
    const response = await get(url);

    if (response.status !== 200) throw new Error(`feed answered ${response.status}`);

    return response.body;
  }
  private async read() {
    const url = this.feed?.url ?? "";

    if (this.rejects) throw new Error("signature mismatch");

    if (this.platform === "win32") {
      const manifest = text(await this.get(`${url}/RELEASES?id=Polaris&localVersion=1.2.2`));
      const [, file = ""] = manifest.split(" ");
      this.received = await this.get(`${url}/${file}`);
      await this.hold;
      this.emit("update-downloaded", {}, "", "ignored", new Date(), this.claims ?? url);

      return;
    }

    const release = Schema.decodeUnknownSync(Schema.fromJsonString(MacFeed))(
      text(await this.get(url))
    );

    this.received = await this.get(release.url);
    await this.hold;
    this.emit(
      "update-downloaded",
      {},
      release.notes,
      release.name,
      new Date(),
      this.claims ?? release.url
    );
  }
}

export interface Asset {
  readonly url: string;
  readonly bytes: Uint8Array;
  /** Bytes per chunk. */
  readonly chunk?: number;
  /** The connection drops once this many bytes of a response went out; cleared after one drop. */
  dropAfter?: number | null;
  /** A pause before each chunk, for tests that act mid-download. */
  readonly delayMs?: number;
  /** The server ignores Range and sends the whole file. */
  ignoreRange?: boolean;
  /** Names this version of the file; a resume asking for another one gets the whole file. */
  etag?: string;
}

export const bytesOf = (length: number) =>
  Uint8Array.from({ length }, (_, i) => (i * 31 + 7) % 251);

/** A server for one asset: Range-aware, chunked, and able to drop the connection. */
export const serveAsset = (asset: Asset, init: RequestInit): Response => {
  const asked = new Headers(init.headers);
  const range = /^bytes=(\d+)-$/.exec(asked.get("Range") ?? "");
  const etag = asset.etag ?? '"first"';
  const whole = range === null || asset.ignoreRange === true || asked.get("If-Range") !== etag;
  const start = whole ? 0 : Number(range[1]);

  if (start >= asset.bytes.length) return new Response(null, { status: 416 });
  const size = asset.chunk ?? 1000;
  const drop = asset.dropAfter ?? null;
  let at = start;
  asset.dropAfter = null;

  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (asset.delayMs !== undefined)
        await new Promise((resolve) => setTimeout(resolve, asset.delayMs));

      if (drop !== null && at - start >= drop) controller.error(new Error("connection reset"));
      else if (at >= asset.bytes.length) controller.close();
      else {
        controller.enqueue(asset.bytes.slice(at, at + size));
        at += size;
      }
    },
  });

  return new Response(body, {
    status: start === 0 ? 200 : 206,
    headers:
      start === 0
        ? { "Content-Length": String(asset.bytes.length), ETag: etag }
        : {
            ETag: etag,
            "Content-Range": `bytes ${start}-${asset.bytes.length - 1}/${asset.bytes.length}`,
          },
  });
};

export const until = async (done: () => boolean) => {
  for (let i = 0; i < 2000 && !done(); i++) await new Promise((resolve) => setTimeout(resolve, 1));

  if (!done()) throw new Error("the update never settled");
};

export const fixture = (
  patch: Partial<UpdateInput> & {
    readonly internet?: (url: string, init: RequestInit) => Promise<Response>;
  } = {},
  native = new FakeSquirrel(patch.platform)
) => {
  const pending = new Set<() => void>();
  const saves: Array<{ automaticAppUpdates?: boolean; appUpdateLastCheckedAt?: number }> = [];
  const delays: Array<number> = [];
  const views: Array<AppUpdateView> = [];
  const requests: Array<{ url: string; headers: Headers }> = [];
  const home = mkdtempSync(join(tmpdir(), "polaris-updates-"));
  const { internet, ...input } = patch;

  const updates = createAppUpdates({
    native,
    version: "0.4.0",
    installId: "c30721f9-24ca-48e4-bdb7-eb9dd579e65b",
    osVersion: "26.1",
    arch: "arm64",
    supported: true,
    blocked: false,
    automatic: true,
    lastCheckedAt: null,
    pendingDir: join(home, "pending-update"),
    bundle: "/Applications/Polaris.app",
    verify: () => Promise.resolve(true),
    progressIntervalMs: 0,
    fetch: (url, init) => {
      requests.push({ url, headers: new Headers(init.headers) });

      return (internet ?? (() => Promise.resolve(new Response(null, { status: 204 }))))(url, init);
    },
    save: (value) => {
      saves.push(value);
    },
    publish: (view) => {
      views.push(view);
    },
    now: () => 1234,
    schedule: (run, delay) => {
      delays.push(delay);
      pending.add(run);

      return () => {
        pending.delete(run);
      };
    },
    ...input,
  });

  const tick = () => {
    const ready = Array.from(pending);

    for (const run of ready) {
      pending.delete(run);
      run();
    }
  };

  const busy = () => ["checking", "downloading"].includes(updates.get().phase);

  return {
    native,
    updates,
    pending,
    saves,
    delays,
    views,
    requests,
    tick,
    pendingDir: join(home, "pending-update"),
    /** Starts a check and waits until it is neither checking nor downloading. */
    checked: async () => {
      updates.check();
      await until(() => !busy());
    },
    settled: () => until(() => !busy()),
    cleanup: () => {
      updates.dispose();
      rmSync(home, { recursive: true, force: true });
    },
  };
};
