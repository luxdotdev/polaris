import type { LanguageProvider } from "./types.ts";

/** Configured provider roles can suppress duplicate features; they never grant a capability. */
export const ownedProvider = (
  provider: LanguageProvider,
  disabled: readonly string[]
): LanguageProvider => {
  if (disabled.length === 0) return provider;
  const denied = new Set(disabled);

  const methods = provider.capabilities.methods.filter((method) => {
    if (denied.has(method) || denied.has(method.split("/").pop() ?? "")) return false;

    if (method.startsWith("completionItem/") && denied.has("completion")) return false;

    if (method.startsWith("codeAction/") && denied.has("codeAction")) return false;

    if (denied.has("diagnostics") && method.endsWith("/diagnostic")) return false;

    if (denied.has("formatting") && method.endsWith("/rangeFormatting")) return false;

    return true;
  });

  return {
    ...provider,
    capabilities: {
      ...provider.capabilities,
      methods,
      completionResolve: provider.capabilities.completionResolve && !denied.has("completion"),
      actionResolve: provider.capabilities.actionResolve && !denied.has("codeAction"),
      diagnostics: denied.has("diagnostics") ? "none" : provider.capabilities.diagnostics,
      workspaceDiagnostics:
        !denied.has("diagnostics") && provider.capabilities.workspaceDiagnostics,
    },
  };
};
