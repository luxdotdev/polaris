/**
 * Closing a tab with unsaved edits (lead's call, after VS Code): Save, Don't
 * save or Cancel. ↵ saves, esc cancels. A crash or a quit still keeps the
 * edits as a draft; only "Don't save" forgets them.
 */
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@polaris/ui";
import { baseName } from "../model/language.ts";
import { answerClose, type CloseChoice } from "../runtime/actions.ts";
import { useEditor } from "../runtime/store.ts";
import { showOpenFailure } from "./toasts.ts";

const answer = (choice: CloseChoice) => {
  void answerClose(choice).catch(() =>
    showOpenFailure({
      title: "Couldn't close file",
      message: "The file is still open. Your edits were kept.",
    })
  );
};

export interface CloseDialogProps {
  readonly hostKey: string;
  readonly workspaceId: string;
}

export const CloseDialog = ({ hostKey, workspaceId }: CloseDialogProps) => {
  const closing = useEditor((s) =>
    s.closing !== null && s.closing.hostKey === hostKey && s.closing.workspaceId === workspaceId
      ? s.closing
      : null
  );

  return (
    <Dialog
      open={closing !== null}
      onOpenChange={(open) => {
        if (!open) answer("cancel");
      }}
    >
      <DialogContent data-testid="editor-close-dialog">
        <DialogHeader>
          <DialogTitle>
            Save changes to {closing === null ? "this file" : baseName(closing.path)}?
          </DialogTitle>
          <DialogDescription>Your edits are lost if you don't save them.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" className="mr-auto" onClick={() => answer("discard")}>
            Don't save
          </Button>
          <Button variant="secondary" onClick={() => answer("cancel")}>
            Cancel
          </Button>
          <Button variant="primary" autoFocus onClick={() => answer("save")}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
