import { Schema } from "effect";
import type { LanguageApi } from "../../../../shared/api.ts";
import { LanguagePreviewMediaView } from "../../../../shared/languages.ts";
import type { LanguagePreviewPolicy } from "@polaris/protocol";
import { previewTarget, type PreviewDocument, type PreviewTarget } from "./targets.ts";

export interface MediaLease {
  readonly url: string;
  readonly release: () => void;
}

export interface ObjectUrls {
  readonly create: (blob: Blob) => string;
  readonly revoke: (url: string) => void;
}

interface MediaJob {
  readonly target: Extract<PreviewTarget, { kind: "file" | "external" }>;
  readonly resolve: (lease: MediaLease) => void;
  readonly reject: (error: Error) => void;
  readonly signal?: AbortSignal | undefined;
  stopped: boolean;
  reserved: boolean;
  cleanup: () => void;
}

const urls: ObjectUrls = {
  create: (blob) => URL.createObjectURL(blob),
  revoke: (url) => URL.revokeObjectURL(url),
};

/** One bounded pool per preview, disposed when its Host, checkout or policy changes. */
export class PreviewMediaPool {
  private readonly active = new Map<string, number>();
  private readonly queue: Array<MediaJob> = [];
  private readonly running = new Set<MediaJob>();
  private reserved = 0;
  private bytes = 0;
  private disposed = false;

  constructor(
    private readonly api: LanguageApi,
    private readonly document: PreviewDocument,
    private readonly policy: LanguagePreviewPolicy,
    private readonly objectUrls: ObjectUrls = urls,
    private readonly limit = 32 * 1024 * 1024,
    private readonly slots = 16,
    private readonly queueLimit = 16,
    private readonly admissionMs = 15000
  ) {}

  async acquire(source: string, signal?: AbortSignal): Promise<MediaLease> {
    if (this.disposed) throw new Error("Preview closed; image limit unavailable");

    if (signal?.aborted) throw new Error("Preview image request canceled");
    const target = previewTarget(source, this.document);

    if (target.kind !== "file" && target.kind !== "external")
      throw new Error("Image path unavailable");

    if (target.kind === "external" && this.policy.externalImages !== "allow")
      throw new Error("External images are blocked");

    if (this.queue.length >= this.queueLimit) throw new Error("Preview image queue limit reached");

    return new Promise((resolve, reject) => {
      const job: MediaJob = {
        target,
        signal,
        resolve,
        reject,
        stopped: false,
        reserved: false,
        cleanup: () => {},
      };

      const abort = () => this.cancel(job, "Preview image request canceled");

      const timer = setTimeout(
        () => this.cancel(job, "Preview image admission deadline reached"),
        this.admissionMs
      );

      job.cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
      };

      signal?.addEventListener("abort", abort, { once: true });
      this.queue.push(job);
      this.drain();
    });
  }

  private cancel(job: MediaJob, message: string): void {
    if (job.stopped) return;
    job.stopped = true;
    job.cleanup();
    const index = this.queue.indexOf(job);

    if (index !== -1) this.queue.splice(index, 1);
    job.reject(new Error(message));
    this.drain();
  }

  private drain(): void {
    if (this.disposed) return;

    while (this.queue.length > 0) {
      const full =
        this.active.size + this.running.size >= this.slots ||
        this.bytes + this.reserved + this.policy.maxMediaBytes > this.limit;

      if (full && this.running.size > 0) return;
      const job = this.queue.shift();

      if (job === undefined) return;

      if (full) {
        this.cancel(job, "Preview image retained capacity limit reached");
        continue;
      }

      this.running.add(job);
      this.reserved += this.policy.maxMediaBytes;
      job.reserved = true;
      job.cleanup();
      // Running cancellation keeps its full reservation until the main request settles.
      const abort = () => this.cancel(job, "Preview image request canceled");
      job.signal?.addEventListener("abort", abort, { once: true });
      job.cleanup = () => job.signal?.removeEventListener("abort", abort);
      void this.run(job);
    }
  }

  private async run(job: MediaJob): Promise<void> {
    try {
      const base = { hostKey: this.document.hostKey, maxBytes: this.policy.maxMediaBytes };
      const target = job.target;

      const result =
        target.kind === "file"
          ? await this.api.request("languages.preview.media", {
              ...base,
              checkout: this.document.checkout,
              documentPath: this.document.path,
              relativePath: target.relativePath,
            })
          : await this.api.request("languages.preview.external", {
              ...base,
              workspaceId: this.document.checkout.workspaceId,
              url: target.url,
            });

      if (job.stopped || this.disposed) return;

      if (!result.ok) throw new Error(result.error.message);
      const media = Schema.decodeUnknownSync(LanguagePreviewMediaView)(result.value);

      if (media.bytes > this.policy.maxMediaBytes || this.bytes + media.bytes > this.limit)
        throw new Error("Preview image limit reached");
      const raw = atob(media.base64);
      const data = Uint8Array.from(raw, (character) => character.charCodeAt(0));
      this.releaseReservation(job);
      const url = this.objectUrls.create(new Blob([data], { type: media.mimeType }));
      this.active.set(url, media.bytes);
      this.bytes += media.bytes;
      job.resolve({ url, release: () => this.release(url) });
    } catch {
      job.reject(new Error("Preview image response unavailable"));
    } finally {
      job.stopped = true;
      job.cleanup();
      this.running.delete(job);
      this.releaseReservation(job);
      this.drain();
    }
  }

  private releaseReservation(job: MediaJob): void {
    if (!job.reserved) return;
    job.reserved = false;
    this.reserved -= this.policy.maxMediaBytes;
  }

  private release(url: string): void {
    const bytes = this.active.get(url);

    if (bytes === undefined) return;
    this.active.delete(url);
    this.bytes -= bytes;
    this.objectUrls.revoke(url);
    this.drain();
  }

  dispose(): void {
    this.disposed = true;

    for (const job of [...this.queue, ...this.running]) this.cancel(job, "Preview closed");

    for (const url of this.active.keys()) this.release(url);
  }
}
