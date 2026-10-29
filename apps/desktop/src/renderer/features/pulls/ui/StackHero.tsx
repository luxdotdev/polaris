/**
 * The Stack popover's hero (DESIGN.md, Chrome redesign → Review; Paper X-G): one pixel slab per
 * pull request on the base branch, the current layer lifted with a strong hairline, each slab a
 * dark tint of its state's hue with a 60% outline and the state word beside it; the base neutral.
 */
import type { StackMemberView, StackView } from "../../../../shared/github.ts";
import { shortBranch, slabLabel, STATUS_HUES } from "../model/stack.ts";

const LEFT = 20;

const MID = 116;

const RIGHT = 212;

/** Half the rhombus's height, and each slab's thickness. */
const RISE = 24;

const DEPTH = 10;

const LIFT = 6;

const TOP = 30;

const FOOT = 38;

const LABEL_X = 244;

/** What fits from LABEL_X to the hero's 400px edge in 11px mono; the base branch is cut to it. */
const LABEL_CHARS = 22;

/** Slabs closer together once the stack grows, so up to ~8 layers fit the hero's cap. */
const stepFor = (slabs: number) => (slabs <= 5 ? 26 : Math.max(14, Math.round(130 / slabs)));

const NEUTRAL_LINE = "color-mix(in oklab, var(--color-text-strong) 16%, transparent)";

interface Slab {
  readonly y: number;
  readonly label: string;
  readonly current: boolean;
  /** null: the base branch. */
  readonly member: StackMemberView | null;
}

const tint = (hue: string, percent: number) =>
  `color-mix(in oklab, ${hue} ${percent}%, var(--color-well))`;

/** Top, left side and right side fills, and the outline, for one slab. */
const paintOf = (slab: Slab) => {
  if (slab.member === null) {
    return {
      top: "color-mix(in oklab, var(--color-text-strong) 6%, var(--color-well))",
      left: "color-mix(in oklab, var(--color-text-strong) 3%, var(--color-well))",
      right: "var(--color-well)",
      line: NEUTRAL_LINE,
      dashed: false,
    };
  }

  const hue = STATUS_HUES[slab.member.status];

  if (hue === null) {
    return {
      top: "var(--color-well)",
      left: "var(--color-well)",
      right: "var(--color-well)",
      line: "color-mix(in oklab, var(--color-text-strong) 22%, transparent)",
      dashed: true,
    };
  }

  return {
    top: tint(hue, 22),
    left: tint(hue, 16),
    right: tint(hue, 10),
    line: `color-mix(in oklab, ${hue} ${slab.current ? 80 : 60}%, transparent)`,
    dashed: false,
  };
};

const labelColour = (slab: Slab) => {
  if (slab.current) return "var(--color-text-strong)";

  if (slab.member === null) return "var(--color-text-subtle)";

  return STATUS_HUES[slab.member.status] ?? "var(--color-text-faint)";
};

/** Bottom (the base) to top, each slab's y, the current one lifted off the one under it. */
const slabsOf = (stack: StackView): ReadonlyArray<Slab> => {
  const step = stepFor(stack.members.length + 1);

  const rows: Array<Slab> = [
    { y: 0, label: shortBranch(stack.trunk, LABEL_CHARS), current: false, member: null },
  ];

  let y = 0;

  stack.members.forEach((member, index) => {
    const current = index + 1 === stack.position;

    y -= step + (current ? LIFT : 0);
    rows.push({ y, label: slabLabel(member, current), current, member });
  });

  return rows.map((row) => ({ ...row, y: row.y - y + TOP }));
};

const LayerSlab = ({ slab }: { readonly slab: Slab }) => {
  const { y } = slab;
  const paint = paintOf(slab);

  const stroke = {
    stroke: paint.line,
    strokeDasharray: paint.dashed ? "3 3" : undefined,
  };

  return (
    <g data-testid="stack-slab" data-current={slab.current ? "" : undefined}>
      <polygon
        points={`${LEFT},${y} ${MID},${y + RISE} ${MID},${y + RISE + DEPTH} ${LEFT},${y + DEPTH}`}
        style={{ fill: paint.left, ...stroke }}
      />
      <polygon
        points={`${MID},${y + RISE} ${RIGHT},${y} ${RIGHT},${y + DEPTH} ${MID},${y + RISE + DEPTH}`}
        style={{ fill: paint.right, ...stroke }}
      />
      <polygon
        points={`${LEFT},${y} ${MID},${y - RISE} ${RIGHT},${y} ${MID},${y + RISE}`}
        style={{
          fill: paint.top,
          ...stroke,
          stroke: slab.current ? "var(--color-text-strong)" : paint.line,
        }}
      />
      <path
        d={`M${RIGHT + 6} ${y}h20`}
        style={{ stroke: NEUTRAL_LINE }}
        strokeDasharray="2 2"
        aria-hidden
      />
      <text
        data-testid={slab.member === null ? "stack-hero-base" : undefined}
        x={LABEL_X}
        y={y + 4}
        className="font-mono"
        fontSize={11}
        style={{ fill: labelColour(slab) }}
      >
        {slab.label}
      </text>
    </g>
  );
};

export const StackHero = ({ stack }: { readonly stack: StackView }) => {
  const slabs = slabsOf(stack);
  const height = (slabs[0]?.y ?? TOP) + FOOT;

  return (
    <div className="flex justify-center pt-1.5 pb-1" data-testid="stack-hero">
      <svg
        width={400}
        height={height}
        viewBox={`0 0 400 ${height}`}
        className="[shape-rendering:crispEdges]"
        role="img"
        aria-label={[
          ...slabs
            .slice(1)
            .toReversed()
            .map((s) => s.label),
          stack.trunk,
        ].join(", ")}
      >
        {slabs.map((slab) => (
          <LayerSlab key={slab.label} slab={slab} />
        ))}
      </svg>
    </div>
  );
};
