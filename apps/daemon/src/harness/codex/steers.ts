/**
 * Steers on Codex, as Turn items. A steer lands twice: `turn/steer` answers
 * once Codex took the input, and Codex may also report it as a `userMessage`
 * item of the Turn (as it does for a steer typed in a co-attached TUI). The
 * first of the two records it as a `UserMessage`; the other is dropped. A
 * Turn's first user message is its prompt, not a steer.
 */
import { TurnItem } from "@polaris/protocol";

type Source = "item" | "response";

interface Awaiting {
  readonly source: Source;
  readonly text: string;
}

export class CodexSteers {
  /** Per Codex turn: the ids of its user message items seen so far. */
  private readonly messages = new Map<string, Set<string>>();
  /** Per Codex turn: steer texts recorded by one source, awaiting the other. */
  private readonly awaiting = new Map<string, Array<Awaiting>>();
  private count = 0;

  /**
   * A `userMessage` item of a turn: its steer item when it is not the prompt and
   * wasn't recorded yet; null otherwise. Started and completed both call it.
   */
  fromItem(codexTurnId: string, itemId: string, text: string | null): TurnItem | null {
    const seen = this.messages.get(codexTurnId) ?? new Set<string>();
    const first = seen.size === 0;

    this.messages.set(codexTurnId, seen);

    if (seen.has(itemId)) return null;
    seen.add(itemId);

    if (first || text === null) return null;

    return this.record(codexTurnId, "item", itemId, text);
  }

  /** `turn/steer` answered: its item, unless the Turn already reported it. */
  fromResponse(codexTurnId: string, text: string): TurnItem | null {
    this.count += 1;

    return this.record(codexTurnId, "response", `steer:${codexTurnId}:${this.count}`, text);
  }

  /** The Turn ended: forget it. */
  end(codexTurnId: string) {
    this.messages.delete(codexTurnId);
    this.awaiting.delete(codexTurnId);
  }

  private record(codexTurnId: string, source: Source, id: string, text: string) {
    const waiting = this.awaiting.get(codexTurnId) ?? [];
    const match = waiting.findIndex((w) => w.source !== source && w.text === text);

    if (match !== -1) {
      waiting.splice(match, 1);

      return null;
    }

    this.awaiting.set(codexTurnId, [...waiting, { source, text }]);

    return TurnItem.cases.UserMessage.make({ id, text });
  }
}
