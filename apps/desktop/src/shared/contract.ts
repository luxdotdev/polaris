/**
 * The IPC contract's inputs as Effect Schemas: the main process decodes every
 * request and subscription from a renderer with these before acting on it.
 * The renderer imports this file for types only (`import type`), so no Schema
 * code reaches its bundle.
 */
import {
  Command,
  CommandId,
  GitDiffSpec,
  HarnessKind,
  Sequence,
  SessionId,
  SessionSummary,
  TerminalId,
  Workspace,
  WorkspaceId,
  Worktree,
} from "@polaris/protocol";
import { Schema } from "effect";

/** A Host's stable key in the HostRegistry: "local", or an SSH alias. */
export const HostKey = Schema.String.check(Schema.isMinLength(1));

export const ThemeSource = Schema.Literals(["system", "dark", "light"]);

export type ThemeSource = typeof ThemeSource.Type;

/** DESIGN.md's density steps; spacing and row heights only. */
export const Density = Schema.Literals(["calm", "balanced", "compact"]);

export type Density = typeof Density.Type;

const onHost = <F extends Schema.Struct.Fields>(fields: F) =>
  Schema.Struct({ hostKey: HostKey, ...fields });

/** A Host's last synchronized state, painted at launch before its Daemon answers (ENG-175). */
export const CachedHost = Schema.Struct({
  hostKey: HostKey,
  sequence: Sequence,
  workspaces: Schema.Array(Workspace),
  worktrees: Schema.Array(Worktree),
  sessions: Schema.Array(SessionSummary),
});

export type CachedHost = typeof CachedHost.Type;

/** Every request a renderer can make, keyed by method. Outputs are in `api.ts`. */
export const RequestInputs = {
  "settings.get": Schema.Struct({}),
  "cache.get": Schema.Struct({}),
  "cache.put": Schema.Struct({ host: CachedHost }),
  "settings.setTheme": Schema.Struct({ theme: ThemeSource }),
  "settings.setDensity": Schema.Struct({ density: Density }),
  "host.retryNow": onHost({}),
  dispatch: onHost({ commandId: CommandId, command: Command }),
  "files.listDir": onHost({ path: Schema.String }),
  "files.stat": onHost({ path: Schema.String }),
  "files.read": onHost({
    path: Schema.String,
    offset: Schema.NullOr(Schema.Int),
    length: Schema.NullOr(Schema.Int),
  }),
  "files.searchPaths": onHost({ root: Schema.String, query: Schema.String, limit: Schema.Int }),
  "files.grep": onHost({
    root: Schema.String,
    pattern: Schema.String,
    regex: Schema.Boolean,
    caseSensitive: Schema.Boolean,
    limit: Schema.Int,
  }),
  "git.status": onHost({ cwd: Schema.String }),
  "git.diff": onHost({ cwd: Schema.String, spec: GitDiffSpec }),
  /** A Harness's Models on the Host (capability `harness.models`); `refresh` asks the Harness again. */
  "harness.models": onHost({ harness: HarnessKind, refresh: Schema.Boolean }),
  /** Each catalogue Harness's status on the Host (capability `harness.availability`). */
  "harness.availability": onHost({ refresh: Schema.Boolean }),
  "session.terminalCommand": onHost({ sessionId: SessionId }),
  "terminal.open": onHost({
    cwd: Schema.String,
    cols: Schema.Int,
    rows: Schema.Int,
    argv: Schema.NullOr(Schema.Array(Schema.String)),
  }),
  "terminal.input": onHost({ terminalId: TerminalId, data: Schema.Uint8Array }),
  "terminal.resize": onHost({ terminalId: TerminalId, cols: Schema.Int, rows: Schema.Int }),
  "terminal.close": onHost({ terminalId: TerminalId }),
  /** Pasted or dropped bytes: sent as a blob, then staged, on one connection. */
  "attachments.stage": onHost({
    sessionId: Schema.NullOr(SessionId),
    workspaceId: WorkspaceId,
    name: Schema.String,
    mimeType: Schema.String,
    bytes: Schema.Uint8Array,
  }),
  /** Probe a remote Host and plan an install or upgrade; installs only with an approved SHA-256. */
  "install.ensure": onHost({ approvedSha256: Schema.NullOr(Schema.String) }),
  /** What onboarding found on this Mac: the Host aliases in `~/.ssh/config`, and the app's version. */
  "onboarding.found": Schema.Struct({}),
  /** "Get started": the welcome isn't shown again. */
  "onboarding.welcomeSeen": Schema.Struct({}),
  /** The native folder picker, for a Workspace on the local Host; null when cancelled. */
  "dialog.pickFolder": Schema.Struct({}),
  /** The renderer's Needs You summary, for the menu bar star, Dock badge and notifications. */
  "needsYou.publish": Schema.Struct({
    count: Schema.Int,
    sessions: Schema.Array(
      Schema.Struct({
        hostKey: HostKey,
        hostLabel: Schema.String,
        workspace: Schema.NullOr(Schema.String),
        sessionId: Schema.String,
        title: Schema.String,
        harness: Schema.String,
        requests: Schema.Array(
          Schema.Struct({
            requestId: Schema.String,
            kind: Schema.Literals(["command", "file-change", "tool", "question"]),
            title: Schema.String,
            detail: Schema.NullOr(Schema.String),
            options: Schema.Array(Schema.String),
          })
        ),
      })
    ),
    focused: Schema.NullOr(Schema.Struct({ hostKey: HostKey, sessionId: Schema.String })),
  }),
  /** Dev only: a fresh temporary directory on the dev Daemon's Host for the proof session. */
  "dev.proofWorkspace": Schema.Struct({}),
} as const;

export type RequestMethod = keyof typeof RequestInputs;

export type RequestInput<M extends RequestMethod> = (typeof RequestInputs)[M]["Type"];

/** What `request` sends: the method, and its input, decoded against `RequestInputs[method]`. */
export const RequestEnvelope = Schema.Struct({ method: Schema.String, input: Schema.Unknown });

export type RequestEnvelope = typeof RequestEnvelope.Type;

/** What `subscribe` sends; the input is decoded against `SubscriptionInputs[kind]`. */
export const SubscribeEnvelope = Schema.Struct({
  id: Schema.Int,
  kind: Schema.String,
  input: Schema.Unknown,
});

export type SubscribeEnvelope = typeof SubscribeEnvelope.Type;

export const UnsubscribeEnvelope = Schema.Struct({ id: Schema.Int });

/** Every live feed a renderer can open, keyed by kind. Items are in `api.ts`. */
export const SubscriptionInputs = {
  /** The Host list with each Host's Connection State; the whole list on every change. */
  hosts: Schema.Struct({}),
  host: onHost({}),
  session: onHost({ sessionId: SessionId, turnLimit: Schema.NullOr(Schema.Int) }),
  terminal: onHost({ terminalId: TerminalId }),
  "files.watch": onHost({ root: Schema.String }),
} as const;

export type SubscriptionKind = keyof typeof SubscriptionInputs;

export type SubscriptionInput<K extends SubscriptionKind> = (typeof SubscriptionInputs)[K]["Type"];
