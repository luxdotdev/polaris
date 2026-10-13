import { Schema } from "effect";

const privateAddress = (host: string): boolean => {
  if (host === "localhost" || host === "[::1]") return true;

  if (/^\[f[cd][0-9a-f]{2}:/i.test(host)) return true;
  const parts = host.split(".").map(Number);

  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255))
    return false;
  const [a, b] = parts;

  return (
    a === 127 ||
    a === 10 ||
    (a === 192 && b === 168) ||
    (a === 172 && b !== undefined && b >= 16 && b <= 31)
  );
};

/** Literal private addresses and localhost only; no DNS resolution or redirect-based probing. */
export const PredictionEndpointUrl = Schema.String.check(
  Schema.isMaxLength(2048),
  Schema.makeFilter((value) => {
    try {
      const url = new URL(value);

      return (
        ["http:", "https:"].includes(url.protocol) &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash &&
        privateAddress(url.hostname)
      );
    } catch {
      return false;
    }
  })
);
