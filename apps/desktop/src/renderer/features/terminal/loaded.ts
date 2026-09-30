/**
 * The xterm runtime loads with the first terminal shown (a lazy chunk), so the
 * app starts without it; until then there is nothing to dispose or reattach.
 */
export interface RuntimeApi {
  readonly disposeTerminal: (hostKey: string, terminalId: string) => void;
  readonly reattachDropped: (hostKey: string) => void;
}

export interface Loaded {
  runtime: RuntimeApi | null;
}

export const loaded: Loaded = { runtime: null };
