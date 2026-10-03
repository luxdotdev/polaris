/** Settings → About: quiet app Updates and the precise per-check privacy fields. */
import { Button, Dither, FolderIcon, PixelCheckIcon, PixelPolarisIcon, Switch } from "@polaris/ui";
import { useId } from "react";
import { polaris } from "../../bridge.ts";
import { useShellActions } from "../../../shell/hooks.ts";
import { useSettings } from "../store.ts";
import { appUpdateRow, checkedAt, type AppUpdateRow } from "../updates/model.ts";
import {
  checkForUpdates,
  restartToUpdate,
  setAutomaticUpdates,
  showUpdateInFinder,
  useUpdates,
} from "../updates/store.ts";
import { Column, FooterStrip, Group, Heading, SettingRow } from "./parts.tsx";

const Glyph = ({ kind }: { readonly kind: AppUpdateRow["glyph"] }) => {
  switch (kind) {
    case "working":
      return <Dither hue="starlight" size={16} />;
    case "check":
      return <PixelCheckIcon size={16} className="text-text-subtle" />;
    case "star":
      return <PixelPolarisIcon size={16} className="text-starlight" />;
    case "folder":
      return <FolderIcon size={16} className="text-text-subtle" />;
    case "failed":
      return (
        <span
          aria-hidden
          className="text-caption text-text-subtle grid size-4 place-items-center rounded-full border"
        >
          !
        </span>
      );
    case "off":
      return (
        <span aria-hidden className="border-text-subtle size-4 rounded-full border border-dashed" />
      );
  }
};

const ACTIONS = { check: checkForUpdates, restart: restartToUpdate, finder: showUpdateInFinder };

const releaseNotes = (version: string) =>
  void polaris().request("shell.openExternal", {
    url: `https://github.com/luxdotdev/polaris/releases/tag/v${encodeURIComponent(version)}`,
  });

export const AboutPage = () => {
  const { view, problem, changing } = useUpdates((s) => s);
  const version = useSettings((s) => s.version);
  const { openSettings } = useShellActions();
  const id = useId();

  if (view === null)
    return (
      <Column>
        <p className="text-body text-text-subtle">
          {problem ?? "Reading Polaris's update settings…"}
        </p>
      </Column>
    );

  const row = appUpdateRow(view);
  const working = view.phase === "checking" || view.phase === "downloading";

  const fields = [
    [
      "Install ID",
      view.automatic
        ? `${view.installId.slice(0, 8)}…${view.installId.slice(-4)} · random, made on this Mac`
        : "Not sent while automatic checks are off",
    ],
    ["Version", view.version],
    ["Arch", view.arch],
    ["macOS", view.macOSVersion],
  ];

  return (
    <Column>
      <header className="gap-panel flex items-center">
        <div
          aria-hidden
          className="bg-surface-sunken rounded-card grid size-16 shrink-0 place-items-center"
        >
          <PixelPolarisIcon size={48} className="text-starlight" />
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <h1 className="text-title text-text-strong font-medium">
            Polaris {view.version || version}
          </h1>
          <p className="text-body text-text-subtle">
            {view.arch === "arm64" ? "Apple silicon" : view.arch} · Apache-2.0
          </p>
        </div>
      </header>
      <div className="gap-gap flex flex-col">
        <Heading>Updates</Heading>
        <Group label="Updates">
          <div
            className="px-panel gap-gap flex items-center py-[calc(var(--spacing-gap)+4px)]"
            data-testid="app-update"
            data-update={view.phase}
          >
            <span className="shrink-0" aria-hidden>
              <Glyph kind={row.glyph} />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5" role="status">
              <span className="text-label text-text-default">{row.title}</span>
              <span className="text-caption text-text-subtle">{row.caption}</span>
            </div>
            <div className="gap-gap flex shrink-0 items-center">
              {view.phase === "ready" && view.availableVersion !== null ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => releaseNotes(view.availableVersion ?? "")}
                >
                  Release notes
                </Button>
              ) : null}
              {row.action === null ? null : (
                <Button
                  size="sm"
                  variant={row.action === "restart" ? "primary" : "secondary"}
                  disabled={row.action === "check" && !view.supported}
                  onClick={() => void ACTIONS[row.action ?? "check"]()}
                >
                  {row.actionLabel}
                </Button>
              )}
            </div>
          </div>
          <SettingRow
            title="Check for updates automatically"
            htmlFor={id}
            caption={
              view.automatic
                ? "On launch and every 6 hours; downloads in the background"
                : "Off · Polaris checks only when you choose Check now"
            }
          >
            <Switch
              id={id}
              checked={view.automatic}
              disabled={changing || !view.supported}
              onCheckedChange={(enabled) => void setAutomaticUpdates(enabled)}
            />
          </SettingRow>
          <SettingRow
            title="Last checked"
            caption={`${checkedAt(view.lastCheckedAt)}${view.availableVersion === null ? "" : ` · found ${view.availableVersion}`}`}
          >
            {row.action === "check" ? null : (
              <Button
                variant="secondary"
                size="sm"
                disabled={working || view.phase === "ready" || !view.supported}
                onClick={() => void checkForUpdates()}
              >
                Check now
              </Button>
            )}
          </SettingRow>
          <FooterStrip>
            <div className="gap-gap flex w-full flex-col">
              <p className="text-caption text-text-default">
                {view.automatic
                  ? "What Polaris sends with each check"
                  : "What Polaris sends when you check"}
              </p>
              <dl className="text-caption text-text-subtle flex flex-col gap-1.5">
                {fields.map(([label, value]) => (
                  <div key={label} className="flex gap-3">
                    <dt className="w-24 shrink-0">{label}</dt>
                    <dd
                      className={
                        label === "Install ID" && view.automatic
                          ? "font-mono break-all"
                          : "break-all"
                      }
                    >
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="text-caption text-text-subtle">
                Nothing else: no account, host, workspace or IP. Turning automatic checks off stops
                both.
              </p>
            </div>
          </FooterStrip>
        </Group>
        {problem === null ? null : (
          <p role="status" className="text-caption text-text-subtle">
            {problem}
          </p>
        )}
      </div>
      <div className="gap-gap flex flex-col">
        <Heading>Daemons on your hosts</Heading>
        <p className="text-body text-text-subtle">
          After the update, each host's daemon follows its upgrade setting when it connects.
        </p>
        <div>
          <Button variant="ghost" onClick={() => openSettings("hosts")}>
            Open hosts
          </Button>
        </div>
      </div>
    </Column>
  );
};
