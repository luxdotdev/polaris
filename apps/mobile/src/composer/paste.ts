/**
 * Images pasted into a composer's field (`modules/polaris-paste`): the native module writes each
 * as a PNG or JPEG in the caches directory and reports them, with the field, as JSON.
 */
import { Option, Schema } from "effect";
import type { Picked } from "./attach.ts";

const PastedImage = Schema.Struct({
  uri: Schema.String,
  name: Schema.String,
  mimeType: Schema.Literals(["image/png", "image/jpeg"]),
  size: Schema.Number,
});

const PasteReport = Schema.Struct({
  fieldId: Schema.String,
  images: Schema.Array(PastedImage),
});

const decode = Schema.decodeUnknownOption(Schema.fromJsonString(PasteReport));

/** The images one paste brought to `fieldId`, as picks; none for another field or a bad report. */
export const pastedInto = (fieldId: string, json: string): ReadonlyArray<Picked> =>
  Option.match(decode(json), {
    onNone: () => [],
    onSome: (paste) =>
      paste.fieldId !== fieldId ? [] : paste.images.map((image) => ({ ...image, isImage: true })),
  });
