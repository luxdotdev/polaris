import { Button } from "@polaris/ui";
import { useStore } from "zustand";
import { needsUser, refactorRegistry, type RefactorController } from "../refactors/controller.ts";
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

  // Recovery shows only when it needs the user; a one-file rename applied directly shows nothing.
  const group = state.group !== null && needsUser(state.group) ? state.group : null;

  if (group === null && error === null) return null;

  return (
    <section
      aria-label="Refactor recovery"
      className="border-border bg-surface text-text flex max-h-[70vh] min-h-0 flex-col border-b"
      data-testid="refactor-preview"
    >
      <header className="px-panel py-row flex flex-wrap items-center gap-3">
        <strong className="text-text-strong">Refactor recovery</strong>
        <span className="text-text-muted text-xs">{state.hostKey}</span>
      </header>
      <div className="px-panel min-h-0 overflow-auto">
        {group === null ? null : (
          <p role="status" className="py-row text-sm">
            {group.state}: {group.message}
          </p>
        )}
        {group?.outcome?.steps.map((step) => (
          <p key={step.index} className="font-mono text-xs break-all">
            {step.index + 1}. {step.operation.kind}: {step.state} · {step.message}
          </p>
        ))}
        {error === null ? null : (
          <p role="alert" className="text-severity-high py-row text-sm">
            {error}
          </p>
        )}
      </div>
      <footer className="px-panel py-row flex flex-wrap justify-end gap-2">
        {group === null ? null : (
          <>
            <Button variant="secondary" disabled={busy} onClick={() => void controller.status()}>
              Check outcome
            </Button>
            <Button
              variant="primary"
              disabled={busy || group.outcome === null || group.state === "conflict"}
              onClick={() =>
                void controller.recover(group.state === "applied" ? "undo" : "recover")
              }
            >
              {group.state === "applied" ? "Undo refactor" : "Recover file operations"}
            </Button>
          </>
        )}
      </footer>
    </section>
  );
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
