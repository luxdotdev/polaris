/**
 * What a Risk Finding may show of a secret: its first four characters and
 * its length, or a PEM block's `-----BEGIN …-----` line, which names the key
 * type and holds nothing secret. Nothing else of the value is ever stored.
 */
export const maskSecret = (value: string): string => {
  const pem = /^-----BEGIN [A-Z0-9 ]+-----/.exec(value);

  if (pem !== null) return `${pem[0]}… (${value.length} characters)`;
  const visible = value.length > 12 ? 4 : 0;

  return `${value.slice(0, visible)}${"•".repeat(4)} (${value.length} characters)`;
};
