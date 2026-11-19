/**
 * Settings → About (DESIGN.md, SR-12): the mark with "Polaris {version}" from the running app,
 * quiet app Updates, the precise per-check privacy fields, and each host's daemon version.
 */
import { Match } from "effect";
import {
  PixelPolarisIcon,
  SettingsButton,
  SettingsCard,
  SettingsGrid,
  SettingsHostRow,
  SettingsToggleRow,
  SettingsWell,
} from "@polaris/ui";
import { downloadPercent, type AppUpdateView } from "../../../../shared/appUpdates.ts";
import { clientCopy } from "../../../../shared/clientCopy.ts";
import { clientPlatform, toClientPlatform } from "../../../../shared/platform.ts";
import { useApp, useShellActions } from "../../../shell/hooks.ts";
import { polaris } from "../../bridge.ts";
import { useSettings } from "../store.ts";
import { DeveloperModeCard } from "./DeveloperMode.tsx";
import { appUpdateRow, checkedAt, type AppUpdateRow } from "../updates/model.ts";
import {
  checkForUpdates,
  restartToUpdate,
  setAutomaticUpdates,
  showUpdateInFinder,
  useUpdates,
} from "../updates/store.ts";

/** Checking: a 14px ring with a quarter arc in text-subtle, turning (Paper U1); still under Reduce Motion. */
const Spinner = () => (
  <svg
    aria-hidden
    width="14"
    height="14"
    viewBox="0 0 16 16"
    className="shrink-0 animate-spin motion-reduce:animate-none"
    data-testid="app-update-spinner"
  >
    <circle cx="8" cy="8" r="6" fill="none" stroke="var(--color-hairline)" strokeWidth="1.6" />
    <path
      d="M8 2a6 6 0 0 1 6 6"
      fill="none"
      stroke="var(--color-text-subtle)"
      strokeWidth="1.6"
      strokeLinecap="round"
    />
  </svg>
);

const ACTIONS = { check: checkForUpdates, restart: restartToUpdate, finder: showUpdateInFinder };

const releaseNotes = (version: string) =>
  void polaris().request("shell.openExternal", {
    url: `https://github.com/luxdotdev/polaris/releases/tag/v${encodeURIComponent(version)}`,
  });

/** The About header and version row for the platform main reports (the Client's own otherwise). */
const aboutPlatform = (view: AppUpdateView) => {
  const platform = view.platform ?? clientPlatform();
  const { os, machine } = clientCopy(platform);

  return Match.value(toClientPlatform(platform)).pipe(
    Match.when("win32", () => ({
      os,
      device: machine,
      description: `Windows ${view.arch} · experimental`,
    })),
    Match.when("darwin", () => ({
      os,
      device: machine,
      description: view.arch === "arm64" ? "Apple silicon" : view.arch,
    })),
    Match.orElse(() => ({ os, device: machine, description: `Linux ${view.arch}` }))
  );
};

/** Core version parts, so "0.4.2" sorts below "0.5.0"; pre-release tags are ignored here. */
const core = (version: string) => (version.split(/[-+]/)[0] ?? "").split(".").map(Number);

const olderThan = (version: string, than: string) => {
  const [a, b] = [core(version), core(than)];

  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);

    if (diff !== 0) return diff < 0;
  }

  return false;
};

/** The mark, then "Polaris {version}" as the running app reports it, never a constant. */
const Header = ({ version, platform }: { readonly version: string; readonly platform: string }) => (
  <header className="flex items-center gap-4 py-2 pb-[calc(var(--spacing-section)-4px)]">
    <div
      aria-hidden
      className="bg-raised grid size-12 shrink-0 place-items-center rounded-[12px] shadow-[inset_0_0_0_1px_var(--color-hairline)]"
    >
      <PixelPolarisIcon size={24} className="text-text-strong" />
    </div>
    <div className="flex min-w-0 flex-col gap-0.5">
      <h1
        className="text-text-strong font-[600] tracking-[-0.01em]"
        style={{
          fontSize: "round(calc(22px * var(--text-scale, 1)), 1px)",
          lineHeight: "round(calc(28px * var(--text-scale, 1)), 1px)",
        }}
        data-testid="about-version"
      >
        Polaris {version}
      </h1>
      <p className="text-body text-text-subtle">{platform} · Apache-2.0</p>
    </div>
  </header>
);

/** The download's share as a 4px Starlight bar; only its transform moves (DESIGN.md, Performance). */
const DownloadBar = ({
  fraction,
  label,
}: {
  readonly fraction: number;
  readonly label: string;
}) => (
  <div
    role="progressbar"
    aria-label={label}
    aria-valuemin={0}
    aria-valuemax={100}
    aria-valuenow={downloadPercent(fraction)}
    className="bg-hairline h-1 overflow-clip rounded-[2px]"
    data-testid="app-update-progress"
  >
    <div
      className="bg-starlight h-full w-full origin-left transition-transform duration-200 ease-out motion-reduce:transition-none"
      style={{ transform: `scaleX(${fraction})` }}
    />
  </div>
);

/** U1's row: a medium title over a caption, then the amount, the spinner or the actions; the bar below. */
const UpdateRow = ({ view, row }: { readonly view: AppUpdateView; readonly row: AppUpdateRow }) => (
  <div className="p-panel flex flex-col" data-testid="app-update" data-update={view.phase}>
    <div className="flex items-center gap-3">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5" role="status">
        <span
          className={`text-body truncate font-medium ${row.tone === "failed" ? "text-failed-text" : "text-text-strong"}`}
        >
          {row.title}
        </span>
        <span className="text-caption text-text-subtle truncate">{row.caption}</span>
      </div>
      {row.progress === null ? null : (
        <span
          className="text-caption text-text-subtle shrink-0 font-mono tabular-nums"
          data-testid="app-update-amount"
        >
          {row.progress.amount}
        </span>
      )}
      {row.spinner ? <Spinner /> : null}
      {view.phase === "ready" && view.readyVersion !== null ? (
        <SettingsButton variant="ghost" onClick={() => releaseNotes(view.readyVersion ?? "")}>
          Release notes
        </SettingsButton>
      ) : null}
      {row.action === null ? null : (
        <SettingsButton
          variant={row.action === "restart" ? "primary" : "secondary"}
          disabled={row.action === "check" && !view.supported}
          onClick={() => void ACTIONS[row.action ?? "check"]()}
        >
          {row.actionLabel}
        </SettingsButton>
      )}
    </div>
    {row.progress === null || row.progress.fraction === null ? null : (
      <div className="pt-3">
        <DownloadBar fraction={row.progress.fraction} label={row.title} />
      </div>
    )}
  </div>
);

const Updates = ({
  view,
  changing,
}: {
  readonly view: AppUpdateView;
  readonly changing: boolean;
}) => {
  const row = appUpdateRow(view);
  const working = view.phase === "checking" || view.phase === "downloading";

  const found = view.availableVersion === null ? "" : ` · found ${view.availableVersion}`;

  const checked =
    view.lastCheckedAt === null ? checkedAt(null) : `Last checked ${checkedAt(view.lastCheckedAt)}`;

  return (
    <SettingsCard
      title="Updates"
      status={`${checked}${found}`}
      action={
        row.action === "check" ? undefined : (
          <SettingsButton
            disabled={working || view.phase === "ready" || !view.supported}
            onClick={() => void checkForUpdates()}
          >
            Check now
          </SettingsButton>
        )
      }
    >
      <SettingsWell>
        <UpdateRow view={view} row={row} />
        <SettingsToggleRow
          title="Check for updates automatically"
          caption={
            view.automatic
              ? "On launch and every 6 hours; downloads in the background"
              : "Off · Polaris checks only when you choose Check now"
          }
          checked={view.automatic}
          disabled={changing || !view.supported}
          onCheckedChange={(enabled) => void setAutomaticUpdates(enabled)}
        />
      </SettingsWell>
    </SettingsCard>
  );
};

const WhatPolarisSends = ({ view }: { readonly view: AppUpdateView }) => {
  const platform = aboutPlatform(view);

  const fields: ReadonlyArray<readonly [string, string]> = [
    [
      "Install ID",
      view.automatic
        ? `${view.installId.slice(0, 4)}…${view.installId.slice(-4)}`
        : "Not sent while automatic checks are off",
    ],
    ["Version", view.version],
    ["Arch", view.arch],
    [platform.os, view.osVersion],
  ];

  return (
    <SettingsCard
      title={
        view.automatic ? "What Polaris sends with each check" : "What Polaris sends when you check"
      }
    >
      <SettingsWell>
        <dl className="divide-hairline flex flex-col divide-y" data-testid="update-fields">
          {fields.map(([label, value]) => (
            <div key={label} className="px-panel flex items-center gap-3 py-2.5">
              <dt className="text-body text-text-default min-w-0 flex-1">{label}</dt>
              <dd
                className="text-text-default font-mono text-[12px] leading-4 break-all"
                title={
                  label === "Install ID" && view.automatic
                    ? `Random, made on ${platform.device}`
                    : undefined
                }
              >
                {value}
              </dd>
            </div>
          ))}
        </dl>
      </SettingsWell>
      <p className="text-caption text-text-subtle pl-gap flex min-h-10 items-center">
        Nothing else: no account, host, workspace or IP.
      </p>
    </SettingsCard>
  );
};

/** Each host's daemon version against this app's; an older one says it can upgrade. */
const Daemons = ({ version }: { readonly version: string }) => {
  const hosts = useApp((s) => s.hosts);
  const { openSettings } = useShellActions();
  const connected = hosts.filter((h) => h.status.state === "connected" && h.status.host !== null);

  const current = connected.filter(
    (h) => !olderThan(h.status.host?.daemonVersion ?? "", version)
  ).length;

  return (
    <SettingsCard
      title="Daemons on your hosts"
      aside={connected.length === 0 ? undefined : `${current} of ${connected.length} current`}
      action={<SettingsButton onClick={() => openSettings("hosts")}>Open hosts</SettingsButton>}
      data-testid="about-daemons"
    >
      <SettingsWell>
        {hosts.map((host) => {
          const daemon = host.status.host?.daemonVersion ?? null;
          const offline = host.status.state !== "connected" || daemon === null;
          const older = daemon !== null && olderThan(daemon, version);

          return (
            <SettingsHostRow
              key={host.key}
              name={host.label}
              colour={host.colour ?? "var(--color-text-faint)"}
              offline={offline}
            >
              <span
                className={`font-mono text-[12px] leading-4 ${older ? "text-text-subtle" : "text-text-default"}`}
                data-testid="daemon-version"
              >
                {older ? `${daemon} · upgrade` : daemon}
              </span>
            </SettingsHostRow>
          );
        })}
        <p className="px-panel text-caption text-text-subtle py-2.5">Daemons upgrade from Hosts</p>
      </SettingsWell>
    </SettingsCard>
  );
};

export const AboutPage = () => {
  const { view, problem, changing } = useUpdates((s) => s);
  const appVersion = useSettings((s) => s.version);

  if (view === null)
    return (
      <div className="mx-auto w-[860px] max-w-[calc(100%-2rem)] py-[calc(var(--spacing-section)+16px)]">
        <p className="text-body text-text-subtle">
          {problem ?? "Reading Polaris's update settings…"}
        </p>
      </div>
    );

  const version = view.version || appVersion;

  return (
    <div className="gap-gap mx-auto flex w-[860px] max-w-[calc(100%-2rem)] flex-col py-[calc(var(--spacing-section)+16px)]">
      <Header version={version} platform={aboutPlatform(view).description} />
      <Updates view={view} changing={changing} />
      {problem === null ? null : (
        <p role="status" className="text-caption text-text-subtle px-panel">
          {problem}
        </p>
      )}
      <SettingsGrid>
        <WhatPolarisSends view={view} />
        <Daemons version={version} />
      </SettingsGrid>
      <DeveloperModeCard />
    </div>
  );
};
