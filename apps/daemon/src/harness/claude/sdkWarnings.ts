/**
 * The Agent SDK's `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` process warning: `query()` emits it at
 * start when read-only `allowedTools` or full-access shadow `canUseTool`, both intended (see
 * README). The process prints warnings with a stack, so it is held back and returned instead.
 */
import { Option, Schema } from "effect";

export const SHADOWED_WARNING = "CLAUDE_SDK_CAN_USE_TOOL_SHADOWED";

const decodeOptions = Schema.decodeUnknownOption(Schema.Struct({ code: Schema.String }));

const decodeCode = Schema.decodeUnknownOption(Schema.String);

/** `emitWarning(warning, { code })`, or the older `emitWarning(warning, type, code)`. */
const codeOf = (rest: ReadonlyArray<unknown>): string | null =>
  Option.getOrNull(
    Option.orElse(
      Option.map(decodeOptions(rest[0]), (options) => options.code),
      () => decodeCode(rest[1])
    )
  );

// Method syntax: `process.emitWarning`'s overloads fit it, and what they take is forwarded as is.
interface WarningTarget {
  emitWarning(warning: string | Error, ...rest: Array<unknown>): void;
}

export interface QuietStart<A> {
  readonly value: A;
  /** The held-back warning's text; null when the SDK didn't emit it. */
  readonly shadowed: string | null;
}

/** Runs `start` (synchronous, as `query()` is) with that warning held back; others pass through. */
export const withoutShadowedWarning = <A>(
  start: () => A,
  target: WarningTarget = process
): QuietStart<A> => {
  // The property itself is put back afterwards, so `process.emitWarning` keeps its identity.
  const saved = Object.getOwnPropertyDescriptor(target, "emitWarning");
  const forward = target.emitWarning.bind(target);
  let shadowed: string | null = null;
  // Read through a call: TypeScript can't see the assignment inside `emitWarning`.
  const held = () => shadowed;

  target.emitWarning = (warning: string | Error, ...rest: Array<unknown>) => {
    if (codeOf(rest) === SHADOWED_WARNING) {
      shadowed ??= warning instanceof Error ? warning.message : warning;

      return;
    }

    forward(warning, ...rest);
  };

  try {
    const value = start();

    return { value, shadowed: held() };
  } finally {
    if (saved === undefined) Reflect.deleteProperty(target, "emitWarning");
    else Object.defineProperty(target, "emitWarning", saved);
  }
};
