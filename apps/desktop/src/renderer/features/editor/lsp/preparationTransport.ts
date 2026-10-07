import { languageIpcError } from "../../../../shared/languageError.ts";
import type { LanguageApi } from "../../../../shared/api.ts";
import type { EditorPreparationTransport } from "./acknowledgedPreparation.ts";

/** Bind only the reviewed additive Main API; old/unregistered handlers return unavailable. */
export const editorPreparationTransport = (
  api: LanguageApi,
  hostKey: string
): EditorPreparationTransport => ({
  acknowledge: async (fence, buffer) => {
    const response = await api.request("languages.document.acknowledge", {
      hostKey,
      fence,
      buffer,
    });

    if (!response.ok) throw languageIpcError(response.error);

    return response.value;
  },
  prepare: async ({ request, result, origin, label, edit }) => {
    const response = await api.request("languages.edit.prepare", {
      hostKey,
      request,
      result,
      origin,
      label,
      edit,
    });

    if (!response.ok) throw languageIpcError(response.error);

    return response.value;
  },
});
