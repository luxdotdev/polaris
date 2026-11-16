/** A session row's title, with the people glyph once the session has a live Share (Paper SS1). */
import { UsersIcon } from "@polaris/ui";
import type { ReactNode } from "react";
import { useIsShared } from "../data/feeds.ts";

export const SharedTitle = ({
  hostKey,
  sessionId,
  children,
}: {
  readonly hostKey: string;
  readonly sessionId: string;
  readonly children: ReactNode;
}) => {
  const shared = useIsShared(hostKey, sessionId);

  if (!shared) return children;

  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="min-w-0 truncate">{children}</span>
      <UsersIcon size={13} className="text-text-subtle shrink-0" data-testid="shared-glyph" />
      <span className="sr-only">, shared</span>
    </span>
  );
};
