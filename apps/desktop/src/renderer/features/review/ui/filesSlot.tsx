/**
 * The file list's place under the queue (Paper X-G): the Review view owns the element, the
 * open subject's body portals its file list into it, so the list keeps its subject's state.
 */
import { createContext, type ReactNode, useContext } from "react";
import { createPortal } from "react-dom";

const FilesSlot = createContext<HTMLElement | null>(null);

export const FilesSlotProvider = FilesSlot.Provider;

/** Renders into the queue's file slot; nothing until the slot is mounted. */
export const InFilesSlot = ({ children }: { readonly children: ReactNode }) => {
  const slot = useContext(FilesSlot);

  return slot === null ? null : createPortal(children, slot);
};
