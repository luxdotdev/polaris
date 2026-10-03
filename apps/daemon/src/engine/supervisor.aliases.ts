import type { SubagentId, TurnId } from "@polaris/protocol";
import { HarnessEvent } from "../harness/HarnessDriver.ts";

const startsSubagent = HarnessEvent.$is("SubagentStarted");

const endsTurn = HarnessEvent.$is("TurnEnded");

const endsSubagent = HarnessEvent.$is("SubagentEnded");

export class HarnessTurnAliases<Source extends object> {
  private readonly turns = new WeakMap<Source, Map<TurnId, TurnId>>();
  private readonly children = new WeakMap<
    Source,
    Map<SubagentId, { native: TurnId; target: TurnId }>
  >();

  set(source: Source, native: TurnId, target: TurnId): void {
    const aliases = this.turns.get(source) ?? new Map<TurnId, TurnId>();
    aliases.set(native, target);
    this.turns.set(source, aliases);
  }

  resolve(source: Source, event: HarnessEvent): HarnessEvent {
    if (!("turnId" in event)) return event;

    const children =
      "subagentId" in event && event.subagentId !== undefined
        ? this.children.get(source)
        : undefined;

    let target = this.turns.get(source)?.get(event.turnId);

    if (target === undefined && "subagentId" in event && event.subagentId !== undefined)
      target = children?.get(event.subagentId)?.target;

    if (target === undefined && startsSubagent(event)) {
      for (const child of children?.values() ?? [])
        if (child.native === event.turnId) {
          target = child.target;
          break;
        }
    }

    if (target === undefined) return event;

    if (startsSubagent(event)) {
      const live = children ?? new Map<SubagentId, { native: TurnId; target: TurnId }>();
      live.set(event.subagentId, { native: event.turnId, target });
      this.children.set(source, live);
    }

    return { ...event, turnId: target };
  }

  ended(source: Source, event: HarnessEvent): void {
    if (endsTurn(event)) {
      const aliases = this.turns.get(source);

      for (const [native, target] of aliases ?? [])
        if (target === event.turnId) aliases?.delete(native);

      if (aliases?.size === 0) this.turns.delete(source);
    }

    if (endsSubagent(event)) {
      const children = this.children.get(source);
      children?.delete(event.subagentId);

      if (children?.size === 0) this.children.delete(source);
    }
  }
}
