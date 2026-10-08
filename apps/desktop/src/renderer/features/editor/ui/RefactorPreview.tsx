import { useStore } from "zustand";
import { refactorRegistry, type RefactorController } from "../refactors/controller.ts";
import { hostInSentence } from "../../../shell/hostCopy.ts";
import { useApp } from "../../../shell/hooks.ts";
import { fileKey } from "../model/drafts.ts";
import { providerLabel } from "../trust/store.ts";
import { RenamePreview } from "./RenamePreview.tsx";
import { getActiveEditor } from "../runtime/hooks.ts";

/** Why an accept left nothing renamed, in one line; the Host's text is never shown. */
const acceptFailure = (controller: RefactorController, host: string) =>
  controller.coordinator.port.connected()
    ? "A file changed since this preview, so nothing was renamed. Rename again to see the current changes."
    : `Can't reach ${host}, so nothing was renamed.`;

const PreviewBody = ({
  controller,
  root,
}: {
  readonly controller: RefactorController;
  readonly root: string;
}) => {
  const state = useStore(controller.state);
  const { preview, error, busy } = state;
  const hostView = useApp((s) => s.hosts.find((h) => h.key === controller.hostKey));
  const host = hostView?.label ?? controller.hostKey;

  if (preview !== null) {
    const providerId = preview.proposal.fence.context.providerId;
    const active = getActiveEditor()?.path ?? null;

    // The provider as the open files' Trust status names it ("TypeScript · bundled").
    const provider =
      [active, ...preview.touched]
        .flatMap((path) =>
          path === null ? [] : [providerLabel(fileKey(controller.hostKey, path), providerId)]
        )
        .find((label) => label !== providerId) ?? providerId;

    return (
      <RenamePreview
        preview={preview}
        root={root}
        first={active}
        provider={provider}
        host={host}
        busy={busy}
        failure={error === null ? null : acceptFailure(controller, hostInSentence(hostView))}
        onAccept={() => void controller.accept()}
        onCancel={() => void controller.reject()}
      />
    );
  }

  // Recovery has its own strip under the breadcrumbs (RefactorRecovery).
  return null;
};

export const RefactorPreview = ({
  hostKey,
  root,
}: {
  readonly hostKey: string;
  readonly root: string;
}) => {
  const controller = useStore(
    refactorRegistry,
    (state) => state.controllers.get(hostKey + "\u0000" + root) ?? null
  );

  return controller === null ? null : <PreviewBody controller={controller} root={root} />;
};
