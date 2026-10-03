import { checkMovingDraftOwnership } from "../refactors/movingInventory.ts";
import type { AppState } from "../../../store/store.ts";
import { polaris } from "../../bridge.ts";
import type { EditorLanguageCoordinator } from "../lsp/integration.ts";
import { languageStore } from "../lsp/state.ts";
import { equal } from "../refactors/equality.ts";
import type { GroupStore } from "../refactors/group.ts";
import { collectInventory } from "../refactors/inventory.ts";
import { within } from "../refactors/plan.ts";
import { bindRuntimeRefactors, type RuntimeRefactorContext } from "../refactors/runtime.ts";
import { editorDraftStore, openBuffers } from "./buffers.ts";
import { previewDocument } from "./markdown.ts";
import {
  checkRefactorBuffers,
  checkMovingRefactorBuffers,
  checkRefactorDrafts,
  openRefactorDocuments,
  publishRefactorBuffers,
} from "./refactorBuffers.ts";
import type { EditorFiles } from "../files/port.ts";
import type { KeyValue } from "../model/drafts.ts";
import { editorStore } from "./store.ts";

/** Project E1 contexts only through the independent Main identity and actual registered checkout. */
export const currentRefactorContexts = (
  app: AppState,
  languages: EditorLanguageCoordinator
): readonly RuntimeRefactorContext[] => {
  const contexts = new Map<string, RuntimeRefactorContext>();

  for (const buffer of openBuffers()) {
    const entry = languages.get(buffer.key);
    const identity = languages.identity(buffer.file.hostKey);
    const document = previewDocument(app, buffer.file);
    const host = app.hosts.find((value) => value.key === buffer.file.hostKey);

    if (
      entry === undefined ||
      entry.disposed ||
      entry.controller.signal.aborted ||
      identity === null ||
      document === null ||
      host?.status.state !== "connected" ||
      !host.status.capabilities.includes("languages") ||
      identity.hostId !== document.hostId ||
      identity.connectionEpoch <= 0
    )
      continue;

    for (const session of entry.groups) {
      const lifetime = session.refactorContext();

      if (lifetime === null) continue;
      const provider = lifetime.provider;

      if (
        provider.context.hostId !== identity.hostId ||
        provider.context.clientId !== identity.clientId ||
        !equal(provider.context.checkout, document.checkout)
      )
        continue;
      const key = JSON.stringify(provider.context);

      if (contexts.has(key)) continue;
      contexts.set(key, {
        hostKey: buffer.file.hostKey,
        identity,
        context: provider.context,
        token: session,
        signal: lifetime.signal,
        provider,
        capabilities: host.status.capabilities,
      });
    }
  }

  return [...contexts.values()];
};

export const bindAppRefactors = (input: {
  readonly app: () => AppState;
  readonly languages: EditorLanguageCoordinator;
  readonly groups: GroupStore;
  readonly files: EditorFiles;
  readonly kv: KeyValue | null;
  readonly subscribeApp?: ((changed: () => void) => () => void) | undefined;
}) =>
  bindRuntimeRefactors({
    api: () => polaris().languages,
    contexts: () => currentRefactorContexts(input.app(), input.languages),
    groups: input.groups,
    opened: (hostKey, root) =>
      openRefactorDocuments(hostKey).filter((doc) => within(root, doc.canonicalPath)),
    inventory: (proposal, hostKey) =>
      collectInventory(
        proposal,
        hostKey,
        openRefactorDocuments(hostKey),
        input.kv,
        editorDraftStore(),
        input.files,
        input.groups
      ),
    validateDisk: async (proposal, hostKey) => {
      for (const snapshot of proposal.snapshots) {
        const disk = await input.files.read({
          hostKey,
          path: snapshot.canonicalPath,
          root: proposal.fence.context.checkout.path,
        });

        const unchanged =
          disk.kind === "missing"
            ? snapshot.diskVersion === null && snapshot.diskText === null
            : disk.kind === "text" &&
              equal(disk.version, snapshot.diskVersion) &&
              disk.text === snapshot.diskText;

        if (!unchanged) throw new Error("An affected file changed on disk. Request a new preview.");
      }
    },
    moving: async (group) => {
      checkMovingRefactorBuffers(group);
      await checkMovingDraftOwnership(
        group,
        openRefactorDocuments(group.hostKey),
        input.kv,
        editorDraftStore(),
        input.groups
      );
      checkMovingRefactorBuffers(group);
    },
    current: async (group, outcome) => {
      checkRefactorBuffers(group, outcome);
      await checkRefactorDrafts(group, editorDraftStore());
      checkRefactorBuffers(group, outcome);
    },
    publish: publishRefactorBuffers,
    subscribe: (changed) => {
      const offLanguage = languageStore.subscribe(changed);
      const offApp = input.subscribeApp?.(changed);

      const offEditor = editorStore.subscribe((state, previous) => {
        if (state.buffers !== previous.buffers) changed();
      });

      return () => {
        offLanguage();
        offApp?.();
        offEditor();
      };
    },
  });
