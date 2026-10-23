/** The phone page's connection log: the latest lines, newest first, each with its local time. */
import { diagnosticText } from "./diagnostics.ts";

export interface ConnectionLog {
  readonly add: (line: string) => void;
  readonly lines: () => ReadonlyArray<string>;
  readonly onChange: (listener: () => void) => void;
}

const clock = (at: Date) =>
  `${at.toTimeString().slice(0, 8)}.${String(at.getMilliseconds()).padStart(3, "0")}`;

export const connectionLog = (limit = 40, now = () => new Date()): ConnectionLog => {
  let lines: ReadonlyArray<string> = [];
  const listeners: Array<() => void> = [];

  return {
    add: (line) => {
      lines = [`${clock(now())} ${diagnosticText(line)}`, ...lines].slice(0, limit);

      for (const listener of listeners) listener();
    },
    lines: () => lines,
    onChange: (listener) => void listeners.push(listener),
  };
};

/** An error as the log shows it: its tag (or name) and message. */
export const describeCause = (cause: unknown) =>
  diagnosticText(cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause));

/** Sends the page's console (Effect logs there) and uncaught errors to the log, which the phone shows. */
export const captureConsole = (log: ConnectionLog) => {
  const text = (args: ReadonlyArray<unknown>) => args.map(describeCause).join(" ");

  for (const level of ["error", "warn", "log"] as const) {
    const original = console[level].bind(console);

    console[level] = (...args: Array<unknown>) => {
      const safe = diagnosticText(text(args));
      log.add(`console.${level}: ${safe}`);
      original(safe);
    };
  }

  window.addEventListener("error", (event) => {
    event.preventDefault();
    log.add(`uncaught: ${describeCause(event.error ?? event.message)}`);
  });
  window.addEventListener("unhandledrejection", (event) => {
    event.preventDefault();
    log.add(`unhandled rejection: ${describeCause(event.reason)}`);
  });
};
