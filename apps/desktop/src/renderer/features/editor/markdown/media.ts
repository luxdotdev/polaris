import { Schema } from "effect";
import type { LanguageApi } from "../../../../shared/api.ts";
import { LanguagePreviewMediaView } from "../../../../shared/languages.ts";
import type { LanguagePreviewPolicy } from "@polaris/protocol";
import { previewTarget, type PreviewDocument } from "./targets.ts";

export interface MediaLease {
  readonly url: string;
  readonly release: () => void;
}

export interface ObjectUrls {
  readonly create: (blob: Blob) => string;
  readonly revoke: (url: string) => void;
}

const urls: ObjectUrls = {
  create: (blob) => URL.createObjectURL(blob),
  revoke: (url) => URL.revokeObjectURL(url),
};

/** One bounded pool per preview, disposed when its Host, checkout or policy changes. */
export class PreviewMediaPool {
  private readonly active = new Map<string, number>();
  private pending = 0;
  private reserved = 0;
  private bytes = 0;
  private disposed = false;

  constructor(
    private readonly api: LanguageApi,
    private readonly document: PreviewDocument,
    private readonly policy: LanguagePreviewPolicy,
    private readonly objectUrls: ObjectUrls = urls,
    private readonly limit = 32 * 1024 * 1024,
    private readonly slots = 16
  ) {}

  async acquire(source: string): Promise<MediaLease> {
    if (this.disposed || this.pending + this.active.size >= this.slots)
      throw new Error("Preview image limit reached");
    const target = previewTarget(source, this.document);

    if (target.kind !== "file" && target.kind !== "external")
      throw new Error("Image path unavailable");

    if (target.kind === "external" && this.policy.externalImages !== "allow")
      throw new Error("External images are blocked");
    const reservation = this.policy.maxMediaBytes;

    if (this.bytes + this.reserved + reservation > this.limit)
      throw new Error("Preview image limit reached");
    this.pending++;
    this.reserved += reservation;

    try {
      const base = { hostKey: this.document.hostKey, maxBytes: this.policy.maxMediaBytes };

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

      if (!result.ok) throw new Error(result.error.message);
      const media = Schema.decodeUnknownSync(LanguagePreviewMediaView)(result.value);

      if (this.disposed) throw new Error("Preview closed");

      if (media.bytes > this.policy.maxMediaBytes || this.bytes + media.bytes > this.limit)
        throw new Error("Preview image limit reached");
      const raw = atob(media.base64);
      const data = Uint8Array.from(raw, (character) => character.charCodeAt(0));
      const url = this.objectUrls.create(new Blob([data], { type: media.mimeType }));
      this.active.set(url, media.bytes);
      this.bytes += media.bytes;

      return { url, release: () => this.release(url) };
    } finally {
      this.pending--;
      this.reserved -= reservation;
    }
  }

  private release(url: string): void {
    const bytes = this.active.get(url);

    if (bytes === undefined) return;
    this.active.delete(url);
    this.bytes -= bytes;
    this.objectUrls.revoke(url);
  }

  dispose(): void {
    this.disposed = true;

    for (const url of this.active.keys()) this.release(url);
  }
}
