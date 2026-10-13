/** Test help: an event with the driver's start stamp cleared, to compare items by content. */
import { TurnItem } from "@polaris/protocol";
import { HarnessEvent } from "./HarnessDriver.ts";

const clear = (item: TurnItem): TurnItem =>
  TurnItem.guards.Reasoning(item) ? item : { ...item, startedAt: null };

export const unstamped = (event: HarnessEvent): HarnessEvent =>
  HarnessEvent.$is("ItemUpdated")(event)
    ? HarnessEvent.ItemUpdated({ ...event, item: clear(event.item) })
    : HarnessEvent.$is("ItemCompleted")(event)
      ? HarnessEvent.ItemCompleted({ ...event, item: clear(event.item) })
      : event;
