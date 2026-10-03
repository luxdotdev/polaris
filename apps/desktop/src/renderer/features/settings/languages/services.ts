import { createStore } from "zustand/vanilla";
import type {
  LanguageIntegrationOptions,
  LanguageSettingsRefresh,
  MarkdownPolicyRefresh,
} from "./integrationContracts.ts";

export interface LanguageSettingsServices
  extends Partial<MarkdownPolicyRefresh>, Partial<LanguageSettingsRefresh> {
  readonly permissions?: LanguageIntegrationOptions["permissions"];
  readonly logs?: LanguageIntegrationOptions["logs"];
}

export const languageSettingsServices = createStore<LanguageSettingsServices>(() => ({}));

/** Integration owners supply accepted seams; disposal cannot remove a replacement owner. */
export const setLanguageSettingsServices = (services: LanguageSettingsServices) => {
  languageSettingsServices.setState(services, true);
  const installed = languageSettingsServices.getState();

  return () => {
    if (languageSettingsServices.getState() === installed)
      languageSettingsServices.setState({}, true);
  };
};
