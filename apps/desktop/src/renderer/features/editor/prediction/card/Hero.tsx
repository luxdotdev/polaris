/**
 * The completion card's hero (Paper X-F 10): crisp line art of what happens on a keystroke. The
 * editor sends keystrokes to the model server on its machine and a suggestion comes back; the
 * language server feeds it from the side. Not answering, the server is dashed and nothing returns.
 */
import { cn } from "@polaris/ui";
import type { Hero as HeroParts } from "./instrument.ts";

const LABEL = "font-mono text-[8px] tracking-[0.12em] uppercase";

const LINE = "stroke-text-subtle";

/** The editor window: a title bar and a few lines of code with the cursor in them. */
const Editor = () => (
  <g className={LINE} fill="none" strokeWidth="1">
    <rect x="12.5" y="44.5" width="104" height="72" />
    <path d="M12.5 52.5h104" />
    <path d="M17 48.5h1M20 48.5h1M23 48.5h1" />
    <path d="M22 60.5h40M28 67.5h48M28 74.5h30M28 88.5h44M22 95.5h52M22 102.5h22" />
    <path className="stroke-text-default" d="M28 81.5h18M48 77v9" />
    <path d="M52 81.5h12M67 81.5h16" />
  </g>
);

/** The model server: a chip on a board, dashed while it isn't answering. */
const Server = ({ answering }: { readonly answering: boolean }) => (
  <g className={LINE} fill="none" strokeWidth="1" strokeDasharray={answering ? undefined : "3 2"}>
    <rect x="238.5" y="50.5" width="104" height="58" />
    <rect x="266.5" y="64.5" width="48" height="24" strokeDasharray={undefined} />
    <path d="M276 76.5h28" strokeDasharray={undefined} />
    <path
      d="M274 60v4M282 60v4M290 60v4M298 60v4M306 60v4M274 89v4M282 89v4M290 89v4M298 89v4M306 89v4"
      strokeDasharray={undefined}
    />
    <path d="M318 101.5h16" strokeDasharray={undefined} />
  </g>
);

const Answering = () => (
  <>
    <text x="140" y="58" className={cn(LABEL, "fill-text-subtle")}>
      Keystrokes
    </text>
    <path className={LINE} d="M117 64.5h118" fill="none" />
    <path className="fill-text-subtle" d="M232 61l5 3.5-5 3.5z" />
    <rect className="fill-text-strong" x="174" y="62" width="5" height="5" />
    <path className={LINE} d="M238 86.5h-118" fill="none" strokeDasharray="4 3" />
    <path className="fill-text-subtle" d="M122 83l-5 3.5 5 3.5z" />
    <text x="140" y="101" className={cn(LABEL, "fill-text-subtle")}>
      Suggestion
    </text>
  </>
);

const NoAnswer = () => (
  <>
    <text x="150" y="58" className={cn(LABEL, "fill-failed-text")}>
      No answer
    </text>
    <path className={LINE} d="M117 64.5h100" fill="none" />
    <path className="stroke-failed" d="M220 60l9 9M229 60l-9 9" fill="none" strokeWidth="1.5" />
    <path className={LINE} d="M231 64.5h7" fill="none" strokeDasharray="2 2" />
  </>
);

export const Hero = ({
  hero,
  file,
}: {
  readonly hero: HeroParts;
  readonly file: string | null;
}) => (
  <svg
    viewBox="0 0 356 140"

    role="img"
    aria-label={
      hero.answering
        ? `Keystrokes go to the model server on ${hero.machine}, ${hero.endpoint}, and suggestions come back.`
        : `The model server on ${hero.machine}, ${hero.endpoint}, isn't answering.`
    }
    className="block h-[140px] w-full [shape-rendering:crispEdges]"
    data-testid="completion-hero"
  >
    <text x="12" y="20" className="fill-text-strong text-[12px]">
      Editor
    </text>
    {file === null ? null : (
      <text x="12" y="35" className="fill-text-subtle font-mono text-[10px]">
        {file}
      </text>
    )}
    <text x="238" y="20" className="fill-text-strong text-[12px]">
      {hero.machine}
    </text>
    <text x="238" y="35" className="fill-text-subtle font-mono text-[10px]">
      {hero.endpoint}
    </text>
    <Editor />
    <Server answering={hero.answering} />
    {hero.answering ? <Answering /> : <NoAnswer />}
    <text x="122" y="131" className={cn(LABEL, "fill-text-subtle")}>
      Language server
    </text>
    <g className={LINE} fill="none">
      <rect x="208.5" y="122.5" width="14" height="11" />
      <path d="M212 128.5h7" />
      <path d="M223 128.5h67.5v-20" strokeDasharray="2 2" />
    </g>
  </svg>
);
