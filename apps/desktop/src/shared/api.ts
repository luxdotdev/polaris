/**
 * The typed bridge between the main process and the renderer: channel names,
 * what every request returns, what every subscription delivers, and the API
 * the preload script exposes as `window.polaris`. Types plus plain constants
 * only, so the renderer and the sandboxed preload can import it.
 */
import type {
  AcceptCommitted,
  AcceptDraft,
  AcceptPlan,
  AcceptPushed,
  AskFinding,
  Attachment,
  AttachmentSettings,
  AttachmentUsage,
  StagedAmount,
  Capability,
  ConnectionState,
  FileChangeEvent,
  FileEntry,
  DiffFile,
  GetReviewerSettings,
  GetRiskSummary,
  ListVerdicts,
  GitStatus,
  Grep,
  HarnessCommands,
  HarnessModels,
  SpinnerVerbs,
  HostHarnesses,
  HostInfo,
  HostStreamItem,
  ConstellationResult,
  HostResourcesSnapshot,
  ConstellationStreamItem,
  PlanLimit,
  RiskSummary,
  RunRiskSummary,
  RunWalkthrough,
  SearchPaths,
  SessionStreamItem,
  TerminalId,
  TerminalLaunch,
  UsageReport,
  UsageStreamItem,
} from "@polaris/protocol";
import type { Rpc } from "effect/rpc";
import type { CommandId } from "./keymap.ts";
import type { PullRef } from "./github.ts";
import type { ConstellationMethod } from "./constellationContract.ts";
import type { ResourceMethod } from "./resourcesContract.ts";
import type { GitHubRequestOutputs, GitHubSubscriptionItems } from "./githubContract.ts";
import type { NeedsYouAction } from "./needsYou.ts";
import type {
  CachedHost,
  CodeFont,
  CodeFontSize,
  Density,
  DiffPalette,
  MotionSource,
  RequestInput,
  RequestMethod,
  SubscriptionInput,
  SessionDefault,
  SessionPrefs,
  SubscriptionKind,
  TextSize,
  ThemeSource,
} from "./contract.ts";

export type {
  AppearancePatch,
  CachedHost,
  CodeFont,
  CodeFontSize,
  Density,
  DiffPalette,
  MotionSource,
  SessionDefault,
  SessionPrefs,
  SessionPrefsPatch,
  TextSize,
  RequestInput,
  RequestMethod,
  SubscriptionInput,
  SubscriptionKind,
  ThemeSource,
} from "./contract.ts";

export const CHANNELS = {
  /** renderer → main, `invoke(request, RequestEnvelope)` → `Result`. */
  request: "polaris:request",
  /** renderer → main, `send(subscribe, SubscribeEnvelope)`. */
  subscribe: "polaris:subscribe",
  /** renderer → main, `send(unsubscribe, { id })`. */
  unsubscribe: "polaris:unsubscribe",
  /** main → renderer: every subscription's items since the last flush, in one message. */
  batch: "polaris:batch",
  /** main → renderer: an `AppEvent` (a menu command, a changed appearance). */
  app: "polaris:app",
} as const;

/** A failure crossing IPC: the tagged error's tag and message, nothing that can't be cloned. */
export interface IpcError {
  /** The failure's tag, e.g. "NotConnected", "FileError", "InvalidInput". */
  readonly code: string;
  readonly message: string;
}

export type Result<A> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly error: IpcError };

// ── Hosts ───────────────────────────────────────────────────────────────────

export interface ConnectionFailureView {
  readonly kind: "transient" | "needs-attention";
  readonly reason: string;
  readonly detail: string;
}

/** `ConnectionStatus` from `@polaris/client`, flattened for structured clone. */
export interface ConnectionStatusView {
  readonly state: ConnectionState;
  readonly failure: ConnectionFailureView | null;
  readonly attempt: number;
  readonly since: number;
  readonly nextAttemptAt: number | null;
  readonly host: HostInfo | null;
  readonly capabilities: ReadonlyArray<Capability>;
  readonly epoch: number;
  /** Round trip when this connection opened, in ms; null if unmeasured. */
  readonly latencyMs: number | null;
  /** When the last good connection ended; null while connected or never. */
  readonly lastSeenAt: number | null;
}

export interface HostView {
  readonly key: string;
  readonly label: string;
  /** From the machine settings; null picks a neutral. */
  readonly colour: string | null;
  /** The `~/.ssh/config` alias; null for the local Host. */
  readonly alias: string | null;
  /** The Daemon runs the scripted bench Harness (the dev Daemon): the proof session may run here. */
  readonly proofHarness: boolean;
  readonly status: ConnectionStatusView;
}

// ── Machines ────────────────────────────────────────────────────────────────

/** A literal alias from `~/.ssh/config`, with where it points when its block says. */
export interface SshAliasView {
  readonly alias: string;
  readonly hostName: string | null;
  readonly user: string | null;
}

/** The install flow's step (`src/main/machines/installFlow.ts`). */
export type InstallStepView =
  | "idle"
  | "checking"
  | "approval"
  | "dismissed"
  | "installing"
  | "ready"
  | "blocked";

export interface InstallFlowView {
  readonly step: InstallStepView;
  /** Checking or installing: what is happening now, for the progress line. */
  readonly activity: string | null;
  readonly offer: {
    readonly platform: string;
    readonly version: string;
    readonly sha256: string;
    readonly sizeBytes: number | null;
  } | null;
  readonly outcome: {
    readonly kind: "current" | "newer" | "installed" | "upgraded";
    readonly version: string;
    readonly from: string | null;
    readonly notes: ReadonlyArray<string>;
    readonly adminCommand: string | null;
  } | null;
  readonly problem: {
    readonly kind: "unsupported" | "missing-build" | "host-setup" | "ssh" | "failed";
    readonly message: string;
    readonly command: string | null;
  } | null;
}

/** One machine in Settings: the local Host or a remote one by alias. */
export interface MachineView {
  /** Null until update facts have loaded; updates never perform a first install. */
  readonly daemon: import("./daemonUpdates.ts").DaemonUpdateView | null;
  readonly key: string;
  readonly label: string;
  readonly colour: string | null;
  /** Null for the local Host. */
  readonly alias: string | null;
  /** Where the alias points, from `~/.ssh/config`. */
  readonly target: { readonly hostName: string | null; readonly user: string | null } | null;
  /** The local Host can be switched off on this machine; remote Hosts are always on. */
  readonly enabled: boolean;
  readonly forwardAgent: boolean;
  /** The remote command override as one shell line; null for the default. */
  readonly remoteCommand: string | null;
  /** Null while the local Host is switched off. */
  readonly status: ConnectionStatusView | null;
  /** Null for the local Host (Polaris never installs on this Mac from here). */
  readonly install: InstallFlowView | null;
}

/** A Schema class instance after structured clone: its fields, without the prototype. */
export type Plain<T> = { readonly [K in keyof T]: T[K] };

// ── Requests ────────────────────────────────────────────────────────────────

/**
 * How the renderer looks, as root attributes: `data-theme` (unset for "system"),
 * `data-density`, `data-text-size`, `data-diff-palette`, `data-reduce-motion`, and the code face.
 */
export interface Appearance {
  readonly theme: ThemeSource;
  readonly density: Density;
  readonly textSize: TextSize;
  readonly diffPalette: DiffPalette;
  readonly motion: MotionSource;
  readonly codeFont: CodeFont;
  readonly codeFontSize: CodeFontSize;
}

/** Each Harness's defaults for new sessions, by kind. */
export type SessionDefaults = Readonly<Record<string, SessionDefault>>;

export interface SettingsView extends Appearance {
  readonly sessionDefaults: SessionDefaults;
  /** Settings → Sessions, defaults filled in. */
  readonly sessions: SessionPrefs;
  /** This build's version, for About Polaris. */
  readonly version: string;
  /** False until the user pressed "Get started" on the welcome. */
  readonly welcomeSeen: boolean;
  readonly hosts: ReadonlyArray<{
    readonly alias: string;
    readonly label: string;
    readonly colour: string | null;
    readonly forwardAgent: boolean;
  }>;
}

/** What a bucket's tokens not covered by a reported cost would cost at API prices (ENG-207). */
export interface BucketEstimate {
  readonly estimatedUsd: number;
  /** Tokens whose Model no price list has; not in `estimatedUsd`. */
  readonly unpricedTokens: number;
}

/** `usage.query`'s report, with each bucket's estimate (same order) and when prices were fetched. */
export interface UsageQueryView {
  readonly report: Plain<UsageReport>;
  readonly estimates: ReadonlyArray<BucketEstimate>;
  /** Null when no price table could be read. */
  readonly pricesFetchedAt: string | null;
}

/** What `files.read` returns: inline text, or the bytes the Daemon sent as a blob. */
export type FileContentView =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "bytes"; readonly bytes: Uint8Array };

/** `install.ensure`'s outcome, flattened (`EnsureResult` in `@polaris/client/install`). */
export interface InstallView {
  readonly result: "Local" | "Ready" | "ApprovalNeeded" | "Unavailable" | "HostSetupNeeded";
  readonly platform: string | null;
  readonly version: string | null;
  /** Show it for the one-time approval, then call again with it approved. */
  readonly sha256: string | null;
  /** For `HostSetupNeeded`: what an administrator must run on the Host. */
  readonly command: string | null;
}

/** Every Constellation request answers with the RPC's result: summary, next, revision. */
export type ConstellationRequestOutputs = {
  readonly [M in ConstellationMethod]: Plain<ConstellationResult>;
};

/** Every Host resource request answers with the Host's whole resources snapshot. */
export type ResourceRequestOutputs = {
  readonly [M in ResourceMethod]: Plain<HostResourcesSnapshot>;
};

export interface RequestOutputs
  extends GitHubRequestOutputs, ConstellationRequestOutputs, ResourceRequestOutputs {
  "settings.get": SettingsView;
  "cache.get": ReadonlyArray<CachedHost>;
  "cache.put": null;
  "settings.setTheme": null;
  "settings.setDensity": null;
  "settings.setAppearance": null;
  "settings.setSessionDefault": null;
  "settings.setSessions": null;
  "shell.openExternal": null;
  "host.retryNow": null;
  dispatch: { readonly sequence: number | null };
  "files.listDir": ReadonlyArray<FileEntry>;
  "files.stat": FileEntry;
  "files.read": {
    readonly size: number;
    readonly mimeType: string;
    readonly content: FileContentView;
  };
  "files.searchPaths": Rpc.Success<typeof SearchPaths>;
  "files.grep": Rpc.Success<typeof Grep>;
  "git.status": Rpc.Success<typeof GitStatus>;
  "git.diff": {
    readonly bytes: Uint8Array;
    readonly files: number;
    /** Each file's byte range in `bytes` (empty from Daemons without `git.diff-files`). */
    readonly fileIndex: ReadonlyArray<Plain<DiffFile>>;
  };
  "git.show": {
    readonly size: number;
    readonly mimeType: string;
    readonly content: FileContentView;
  };
  "harness.models": Plain<HarnessModels>;
  "harness.commands": Plain<HarnessCommands>;
  "harness.spinnerVerbs": Plain<SpinnerVerbs> | null;
  "harness.availability": Plain<HostHarnesses>;
  "session.terminalCommand": TerminalLaunch | null;
  "usage.query": UsageQueryView;
  "terminal.open": { readonly terminalId: TerminalId };
  "terminal.input": null;
  "terminal.resize": null;
  "terminal.close": null;
  "attachments.stage": Attachment;
  "attachments.settings": {
    readonly settings: Plain<AttachmentSettings>;
    readonly usage: Plain<AttachmentUsage>;
  };
  "attachments.setSettings": null;
  "attachments.clear": Plain<StagedAmount>;
  "review.runRiskSummary": Rpc.Success<typeof RunRiskSummary>;
  "review.runWalkthrough": Rpc.Success<typeof RunWalkthrough>;
  "review.stopWalkthrough": null;
  "review.riskSummary": Rpc.Success<typeof GetRiskSummary>;
  "review.verdicts": Rpc.Success<typeof ListVerdicts>;
  "review.askFinding": Rpc.Success<typeof AskFinding>;
  "review.reviewerSettings": Rpc.Success<typeof GetReviewerSettings>;
  "review.setReviewerSettings": null;
  "session.acceptPlan": Plain<AcceptPlan>;
  "session.draftAccept": Plain<AcceptDraft>;
  "session.commitAccepted": Plain<AcceptCommitted>;
  "session.pushAccepted": Plain<AcceptPushed>;
  "install.ensure": InstallView;
  "machines.sshAliases": ReadonlyArray<SshAliasView>;
  "machines.add": { readonly key: string };
  "machines.update": null;
  "machines.remove": null;
  "machines.check": null;
  "machines.updateDaemon": null;
  "machines.setKeepDaemonsUpToDate": null;
  "machines.setDaemonUpdateOverride": null;
  "machines.approve": null;
  "machines.dismiss": null;
  "machines.startDaemon": null;
  "machines.setLocalEnabled": null;
  "machines.openSsh": null;
  "clipboard.write": null;
  "onboarding.found": { readonly sshHosts: ReadonlyArray<string>; readonly version: string };
  "onboarding.welcomeSeen": null;
  "dialog.pickFolder": { readonly path: string | null };
  "needsYou.publish": null;
  "dev.proofWorkspace": { readonly path: string };
}

// Every method has an output type; a missing one fails to compile here.
export type RequestOutput<M extends RequestMethod> = RequestOutputs[M];

// ── Subscriptions ───────────────────────────────────────────────────────────

export type TerminalItem =
  | { readonly _tag: "Output"; readonly data: Uint8Array }
  | { readonly _tag: "Exit"; readonly code: number | null };

export interface SubscriptionItems extends GitHubSubscriptionItems {
  hosts: ReadonlyArray<HostView>;
  machines: ReadonlyArray<MachineView>;
  host: HostStreamItem;
  session: SessionStreamItem;
  terminal: TerminalItem;
  "files.watch": ReadonlyArray<typeof FileChangeEvent.Type>;
  usage: UsageStreamItem;
  "harness.availability": Plain<HostHarnesses>;
  "plan-limits": Plain<PlanLimit>;
  "review.watchRiskSummary": RiskSummary;
  constellation: ConstellationStreamItem;
}

export type SubscriptionItem<K extends SubscriptionKind> = SubscriptionItems[K];

/** One subscription's share of a batch; `end` is set once, when the feed ends. */
export interface BatchEntry {
  readonly id: number;
  readonly items: ReadonlyArray<unknown>;
  /** Absent while live; null when it ended cleanly; the error when it failed. */
  readonly end?: IpcError | null;
}

export interface SubscriptionListener<A> {
  /** Items in arrival order; called at most once per batch. */
  readonly items: (items: ReadonlyArray<A>) => void;
  readonly end?: (error: IpcError | null) => void;
}

// ── App events ──────────────────────────────────────────────────────────────

export type Route = "orchestrate" | "review" | "edit";

export type AppEvent =
  /** A command from the native menu (`shared/keymap.ts`); the renderer runs it. */
  | { readonly kind: "command"; readonly id: CommandId }
  | { readonly kind: "appearance"; readonly appearance: Appearance }
  | { readonly kind: "session-defaults"; readonly sessionDefaults: SessionDefaults }
  | { readonly kind: "sessions"; readonly sessions: SessionPrefs }
  /** Dev only (Develop menu): start the bench-Harness proof session on this Host. */
  | { readonly kind: "proof"; readonly hostKey: string }
  /** The menu bar star or a notification: open a waiting session, or answer it. */
  | ({ readonly kind: "needs-you" } & NeedsYouAction)
  /** A review-request notification: open its pull request in Review, or the list (null). */
  | { readonly kind: "open-pull"; readonly pull: OpenPull | null };

/** A pull request to open in Review, with its node id when known. */
export interface OpenPull extends PullRef {
  readonly pullId: string | null;
}

// ── The API on `window.polaris` ─────────────────────────────────────────────

export interface PolarisApi {
  readonly request: <M extends RequestMethod>(
    method: M,
    input: RequestInput<M>
  ) => Promise<Result<RequestOutput<M>>>;
  /** Opens a live feed; call the returned function to close it. */
  readonly subscribe: <K extends SubscriptionKind>(
    kind: K,
    input: SubscriptionInput<K>,
    listener: SubscriptionListener<SubscriptionItem<K>>
  ) => () => void;
  readonly onAppEvent: (listener: (event: AppEvent) => void) => () => void;
}
