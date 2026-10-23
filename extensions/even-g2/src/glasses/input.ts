// Portions adapted from even-realities/evenhub-templates@8cb01354 (MIT)
/** Reads the glasses' events as the app's inputs, audio frames and exits. */
import { type EvenHubEvent, OsEventTypeList } from "@evenrealities/even_hub_sdk";
import type { Input } from "../model/app.ts";

export type GlassesEvent =
  | Input
  | { readonly kind: "audio"; readonly pcm: Uint8Array }
  | { readonly kind: "exited" };

/**
 * CLICK_EVENT is 0 and protobuf omits zero values, so a tap arrives with no
 * `eventType`; the default applies only inside an envelope that is present.
 */
const eventTypeOf = (envelope?: { readonly eventType?: OsEventTypeList }) =>
  envelope === undefined ? null : (envelope.eventType ?? OsEventTypeList.CLICK_EVENT);

const fromType = (type: OsEventTypeList | null, index: number): GlassesEvent | null => {
  switch (type) {
    case OsEventTypeList.CLICK_EVENT:
      return { kind: "click", index };
    case OsEventTypeList.DOUBLE_CLICK_EVENT:
      return { kind: "double-click" };
    case OsEventTypeList.LONG_PRESS_EVENT:
      return { kind: "long-press" };
    case OsEventTypeList.LONG_PRESS_RELEASE_EVENT:
      return { kind: "long-press-release" };
    case OsEventTypeList.SYSTEM_EXIT_EVENT:
    case OsEventTypeList.ABNORMAL_EXIT_EVENT:
      return { kind: "exited" };
    default:
      return null;
  }
};

/** A list row's index is omitted for the first row, for the same reason. */
export const readEvent = (event: EvenHubEvent): GlassesEvent | null => {
  const pcm = event.audioEvent?.audioPcm;

  if (pcm !== undefined) return { kind: "audio", pcm };

  if (event.listEvent !== undefined)
    return fromType(eventTypeOf(event.listEvent), event.listEvent.currentSelectItemIndex ?? 0);

  return fromType(eventTypeOf(event.textEvent), 0) ?? fromType(eventTypeOf(event.sysEvent), 0);
};
