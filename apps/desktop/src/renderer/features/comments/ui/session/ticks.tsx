/**
 * Where a message has Comments, a short tick on the conversation's scrollbar edge, placed by
 * its row among all rows; a click scrolls to it. Neutral, like the scrollbar it sits on.
 */
export interface CommentTick {
  readonly key: string;
  /** The row's index among `total`. */
  readonly index: number;
  readonly label: string;
}

export const CommentTicks = ({
  ticks,
  total,
  onJump,
}: {
  ticks: ReadonlyArray<CommentTick>;
  total: number;
  onJump: (key: string) => void;
}) =>
  ticks.length === 0 || total === 0 ? null : (
    <div
      className="pointer-events-none absolute inset-y-2 right-0 z-[4] w-2"
      data-testid="comment-ticks"
    >
      {ticks.map((t) => (
        <button
          key={t.key}
          type="button"
          aria-label={t.label}
          title={t.label}
          onClick={() => onJump(t.key)}
          className="bg-text-subtle pointer-events-auto absolute right-0.5 h-0.5 w-1.5 cursor-default rounded-full opacity-70 hover:opacity-100"
          style={{ top: `${(t.index / Math.max(1, total - 1)) * 100}%` }}
        />
      ))}
    </div>
  );
