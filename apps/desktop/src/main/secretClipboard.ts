/**
 * A secret on the clipboard (a link string): cleared after a minute, unless the user
 * copied something else since. The text is never logged.
 */
export interface SystemClipboard {
  readonly readText: () => string | Promise<string>;
  readonly writeText: (text: string) => void;
  readonly clear: () => void;
}

export const SECRET_CLIPBOARD_MS = 60_000;

export const writeSecret = (
  clipboard: SystemClipboard,
  text: string,
  schedule: (run: () => Promise<void>, ms: number) => void = setTimeout
) => {
  clipboard.writeText(text);
  schedule(async () => {
    if ((await clipboard.readText()) === text) clipboard.clear();
  }, SECRET_CLIPBOARD_MS);
};
