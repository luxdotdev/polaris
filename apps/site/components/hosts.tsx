import { LaptopIcon, ServerIcon } from "./icons";
import { container, display, lead, SectionHeader } from "./section-header";

interface Host {
  readonly name: string;
  readonly detail: string;
  readonly local: boolean;
  /** The Harnesses working there, as dither tiles. */
  readonly agents: readonly ("claude" | "codex")[];
  readonly working: string;
}

const hosts: readonly Host[] = [
  {
    name: "This Mac",
    detail: "local · 5 workspaces",
    local: true,
    agents: ["claude", "claude", "codex"],
    working: "3 working",
  },
  {
    name: "build-01",
    detail: "ssh · 4 ms · 3 workspaces",
    local: false,
    agents: ["codex"],
    working: "1 working",
  },
  {
    name: "dev-vm",
    detail: "ssh · 21 ms · 2 workspaces",
    local: false,
    agents: ["codex", "claude"],
    working: "2 working",
  },
  {
    name: "staging",
    detail: "ssh · 38 ms · 1 workspace",
    local: false,
    agents: ["codex"],
    working: "1 working",
  },
];

const facts = [
  {
    title: "Uses the SSH you already have",
    body: "Pick a host from your SSH config. Polaris shows what it will install and asks first.",
  },
  {
    title: "Stays out of the way",
    body: "The daemon idles quietly, so it's at home on a small VM as much as a workstation.",
  },
  {
    title: "Picks up where you left off",
    body: "Lose the connection and Polaris reconnects, then catches you up on every turn you missed.",
  },
] as const;

export function Hosts() {
  return (
    <section
      id="hosts"
      aria-labelledby="anywhere"
      className={`${container} flex scroll-mt-20 flex-col gap-[18px] pt-28 md:gap-6 lg:pt-[200px]`}
    >
      <SectionHeader label="02 — Anywhere" />
      <div className="flex flex-col gap-[18px] pt-3 lg:flex-row lg:items-start lg:gap-16 lg:pt-10 xl:gap-24">
        <div className="flex flex-col gap-[18px] pb-3 lg:w-[480px] lg:shrink-0 lg:gap-7 lg:pb-0 xl:w-[560px]">
          <h2 id="anywhere" className={`${display} max-w-[300px] lg:max-w-[470px]`}>
            Wherever your code lives.
          </h2>
          <p className={lead}>
            Run agents on this Mac or on any machine you can reach over SSH. Every session shows up
            in the same window, and remote agents keep working after you close the lid.
          </p>
        </div>
        <HostPanel />
      </div>
      <ul className="flex flex-col gap-5 pt-7 lg:flex-row lg:gap-12 lg:pt-[72px]">
        {facts.map((fact) => (
          <li
            key={fact.title}
            className="border-site-rule flex flex-col gap-1.5 border-t pt-4 lg:flex-1 lg:basis-0 lg:gap-2 lg:pt-5"
          >
            <h3 className="text-text-strong text-[17px] leading-[22px] font-medium lg:text-[18px] lg:leading-6">
              {fact.title}
            </h3>
            <p className="text-site-muted text-[15px] leading-[23px] lg:text-[16px] lg:leading-6">
              {fact.body}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** An illustration of the Hosts list, drawn rather than shot; it is not interactive. */
function HostPanel() {
  return (
    <figure
      aria-label="Four hosts: this Mac and three machines over SSH, with seven agents working"
      className="border-site-rule bg-site-card flex flex-col gap-1.5 rounded-[18px] border p-2 shadow-(--site-card-shadow) lg:grow lg:p-3"
    >
      <figcaption className="flex items-center justify-between pt-3 pr-3.5 pb-4 pl-3 lg:px-4">
        <span className="text-text-strong text-[15px] leading-5 font-medium">Hosts</span>
        <span className="text-site-kicker text-[14px] leading-5">
          4 hosts<span className="hidden lg:inline"> · 11 workspaces</span> · 7 working
        </span>
      </figcaption>
      <ul className="flex flex-col gap-1.5" aria-hidden="true">
        {hosts.map((host) => (
          <HostRow key={host.name} host={host} />
        ))}
      </ul>
    </figure>
  );
}

function HostRow({ host }: { readonly host: Host }) {
  return (
    <li className="bg-site-row flex h-16 items-center gap-3.5 rounded-[12px] pr-3.5 pl-3 lg:h-[72px] lg:px-4">
      <span className="bg-site-tile text-site-copy flex size-9 shrink-0 items-center justify-center rounded-[10px]">
        {host.local ? <LaptopIcon /> : <ServerIcon />}
      </span>
      <span className="flex min-w-0 grow flex-col gap-0.5">
        <span className="text-text-strong text-[16px] leading-[22px] font-medium">{host.name}</span>
        <span className="text-site-kicker truncate text-[13px] leading-[18px]">{host.detail}</span>
      </span>
      <span className="hidden w-[120px] shrink-0 items-center justify-end gap-1.5 lg:flex">
        {host.agents.map((agent, index) => (
          <span
            // Harness tiles repeat, so their order is their identity.
            key={`${agent}-${index}`}
            className={`px-icon size-3.5 ${agent === "claude" ? "px-dither-claude" : "px-dither-codex"}`}
          />
        ))}
      </span>
      <span className="text-site-copy shrink-0 text-right text-[14px] leading-5 lg:w-[88px]">
        {host.working}
      </span>
    </li>
  );
}
