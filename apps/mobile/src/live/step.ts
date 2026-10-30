/** A tool step's one line, as the Daemon's Live Activity slice words it (apps/daemon/src/push/slice.ts). */
import type { TurnItem } from "@polaris/protocol";
import { Match } from "effect";

/** Null for items that aren't tool steps. */
export const stepLine = (item: TurnItem): string | null =>
  Match.value(item).pipe(
    Match.tags({
      CommandExecution: ({ command }) => command,
      FileChange: ({ changes }) =>
        changes.length === 1 ? `Edit ${changes[0]?.path ?? ""}` : `Edit ${changes.length} files`,
      ToolCall: ({ title, name }) => title ?? name,
    }),
    Match.orElse(() => null)
  );
