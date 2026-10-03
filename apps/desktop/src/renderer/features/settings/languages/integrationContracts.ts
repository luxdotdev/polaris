import type * as P from "@polaris/protocol";
import type { LanguageInstallFeedback } from "./feedback.ts";
import type { HostView, LanguageApi } from "../../../../shared/api.ts";
import type {
  LanguageSettingsAction,
  LanguageToolActions,
  LanguageSettingsResult,
} from "./contracts.ts";

export interface RegisteredLanguageCheckout {
  readonly key: string;
  readonly label: string;
  readonly hostKey: string;
  readonly checkout: P.LanguageCheckout;
}

export interface LanguageIntegrationOptions {
  readonly api: LanguageApi | undefined;
  readonly feedback?: LanguageInstallFeedback;
  readonly hosts: ReadonlyArray<HostView>;
  readonly language: P.LanguageSyntaxId;
  readonly selected: RegisteredLanguageCheckout | null;
  readonly checkouts?: ReadonlyArray<RegisteredLanguageCheckout>;
  readonly refreshLanguageSettings?: LanguageSettingsRefresh["refreshLanguageSettings"];
  /** I1/G2 supply permissions only after artifact and authenticated handler gates. */
  readonly permissions?: (hostKey: string, fact: P.LanguageAvailability) => LanguageToolActions;
  readonly recover: (
    action: Extract<LanguageSettingsAction, { kind: "recover-host" }>
  ) => Promise<LanguageSettingsResult<void>>;
  readonly logs?: (
    hostKey: string,
    context: P.LanguageContextIdentity
  ) => Promise<LanguageSettingsResult<void>>;
}

export interface LanguageSettingsRefresh {
  readonly refreshLanguageSettings: (hostKey: string, workspaceId: P.WorkspaceId) => void;
}

export interface MarkdownPolicyRefresh {
  readonly refreshMarkdownPolicy: (hostKey: string, workspaceId: P.WorkspaceId) => void;
}

export interface OptionalLanguageActions {
  permissions?: NonNullable<LanguageIntegrationOptions["permissions"]>;
  logs?: NonNullable<LanguageIntegrationOptions["logs"]>;
  refreshLanguageSettings?: LanguageSettingsRefresh["refreshLanguageSettings"];
}
