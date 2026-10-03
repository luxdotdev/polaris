import { Button } from "@polaris/ui";
import { useStore } from "zustand";
import { refactorRegistry, type RefactorController } from "../refactors/controller.ts";

const PreviewBody = ({ controller }: { readonly controller: RefactorController }) => {
  const state = useStore(controller.state);
  const { preview, group, error, busy } = state;

  if (preview === null && group === null && error === null) return null;

  return (
    <section
      aria-label="Refactor preview"
      className="border-border bg-surface text-text flex max-h-[70vh] min-h-0 flex-col border-b"
      data-testid="refactor-preview"
    >
      <header className="px-panel py-row flex flex-wrap items-center gap-3">
        <strong className="text-text-strong">
          {preview?.proposal.label ?? "Refactor recovery"}
        </strong>
        <span className="text-text-muted text-xs">{state.hostKey}</span>
        <span className="text-text-muted text-xs">
          Text changes stay as drafts. File operations change disk.
        </span>
      </header>
      <div className="px-panel min-h-0 overflow-auto">
        {preview?.proposal.edit.documentChanges?.map((change, index) =>
          "kind" in change ? (
            <p key={index} className="font-mono text-xs break-all">
              {index + 1}. {change.kind}{" "}
              {change.kind === "rename" ? `${change.oldUri} → ${change.newUri}` : change.uri}
            </p>
          ) : null
        )}
        {preview?.documents
          .filter((doc) => doc.dirty)
          .map((doc) => (
            <details key={doc.canonicalPath} open>
              <summary className="py-row font-mono text-xs break-all">{doc.canonicalPath}</summary>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-text-muted text-xs">Original draft</p>
                  <pre aria-label="Original text" className="text-text-muted overflow-auto text-xs">
                    {preview.originals.find((original) => original.canonicalPath === doc.sourcePath)
                      ?.text ?? ""}
                  </pre>
                </div>
                <div>
                  <p className="text-text-muted text-xs">Proposed draft</p>
                  <pre aria-label="Draft text" className="overflow-auto text-xs">
                    {doc.text}
                  </pre>
                </div>
              </div>
            </details>
          ))}
        {preview?.originals
          .filter(
            (original) =>
              original.dirty &&
              !preview.documents.some((doc) => doc.sourcePath === original.canonicalPath)
          )
          .map((original) => (
            <details key={original.canonicalPath}>
              <summary className="font-mono text-xs break-all">
                Preserved original draft: {original.canonicalPath}
              </summary>
              <pre className="overflow-auto text-xs">{original.text}</pre>
            </details>
          ))}
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
        {preview === null ? null : (
          <>
            <Button variant="secondary" disabled={busy} onClick={() => void controller.reject()}>
              Reject
            </Button>
            <Button variant="primary" disabled={busy} onClick={() => void controller.accept()}>
              Accept refactor
            </Button>
          </>
        )}
        {group === null || group.state === "restored" ? null : (
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

  return controller === null ? null : <PreviewBody controller={controller} />;
};
