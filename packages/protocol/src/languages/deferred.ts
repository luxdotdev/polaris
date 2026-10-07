import { Schema } from "effect";

/** Defer tagged-union guard construction until decoding or use of a case constructor. */
interface TaggedUtilities {
  readonly cases: object;
  readonly guards: object;
  readonly isAnyOf: object;
  readonly match: object;
  readonly matchOrElse: object;
}

export function deferredSchema<S extends Schema.Top & TaggedUtilities>(build: () => S) {
  let value: S | undefined;
  const current = () => (value ??= build());
  const suspended = Schema.suspend(current);

  const utilities = {
    get cases(): S["cases"] {
      return current().cases;
    },
    get guards(): S["guards"] {
      return current().guards;
    },
    get isAnyOf(): S["isAnyOf"] {
      return current().isAnyOf;
    },
    get match(): S["match"] {
      return current().match;
    },
    get matchOrElse(): S["matchOrElse"] {
      return current().matchOrElse;
    },
    get check(): S["check"] {
      const schema = current();

      return schema.check.bind(schema);
    },
  };

  // SAFETY: These exact getter descriptors add S's utilities and checked schema method to its codec.
  return Object.defineProperties(
    suspended,
    Object.getOwnPropertyDescriptors(utilities)
  ) as Schema.suspend<S> & typeof utilities;
}
