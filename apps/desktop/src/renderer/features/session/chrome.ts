/**
 * What another feature can put around a session's conversation: Constellations swap in a
 * worker's header, Polaris-authored cards for briefs and digests, the Claim, a steer route.
 */
import { createContext, type ReactNode, useContext } from "react";

export interface PolarisCardArgs {
  readonly turnId: string;
  /** The Turn is folded to its one-line summary. */
  readonly folded: boolean;
  readonly onToggle: () => void;
}

export interface SessionChrome {
  /** Replaces the session header. */
  readonly header?: ReactNode;
  /** A Polaris-authored Turn's card in place of the prompt bubble; null keeps the bubble. */
  readonly promptCard?: (args: PolarisCardArgs) => ReactNode | null;
  /** Replaces the conversation (a handover summary); the composer stays. */
  readonly body?: ReactNode;
  /** Closes the conversation, after the last row. */
  readonly trailer?: ReactNode;
  /** Sends the composer's text somewhere other than the session (a journaled steer). */
  readonly composer?: {
    readonly placeholder: string;
    readonly onSubmit: (text: string) => Promise<boolean>;
  };
}

const NONE: SessionChrome = {};

export const SessionChromeContext = createContext<SessionChrome>(NONE);

export const useSessionChrome = (): SessionChrome => useContext(SessionChromeContext);
