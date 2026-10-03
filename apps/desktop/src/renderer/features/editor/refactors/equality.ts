import type { LanguageContextIdentity } from "@polaris/protocol";
import { Predicate, Schema } from "effect";

/** JSON field order is immaterial to ownership comparisons; array order remains authoritative. */
export const equal = <A, B>(left: A, right: B) => {
  const ordered = <T>(input: T): string => {
    const value = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json))(
      JSON.stringify(input)
    );

    const keys = new Set<string>();

    const visit = (item: typeof Schema.Json.Type): void => {
      if (Array.isArray(item)) {
        item.forEach(visit);

        return;
      }

      if (!Predicate.isObject(item)) return;

      for (const [key, child] of Object.entries(item)) {
        keys.add(key);
        visit(Schema.decodeUnknownSync(Schema.Json)(child));
      }
    };

    visit(value);

    return JSON.stringify(value, [...keys].sort());
  };

  return ordered(left) === ordered(right);
};

/** Historical operation recovery stays bound to independently authenticated Host, Client and checkout. */
export const sameRefactorOwner = (left: LanguageContextIdentity, right: LanguageContextIdentity) =>
  left.hostId === right.hostId &&
  left.clientId === right.clientId &&
  equal(left.checkout, right.checkout);
