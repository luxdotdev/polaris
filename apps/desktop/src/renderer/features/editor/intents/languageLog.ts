/**
 * "Show language server log": the Command Palette (and the status popover) ask for a
 * language's log tab here; the log tab's feature listens and opens it. The contract is
 * `.dagr/contracts/log-intent.md`; nothing here knows how the tab renders.
 */
import type * as P from "@polaris/protocol";
import type { LanguageId } from "../model/language.ts";

export interface LanguageLogIntent {
  readonly hostKey: string;
  readonly workspaceId: string;
  /** The focused file's checkout: a Workspace, one of its Worktrees, or a Review Checkout. */
  readonly checkout: P.LanguageCheckout;
  readonly language: LanguageId;
  /** The server to show; null for the language's first running server. */
  readonly providerId: string | null;
  /** The focused file the request came from. */
  readonly path: string;
}

export type LanguageLogListener = (intent: LanguageLogIntent) => void;

const listeners = new Set<LanguageLogListener>();

/** The log tab's side: returns the unsubscribe. */
export const onOpenLanguageLog = (listener: LanguageLogListener): (() => void) => {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
};

/** Whether anything can open a log tab yet; the palette hides the command until then. */
export const canOpenLanguageLog = (): boolean => listeners.size > 0;

/** Asks for the log tab; true when a listener took the intent. */
export const openLanguageLog = (intent: LanguageLogIntent): boolean => {
  for (const listener of listeners) listener(intent);

  return listeners.size > 0;
};
