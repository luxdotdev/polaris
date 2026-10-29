/**
 * The Hosts popover from the machine bar (DESIGN.md, Menus and popovers; Paper X-F 05): an
 * instrument card whose picture is every Host joined to this machine by its route, each
 * with its Connection State, and a footer counting the connected ones.
 */
import { Button, cn, InstrumentPopoverContent, Kicker, Popover, PopoverTrigger } from "@polaris/ui";
import { useState } from "react";
import { clientCopy } from "../../../../shared/clientCopy.ts";
import type { HostView } from "../../../../shared/api.ts";
import { useSince } from "../../../shell/HostState.tsx";
import { isSlowLink } from "../../../shell/hostCopy.ts";
import { useApp, useShellActions } from "../../../shell/hooks.ts";
import { HostGlyph, LINE, THIS_MACHINE_HEIGHT, ThisMachine } from "./glyphs.tsx";
import { hostArt, PER_ROW, routeWords, rowsOf, stateParts, statusLine } from "./model.ts";

const WIDTH = 420;

const ROW = 140;

const LABEL_TOP = 14;

/** A machine's bottom vertex, from its row's top. */
const BASE = 130;

/** The row's shared line, below its machines. */
const BUS = BASE + 16;

const LAPTOP_GAP = 24;

const FOOT = 14;

const LINK = "color-mix(in oklab, var(--color-text-strong) 26%, transparent)";

const connected = (host: HostView) => host.status.state === "connected";

interface Placed {
  readonly host: HostView;
  readonly x: number;
  readonly top: number;
  readonly slot: number;
}

interface Layout {
  readonly placed: ReadonlyArray<Placed>;
  readonly buses: ReadonlyArray<{ readonly y: number; readonly from: number; readonly to: number }>;
  readonly trunk: number;
  readonly laptopTop: number;
  readonly height: number;
}

/** One row side by side; past `PER_ROW`, a grid with the trunk between its middle columns. */
const layout = (remote: ReadonlyArray<HostView>): Layout => {
  const rows = rowsOf(remote);
  const columns = rows.length > 1 ? PER_ROW : Math.max(1, remote.length);
  const slot = WIDTH / columns;
  const trunk = rows.length > 1 || remote.length === 0 ? WIDTH / 2 : Math.round(WIDTH * 0.64);

  const placed = rows.flatMap((row, r) =>
    row.map((host, c) => ({ host, x: slot * (c + 0.5), top: r * ROW, slot }))
  );

  const buses = rows.map((row, r) => {
    const xs = [trunk, ...row.map((_, c) => slot * (c + 0.5))];

    return { y: r * ROW + BUS, from: Math.min(...xs), to: Math.max(...xs) };
  });

  const laptopTop = remote.length === 0 ? 20 : rows.length * ROW + LAPTOP_GAP;

  return { placed, buses, trunk, laptopTop, height: laptopTop + THIS_MACHINE_HEIGHT + FOOT };
};

/** A Host's drop to its row's line: dotted with a lit flow dot, or broken while it's down. */
const Drop = ({ item }: { readonly item: Placed }) => {
  const { x, top } = item;
  const from = top + BASE;
  const to = top + BUS;
  const mid = Math.round((from + to) / 2);

  if (!connected(item.host))
    return (
      <>
        <path d={`M${x} ${from}V${to}`} style={{ stroke: LINE }} strokeDasharray="4 3" />
        <path
          d={`M${x - 5} ${mid - 2}h10M${x - 5} ${mid + 2}h10`}
          style={{ stroke: LINE }}
          data-testid="hosts-link-broken"
        />
      </>
    );

  return (
    <>
      <path d={`M${x} ${from}V${to}`} style={{ stroke: LINK }} strokeDasharray="2 2" />
      <rect x={x - 1} y={mid - 1} width={3} height={3} style={{ fill: "var(--color-starlight)" }} />
    </>
  );
};

const HostLabel = ({ item }: { readonly item: Placed }) => {
  const { host } = item;
  const since = useSince(host);

  return (
    <div
      className="absolute flex flex-col items-center gap-0.5 px-1"
      style={{ left: item.x - item.slot / 2, top: item.top + LABEL_TOP, width: item.slot }}
      data-host={host.key}
      data-connection={host.status.state}
    >
      <span
        title={host.label}
        className={cn(
          "text-caption max-w-full truncate font-medium",
          connected(host) ? "text-text-strong" : "text-text-default"
        )}
      >
        {host.label}
      </span>
      <Kicker
        className="max-w-full text-center"
        parts={stateParts(host, since, isSlowLink(host))}
      />
    </div>
  );
};

/** "You · connected": the local Host's state, when this machine runs one. */
const LocalKicker = ({ local }: { readonly local: HostView }) => {
  const since = useSince(local);

  return <Kicker parts={["you", ...stateParts(local, since, false)]} />;
};

const LocalLabel = ({
  local,
  x,
  top,
}: {
  readonly local: HostView | undefined;
  readonly x: number;
  readonly top: number;
}) => (
  <div
    className="absolute flex flex-col gap-0.5"
    style={{ left: x + 44, top: top + 20, width: WIDTH - x - 52 }}
  >
    <span
      className="text-caption text-text-strong truncate font-medium"
      title={local?.label ?? clientCopy().localHost}
    >
      {local?.label ?? clientCopy().localHost}
    </span>
    {local === undefined ? (
      <Kicker className="truncate" parts={["you"]} />
    ) : (
      <LocalKicker local={local} />
    )}
  </div>
);

/** The hero: every remote Host over its route to this machine, and this machine below. */
const HostsPicture = ({ hosts }: { readonly hosts: ReadonlyArray<HostView> }) => {
  const remote = hosts.filter((h) => h.kind !== "local");
  const local = hosts.find((h) => h.kind === "local");
  const view = layout(remote);
  const route = routeWords(remote);
  const firstBus = view.buses[0];

  return (
    <div
      className="relative mx-auto"
      style={{ width: WIDTH, height: view.height }}
      data-testid="hosts-picture"
    >
      <svg
        width={WIDTH}
        height={view.height}
        viewBox={`0 0 ${WIDTH} ${view.height}`}
        className="absolute inset-0 [shape-rendering:crispEdges]"
        aria-hidden
      >
        {view.buses.map((bus) => (
          <path
            key={bus.y}
            d={`M${bus.from} ${bus.y}H${bus.to}`}
            style={{ stroke: LINK }}
            strokeDasharray="2 2"
          />
        ))}
        {firstBus === undefined ? null : (
          <path
            d={`M${view.trunk} ${firstBus.y}V${view.laptopTop + 4}`}
            style={{ stroke: LINK }}
            strokeDasharray="2 2"
          />
        )}
        {view.placed.map((item) => (
          <g
            key={item.host.key}
            style={{ opacity: connected(item.host) ? 1 : "var(--opacity-dimmed)" }}
          >
            <Drop item={item} />
            <HostGlyph
              art={hostArt(item.host.kind, item.host.status.host?.platform)}
              at={{ x: item.x, y: item.top + BASE }}
              lit={connected(item.host)}
            />
          </g>
        ))}
        <ThisMachine at={{ x: view.trunk, y: view.laptopTop }} />
      </svg>
      {view.placed.map((item) => (
        <HostLabel key={item.host.key} item={item} />
      ))}
      {firstBus === undefined || route.length === 0 ? null : (
        <Kicker
          className="absolute"
          style={{ left: firstBus.from + 8, top: firstBus.y - 16 }}
          parts={route}
        />
      )}
      <LocalLabel local={local} x={view.trunk} top={view.laptopTop} />
    </div>
  );
};

/** The machine bar's Hosts control and its card. */
export const HostsButton = () => {
  const hosts = useApp((s) => s.hosts);
  const { openSettings } = useShellActions();
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="hosts-trigger"
          className="hover:bg-fill-hover data-[state=open]:bg-fill-hover flex h-[38px] shrink-0 cursor-default items-center rounded-full px-3"
        >
          <span className="text-label font-regular text-text-subtle">Hosts</span>
        </button>
      </PopoverTrigger>
      <InstrumentPopoverContent
        align="end"
        data-testid="hosts-card"
        className="w-[440px]"
        header={{
          title: (
            <>
              Hosts
              <span className="text-caption text-text-subtle ml-2 font-normal">
                How {clientCopy().machine} reaches each one
              </span>
            </>
          ),
        }}
        wells={[<HostsPicture key="picture" hosts={hosts} />]}
        footer={{
          status: statusLine(hosts),
          action: (
            <Button
              size="xs"
              className="rounded-full"
              onClick={() => {
                setOpen(false);
                openSettings("hosts", { adding: true });
              }}
            >
              Add host…
            </Button>
          ),
        }}
      />
    </Popover>
  );
};
