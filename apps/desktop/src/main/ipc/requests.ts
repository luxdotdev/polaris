/**
 * The handlers behind `window.polaris.request`: one per method, each taking the
 * decoded input and returning a structured-clone-friendly output. Blobs the
 * Daemon sends (file contents, diffs) are taken here and cross IPC as bytes.
 */
import type { HostConnection, LiveSession } from "@polaris/client";
import type { FileContent } from "@polaris/protocol";
import { Effect, flow, Match, Schema } from "effect";
import type {
  Appearance,
  FileContentView,
  InstallView,
  IpcError,
  RequestOutput,
} from "../../shared/api.ts";
import { RequestInputs, type RequestInput, type RequestMethod } from "../../shared/contract.ts";
import { HostDirectory, toIpcError } from "../hosts.ts";
import type { Settings } from "../settings.ts";
import type { SnapshotCache } from "../snapshotCache.ts";
import { ensureInstalled } from "./install.ts";

/** What the handlers need from the app outside the Client runtime. */
export interface RequestContext {
  readonly settings: () => Settings;
  readonly cache: SnapshotCache;
  readonly setAppearance: (patch: Partial<Appearance>) => void;
  /** A fresh temp directory, or null when the local Daemon doesn't run the bench Harness. */
  readonly proofWorkspace: () => string | null;
  /** The literal Host aliases in `~/.ssh/config`. */
  readonly sshHosts: () => ReadonlyArray<string>;
  readonly setWelcomeSeen: () => void;
  readonly appVersion: string;
  /** The native folder picker on the focused window; null when cancelled. */
  readonly pickFolder: () => Promise<string | null>;
  /** The bundled Daemon builds (`manifest.json`), or null when this build has none. */
  readonly daemonDist: string | null;
}

type Handler<M extends RequestMethod> = (
  input: RequestInput<M>
) => Effect.Effect<RequestOutput<M>, IpcError, HostDirectory>;

export type Handlers = { readonly [M in RequestMethod]: Handler<M> };

type Failure = { readonly _tag: string; readonly message: string };

const connection = (hostKey: string) => HostDirectory.use((dir) => dir.connection(hostKey));

const onHost = <A, E extends Failure>(
  hostKey: string,
  use: (connection: HostConnection) => Effect.Effect<A, E>
) => Effect.flatMap(connection(hostKey), use).pipe(Effect.mapError(toIpcError));

const onLive = <A, E extends Failure>(
  hostKey: string,
  use: (session: LiveSession) => Effect.Effect<A, E>
) => onHost(hostKey, (c) => Effect.flatMap(c.session, use));

const done = <E, R>(effect: Effect.Effect<unknown, E, R>) => Effect.as(effect, null);

const fileContent = (session: LiveSession, content: FileContent) =>
  Match.value(content).pipe(
    Match.tagsExhaustive({
      Inline: ({ text }) => Effect.succeed<FileContentView>({ kind: "text", text }),
      Blob: ({ blobId }) =>
        Effect.map(session.blobs.take(blobId), (bytes): FileContentView => ({
          kind: "bytes",
          bytes,
        })),
    })
  );

const local = (): InstallView => ({
  result: "Local",
  platform: null,
  version: null,
  sha256: null,
  command: null,
});

export const requestHandlers = (ctx: RequestContext): Handlers => ({
  "settings.get": () =>
    Effect.sync(() => {
      const settings = ctx.settings();

      return {
        theme: settings.theme ?? "system",
        density: settings.density ?? "calm",
        welcomeSeen: settings.welcomeSeen ?? false,
        hosts: (settings.hosts ?? []).map((h) => ({
          alias: h.alias,
          label: h.label ?? h.alias,
          colour: h.colour ?? null,
          forwardAgent: h.forwardAgent ?? false,
        })),
      };
    }),
  "cache.get": () => Effect.sync(() => ctx.cache.get()),
  "cache.put": ({ host }) => Effect.sync(() => ctx.cache.put(host)).pipe(done),
  "settings.setTheme": ({ theme }) => Effect.sync(() => ctx.setAppearance({ theme })).pipe(done),
  "settings.setDensity": ({ density }) =>
    Effect.sync(() => ctx.setAppearance({ density })).pipe(done),
  "host.retryNow": ({ hostKey }) => onHost(hostKey, (c) => c.retryNow).pipe(done),
  dispatch: ({ hostKey, commandId, command }) =>
    onLive(hostKey, (s) => s.client.dispatch({ commandId, command })),
  "files.listDir": ({ hostKey, path }) =>
    onLive(hostKey, (s) => s.client["files.listDir"]({ path })),
  "files.stat": ({ hostKey, path }) => onLive(hostKey, (s) => s.client["files.stat"]({ path })),
  "files.read": ({ hostKey, ...payload }) =>
    onLive(hostKey, (s) =>
      Effect.flatMap(s.client["files.read"](payload), (read) =>
        Effect.map(fileContent(s, read.content), (content) => ({
          size: read.size,
          mimeType: read.mimeType,
          content,
        }))
      )
    ),
  "files.searchPaths": ({ hostKey, ...payload }) =>
    onLive(hostKey, (s) => s.client["files.searchPaths"](payload)),
  "files.grep": ({ hostKey, ...payload }) =>
    onLive(hostKey, (s) => s.client["files.grep"](payload)),
  "git.status": ({ hostKey, cwd }) => onLive(hostKey, (s) => s.client["git.status"]({ cwd })),
  "git.diff": ({ hostKey, cwd, spec }) =>
    onLive(hostKey, (s) =>
      Effect.flatMap(s.client["git.diff"]({ cwd, spec }), (diff) =>
        Effect.map(s.blobs.take(diff.blobId), (bytes) => ({ bytes, files: diff.files }))
      )
    ),
  "harness.models": ({ hostKey, ...payload }) =>
    onLive(hostKey, (s) => s.client["harness.models"](payload)),
  "harness.availability": ({ hostKey, refresh }) =>
    onLive(hostKey, (s) => s.client["harness.availability"]({ refresh })),
  "session.terminalCommand": ({ hostKey, sessionId }) =>
    onLive(hostKey, (s) => s.client["session.terminalCommand"]({ sessionId })),
  "terminal.open": ({ hostKey, ...payload }) =>
    onLive(hostKey, (s) => s.client["terminal.open"](payload)),
  "terminal.input": ({ hostKey, ...payload }) =>
    onLive(hostKey, (s) => s.client["terminal.input"](payload)).pipe(done),
  "terminal.resize": ({ hostKey, ...payload }) =>
    onLive(hostKey, (s) => s.client["terminal.resize"](payload)).pipe(done),
  "terminal.close": ({ hostKey, ...payload }) =>
    onLive(hostKey, (s) => s.client["terminal.close"](payload)).pipe(done),
  "attachments.stage": ({ hostKey, bytes, ...payload }) =>
    onHost(hostKey, (c) =>
      c.withBlob(bytes, (blobId, s) => s.client["attachments.stage"]({ ...payload, blobId }))
    ),
  "install.ensure": ({ hostKey, approvedSha256 }) =>
    HostDirectory.use((dir) => {
      const alias = dir.entry(hostKey)?.alias ?? null;

      if (alias === null) return Effect.succeed(local());

      return ensureInstalled({ alias, approvedSha256, dist: ctx.daemonDist });
    }),
  "onboarding.found": () =>
    Effect.sync(() => ({ sshHosts: ctx.sshHosts(), version: ctx.appVersion })),
  "onboarding.welcomeSeen": () => Effect.sync(ctx.setWelcomeSeen).pipe(done),
  "dialog.pickFolder": () => Effect.promise(ctx.pickFolder).pipe(Effect.map((path) => ({ path }))),
  "dev.proofWorkspace": () =>
    Effect.suspend(() => {
      const path = ctx.proofWorkspace();

      return path === null
        ? Effect.fail<IpcError>({
            code: "Unsupported",
            message: "the local Daemon does not run the bench Harness",
          })
        : Effect.succeed({ path });
    }),
});

/** Decodes an untrusted request's input from a renderer, then runs its handler. */
export const requestRunner = <M extends RequestMethod>(handlers: Handlers, method: M) =>
  flow(
    Schema.decodeUnknownEffect(RequestInputs[method]),
    Effect.mapError((error): IpcError => ({ code: "InvalidInput", message: error.message })),
    Effect.flatMap((input) => handlers[method](input))
  );

export const isRequestMethod = (method: string): method is RequestMethod =>
  Object.hasOwn(RequestInputs, method);
