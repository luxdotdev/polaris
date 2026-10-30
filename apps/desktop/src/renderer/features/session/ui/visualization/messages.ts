/**
 * What a Visualization frame may ask of the app (ADR 0089): its height, a link to open after
 * the user confirms, and its `pv.state`. Anything else, or anything from another window, is dropped.
 */
import { FRAME_HEIGHT_MAX, FRAME_HEIGHT_MIN, FrameMessage } from "@polaris/visualization";
import { Match, Option, Schema } from "effect";

export type FrameRequest =
  | { readonly kind: "height"; readonly height: number }
  | { readonly kind: "open-link"; readonly url: string }
  /** The state envelope as JSON text, stored as it is. */
  | { readonly kind: "state"; readonly json: string };

const decode = Schema.decodeUnknownOption(FrameMessage);

export const clampHeight = (height: number) =>
  Math.min(FRAME_HEIGHT_MAX, Math.max(FRAME_HEIGHT_MIN, Math.ceil(height)));

/** The link as the browser will open it; null unless it is https. */
export const httpsLink = (url: string): string | null => {
  if (!URL.canParse(url)) return null;
  const parsed = new URL(url);

  return parsed.protocol === "https:" ? parsed.href : null;
};

const stateJson = (message: Extract<FrameMessage, { readonly type: "pv:state" }>) => {
  try {
    return JSON.stringify(message.state) ?? null;
  } catch {
    return null;
  }
};

const request = (message: FrameMessage): FrameRequest | null =>
  Match.value(message).pipe(
    Match.discriminatorsExhaustive("type")({
      "pv:height": ({ height }): FrameRequest | null =>
        Number.isFinite(height) ? { kind: "height", height: clampHeight(height) } : null,
      "pv:open-link": ({ url }): FrameRequest | null => {
        const link = httpsLink(url);

        return link === null ? null : { kind: "open-link", url: link };
      },
      "pv:state": (message): FrameRequest | null => {
        const json = stateJson(message);

        return json === null ? null : { kind: "state", json };
      },
    })
  );

/** A message event's request, only when it came from `frame`, the frame's own window. */
export const frameRequest = (
  event: Pick<MessageEvent<unknown>, "source" | "data">,
  frame: Window | null
): FrameRequest | null => {
  if (frame === null || event.source !== frame) return null;

  return Option.getOrNull(Option.flatMapNullishOr(decode(event.data), request));
};
