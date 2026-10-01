/**
 * The IPC contract's inputs as Effect Schemas: the main process decodes every
 * request and subscription from a renderer with these before acting on it.
 * The renderer imports this file for types only (`import type`), so no Schema
 * code reaches its bundle.
 */
import {
  AttachmentSettings,
  Command,
  CommandId,
  GitDiffSpec,
  HarnessKind,
  PermissionMode,
  ReviewCheckoutId,
  ReviewContext,
  ReviewerSettings,
  ReviewSubject,
  RiskFindingId,
  RiskSummaryId,
  RiskSummaryRef,
  Sequence,
  SessionId,
  Timestamp,
  SessionSummary,
  TerminalId,
  Workspace,
  WorkspaceId,
  Worktree,
} from "@polaris/protocol";
import { Schema } from "effect";
import { GitHubRequestInputs, GitHubSubscriptionInputs } from "./githubContract.ts";
import { BRANCH_PREFIX } from "./sessionPrefs.ts";

/** A Host's stable key in the HostRegistry: "local", or an SSH alias. */
export const HostKey = Schema.String.check(Schema.isMinLength(1));

export const ThemeSource = Schema.Literals(["system", "dark", "light"]);

export type ThemeSource = typeof ThemeSource.Type;

/** DESIGN.md's density steps; spacing and row heights only. */
export const Density = Schema.Literals(["calm", "balanced", "compact"]);

export type Density = typeof Density.Type;

/** `data-text-size`: scales the type table only (DESIGN.md, Settings). */
export const TextSize = Schema.Literals(["small", "default", "large", "larger"]);

export type TextSize = typeof TextSize.Type;

/** `data-diff-palette`: `cvd` is the colourblind-safe blue and orange. */
export const DiffPalette = Schema.Literals(["default", "cvd"]);

export type DiffPalette = typeof DiffPalette.Type;

/** Reduce Motion: follow macOS, always reduce, or keep motion. */
export const MotionSource = Schema.Literals(["system", "reduce", "full"]);

export type MotionSource = typeof MotionSource.Type;

/** The code face: `--font-mono` on the root. */
export const CodeFont = Schema.Literals(["sf-mono", "menlo"]);

export type CodeFont = typeof CodeFont.Type;

/** The code face's size in px at the default text size (`--code-size`). */
export const CodeFontSize = Schema.Literals([12, 13, 14, 15]);

export type CodeFontSize = typeof CodeFontSize.Type;

/** Any subset of the appearance settings, applied over the current ones. */
export const AppearancePatch = Schema.Struct({
  theme: Schema.optionalKey(ThemeSource),
  density: Schema.optionalKey(Density),
  textSize: Schema.optionalKey(TextSize),
  diffPalette: Schema.optionalKey(DiffPalette),
  motion: Schema.optionalKey(MotionSource),
  codeFont: Schema.optionalKey(CodeFont),
  codeFontSize: Schema.optionalKey(CodeFontSize),
});

export type AppearancePatch = typeof AppearancePatch.Type;

/** What a new Agent Session of one Harness starts with; null fields take the Harness's default. */
export const SessionDefault = Schema.Struct({
  model: Schema.NullOr(Schema.String),
  effort: Schema.NullOr(Schema.String),
  permissionMode: PermissionMode,
});

export type SessionDefault = typeof SessionDefault.Type;

export const BranchPrefix = Schema.String.check(Schema.isPattern(BRANCH_PREFIX));

/**
 * Where accepting a session's work commits (ENG-224): `auto` makes a branch only when
 * on the default branch; `current` commits where it is, main included; `create` always branches.
 */
export const AcceptBranchMode = Schema.Literals(["auto", "current", "create"]);

export type AcceptBranchMode = typeof AcceptBranchMode.Type;

/** Settings → Sessions: how every new Agent Session starts and what happens around it. */
export const SessionPrefs = Schema.Struct({
  /** Start on a new Worktree rather than in the Workspace directory. */
  newWorktree: Schema.Boolean,
  /** What a branch taken from the prompt starts with ("polaris/"). */
  branchPrefix: BranchPrefix,
  /** A Turn's first edit opens Output. */
  openOutputOnEdit: Schema.Boolean,
  /** Native notifications when a session needs you. */
  notifyNeedsYou: Schema.Boolean,
  /** Native notifications when someone requests your review on GitHub (ENG-229). */
  notifyReviewRequests: Schema.Boolean,
  /** Archive deletes a session's branch once it is merged; unmerged branches always stay. */
  deleteMergedBranch: Schema.Boolean,
  /** The Working strip's verbs; null for the built-in ones (Claude Code's own settings come first). */
  spinnerVerbs: Schema.NullOr(Schema.Array(Schema.String)),
  /** Where accepted work is committed, unless the Workspace says otherwise. */
  acceptBranch: AcceptBranchMode,
  /** Per-Workspace overrides of `acceptBranch`, keyed `hostKey/workspaceId`. */
  workspaceAcceptBranch: Schema.Record(Schema.String, AcceptBranchMode),
});

export type SessionPrefs = typeof SessionPrefs.Type;

export const SessionPrefsPatch = Schema.Struct({
  newWorktree: Schema.optionalKey(Schema.Boolean),
  branchPrefix: Schema.optionalKey(BranchPrefix),
  openOutputOnEdit: Schema.optionalKey(Schema.Boolean),
  notifyNeedsYou: Schema.optionalKey(Schema.Boolean),
  notifyReviewRequests: Schema.optionalKey(Schema.Boolean),
  deleteMergedBranch: Schema.optionalKey(Schema.Boolean),
  spinnerVerbs: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.String))),
  acceptBranch: Schema.optionalKey(AcceptBranchMode),
  /** Replaces every override. */
  workspaceAcceptBranch: Schema.optionalKey(Schema.Record(Schema.String, AcceptBranchMode)),
});

export type SessionPrefsPatch = typeof SessionPrefsPatch.Type;

const onHost = <F extends Schema.Struct.Fields>(fields: F) =>
  Schema.Struct({ hostKey: HostKey, ...fields });

/** A `~/.ssh/config` alias; never starts with "-" (it would read as an ssh option). */
export const SshAlias = Schema.String.check(Schema.isPattern(/^[^-\s][^\s]*$/));

/** A machine's colour: an identity hue name from `@polaris/ui` or a hex colour. */
export const MachineColour = Schema.String.check(Schema.isPattern(/^(#[0-9a-fA-F]{6}|[a-z-]+)$/));

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
  "settings.setAppearance": Schema.Struct({ patch: AppearancePatch }),
  /** Null clears the Harness's defaults. */
  "settings.setSessionDefault": Schema.Struct({
    harness: HarnessKind,
    value: Schema.NullOr(SessionDefault),
  }),
  "settings.setSessions": Schema.Struct({ patch: SessionPrefsPatch }),
  /** Opens a URL in the user's browser; https only (a catalogue `docsUrl`). */
  "shell.openExternal": Schema.Struct({
    url: Schema.String.check(Schema.isPattern(/^https:\/\//)),
  }),
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
  /** A file at a revision (capability `git.show`): Review's context expansion. */
  "git.show": onHost({ cwd: Schema.String, revision: Schema.String, path: Schema.String }),
  /** A Harness's Models on the Host (capability `harness.models`); `refresh` asks the Harness again. */
  "harness.models": onHost({ harness: HarnessKind, refresh: Schema.Boolean }),
  /** A Harness's Skills and Slash Commands in a directory (capability `harness.commands`). */
  "harness.commands": onHost({
    harness: HarnessKind,
    cwd: Schema.String,
    refresh: Schema.Boolean,
  }),
  "harness.spinnerVerbs": onHost({ cwd: Schema.NullOr(Schema.String) }),
  /** Each catalogue Harness's status on the Host (capability `harness.availability`). */
  "harness.availability": onHost({ refresh: Schema.Boolean }),
  "session.terminalCommand": onHost({ sessionId: SessionId }),
  /** Hourly Usage buckets overlapping `[from, to)` (capability `usage`). */
  "usage.query": onHost({
    from: Timestamp,
    to: Timestamp,
    harness: Schema.NullOr(HarnessKind),
    sessionId: Schema.NullOr(SessionId),
  }),
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
  /** Attachment cleanup (Settings → Attachments): the Host's policy and what it has staged. */
  "attachments.settings": onHost({}),
  "attachments.setSettings": onHost({ settings: AttachmentSettings }),
  /** Deletes staged attachments now: one Workspace's, or all of them (null). */
  "attachments.clear": onHost({ workspaceId: Schema.NullOr(WorkspaceId) }),
  /** Start a Risk Summary (Rules, then the Reviewer), or answer the cached one. */
  "review.runRiskSummary": onHost({
    workspaceId: WorkspaceId,
    subject: ReviewSubject,
    checkoutId: Schema.NullOr(ReviewCheckoutId),
    since: Schema.NullOr(Schema.String),
    refresh: Schema.Boolean,
    context: Schema.NullOr(ReviewContext),
  }),
  "review.riskSummary": onHost({ ref: RiskSummaryRef }),
  /** A follow-up to the Reviewer, about one Finding or the whole change. */
  "review.askFinding": onHost({
    summaryId: RiskSummaryId,
    findingId: Schema.NullOr(RiskFindingId),
    question: Schema.String,
  }),
  /** Settings → Reviewer: the Host's settings and the Reviewer a Workspace would run. */
  "review.reviewerSettings": onHost({ workspaceId: Schema.NullOr(WorkspaceId) }),
  "review.setReviewerSettings": onHost({ settings: ReviewerSettings }),
  /** Probe a remote Host and plan an install or upgrade; installs only with an approved SHA-256. */
  "install.ensure": onHost({ approvedSha256: Schema.NullOr(Schema.String) }),
  /** The literal `Host` aliases in `~/.ssh/config` (Includes followed, wildcards skipped). */
  "machines.sshAliases": Schema.Struct({}),
  /** Adds a remote Host by alias and checks it: probe, then ask to install. */
  "machines.add": Schema.Struct({
    alias: SshAlias,
    label: Schema.String,
    colour: Schema.NullOr(MachineColour),
    forwardAgent: Schema.Boolean,
  }),
  /** Changes a remote Host's settings; a changed transport reconnects it. */
  "machines.update": onHost({
    label: Schema.optionalKey(Schema.String),
    colour: Schema.optionalKey(Schema.NullOr(MachineColour)),
    forwardAgent: Schema.optionalKey(Schema.Boolean),
    /** The remote command as one shell line; null restores the default. */
    remoteCommand: Schema.optionalKey(Schema.NullOr(Schema.String)),
  }),
  "machines.remove": onHost({}),
  /** Probe the Host and plan again (the user asked): may install an approved build. */
  "machines.check": onHost({}),
  /** "Approve and install": records the SHA-256 for this Host, then installs. */
  "machines.approve": onHost({ sha256: Schema.String }),
  /** "Not now". */
  "machines.dismiss": onHost({}),
  /** Restart the installed Daemon's service (`polaris install` with the current build). */
  "machines.startDaemon": onHost({}),
  /** Switch the local Host on or off on this machine. */
  "machines.setLocalEnabled": Schema.Struct({ enabled: Schema.Boolean }),
  /**
   * Opens macOS Terminal on this Mac running `ssh <alias>` (to trust a host key); the
   * fallback when the local Host is off, since the in-app terminal runs on a Daemon.
   */
  "machines.openSsh": onHost({}),
  "clipboard.write": Schema.Struct({ text: Schema.String }),
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
  ...GitHubRequestInputs,
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
  /** The machines for Settings: each Host's settings, Connection State and install flow. */
  machines: Schema.Struct({}),
  host: onHost({}),
  session: onHost({ sessionId: SessionId, turnLimit: Schema.NullOr(Schema.Int) }),
  terminal: onHost({ terminalId: TerminalId }),
  "files.watch": onHost({ root: Schema.String }),
  /** Plan Limits (every known one first) and Usage changes on a Host (capability `usage`). */
  usage: onHost({}),
  /** Each catalogue Harness's status as it changes (`harness.watchAvailability`). */
  "harness.availability": onHost({}),
  /** Plan Limits as they change (`usage.watch`, its `PlanLimitChanged` items). */
  "plan-limits": onHost({}),
  ...GitHubSubscriptionInputs,
} as const;

export type SubscriptionKind = keyof typeof SubscriptionInputs;

export type SubscriptionInput<K extends SubscriptionKind> = (typeof SubscriptionInputs)[K]["Type"];
