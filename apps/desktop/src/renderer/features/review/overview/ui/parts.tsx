/**
 * Overview's shared pieces: the raised card with its head row, the author mark (an
 * initial; a square one for a bot), the Polaris mark, and the "⋯" trigger.
 */
import { cn, PixelPolarisIcon, Tile, type TileSize } from "@polaris/ui";
import type { ComponentProps, ReactNode } from "react";
import type { PersonView } from "../model/types.ts";

export const Card = ({ className, ...props }: ComponentProps<"section">) => (
  <section
    className={cn("rounded-row bg-surface-raised border-hairline flex flex-col border", className)}
    {...props}
  />
);

/** A card's head: mark, name and caption on one line, trailing actions. */
export const CardHead = ({
  children,
  ruled = false,
}: {
  readonly children: ReactNode;
  readonly ruled?: boolean;
}) => (
  <div
    className={cn(
      "gap-gap pr-row-x flex min-h-11 items-center pl-3.5",
      ruled ? "border-hairline py-row-x border-b" : "pt-row-x pb-1.5"
    )}
  >
    {children}
  </div>
);

export const Mark = ({ person }: { readonly person: PersonView | null }) => {
  const login = person?.login ?? "?";

  return (
    <span
      aria-hidden="true"
      className={cn(
        "bg-fill-selected flex size-5 shrink-0 items-center justify-center font-medium uppercase",
        person?.bot === true
          ? "text-text-default rounded-[5px] font-mono text-[11px]"
          : "text-text-subtle text-micro rounded-full"
      )}
    >
      {login.slice(0, 1)}
    </span>
  );
};

export const BotTag = () => (
  <span className="border-hairline text-text-subtle rounded-[4px] border px-[5px] text-[11px] leading-4">
    bot
  </span>
);

export const PolarisMark = ({ size = 24 }: { readonly size?: TileSize }) => (
  <Tile hue="starlight" size={size}>
    <PixelPolarisIcon size={size <= 24 ? 14 : 16} />
  </Tile>
);

export const MoreButton = ({ className, ...props }: ComponentProps<"button">) => (
  <button
    type="button"
    className={cn(
      "rounded-control text-text-subtle hover:bg-fill-hover text-heading-sm flex size-6 shrink-0 cursor-default items-center justify-center",
      className
    )}
    {...props}
  >
    ⋯
  </button>
);

/** A quiet text action in a card's foot or head. */
export const TextAction = ({
  className,
  strong = false,
  ...props
}: ComponentProps<"button"> & { readonly strong?: boolean }) => (
  <button
    type="button"
    className={cn(
      "text-caption hover:text-text-strong cursor-default",
      strong ? "text-text-default font-medium" : "text-text-subtle",
      className
    )}
    {...props}
  />
);

export const ExternalLink = ({
  href,
  children,
}: {
  readonly href: string;
  readonly children: ReactNode;
}) => (
  <a
    href={href}
    target="_blank"
    rel="noreferrer"
    className="text-caption text-text-subtle hover:text-text-default"
  >
    {children} ↗
  </a>
);
