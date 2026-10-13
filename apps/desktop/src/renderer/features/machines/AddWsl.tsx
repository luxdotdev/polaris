/**
 * The WSL part of "Add a host" (Paper W1, W3): the distros on this PC as a
 * radio list (WSL 1 ones dimmed, never pickable), or what to do when WSL
 * isn't installed or has no distro. Polaris never runs `wsl --install` itself.
 */
import { Button, cn, CopyButton } from "@polaris/ui";
import { Match } from "effect";
import type { WslDistrosView, WslDistroView } from "../../../shared/api.ts";
import { distroCaption, type WslEmpty, wslSection } from "./wsl.ts";

export interface AddWslProps {
  readonly view: WslDistrosView | null;
  /** Distros already added as Hosts; they aren't offered again. */
  readonly taken: ReadonlySet<string>;
  readonly selected: string | null;
  readonly onSelect: (distro: WslDistroView) => void;
  readonly onLookAgain: () => void;
}

const Heading = ({ children }: { readonly children: string }) => (
  <p className="text-caption text-text-subtle px-row-x pb-1 font-medium">{children}</p>
);

const DistroList = ({
  distros,
  selected,
  onSelect,
}: Pick<AddWslProps, "selected" | "onSelect"> & {
  readonly distros: ReadonlyArray<WslDistroView>;
}) => (
  <ul
    role="radiogroup"
    aria-label="WSL distros on this PC"
    className="flex max-h-[220px] flex-col overflow-y-auto"
  >
    {distros.map((distro) => {
      const blocked = distro.unsupported !== null;

      return (
        <li key={distro.name}>
          <button
            type="button"
            role="radio"
            aria-checked={selected === distro.name}
            aria-disabled={blocked}
            disabled={blocked}
            onClick={() => onSelect(distro)}
            className={cn(
              "h-row px-row-x flex w-full cursor-default items-center gap-3 rounded-row text-left",
              selected === distro.name ? "bg-fill-selected" : "hover:bg-fill-hover",
              blocked && "opacity-(--opacity-dimmed) hover:bg-transparent"
            )}
          >
            <span className="text-code-inline text-text-strong w-[160px] shrink-0 truncate font-mono">
              {distro.name}
            </span>
            <span className="text-caption text-text-subtle truncate">{distroCaption(distro)}</span>
          </button>
        </li>
      );
    })}
  </ul>
);

const Empty = ({
  state,
  onLookAgain,
}: { readonly state: WslEmpty } & Pick<AddWslProps, "onLookAgain">) => (
  <div
    className="border-hairline bg-surface-sunken gap-row-x rounded-row flex flex-col border p-3"
    data-testid="wsl-empty"
  >
    <p className="text-body text-text-default">{state.body}</p>
    {state.command === null ? null : (
      <pre className="border-hairline bg-surface-raised text-code-inline text-text-subtle py-row-x rounded-row border px-3 font-mono leading-[18px]">
        {state.command}
      </pre>
    )}
    <div className="gap-gap flex items-center">
      {state.command === null ? null : (
        <CopyButton
          variant="button"
          buttonVariant="secondary"
          label="Copy command"
          text={state.command}
        />
      )}
      <Button onClick={onLookAgain}>Look again</Button>
      {state.hint === null ? null : (
        <span className="text-caption text-text-subtle">{state.hint}</span>
      )}
    </div>
  </div>
);

/** Null off Windows: the card then reads exactly as it does on a Mac. */
export const AddWsl = ({ view, taken, selected, onSelect, onLookAgain }: AddWslProps) => {
  const section = wslSection(view);

  const body = Match.value(section).pipe(
    Match.discriminatorsExhaustive("kind")({
      hidden: () => null,
      loading: () => <p className="text-caption text-text-subtle px-row-x">Asking WSL…</p>,
      empty: (state) => <Empty state={state} onLookAgain={onLookAgain} />,
      distros: ({ distros }) => (
        <DistroList
          distros={distros.filter((d) => !taken.has(d.name))}
          selected={selected}
          onSelect={onSelect}
        />
      ),
    })
  );

  if (body === null) return null;

  return (
    <div className="flex flex-col gap-1" data-testid="add-wsl">
      <Heading>WSL distros on this PC</Heading>
      {body}
    </div>
  );
};
