import type { WireOptions } from "@polaris/protocol";

export const GATEWAY_MAX_CONNECTIONS = 16;

export const GATEWAY_PRE_HELLO_BYTES = 64 * 1024;

export const GATEWAY_HELLO_TIMEOUT_MS = 10_000;

export const GATEWAY_MAX_QUEUED_BYTES = 32 * 1024 * 1024;

export const GATEWAY_MAX_QUEUED_MESSAGES = 64;

/** Enough for a five-minute voice recording, without the local socket's GiB buffer. */
export const GATEWAY_WIRE_LIMITS: WireOptions = {
  maxBlobBytes: 16 * 1024 * 1024,
  maxBufferedBlobBytes: 32 * 1024 * 1024,
  maxQueuedJsonBytes: 1024 * 1024,
  unclaimedBlobTtlMs: 10_000,
  blobIdleTimeoutMs: 10_000,
};

/** Global to the listener: Tailscale proxying makes an IP-based budget misleading. No timer. */
export const requestBudget = (burst: number, perSecond: number, now = () => performance.now()) => {
  let available = burst;
  let last = now();

  return () => {
    const current = now();
    available = Math.min(burst, available + ((current - last) * perSecond) / 1000);
    last = current;

    if (available < 1) return false;
    available--;

    return true;
  };
};
