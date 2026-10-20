/**
 * Host images shown in place, memoised per (Host, path) so a re-render or remount never reads
 * the Host again, and bounded in count, encoded and decoded bytes. Unused images stay until
 * room is needed; a failure is asked again after `retryMs`, so a Host back online shows it.
 */
import type { HostImage, HostImageFailure } from "./index.ts";

export type HostImageView =
  | { readonly kind: "ready"; readonly url: string }
  | {
      readonly kind: "failed";
      readonly reason: HostImageFailure | "too-large" | "busy";
    };

export interface HostImageLease {
  /** The image if it's already settled, so a remount shows it without a loading frame. */
  readonly current: HostImageView | null;
  readonly settled: Promise<HostImageView>;
  readonly release: () => void;
}

export interface HostImageLimits {
  readonly images: number;
  readonly bytes: number;
  readonly decodedBytes: number;
  /** Host reads in flight at once. */
  readonly reads: number;
  readonly retryMs: number;
}

export interface HostImageDeps {
  readonly read: (hostKey: string, path: string) => Promise<HostImage>;
  readonly createUrl?: (blob: Blob) => string;
  readonly revokeUrl?: (url: string) => void;
  readonly now?: () => number;
}

interface Entry {
  readonly key: string;
  refs: number;
  view: HostImageView | null;
  settledAt: number;
  bytes: number;
  decodedBytes: number;
  readonly settled: Promise<HostImageView>;
}

const LIMITS: HostImageLimits = {
  images: 32,
  bytes: 48 * 1024 * 1024,
  decodedBytes: 256 * 1024 * 1024,
  reads: 2,
  retryMs: 5000,
};

export class HostImagePool {
  private readonly entries = new Map<string, Entry>();
  private readonly waiting: Array<() => void> = [];
  private reading = 0;
  private bytes = 0;
  private decodedBytes = 0;
  private images = 0;
  private readonly createUrl: (blob: Blob) => string;
  private readonly revokeUrl: (url: string) => void;
  private readonly now: () => number;

  constructor(
    private readonly deps: HostImageDeps,
    private readonly limits: HostImageLimits = LIMITS
  ) {
    this.createUrl = deps.createUrl ?? ((blob) => URL.createObjectURL(blob));
    this.revokeUrl = deps.revokeUrl ?? ((url) => URL.revokeObjectURL(url));
    this.now = deps.now ?? Date.now;
  }

  acquire(hostKey: string, path: string): HostImageLease {
    const key = `${hostKey}\n${path}`;
    const known = this.entries.get(key);
    const stale = known?.view?.kind === "failed" && known.refs === 0 && this.isStale(known);

    if (stale) this.entries.delete(key);
    const entry = (stale ? undefined : known) ?? this.start(key, hostKey, path);

    entry.refs += 1;
    // Most recently used last, so eviction takes the oldest unused first.
    this.entries.delete(key);
    this.entries.set(key, entry);
    let released = false;

    return {
      current: entry.view,
      settled: entry.settled,
      release: () => {
        if (released) return;
        released = true;
        entry.refs -= 1;
        this.trim();
      },
    };
  }

  private isStale(entry: Entry): boolean {
    return this.now() - entry.settledAt >= this.limits.retryMs;
  }

  private start(key: string, hostKey: string, path: string): Entry {
    const entry: Entry = {
      key,
      refs: 0,
      view: null,
      settledAt: 0,
      bytes: 0,
      decodedBytes: 0,
      settled: Promise.resolve().then(() => this.limited(() => this.run(entry, hostKey, path))),
    };

    return entry;
  }

  private async run(entry: Entry, hostKey: string, path: string): Promise<HostImageView> {
    // Nobody is waiting any more (scrolled past mid-stream): skip the read and forget it.
    if (entry.refs === 0) {
      this.evict(entry);

      return { kind: "failed", reason: "unreadable" };
    }

    const image = await this.deps.read(hostKey, path).catch(() => ({
      kind: "failed" as const,
      reason: "unreadable" as const,
    }));

    return this.settle(entry, image);
  }

  private settle(entry: Entry, image: HostImage): HostImageView {
    const view = this.admit(entry, image);

    entry.view = view;
    entry.settledAt = this.now();
    this.trim();

    return view;
  }

  private admit(entry: Entry, image: HostImage): HostImageView {
    if (image.kind !== "ready")
      return { kind: "failed", reason: image.kind === "too-large" ? "too-large" : image.reason };

    if (image.bytes > this.limits.bytes || image.decodedBytes > this.limits.decodedBytes)
      return { kind: "failed", reason: "too-large" };
    this.makeRoom(image.bytes, image.decodedBytes);

    if (!this.fits(image.bytes, image.decodedBytes)) return { kind: "failed", reason: "busy" };
    entry.bytes = image.bytes;
    entry.decodedBytes = image.decodedBytes;
    this.images += 1;
    this.bytes += image.bytes;
    this.decodedBytes += image.decodedBytes;

    return { kind: "ready", url: this.createUrl(image.blob) };
  }

  private fits(bytes: number, decodedBytes: number): boolean {
    return (
      this.images + 1 <= this.limits.images &&
      this.bytes + bytes <= this.limits.bytes &&
      this.decodedBytes + decodedBytes <= this.limits.decodedBytes
    );
  }

  /** Evicts unused images, oldest first, until one of this size fits or none are left. */
  private makeRoom(bytes: number, decodedBytes: number): void {
    // A Map's iterator stays valid while entries are deleted from it.
    for (const entry of this.entries.values()) {
      if (this.fits(bytes, decodedBytes)) return;

      if (entry.refs === 0 && entry.view?.kind === "ready") this.evict(entry);
    }
  }

  /** Keeps unused entries to the image count; failures past their retry go too. */
  private trim(): void {
    let idle = [...this.entries.values()].filter(
      (entry) => entry.refs === 0 && entry.view !== null
    );

    for (const entry of idle)
      if (entry.view?.kind === "failed" && this.isStale(entry)) this.evict(entry);
    idle = idle.filter((entry) => this.entries.has(entry.key));

    while (this.entries.size > this.limits.images && idle.length > 0) {
      const oldest = idle.shift();

      if (oldest !== undefined) this.evict(oldest);
    }
  }

  private evict(entry: Entry): void {
    if (this.entries.get(entry.key) === entry) this.entries.delete(entry.key);

    if (entry.view?.kind !== "ready") return;
    this.revokeUrl(entry.view.url);
    this.images -= 1;
    this.bytes -= entry.bytes;
    this.decodedBytes -= entry.decodedBytes;
    entry.view = { kind: "failed", reason: "busy" };
  }

  private async limited<A>(task: () => Promise<A>): Promise<A> {
    if (this.reading >= this.limits.reads)
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.reading += 1;

    try {
      return await task();
    } finally {
      this.reading -= 1;
      this.waiting.shift()?.();
    }
  }
}
