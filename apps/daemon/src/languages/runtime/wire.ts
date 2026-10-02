import { Match } from "effect";
import type { LanguageSyncInput, LanguageProviderCapabilities } from "@polaris/protocol";
import type { Documents } from "./documents.ts";

export async function drainStderr(
  stream: ReadableStream<Uint8Array>,
  onBytes: (bytes: number) => void,
  signal: AbortSignal
) {
  const reader = stream.getReader();

  const cancel = () => {
    // Cancellation closes pending reads without awaiting the source's finalizer.
    void reader.cancel().catch(() => {});
  };

  signal.addEventListener("abort", cancel, { once: true });

  if (signal.aborted) cancel();

  try {
    let bytes = 0;

    while (true) {
      const chunk = await reader.read();

      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      onBytes(bytes);

      if (bytes > 65536) {
        cancel();
        break;
      }
    }
  } catch {
    /* Process shutdown can close stderr. */
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}

type SaveParameters = { textDocument: { uri: string }; text?: string };

export function notificationMessage(
  notification: LanguageSyncInput["notification"],
  document: Documents["open"] extends Map<string, infer D> ? D | undefined : never,
  capabilities: LanguageProviderCapabilities
) {
  return Match.value(notification).pipe(
    Match.tag("Open", (value) =>
      capabilities.openClose
        ? {
            method: "textDocument/didOpen",
            params: {
              textDocument: {
                uri: value.uri,
                version: value.version,
                languageId: value.languageId,
                text: value.text,
              },
            },
          }
        : undefined
    ),
    Match.tag("Change", (value) =>
      capabilities.synchronization === "none"
        ? undefined
        : {
            method: "textDocument/didChange",
            params: {
              textDocument: { uri: value.uri, version: value.version },
              contentChanges:
                capabilities.synchronization === "full"
                  ? [{ text: document!.text }]
                  : value.changes,
            },
          }
    ),
    Match.tag("Close", (value) =>
      capabilities.openClose
        ? { method: "textDocument/didClose", params: { textDocument: { uri: value.uri } } }
        : undefined
    ),
    Match.tag("Save", (value) => {
      if (!capabilities.save) return undefined;

      const params: SaveParameters = {
        textDocument: { uri: value.uri },
      };

      if (capabilities.saveIncludeText) params.text = document!.text;

      return { method: "textDocument/didSave", params };
    }),
    Match.exhaustive
  );
}

export const clientCapabilities = {
  general: { positionEncodings: ["utf-8", "utf-16", "utf-32"] },
  workspace: {
    configuration: true,
    workspaceFolders: true,
    applyEdit: true,
    workspaceEdit: { documentChanges: true, resourceOperations: ["create", "rename", "delete"] },
    didChangeConfiguration: { dynamicRegistration: false },
  },
  textDocument: {
    synchronization: { dynamicRegistration: false, didSave: true },
    completion: { dynamicRegistration: true },
    hover: { dynamicRegistration: true },
    diagnostic: { dynamicRegistration: true },
    publishDiagnostics: { versionSupport: true },
  },
  window: { workDoneProgress: true },
};
