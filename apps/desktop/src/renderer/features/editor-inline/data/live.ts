/** The real proposer: `inline.propose` on the file's Host, through the main process's feed. */
import { Match } from "effect";
import { polaris } from "../../bridge.ts";
import type { Proposer } from "./proposer.ts";

export const liveProposer: Proposer = (hostKey, request, handlers) => {
  let proposed = false;

  return polaris().subscribe(
    "inline.propose",
    { hostKey, ...request },
    {
      items: (items) => {
        for (const item of items) {
          Match.value(item).pipe(
            Match.tagsExhaustive({
              Delta: ({ text }) => handlers.onDelta(text),
              Proposed: ({ patch, thoughtMs }) => {
                proposed = true;
                handlers.onProposed(patch, thoughtMs);
              },
            })
          );
        }
      },
      end: (error) => {
        if (error !== null) handlers.onFailed(error.message);
        else if (!proposed) handlers.onFailed("The harness stopped without a proposal");
      },
    }
  );
};
