/**
 * How a card asks for a proposal: `inline.propose` on the file's Host, streamed. The preview
 * and tests put a scripted proposer in its place. Returns a function that cancels the request.
 */
import type { InlineRequest } from "../model/card.ts";
import type { InlinePatch } from "../model/patch.ts";
import { liveProposer } from "./live.ts";

export interface ProposerHandlers {
  readonly onDelta: (text: string) => void;
  readonly onProposed: (patch: InlinePatch, thoughtMs: number) => void;
  readonly onFailed: (message: string) => void;
}

export type Proposer = (
  hostKey: string,
  request: InlineRequest,
  handlers: ProposerHandlers
) => () => void;

let current: Proposer = liveProposer;

export const proposer = (): Proposer => current;

export const setProposer = (next: Proposer) => {
  current = next;
};

/** A proposer that thinks for `delayMs`, then answers with `patch(request)`. */
export const scriptedProposer =
  (patch: (request: InlineRequest) => InlinePatch, delayMs = 600): Proposer =>
  (_hostKey, request, handlers) => {
    const started = Date.now();
    const delta = setTimeout(() => handlers.onDelta("Reading the selection"), delayMs / 3);

    const done = setTimeout(
      () => handlers.onProposed(patch(request), Date.now() - started),
      delayMs
    );

    return () => {
      clearTimeout(delta);
      clearTimeout(done);
    };
  };
