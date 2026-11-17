/**
 * A person's avatar (DESIGN.md, Shared Sessions "Avatars and presence"): their GitHub image as
 * the main process fetched it, else their initials; `full` radius and no per-person colour.
 */
import { cn } from "@polaris/ui";
import type { SharingPersonView } from "../../../../shared/sharingContract.ts";
import { initialsOf } from "../model/copy.ts";

export const PersonAvatar = ({
  person,
  size = 20,
  className,
}: {
  readonly person: SharingPersonView;
  /** 16 in owner group headers, 20 in rows, 24 in the presence row. */
  readonly size?: 16 | 20 | 24 | 26;
  readonly className?: string;
}) =>
  person.avatar === null ? (
    <span
      aria-hidden="true"
      style={{ width: size, height: size }}
      className={cn(
        "bg-surface-raised border-hairline text-text-default flex shrink-0 items-center justify-center rounded-full border font-medium",
        size <= 16 ? "text-[8px]" : "text-micro",
        className
      )}
    >
      {initialsOf(person)}
    </span>
  ) : (
    <img
      alt=""
      src={person.avatar}
      style={{ width: size, height: size }}
      className={cn("shrink-0 rounded-full", className)}
    />
  );
