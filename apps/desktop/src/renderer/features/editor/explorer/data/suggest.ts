/**
 * "Write a message" (Paper 15c): streams `commit.suggestMessage` into the Commit box,
 * replacing the message with one Undo away. Stop, or any failure, puts back what was there.
 */
import { commitMessageText, type CommitMessageStreamItem } from "@polaris/protocol";
import { Match } from "effect";
import type { RoleDefault } from "../../../../../shared/contract.ts";
import { polaris } from "../../../bridge.ts";
import { IDLE, partialMessage } from "../model/suggest.ts";
import type { Place } from "./actions.ts";
import { draftOf, patch } from "./draft.ts";

/** Each Commit box's open stream; closing it cancels the Harness on the Host. */
const open = new Map<string, () => void>();

const close = (key: string) => {
  open.get(key)?.();
  open.delete(key);
};

const writing = (key: string) => draftOf(key).suggestion.kind === "writing";

const onItem = (key: string, raw: { text: string }, item: CommitMessageStreamItem) =>
  Match.value(item).pipe(
    Match.tagsExhaustive({
      Delta: ({ text }) => {
        raw.text += text;
        const shown = partialMessage(raw.text);

        if (shown !== null) patch(key, () => ({ message: shown }));
      },
      Suggested: ({ message }) => {
        const before = draftOf(key).suggestion;

        open.delete(key);
        patch(key, () => ({
          message: commitMessageText(message),
          committed: null,
          suggestion: { kind: "replaced", before: before.kind === "writing" ? before.before : "" },
        }));
      },
    })
  );

/** Starts writing for `place`'s staged changes with the Settings → Editor choice. */
export const suggest = (place: Place, cwd: string, choice: RoleDefault) => {
  const key = place.key;

  if (writing(key)) return;
  const before = draftOf(key);
  const raw = { text: "" };

  patch(key, () => ({
    suggestion: {
      kind: "writing",
      startedAt: Date.now(),
      before: before.suggestion.kind === "replaced" ? before.suggestion.before : before.message,
      model: choice.model ?? "",
    },
  }));

  const stop = polaris().subscribe(
    "commit.suggestMessage",
    {
      hostKey: place.hostKey,
      cwd,
      harness: choice.harness === "codex" ? "codex" : "claude",
      model: choice.model,
      effort: choice.effort,
    },
    {
      items: (items) => {
        for (const item of items) if (writing(key)) onItem(key, raw, item);
      },
      end: (error) => {
        open.delete(key);
        const current = draftOf(key).suggestion;

        if (current.kind !== "writing") return;
        patch(key, () => ({
          message: current.before,
          suggestion:
            error === null
              ? { kind: "failed", reason: "harness-failed", message: "" }
              : { kind: "failed", reason: error.code, message: error.message },
        }));
      },
    }
  );

  open.set(key, stop);
};

/** Stop (or Esc): cancels the Harness and puts the message back as it was. */
export const stopSuggesting = (key: string) => {
  const current = draftOf(key).suggestion;

  close(key);

  if (current.kind === "writing") patch(key, () => ({ message: current.before, suggestion: IDLE }));
};

/** Undo: the message from before it was replaced. */
export const undoSuggestion = (key: string) => {
  const current = draftOf(key).suggestion;

  if (current.kind === "replaced")
    patch(key, () => ({ message: current.before, suggestion: IDLE }));
};

export const dismissFailure = (key: string) => {
  if (draftOf(key).suggestion.kind === "failed") patch(key, () => ({ suggestion: IDLE }));
};
