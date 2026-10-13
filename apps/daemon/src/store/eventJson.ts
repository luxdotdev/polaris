import { DomainEvent } from "@polaris/protocol";
import { Schema } from "effect";
import { json } from "./json.ts";

// SAFETY: TaggedUnion.cases contains exactly the union's event discriminators.
const kinds = Object.keys(DomainEvent.cases) as Array<DomainEvent["_tag"]>;

const tag = Schema.decodeUnknownSync(Schema.Struct({ _tag: Schema.Literals(kinds) }));

const anyTag = Schema.decodeUnknownSync(Schema.Struct({ _tag: Schema.String }));

const known: ReadonlySet<string> = new Set(kinds);

const codecs = new Map<DomainEvent["_tag"], ReturnType<typeof json<DomainEvent, unknown>>>();

const codecFor = (kind: DomainEvent["_tag"]) => {
  let codec = codecs.get(kind);

  if (codec === undefined) {
    const schema: Schema.Codec<DomainEvent, unknown> = DomainEvent.cases[kind];
    codec = json(schema);
    codecs.set(kind, codec);
  }

  return codec;
};

/** Validate the discriminator first, then compile only that event's canonical payload codec. */
export const EventJson = {
  encode: (event: DomainEvent): string => codecFor(tag(event)._tag).encode(event),
  decode: (text: string): DomainEvent => {
    const value: unknown = JSON.parse(text);
    const kind = anyTag(value)._tag;

    if (!known.has(kind))
      throw new Error(
        `the event log holds a "${kind}" event, which this Daemon does not know: a newer Daemon wrote it. Run that version or a newer one.`
      );

    // SAFETY: `known` holds exactly the union's event discriminators.
    return codecFor(kind as DomainEvent["_tag"]).decodeUnknown(value);
  },
};
