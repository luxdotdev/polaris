import {
  LanguageDocumentNotification,
  LanguageSyncAck,
  languageFenceSatisfied,
} from "@polaris/protocol";
import type {
  LanguageContextIdentity,
  LanguageRequestFence,
  LanguagePosition,
  LanguagePositionEncoding,
} from "@polaris/protocol";
import { Match, Schema } from "effect";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { within } from "../trust/index.ts";
import { failure } from "../transport/framing.ts";

type Document = { uri: string; languageId: string; version: number; text: string };

export class Documents {
  readonly open = new Map<string, Document>();
  sequence = 0;
  private bytes = 0;
  constructor(
    readonly context: LanguageContextIdentity,
    private readonly reserve: (delta: number) => void = () => {}
  ) {}

  ack(): LanguageSyncAck {
    return LanguageSyncAck.make({
      context: this.context,
      acceptedSequence: this.sequence,
      documents: [...this.open.values()].map(({ uri, version }) => ({ uri, version })),
    });
  }

  fence(fence: LanguageRequestFence) {
    if (!languageFenceSatisfied(fence, this.ack()))
      throw failure("stale-document", "Document fence is obsolete");
  }

  apply(
    sequence: number,
    input: LanguageDocumentNotification,
    encoding: typeof LanguagePositionEncoding.Type
  ) {
    const notification = Schema.decodeUnknownSync(LanguageDocumentNotification)(input);

    if (sequence !== this.sequence + 1)
      throw failure("stale-document", "Expected next document sequence");
    this.validateUri(notification.uri);
    const current = this.open.get(notification.uri);
    const previous = current?.text ?? "";

    const next = Match.value(notification).pipe(
      Match.tag("Open", (value) => {
        if (current !== undefined) throw failure("conflict", "Document already open");

        if (this.open.size >= 1024) throw failure("queue-full", "Document limit reached");

        return {
          uri: value.uri,
          languageId: value.languageId,
          version: value.version,
          text: value.text,
        };
      }),
      Match.tag("Change", (value) => {
        if (current === undefined || current.version !== value.previousVersion)
          throw failure("stale-document", "Change does not follow current document");
        let text = current.text;

        for (const change of value.changes) {
          if (change.range === undefined) {
            text = change.text;
            continue;
          }

          const start = positionOffset(text, change.range.start, encoding);
          const end = positionOffset(text, change.range.end, encoding);

          if (
            change.rangeLength !== undefined &&
            units(text.slice(start, end), encoding) !== change.rangeLength
          )
            throw failure("invalid-input", "Range length does not match document");
          text = text.slice(0, start) + change.text + text.slice(end);
        }

        return { ...current, version: value.version, text };
      }),
      Match.tag("Save", "Close", (value) => {
        if (current === undefined || current.version !== value.version)
          throw failure("stale-document", "Document version changed");

        return Match.value(value).pipe(
          Match.tag("Close", () => undefined),
          Match.orElse(() => current)
        );
      }),
      Match.exhaustive
    );

    const bytes = Buffer.byteLength(next?.text ?? "");

    if (bytes > 1048576 || this.bytes - Buffer.byteLength(previous) + bytes > 8388608)
      throw failure("too-large", "Document text budget exceeded");
    this.reserve(bytes - Buffer.byteLength(previous));
    this.bytes += bytes - Buffer.byteLength(previous);

    if (next === undefined) this.open.delete(notification.uri);
    else this.open.set(notification.uri, next);
    this.sequence = sequence;

    return next;
  }

  clear() {
    this.reserve(-this.bytes);
    this.bytes = 0;
    this.sequence = 0;
    this.open.clear();
  }

  validateUri(uri: string) {
    try {
      const url = new URL(uri);

      if (url.protocol !== "file:" || url.host !== "" || url.search !== "" || url.hash !== "")
        throw failure("invalid-input", "Expected checkout file URI");

      if (!within(this.context.checkout.path, resolve(fileURLToPath(url))))
        throw failure("invalid-input", "Document leaves checkout");
    } catch {
      throw failure("invalid-input", "Invalid checkout document URI");
    }
  }
}

const units = (text: string, encoding: typeof LanguagePositionEncoding.Type) =>
  Match.value(encoding).pipe(
    Match.when("utf-8", () => Buffer.byteLength(text)),
    Match.when("utf-16", () => text.length),
    Match.when("utf-32", () => Array.from(text).length),
    Match.exhaustive
  );

export function positionOffset(
  text: string,
  position: typeof LanguagePosition.Type,
  encoding: typeof LanguagePositionEncoding.Type
): number {
  let start = 0;

  for (let line = 0; line < position.line; line++) {
    const end = text.indexOf("\n", start);

    if (end < 0) throw failure("invalid-input", "Position line exceeds document");
    start = end + 1;
  }

  let count = 0;
  let offset = start;

  for (const character of text.slice(start)) {
    if (count === position.character) return offset;

    if (character === "\n" || character === "\r") break;
    count += units(character, encoding);
    offset += character.length;

    if (count > position.character)
      throw failure("invalid-input", "Position splits encoded character");
  }

  if (count === position.character) return offset;
  throw failure("invalid-input", "Position character exceeds line");
}
