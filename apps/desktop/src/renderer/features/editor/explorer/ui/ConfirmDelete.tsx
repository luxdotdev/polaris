/** Asked before deleting for good: only where the Host has no trash (spec §2). */
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@polaris/ui";
import { basename } from "../model/paths.ts";

export interface ConfirmDeleteProps {
  readonly path: string | null;
  readonly host: string;
  readonly onConfirm: (path: string) => void;
  readonly onCancel: () => void;
}

export const ConfirmDelete = ({ path, host, onConfirm, onCancel }: ConfirmDeleteProps) => (
  <Dialog open={path !== null} onOpenChange={(open) => (open ? undefined : onCancel())}>
    <DialogContent data-testid="confirm-delete">
      <DialogHeader>
        <DialogTitle>Delete {path === null ? "" : basename(path)} for good?</DialogTitle>
        <DialogDescription>{host} has no trash, so this can't be undone.</DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="ghost" autoFocus onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="danger" onClick={() => (path === null ? undefined : onConfirm(path))}>
          Delete
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
