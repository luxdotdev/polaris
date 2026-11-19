/** The loopback feed Squirrel installs a verified Update from (docs/adr/0116). */
import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, type FileHandle } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Schema } from "effect";
import type { OfferedUpdate } from "./release.ts";

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

export interface FeedRequest {
  readonly remoteAddress: string | undefined;
  readonly host: string | undefined;
  readonly method: string | undefined;
  readonly url: string | undefined;
}

export interface FeedContent {
  readonly platform: string;
  readonly origin: string;
  readonly token: string;
  readonly update: OfferedUpdate;
  readonly bytes: number;
  /** The package's SHA-1, which Squirrel.Windows checks again. */
  readonly sha1: string | null;
}

export type FeedAnswer =
  | { readonly status: 403 | 404 | 405 }
  | { readonly status: 200; readonly type: string; readonly body: string }
  | { readonly status: 200; readonly type: string; readonly file: true };

/** The manifest Squirrel reads: Squirrel.Mac JSON, or Squirrel.Windows RELEASES. */
const manifest = (feed: FeedContent): { readonly path: string; readonly answer: FeedAnswer } =>
  feed.platform === "win32"
    ? {
        path: "RELEASES",
        answer: {
          status: 200,
          type: "text/plain",
          body: `${feed.sha1 ?? ""} ${feed.update.file} ${feed.bytes}`,
        },
      }
    : {
        path: "feed",
        answer: {
          status: 200,
          type: "application/json",
          // An absent date is left out: JSON.stringify drops an undefined value.
          body: JSON.stringify({
            url: `${feed.origin}/${feed.token}/${feed.update.file}`,
            name: feed.update.name,
            notes: feed.update.notes,
            pub_date: feed.update.pubDate === "" ? undefined : feed.update.pubDate,
          }),
        },
      };

/** Only this machine, asking this server by its loopback name for a path under the token. */
export const feedAnswer = (request: FeedRequest, feed: FeedContent): FeedAnswer => {
  if (request.remoteAddress === undefined || !LOOPBACK.has(request.remoteAddress))
    return { status: 403 };

  if (request.host === undefined || `http://${request.host}` !== feed.origin)
    return { status: 403 };

  if (request.method !== "GET" && request.method !== "HEAD") return { status: 405 };
  const path = (request.url ?? "").split("?")[0] ?? "";
  const listed = manifest(feed);

  if (path === `/${feed.token}/${listed.path}`) return listed.answer;

  if (path === `/${feed.token}/${feed.update.file}`)
    return { status: 200, type: "application/octet-stream", file: true };

  return { status: 404 };
};

const Address = Schema.Struct({ address: Schema.String, port: Schema.Number });

export interface LocalFeed {
  /** What `autoUpdater.setFeedURL` takes on this platform. */
  readonly url: string;
  /** The unguessable address everything this feed serves sits under. */
  readonly root: string;
  readonly close: () => void;
}

/** Opens the staged package once, never through a symlink; null when it is not a plain file. */
export const openPackage = async (path: string): Promise<FileHandle | null> => {
  const nofollow = process.platform === "win32" ? 0 : constants.O_NOFOLLOW;
  const file = await open(path, constants.O_RDONLY | nofollow).catch(() => null);

  if (file === null || (await file.stat()).isFile()) return file;
  await file.close();

  return null;
};

/** The path still names the file that was opened: nothing took its place meanwhile. */
export const stillNames = async (path: string, file: FileHandle) => {
  const [named, opened] = await Promise.all([
    lstat(path, { bigint: true }).catch(() => null),
    file.stat({ bigint: true }),
  ]);

  return named !== null && named.isFile() && named.dev === opened.dev && named.ino === opened.ino;
};

export interface LocalFeedInput {
  readonly platform: string;
  /** The verified package, already open; every request is served from it, and `close` closes it. */
  readonly file: FileHandle;
  readonly bytes: number;
  readonly sha1: string | null;
  readonly update: OfferedUpdate;
}

/** Listens on 127.0.0.1 only, on a port the OS picks, under a path nobody else can guess. */
export const serveLocalFeed = async (input: LocalFeedInput): Promise<LocalFeed> => {
  const token = randomBytes(24).toString("hex");
  let feed: FeedContent | null = null;
  const { file } = input;

  if ((await file.stat()).size !== input.bytes) throw new Error("the verified file changed");

  const respond = (request: IncomingMessage, response: ServerResponse) => {
    const answer: FeedAnswer =
      feed === null
        ? { status: 404 }
        : feedAnswer(
            {
              remoteAddress: request.socket.remoteAddress,
              host: request.headers.host,
              method: request.method,
              url: request.url,
            },
            feed
          );

    if (answer.status !== 200) {
      response.writeHead(answer.status).end();

      return;
    }

    const length = "file" in answer ? input.bytes : Buffer.byteLength(answer.body);
    response.writeHead(200, { "Content-Type": answer.type, "Content-Length": length });

    if (request.method === "HEAD") response.end();
    else if ("file" in answer)
      file
        .createReadStream({ start: 0, autoClose: false })
        .on("error", () => response.destroy())
        .pipe(response);
    else response.end(answer.body);
  };

  const server = createServer(respond);

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
  } catch (error) {
    await file.close();
    throw error;
  }

  const { address, port } = Schema.decodeUnknownSync(Address)(server.address());
  const origin = `http://${address}:${port}`;

  let closed = false;

  feed = { ...input, origin, token };

  return {
    url: input.platform === "win32" ? `${origin}/${token}` : `${origin}/${token}/feed`,
    root: `${origin}/${token}`,
    close: () => {
      if (closed) return;
      closed = true;
      server.close();
      server.closeAllConnections();
      void file.close().catch(() => undefined);
    },
  };
};
