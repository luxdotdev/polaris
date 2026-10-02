import * as P from "@polaris/protocol";
import { Schema } from "effect";
import type { LanguageApi, PolarisApi } from "../../../../shared/api.ts";
import type { AppState } from "../../../store/store.ts";
import { polaris } from "../../bridge.ts";
import type { EditorFile } from "../cm/extensions.ts";
import { languageFor } from "../model/language.ts";
import { showOpenFailure } from "../ui/toasts.ts";
import type { FormatSettings, FormattingPort } from "./index.ts";

interface FormatterBinding {
  readonly port: Pick<FormattingPort, "settings" | "format">;
}

const bindings = new Map<string, FormatterBinding>();

const keyOf = (file: EditorFile) => `${file.hostKey}\u0000${file.workspaceId}\u0000${file.path}`;

/** E1 owns context generation/capabilities and removes the binding on context replacement. */
export const bindFormatter = (
  file: EditorFile,
  port: Pick<FormattingPort, "settings" | "format">
) => {
  const key = keyOf(file);
  const binding = { port };

  bindings.set(key, binding);

  return () => {
    if (bindings.get(key) === binding) bindings.delete(key);
  };
};

export const readFormatSettings = async (
  file: EditorFile,
  app: AppState,
  api: LanguageApi | undefined = polaris().languages
): Promise<FormatSettings> => {
  if (api === undefined)
    return { formatOnSave: true, formatter: P.LanguageFormatterSelection.cases.None.make({}) };

  const language = languageFor(file.path);
  const hostId = app.hosts.find((host) => host.key === file.hostKey)?.status.host?.hostId;

  const workspaceId = Schema.decodeUnknownSync(P.WorkspaceId)(file.workspaceId);

  const scopes: P.LanguageSettingsScope[] = [
    P.LanguageSettingsScope.cases.App.make({}),
    P.LanguageSettingsScope.cases.Language.make({ language }),
  ];

  if (hostId !== undefined)
    scopes.push(
      P.LanguageSettingsScope.cases.Host.make({ hostId }),
      P.LanguageSettingsScope.cases.Workspace.make({ hostId, workspaceId, language: null }),
      P.LanguageSettingsScope.cases.Workspace.make({ hostId, workspaceId, language })
    );

  const records = await Promise.all(
    scopes.map(async (scope) => {
      const result = await api.request("languages.settings.get", { hostKey: file.hostKey, scope });

      if (!result.ok) throw new Error(result.error.message);

      if (JSON.stringify(result.value.scope) !== JSON.stringify(scope))
        throw new Error("Formatter Settings changed scope while saving.");

      return result.value.settings;
    })
  );

  const settings: P.LanguageSettingsPatch = {};

  for (const record of records) Object.assign(settings, record);

  return {
    formatOnSave: settings.formatOnSave ?? true,
    formatter: settings.formatter ?? P.LanguageFormatterSelection.cases.None.make({}),
  };
};

/** Settings remain Client-local; selected missing/old/disconnected Host tools fail explicitly. */
export const createAppFormatting = (
  app: () => AppState,
  bridge: () => PolarisApi = polaris
): FormattingPort => {
  const captured = new WeakMap<AbortSignal, FormatterBinding | undefined>();

  return {
    settings: (file, signal) => {
      const binding = bindings.get(keyOf(file));

      captured.set(signal, binding);

      return (
        binding?.port.settings(file, signal) ?? readFormatSettings(file, app(), bridge().languages)
      );
    },
    format: async (snapshot, formatter, signal) => {
      if (signal.aborted) throw new Error("Formatting cancelled.");
      const binding = bindings.get(keyOf(snapshot.file));

      if (binding === undefined || binding !== captured.get(signal))
        throw new Error("The selected formatter is unavailable on this Host.");

      const text = await binding.port.format(snapshot, formatter, signal);

      if (signal.aborted || bindings.get(keyOf(snapshot.file)) !== binding)
        throw new Error("Formatter context changed while saving.");

      return text;
    },
    failure: (file, message) =>
      showOpenFailure({
        title: `Saving unformatted: ${file.path.split("/").pop() ?? file.path}`,
        message: `${message} Saving your text without formatting.`,
      }),
  };
};
