/**
 * The xterm runtime loads with the first terminal shown (a lazy chunk), so the
 * app starts without it; until then there is nothing to dispose, reattach or focus.
 */
export interface RuntimeApi {
  readonly disposeTerminal: (hostKey: string, terminalId: string) => void;
  readonly reattachDropped: (hostKey: string) => void;
  readonly focusTerminal: (hostKey: string, terminalId: string) => void;
  /** The text selected in it; "" when nothing is. */
  readonly selection: (hostKey: string, terminalId: string) => string;
  readonly selectAll: (hostKey: string, terminalId: string) => void;
  /** Clears its scrollback and screen, as ⌘K does in Terminal. */
  readonly clear: (hostKey: string, terminalId: string) => void;
}

export interface Loaded {
  runtime: RuntimeApi | null;
}

export const loaded: Loaded = { runtime: null };
