import type * as P from "@polaris/protocol";

export interface LanguageScopeOption {
  readonly key: string;
  readonly label: string;
  readonly scope: P.LanguageSettingsScope;
}

/** Each permission is supplied by integration after authoritative Host preflight. */
export interface LanguageToolActions {
  readonly install?: string;
  readonly update?: string;
  readonly rollback?: string;
  readonly retry?: string;
  readonly restart?: P.LanguageContextIdentity;
  readonly logs?: P.LanguageContextIdentity;
  readonly cancel?: string;
}

export interface LanguageToolView {
  readonly name: string;
  readonly availability: P.LanguageAvailability;
  readonly runtime: typeof P.LanguageRuntime.Type | null;
  readonly progress: P.LanguageInstallProgress | null;
  readonly actions: LanguageToolActions;
}

export interface LanguageHostView {
  readonly key: string;
  readonly id: P.HostId;
  readonly name: string;
  readonly connection: "Connected" | "Reconnecting" | "Needs Attention" | "Offline";
  readonly capability: "available" | "unsupported";
  readonly detail: string;
  readonly recovery: "reconnect" | "upgrade" | "attention" | null;
  readonly tools: ReadonlyArray<LanguageToolView>;
  readonly discovery: typeof P.LanguageDiscovery.Type | null;
  readonly canSetTrust?: boolean;
  readonly trust?: typeof P.LanguageTrust.Type;
  readonly trustCheckout?: P.LanguageCheckout;
}

export interface LanguageSettingsSnapshot {
  /** Renderer-local observation identity; never serialized as trust or protocol authority. */
  readonly observation?: object;
  readonly record: typeof P.LanguageSettingsRecord.Type;
  readonly effective: typeof P.LanguageEffectiveSettings.Type;
  readonly providers: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  readonly formatters: ReadonlyArray<{
    readonly key: string;
    readonly name: string;
    readonly selection: P.LanguageFormatterSelection;
  }>;
  readonly hosts: ReadonlyArray<LanguageHostView>;
}

export type LanguageSettingsAction =
  | { readonly kind: "refresh" }
  | {
      readonly kind: "recover-host";
      readonly hostKey: string;
      readonly recovery: "reconnect" | "upgrade" | "attention";
    }
  | {
      readonly kind: "install";
      readonly hostKey: string;
      readonly toolId: string;
      readonly version: string;
      readonly intent: "manual" | "update" | "rollback";
    }
  | {
      readonly kind: "retry";
      readonly hostKey: string;
      readonly toolId: string;
      readonly version: string;
    }
  | { readonly kind: "cancel-install"; readonly hostKey: string; readonly jobId: string }
  | {
      readonly kind: "restart" | "logs";
      readonly hostKey: string;
      readonly context: P.LanguageContextIdentity;
    }
  | {
      readonly kind: "trust";
      readonly hostKey: string;
      readonly trust: typeof P.LanguageTrust.Type;
      readonly trusted: boolean;
    };

/** Errors are already sanitized by the adapter; never return launch environment values. */
export type LanguageSettingsResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string };

export interface LanguageSettingsAdapter {
  readonly watch?: (
    snapshot: LanguageSettingsSnapshot,
    receive: (snapshot: LanguageSettingsSnapshot | null) => void
  ) => () => void;
  readonly load: (
    scope: P.LanguageSettingsScope,
    signal: AbortSignal
  ) => Promise<LanguageSettingsResult<LanguageSettingsSnapshot>>;
  readonly save: (
    record: typeof P.LanguageSettingsRecord.Type,
    signal: AbortSignal
  ) => Promise<LanguageSettingsResult<void>>;
  readonly act: (
    action: LanguageSettingsAction,
    signal: AbortSignal
  ) => Promise<LanguageSettingsResult<void>>;
}

export interface LanguageSettingsProps {
  readonly adapter: LanguageSettingsAdapter;
  readonly scopes: ReadonlyArray<LanguageScopeOption>;
  readonly initialScopeKey?: string;
  readonly onDirty?: (dirty: boolean) => void;
}
