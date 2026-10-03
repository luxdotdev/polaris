import type { LanguageFormatterSelection, LanguageSaveReason } from "@polaris/protocol";
import { Predicate } from "effect";
import type { EditorFile } from "../cm/extensions.ts";
import type { FileVersion } from "../model/buffer.ts";

export type SaveReason = typeof LanguageSaveReason.Type;

export interface FormatSettings {
  readonly formatOnSave: boolean;
  readonly formatter: LanguageFormatterSelection;
}

export interface FormatSnapshot {
  readonly file: EditorFile;
  readonly text: string;
  readonly version: number;
  readonly diskVersion: FileVersion | null;
  readonly reason: SaveReason;
}

/** Bind ordered document sync, selected formatter and repository configuration here. */
export interface FormattingPort {
  readonly settings: (file: EditorFile, signal: AbortSignal) => Promise<FormatSettings>;
  readonly format: (
    snapshot: FormatSnapshot,
    formatter: LanguageFormatterSelection,
    signal: AbortSignal
  ) => Promise<string>;
  readonly failure: (file: EditorFile, message: string) => void;
  readonly timeoutMs?: number;
}

export interface SavePort {
  readonly snapshot: (reason: SaveReason) => FormatSnapshot | null;
  readonly current: (snapshot: FormatSnapshot) => boolean;
  readonly apply: (text: string) => void;
  readonly write: () => Promise<boolean>;
}

const messageOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

/** One bounded preflight and disk write per buffer; concurrent save paths share the result. */
export class SaveCoordinator {
  private pending: Promise<boolean> | null = null;
  private controller: AbortController | null = null;
  private lastNotice: string | null = null;

  constructor(
    private readonly port: SavePort,
    private readonly formatting?: FormattingPort
  ) {}

  invalidate() {
    this.controller?.abort();
  }

  save(reason: SaveReason): Promise<boolean> {
    if (this.pending !== null) return this.pending;

    const next = this.run(reason).finally(() => {
      if (this.pending === next) this.pending = null;
    });

    this.pending = next;

    return next;
  }

  private async preflight(snapshot: FormatSnapshot) {
    const formatting = this.formatting;

    if (formatting === undefined) return;

    const controller = new AbortController();

    this.controller = controller;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const interrupted = new Promise<never>((_resolve, reject) => {
      controller.signal.addEventListener(
        "abort",
        () => reject(new Error("Formatting cancelled.")),
        { once: true }
      );
      timer = setTimeout(
        () => reject(new Error("Formatting timed out.")),
        formatting.timeoutMs ?? 3000
      );
    });

    try {
      const operation = async () => {
        const settings = await formatting.settings(snapshot.file, controller.signal);

        if (controller.signal.aborted) throw new Error("Formatting cancelled.");

        if (!settings.formatOnSave || Predicate.isTagged(settings.formatter, "None")) return null;

        return formatting.format(snapshot, settings.formatter, controller.signal);
      };

      const text = await Promise.race([operation(), interrupted]);

      if (this.port.current(snapshot)) {
        if (text !== null && text !== snapshot.text) this.port.apply(text);

        this.lastNotice = null;
      }
    } catch (cause) {
      if (controller.signal.aborted || !this.port.current(snapshot)) return;

      const message = messageOf(cause);

      if (snapshot.reason !== "autosave" || message !== this.lastNotice)
        formatting.failure(snapshot.file, message);

      this.lastNotice = message;
    } finally {
      clearTimeout(timer);
      this.controller = null;
      controller.abort();
    }
  }

  private async run(reason: SaveReason): Promise<boolean> {
    const snapshot = this.port.snapshot(reason);

    if (snapshot === null) return this.port.write();
    await this.preflight(snapshot);

    return this.port.write();
  }
}
