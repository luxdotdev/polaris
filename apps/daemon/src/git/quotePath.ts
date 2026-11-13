/** Paths as git prints them: C-quoted when they hold unusual bytes. */
const ESCAPES = new Map([
  ["n", 10],
  ["t", 9],
  ['"', 34],
  ["\\", 92],
  ["a", 7],
  ["b", 8],
]);

/** git C-quotes a path with unusual bytes ("a\303\251.ts"); octal escapes are UTF-8 bytes. */
export const unquotePath = (raw: string): string => {
  if (!raw.startsWith('"') || !raw.endsWith('"')) return raw;
  const bytes: Array<number> = [];
  const body = raw.slice(1, -1);

  for (let at = 0; at < body.length; at++) {
    const char = body[at]!;

    if (char !== "\\") {
      bytes.push(...Buffer.from(char));
      continue;
    }

    const octal = /^[0-7]{3}/.exec(body.slice(at + 1));

    if (octal === null) bytes.push(ESCAPES.get(body[at + 1]!) ?? body.charCodeAt(at + 1));
    else bytes.push(Number.parseInt(octal[0], 8));
    at += octal === null ? 1 : 3;
  }

  return Buffer.from(bytes).toString("utf8");
};
