/**
 * Steers on Codex, as Turn items. Codex answers `turn/steer` and reports the steer as
 * a `userMessage` item as soon as it queues it; the first of the two queues it, the
 * other is dropped. The model reads it only when it next samples, which a running
 * command can hold off, so it lands when the Turn's next item starts or the Turn ends.
 * A Turn's first user message is its prompt, not a steer.
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
  /** Per Codex turn: steers Codex took that the model hasn't read yet. */
  private readonly queued = new Map<string, Array<TurnItem>>();
  private count = 0;

  /** A `userMessage` item of a turn: queued as a steer unless it is the prompt or seen. */
  fromItem(codexTurnId: string, itemId: string, text: string | null) {
    const seen = this.messages.get(codexTurnId) ?? new Set<string>();
    const first = seen.size === 0;

    this.messages.set(codexTurnId, seen);

    if (seen.has(itemId)) return;
    seen.add(itemId);

    if (first || text === null) return;
    this.record(codexTurnId, "item", itemId, text);
  }

  /** `turn/steer` answered: queued, unless the Turn already reported it. */
  fromResponse(codexTurnId: string, text: string) {
    this.count += 1;
    this.record(codexTurnId, "response", `steer:${codexTurnId}:${this.count}`, text);
  }

  /** Another item of the Turn started: the model has read every steer queued before it. */
  take(codexTurnId: string): ReadonlyArray<TurnItem> {
    const queued = this.queued.get(codexTurnId) ?? [];
    this.queued.delete(codexTurnId);

    return queued;
  }

  /** The Turn ended: the steers still queued (it read them last), and the Turn forgotten. */
  end(codexTurnId: string): ReadonlyArray<TurnItem> {
    const queued = this.take(codexTurnId);
    this.messages.delete(codexTurnId);
    this.awaiting.delete(codexTurnId);

    return queued;
  }

  private record(codexTurnId: string, source: Source, id: string, text: string) {
    const waiting = this.awaiting.get(codexTurnId) ?? [];
    const match = waiting.findIndex((w) => w.source !== source && w.text === text);

    if (match !== -1) {
      waiting.splice(match, 1);

      return;
    }

    this.awaiting.set(codexTurnId, [...waiting, { source, text }]);
    const queued = this.queued.get(codexTurnId) ?? [];
    this.queued.set(codexTurnId, [...queued, TurnItem.cases.UserMessage.make({ id, text })]);
  }
}
