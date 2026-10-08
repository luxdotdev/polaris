/**
 * Refactor recovery (DESIGN.md, Editor: Refactor recovery): the disk-change strip's shape under
 * the breadcrumbs, shown only for an unresolved multi-file or file-operation outcome.
 */
import { Button } from "@polaris/ui";
import { useStore } from "zustand";
import { needsUser, refactorRegistry, type RefactorController } from "../refactors/controller.ts";
import { failureCopy, recoveryCopy, type RecoveryAction } from "../refactors/recoveryCopy.ts";
import { EditorStrip } from "./Banner.tsx";

const RecoveryStrip = ({ controller }: { readonly controller: RefactorController }) => {
  const { group, error, busy, preview } = useStore(controller.state);
  const shown = group !== null && needsUser(group) ? group : null;

  // A preview shows its own failures.
  if (preview !== null || (shown === null && error === null)) return null;
  const copy = shown === null ? failureCopy(error ?? "") : recoveryCopy(shown);

  const run: Record<RecoveryAction, () => void> = {
    check: () => void controller.status(),
    undo: () => void controller.recover("recover"),
    dismiss: () => controller.dismissError(),
  };

  return (
    <EditorStrip
      role={error === null ? "status" : "alert"}
      testId="refactor-recovery"
      kind={shown?.state ?? "failed"}
      text={
        shown === null || error === null ? copy.text : `${copy.text} ${failureCopy(error).text}`
      }
    >
      {copy.actions.map(({ action, label }) => (
        <Button
          key={action}
          variant="secondary"
          aria-disabled={busy}
          onClick={() => {
            if (!busy) run[action]();
          }}
        >
          {label}
        </Button>
      ))}
    </EditorStrip>
  );
};

export const RefactorRecovery = ({
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

  return controller === null ? null : <RecoveryStrip controller={controller} />;
};
