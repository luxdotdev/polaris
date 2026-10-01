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
  SessionDefault,
  InstallView,
  IpcError,
  RequestOutput,
} from "../../shared/api.ts";
import {
  RequestInputs,
  type RequestInput,
  type RequestMethod,
  type SessionPrefsPatch,
} from "../../shared/contract.ts";
import { type ClientServices, HostDirectory, toIpcError } from "../hosts.ts";
import { githubHandlers } from "../github/ipc.ts";
import { Machines } from "../machines/service.ts";
import type { NeedsYouSummary } from "../../shared/needsYou.ts";
import { appearanceOf, sessionPrefsOf, type Settings } from "../settings.ts";
import { estimate, type Prices } from "../prices.ts";
import type { SnapshotCache } from "../snapshotCache.ts";
import { ensureInstalled } from "./install.ts";

/** What the handlers need from the app outside the Client runtime. */
export interface RequestContext {
  readonly settings: () => Settings;
  readonly cache: SnapshotCache;
  /** The price table for Usage estimates. */
  readonly prices: Prices;
  readonly setAppearance: (patch: Partial<Appearance>) => void;
  readonly setSessionDefault: (harness: string, value: SessionDefault | null) => void;
  readonly setSessions: (patch: SessionPrefsPatch) => void;
  readonly openExternal: (url: string) => Promise<void>;
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
  readonly writeClipboard: (text: string) => Promise<void>;
  /** The renderer's Needs You summary, for the menu bar star, Dock badge and notifications. */
  readonly needsYou: (summary: NeedsYouSummary) => void;
}

export type Handler<M extends RequestMethod> = (
  input: RequestInput<M>
) => Effect.Effect<RequestOutput<M>, IpcError, ClientServices>;

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

const machines = <A, E extends Failure>(use: (m: Machines["Service"]) => Effect.Effect<A, E>) =>
  Machines.use(use).pipe(Effect.mapError(toIpcError));

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
  ...githubHandlers,
  "settings.get": () =>
    Effect.sync(() => {
      const settings = ctx.settings();

      return {
        ...appearanceOf(settings),
        sessionDefaults: settings.sessionDefaults ?? {},
        sessions: sessionPrefsOf(settings),
        version: ctx.appVersion,
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
  "settings.setAppearance": ({ patch }) => Effect.sync(() => ctx.setAppearance(patch)).pipe(done),
  "settings.setSessionDefault": ({ harness, value }) =>
    Effect.sync(() => ctx.setSessionDefault(harness, value)).pipe(done),
  "settings.setSessions": ({ patch }) => Effect.sync(() => ctx.setSessions(patch)).pipe(done),
  "shell.openExternal": ({ url }) =>
    Effect.tryPromise({
      try: () => ctx.openExternal(url),
      catch: (cause): IpcError => ({ code: "OpenFailed", message: String(cause) }),
    }).pipe(done),
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
        Effect.map(s.blobs.take(diff.blobId), (bytes) => ({
          bytes,
          files: diff.files,
          fileIndex: diff.fileIndex,
        }))
      )
    ),
  "git.show": ({ hostKey, ...payload }) =>
    onLive(hostKey, (s) =>
      Effect.flatMap(s.client["git.show"](payload), (shown) =>
        Effect.map(fileContent(s, shown.content), (content) => ({
          size: shown.size,
          mimeType: shown.mimeType,
          content,
        }))
      )
    ),
  "harness.models": ({ hostKey, ...payload }) =>
    onLive(hostKey, (s) => s.client["harness.models"](payload)),
  "harness.commands": ({ hostKey, ...payload }) =>
    onLive(hostKey, (s) => s.client["harness.commands"](payload)),
  "harness.spinnerVerbs": ({ hostKey, cwd }) =>
    onLive(hostKey, (s) => s.client["harness.spinnerVerbs"]({ cwd })),
  "harness.availability": ({ hostKey, refresh }) =>
    onLive(hostKey, (s) => s.client["harness.availability"]({ refresh })),
  "session.terminalCommand": ({ hostKey, sessionId }) =>
    onLive(hostKey, (s) => s.client["session.terminalCommand"]({ sessionId })),
  "usage.query": ({ hostKey, ...payload }) =>
    onLive(hostKey, (s) => s.client["usage.query"](payload)).pipe(
      Effect.flatMap((report) =>
        Effect.promise(() => ctx.prices.table().catch(() => null)).pipe(
          Effect.map((table) => ({
            report,
            estimates: table === null ? [] : estimate(report.buckets, table),
            pricesFetchedAt: table?.fetchedAt ?? null,
          }))
        )
      )
    ),
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
  "attachments.settings": ({ hostKey }) =>
    onLive(hostKey, (s) => s.client["attachments.settings"]({})),
  "attachments.setSettings": ({ hostKey, settings }) =>
    onLive(hostKey, (s) => s.client["attachments.setSettings"]({ settings })).pipe(done),
  "attachments.clear": ({ hostKey, workspaceId }) =>
    onLive(hostKey, (s) => s.client["attachments.clear"]({ workspaceId })),
  "review.runRiskSummary": ({ hostKey, ...payload }) =>
    onLive(hostKey, (s) => s.client["review.runRiskSummary"](payload)),
  "review.riskSummary": ({ hostKey, ref }) =>
    onLive(hostKey, (s) => s.client["review.riskSummary"]({ ref })),
  "review.askFinding": ({ hostKey, ...payload }) =>
    onLive(hostKey, (s) => s.client["review.askFinding"](payload)),
  "review.reviewerSettings": ({ hostKey, workspaceId }) =>
    onLive(hostKey, (s) => s.client["review.reviewerSettings"]({ workspaceId })),
  "review.setReviewerSettings": ({ hostKey, settings }) =>
    onLive(hostKey, (s) => s.client["review.setReviewerSettings"]({ settings })).pipe(done),
  "session.acceptPlan": ({ hostKey, ...payload }) =>
    onLive(hostKey, (s) => s.client["session.acceptPlan"](payload)),
  "session.draftAccept": ({ hostKey, ...payload }) =>
    onLive(hostKey, (s) => s.client["session.draftAccept"](payload)),
  "session.commitAccepted": ({ hostKey, ...payload }) =>
    onLive(hostKey, (s) => s.client["session.commitAccepted"](payload)),
  "session.pushAccepted": ({ hostKey, ...payload }) =>
    onLive(hostKey, (s) => s.client["session.pushAccepted"](payload)),
  "install.ensure": ({ hostKey, approvedSha256 }) =>
    HostDirectory.use((dir) => {
      const alias = dir.entry(hostKey)?.alias ?? null;

      if (alias === null) return Effect.succeed(local());

      return ensureInstalled({ alias, approvedSha256, dist: ctx.daemonDist });
    }),
  "machines.sshAliases": () => machines((m) => m.sshAliases),
  "machines.add": (input) => machines((m) => Effect.map(m.add(input), (key) => ({ key }))),
  "machines.update": ({ hostKey, ...patch }) =>
    machines((m) => m.update(hostKey, patch)).pipe(done),
  "machines.remove": ({ hostKey }) => machines((m) => m.remove(hostKey)).pipe(done),
  "machines.check": ({ hostKey }) => machines((m) => m.check(hostKey)).pipe(done),
  "machines.approve": ({ hostKey, sha256 }) =>
    machines((m) => m.approve(hostKey, sha256)).pipe(done),
  "machines.dismiss": ({ hostKey }) => machines((m) => m.dismiss(hostKey)).pipe(done),
  "machines.startDaemon": ({ hostKey }) => machines((m) => m.startDaemon(hostKey)).pipe(done),
  "machines.setLocalEnabled": ({ enabled }) =>
    machines((m) => m.setLocalEnabled(enabled)).pipe(done),
  "machines.openSsh": ({ hostKey }) => machines((m) => m.openSsh(hostKey)).pipe(done),
  "clipboard.write": ({ text }) => Effect.promise(() => ctx.writeClipboard(text)).pipe(done),
  "onboarding.found": () =>
    Effect.sync(() => ({ sshHosts: ctx.sshHosts(), version: ctx.appVersion })),
  "onboarding.welcomeSeen": () => Effect.sync(ctx.setWelcomeSeen).pipe(done),
  "dialog.pickFolder": () => Effect.promise(ctx.pickFolder).pipe(Effect.map((path) => ({ path }))),
  "needsYou.publish": (summary) => Effect.sync(() => ctx.needsYou(summary)).pipe(Effect.as(null)),
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
