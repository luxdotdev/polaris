/** The phone page's connection log: the latest lines, oldest first, each with its time. */
export interface ConnectionLog {
  readonly add: (line: string) => void;
  readonly lines: () => ReadonlyArray<string>;
  readonly onChange: (listener: () => void) => void;
}

export const connectionLog = (limit = 60, now = () => new Date()): ConnectionLog => {
  let lines: ReadonlyArray<string> = [];
  const listeners: Array<() => void> = [];

  return {
    add: (line) => {
      lines = [...lines, `${now().toISOString().slice(11, 23)} ${line}`].slice(-limit);

      for (const listener of listeners) listener();
    },
    lines: () => lines,
    onChange: (listener) => void listeners.push(listener),
  };
};

/** An error as the log shows it: its tag (or name) and message. */
export const describeCause = (cause: unknown) =>
  cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);
