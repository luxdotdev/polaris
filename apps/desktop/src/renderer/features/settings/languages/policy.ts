import * as P from "@polaris/protocol";
import { Schema } from "effect";
import type { LanguageApi } from "../../../../shared/api.ts";
import type { MarkdownPolicyRefresh } from "./integrationContracts.ts";
import type { LanguageSettingsResult } from "./contracts.ts";

/** Refresh only the explicitly acknowledged policy's Host/Workspace, never an unknown mutation. */
export const updateMarkdownPolicy = async (
  api: LanguageApi,
  hook: MarkdownPolicyRefresh,
  hostKey: string,
  policy: P.LanguagePreviewPolicy,
  signal: AbortSignal
): Promise<LanguageSettingsResult<P.LanguagePreviewPolicy>> => {
  if (signal.aborted)
    return { ok: false, message: "Policy update cancelled. Refresh to check its outcome." };

  try {
    const valid = Schema.decodeUnknownSync(P.LanguagePreviewPolicy)(policy);
    const result = await api.request("languages.preview.policy.set", { hostKey, policy: valid });

    if (signal.aborted)
      return { ok: false, message: "Policy completion is unknown. Refresh to check its outcome." };

    if (!result.ok)
      return { ok: false, message: "Couldn't save preview policy. Refresh to retry." };
    const confirmed = Schema.decodeUnknownSync(P.LanguagePreviewPolicy)(result.value);

    if (!Schema.toEquivalence(P.LanguagePreviewPolicy)(valid, confirmed))
      return {
        ok: false,
        message: "Policy confirmation did not match. Refresh to check its outcome.",
      };
    hook.refreshMarkdownPolicy(hostKey, confirmed.workspaceId);

    return { ok: true, value: confirmed };
  } catch {
    return { ok: false, message: "Couldn't confirm preview policy. Refresh to check its outcome." };
  }
};
