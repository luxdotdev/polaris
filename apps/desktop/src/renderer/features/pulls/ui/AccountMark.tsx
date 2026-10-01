/** An account's mark (Paper R3, S5): a two-stop wash, as the CSP keeps GitHub avatars out. */
import { cn } from "@polaris/ui";

/** Paper R3's washes. */
const MARKS: ReadonlyArray<readonly [string, string]> = [
  ["oklab(72.9% -0.010 -0.072)", "oklab(48.7% -0.006 -0.067)"],
  ["oklab(73.8% 0.028 0.065)", "oklab(49.6% 0.026 0.053)"],
  ["oklab(72% 0.045 -0.04)", "oklab(48% 0.04 -0.035)"],
  ["oklab(73% -0.05 0.02)", "oklab(49% -0.045 0.015)"],
];

/** By the account's place in the user's order, so two accounts never share a mark. */
export const AccountMark = ({
  index,
  size = 14,
  className,
}: {
  readonly index: number;
  readonly size?: number;
  readonly className?: string | undefined;
}) => {
  const [from, to] = MARKS[index % MARKS.length] ?? [];

  return (
    <span
      aria-hidden
      className={cn("shrink-0 rounded-full", className)}
      style={{
        width: size,
        height: size,
        backgroundImage: `linear-gradient(in oklab 135deg, ${from} 0%, ${to} 100%)`,
      }}
    />
  );
};
