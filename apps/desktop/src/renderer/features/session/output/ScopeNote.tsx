/** The line above the whole session's diff when it isn't every Turn (ENG-977). */
import { Button } from "@polaris/ui";
import type { ScopeNote } from "./sessionScope.ts";

export const ScopeNoteLine = ({ note }: { readonly note: ScopeNote | null }) => {
  if (note === null) return null;

  return (
    <div
      className="text-caption text-text-subtle flex flex-wrap items-center gap-1 px-4 pt-3"
      data-testid="scope-note"
    >
      {note.kind === "partial" ? (
        <>
          <span>Couldn't reach the session's first turns; showing the loaded turns only</span>
          <Button variant="ghost" size="sm" onClick={note.retry}>
            Retry
          </Button>
        </>
      ) : (
        <span>From turn {note.number}: earlier turns have no checkpoint</span>
      )}
    </div>
  );
};
