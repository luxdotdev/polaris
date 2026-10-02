import { Schema } from "effect";

/** Canonical JSON codecs compile only when their persisted value is first used. */
export const json = <A, I>(schema: Schema.Codec<A, I>) => {
  const compile = () => {
    const codec = Schema.toCodecJson(schema);

    return { encode: Schema.encodeSync(codec), decode: Schema.decodeUnknownSync(codec) };
  };

  let compiled: ReturnType<typeof compile> | undefined;
  const get = () => (compiled ??= compile());

  return {
    encode: (value: A): string => JSON.stringify(get().encode(value)),
    decode: (text: string): A => get().decode(JSON.parse(text)),
    get decodeUnknown() {
      return get().decode;
    },
  };
};
