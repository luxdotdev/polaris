/**
 * The title Claude Code gives a session. It names a session itself from its first prompt
 * and records the name in the transcript as an `ai-title` entry; a `/rename` records a
 * `custom-title`, which wins. Neither reaches a hook field or an SDK message (Claude Code
 * 2.1.310), so the driver reads the transcript when Claude stops (see this driver's README).
 */
import type { HookCallback, HookCallbackMatcher, HookEvent } from "@anthropic-ai/claude-agent-sdk";
import { Option, Schema } from "effect";
import { HarnessEvent } from "../HarnessDriver.ts";
import { StringOrNull } from "./payloads.ts";

/** Bytes read from each end of the transcript; Claude Code re-appends its titles near the end. */
const WINDOW = 64 * 1024;

const TitleEntry = Schema.Struct({
  type: Schema.Literals(["ai-title", "custom-title"]),
  aiTitle: StringOrNull,
  customTitle: StringOrNull,
});

const decodeEntry = Schema.decodeUnknownOption(Schema.fromJsonString(TitleEntry));

/** The last title of this kind in `text`, a run of JSONL that may start and end mid-line. */
const lastTitle = (text: string, key: "aiTitle" | "customTitle"): string | null => {
  let found: string | null = null;

  for (const line of text.split("\n")) {
    if (!line.includes(`"${key}"`)) continue;
    const title = Option.getOrNull(decodeEntry(line))?.[key]?.trim();

    if (title) found = title;
  }

  return found;
};

/** The session's title from its transcript: the user's own, else Claude Code's; null when neither. */
export const readTranscriptTitle = async (path: string): Promise<string | null> => {
  try {
    const file = Bun.file(path);
    const size = file.size;
    const head = await file.slice(0, Math.min(size, WINDOW)).text();
    const tail = size > WINDOW ? await file.slice(Math.max(WINDOW, size - WINDOW)).text() : "";

    return (
      lastTitle(tail, "customTitle") ??
      lastTitle(head, "customTitle") ??
      lastTitle(tail, "aiTitle") ??
      lastTitle(head, "aiTitle")
    );
  } catch {
    return null;
  }
};

/** Suggests each title once, as it changes. */
export class TitleWatch {
  private last: string | null = null;

  next(title: string | null): ReadonlyArray<HarnessEvent> {
    if (title === null || title === this.last) return [];
    this.last = title;

    return [HarnessEvent.TitleSuggested({ title })];
  }
}

/** Agent SDK hooks that suggest the session's title each time Claude stops. */
export const titleHooks = (
  emit: (event: HarnessEvent) => void
): Partial<Record<HookEvent, HookCallbackMatcher[]>> => {
  const watch = new TitleWatch();

  const onStop: HookCallback = async (input) => {
    if (input.hook_event_name === "Stop")
      for (const event of watch.next(await readTranscriptTitle(input.transcript_path))) emit(event);

    return {};
  };

  return { Stop: [{ hooks: [onStop] }] };
};
