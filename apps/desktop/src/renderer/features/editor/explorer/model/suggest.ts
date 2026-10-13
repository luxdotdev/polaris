/**
 * The Commit box's one-click message (Paper 15c, 15d) as data: its states, the
 * message read out of the Harness's streamed JSON, and the copy for each refusal.
 */

/** What the "Write a message" button is doing for one Commit box. */
export type Suggestion =
  | { readonly kind: "idle" }
  | {
      readonly kind: "writing";
      readonly startedAt: number;
      /** The message before writing began; Stop and failures put it back. */
      readonly before: string;
      readonly model: string;
    }
  /** Until the user types: Undo puts `before` back. */
  | { readonly kind: "replaced"; readonly before: string }
  | { readonly kind: "failed"; readonly reason: string; readonly message: string };

export const IDLE: Suggestion = { kind: "idle" };

/** Whether the button may start, and the hover reason when it may not. */
export const suggestBlock = (
  staged: number,
  committing: boolean,
  suggestion: Suggestion
): string | null => {
  if (staged === 0) return "Stage changes to write a message";

  if (committing) return "Committing…";

  if (suggestion.kind === "writing") return "Writing a message…";

  return null;
};

const ESCAPES = new Map([
  ["n", "\n"],
  ["t", "\t"],
  ['"', '"'],
  ["\\", "\\"],
  ["/", "/"],
]);

/** One JSON string's characters from `start`, stopping at its closing quote or the end. */
const readString = (raw: string, start: number): string => {
  let out = "";

  for (let i = start; i < raw.length; i++) {
    const c = raw.charAt(i);

    if (c === '"') return out;

    if (c !== "\\") {
      out += c;
      continue;
    }

    const next = raw.charAt(i + 1);

    if (next === "u") {
      const hex = raw.slice(i + 2, i + 6);

      if (!/^[0-9a-fA-F]{4}$/.test(hex)) return out;
      out += String.fromCharCode(Number.parseInt(hex, 16));
      i += 5;
    } else {
      out += ESCAPES.get(next) ?? "";
      i += 1;
    }
  }

  return out;
};

const field = (raw: string, key: string): string | null => {
  const match = new RegExp(`"${key}"\\s*:\\s*"`).exec(raw);

  return match === null ? null : readString(raw, match.index + match[0].length);
};

/** The message so far from the Harness's partial `{subject, body}` JSON; null before the subject. */
export const partialMessage = (raw: string): string | null => {
  const subject = field(raw, "subject");

  if (subject === null) return null;
  const body = field(raw, "body")?.trim() ?? "";

  return body === "" ? subject : `${subject}\n\n${body}`;
};

const FRIENDLY = new Map([
  ["claude-haiku-5-5", "Haiku 5.5"],
  ["gpt-6-luna", "GPT 6 Luna"],
]);

/** A Model's name before its Harness has listed it. */
export const fallbackModelName = (id: string) => FRIENDLY.get(id) ?? id;

/** The one line a refusal shows under the field: which Harness, which Host, what's wrong. */
export const failureLine = (
  failure: { readonly reason: string; readonly message: string },
  harness: string,
  host: string
): string => {
  switch (failure.reason) {
    case "needs-sign-in":
      return `${harness} isn't signed in on ${host}.`;
    case "harness-missing":
      return `${harness} isn't set up on ${host}.`;
    case "nothing-staged":
      return "Nothing is staged any more.";
    case "not-a-repository":
      return "This folder isn't in a git repository.";
    case "timed-out":
      return `${harness} took too long. Try again, or a faster model.`;
    case "invalid-message":
      return `${harness} didn't return a usable message. Try again.`;
    default:
      return failure.message === "" ? `${harness} couldn't write a message.` : failure.message;
  }
};
