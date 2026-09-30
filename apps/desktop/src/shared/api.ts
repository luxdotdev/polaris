/**
 * The typed bridge between the main process and the renderer: channel names,
 * what every request returns, what every subscription delivers, and the API
 * the preload script exposes as `window.polaris`. Types plus plain constants
 * only, so the renderer and the sandboxed preload can import it.
 */
import type {
  Attachment,
  Capability,
  ConnectionState,
  FileChangeEvent,
  FileEntry,
  GitStatus,
  Grep,
  HarnessModels,
  HostHarnesses,
  HostInfo,
  HostStreamItem,
  SearchPaths,
  SessionStreamItem,
  TerminalId,
  TerminalLaunch,
  UsageReport,
  UsageStreamItem,
} from "@polaris/protocol";
import type { Rpc } from "effect/rpc";
import type {
  CachedHost,
  CodeFont,
  Density,
  DiffPalette,
  MotionSource,
  RequestInput,
  RequestMethod,
  SubscriptionInput,
  SessionDefault,
  SubscriptionKind,
  TextSize,
  ThemeSource,
} from "./contract.ts";

export type {
  AppearancePatch,
  CachedHost,
  CodeFont,
  Density,
  DiffPalette,
  MotionSource,
  SessionDefault,
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

/** A Harness on one Host (`harness.availability`), flattened. */
export interface HarnessAvailabilityView {
  readonly harness: string;
  /** The product's name ("Claude Code"). */
  readonly name: string;
  /** Its own setup docs: Polaris never installs a Harness, it links these. */
  readonly docsUrl: string | null;
  readonly status: "not-installed" | "outdated" | "needs-sign-in" | "ready" | "unknown";
  readonly version: string | null;
  readonly minVersion: string;
  readonly detail: string | null;
  /** The Harness's own sign-in, run on the Host in a terminal; null when it can't. */
  readonly signInArgv: ReadonlyArray<string> | null;
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
}

/** Each Harness's defaults for new sessions, by kind. */
export type SessionDefaults = Readonly<Record<string, SessionDefault>>;

export interface SettingsView extends Appearance {
  readonly sessionDefaults: SessionDefaults;
  /** This build's version, for About Polaris. */
  readonly version: string;
  readonly hosts: ReadonlyArray<{
    readonly alias: string;
    readonly label: string;
    readonly colour: string | null;
    readonly forwardAgent: boolean;
  }>;
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

export interface RequestOutputs {
  "settings.get": SettingsView;
  "cache.get": ReadonlyArray<CachedHost>;
  "cache.put": null;
  "settings.setTheme": null;
  "settings.setDensity": null;
  "settings.setAppearance": null;
  "settings.setSessionDefault": null;
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
  "git.diff": { readonly bytes: Uint8Array; readonly files: number };
  "harness.models": Plain<HarnessModels>;
  "harness.availability": Plain<HostHarnesses>;
  "session.terminalCommand": TerminalLaunch | null;
  "usage.query": Plain<UsageReport>;
  "terminal.open": { readonly terminalId: TerminalId };
  "terminal.input": null;
  "terminal.resize": null;
  "terminal.close": null;
  "attachments.stage": Attachment;
  "install.ensure": InstallView;
  "machines.sshAliases": ReadonlyArray<SshAliasView>;
  "machines.add": { readonly key: string };
  "machines.update": null;
  "machines.remove": null;
  "machines.check": null;
  "machines.approve": null;
  "machines.dismiss": null;
  "machines.startDaemon": null;
  "machines.setLocalEnabled": null;
  /** Null when the Host's Daemon doesn't report availability (capability missing). */
  "machines.harnesses": ReadonlyArray<HarnessAvailabilityView> | null;
  "machines.openSsh": null;
  "clipboard.write": null;
  "dev.proofWorkspace": { readonly path: string };
}

// Every method has an output type; a missing one fails to compile here.
export type RequestOutput<M extends RequestMethod> = RequestOutputs[M];

// ── Subscriptions ───────────────────────────────────────────────────────────

export type TerminalItem =
  | { readonly _tag: "Output"; readonly data: Uint8Array }
  | { readonly _tag: "Exit"; readonly code: number | null };

export interface SubscriptionItems {
  hosts: ReadonlyArray<HostView>;
  machines: ReadonlyArray<MachineView>;
  host: HostStreamItem;
  session: SessionStreamItem;
  terminal: TerminalItem;
  "files.watch": ReadonlyArray<typeof FileChangeEvent.Type>;
  usage: UsageStreamItem;
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
  | { readonly kind: "route"; readonly route: Route }
  | { readonly kind: "appearance"; readonly appearance: Appearance }
  | { readonly kind: "session-defaults"; readonly sessionDefaults: SessionDefaults }
  /** Polaris → Settings… (⌘,). */
  | { readonly kind: "settings" }
  /** Dev only (Develop menu): start the bench-Harness proof session on this Host. */
  | { readonly kind: "proof"; readonly hostKey: string };

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
