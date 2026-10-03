import { createHmac, randomBytes } from "node:crypto";
import { isIP } from "node:net";

export const windowMs = 15 * 60 * 1000;

/** Fixed-window, per-instance guard. Only ephemeral keyed digests and counts are retained. */
export function createRateLimit(now: () => number = Date.now) {
  let until = 0;
  let secret = randomBytes(32);
  let total = 0;
  const counts = new Map<string, number>();

  return (headers: Headers, vercel: boolean): number => {
    const time = now();

    if (time >= until) {
      counts.clear();
      secret = randomBytes(32);
      total = 0;
      until = time + windowMs;
    }

    const raw = vercel ? headers.get("x-vercel-forwarded-for")?.trim() : undefined;
    const version = raw ? isIP(raw) : 0;
    let identity = "unknown";

    if (raw && version === 4) identity = raw;

    if (raw && version === 6) identity = new URL(`http://[${raw}]`).hostname;
    const key = createHmac("sha256", secret).update(identity).digest("hex");
    const count = counts.get(key) ?? 0;

    if (count >= 3 || total >= 100) return Math.max(1, Math.ceil((until - time) / 1000));
    counts.set(key, count + 1);
    total += 1;

    return 0;
  };
}
