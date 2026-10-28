/**
 * A secret on the clipboard (a link string): marked so clipboard history keeps no copy,
 * cleared after a minute unless the user copied something else since. Never logged.
 */
export interface SystemClipboard {
  readonly readText: () => string | Promise<string>;
  /** One entry, by MIME type or raw platform format, committed atomically. */
  readonly write: (entry: Readonly<Record<string, string>>) => Promise<void>;
  readonly clear: () => void;
}

export const SECRET_CLIPBOARD_MS = 60_000;

const raw = (format: string) => `electron application/osclipboard;format="${format}"`;

/**
 * nspasteboard.org's markers, which clipboard managers and history honour (RV5). Universal
 * Clipboard still carries the link to the user's iPhone: the advertised paste flow.
 */
export const SECRET_MARKERS = [
  raw("org.nspasteboard.ConcealedType"),
  raw("org.nspasteboard.TransientType"),
] as const;

export const writeSecret = async (
  clipboard: SystemClipboard,
  text: string,
  schedule: (run: () => Promise<void>, ms: number) => void = setTimeout
) => {
  const markers = Object.fromEntries(SECRET_MARKERS.map((format) => [format, ""]));
  await clipboard.write({ "text/plain": text, ...markers });
  schedule(async () => {
    if ((await clipboard.readText()) === text) clipboard.clear();
  }, SECRET_CLIPBOARD_MS);
};
