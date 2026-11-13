/** Handlers for `git.blame`, `origins.match` and `origins.forCommit` (capability `origins`). */
import { OriginRpcs } from "@polaris/protocol";
import { Effect } from "effect";
import { Origins } from "./index.ts";

export const OriginRpcsLive = OriginRpcs.toLayer(
  Effect.gen(function* () {
    const origins = yield* Origins;

    return {
      "git.blame": (request) => origins.blame(request),
      "origins.match": ({ repoKey, lines }) => origins.match(repoKey, lines),
      "origins.forCommit": ({ workspaceId, sha }) =>
        Effect.map(origins.forCommit(workspaceId, sha), (sessions) => ({ sessions })),
    };
  })
);
