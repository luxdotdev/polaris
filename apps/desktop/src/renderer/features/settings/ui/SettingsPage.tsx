/**
 * Settings (DESIGN.md, Settings): replaces the three zones inside the main
 * window. A 264px sunken nav on the left and one centred 680px column; esc
 * (outside an open menu or dialog) goes back to where the user was.
 */
import {
  ChartColumnIcon,
  ChevronLeftIcon,
  cn,
  ContrastIcon,
  GridIcon,
  Kbd,
  PixelPolarisIcon,
  ServerIcon,
} from "@polaris/ui";
import { type ReactNode, useEffect } from "react";
import { slots } from "../../../app/slots.tsx";
import type { SettingsRoute, SettingsSection } from "../../../routes/selection.ts";
import { useShellActions } from "../../../shell/hooks.ts";
import { SECTION_GROUPS, sectionInfo } from "../model/sections.ts";
import { useSettings } from "../store.ts";
import { AppearancePage } from "./AppearancePage.tsx";
import { HarnessesPage } from "./HarnessesPage.tsx";
import { UsagePage } from "./UsagePage.tsx";

const ICONS: Readonly<Record<SettingsSection, ReactNode>> = {
  appearance: <ContrastIcon />,
  harnesses: <GridIcon />,
  usage: <ChartColumnIcon />,
  hosts: <ServerIcon />,
};

/** An open popover, menu, select or dialog takes esc first. */
const layerOpen = () =>
  document.querySelector("[data-radix-popper-content-wrapper], [role='dialog']") !== null;

const useEscapeCloses = (close: () => void) => {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || layerOpen()) return;
      event.preventDefault();
      close();
    };

    // Capture, so it runs before a Radix layer dismisses itself on the same key.
    window.addEventListener("keydown", onKey, true);

    return () => window.removeEventListener("keydown", onKey, true);
  }, [close]);
};

const NavItem = ({
  section,
  selected,
  onSelect,
}: {
  readonly section: SettingsSection;
  readonly selected: boolean;
  readonly onSelect: () => void;
}) => (
  <button
    type="button"
    aria-current={selected ? "page" : undefined}
    onClick={onSelect}
    className={cn(
      "h-row px-row-x rounded-row text-label flex w-full shrink-0 cursor-default items-center gap-2.5",
      selected
        ? "bg-fill-selected text-text-strong"
        : "text-text-default hover:bg-fill-hover [&>svg]:text-text-subtle"
    )}
  >
    {ICONS[section]}
    {sectionInfo(section).title}
  </button>
);

const SettingsNav = ({ current }: { readonly current: SettingsSection }) => {
  const { openSettings, closeSettings } = useShellActions();
  const version = useSettings((s) => s.version);

  return (
    <nav
      aria-label="Settings"
      className="border-hairline bg-surface-sunken px-gap flex w-[264px] shrink-0 flex-col overflow-y-auto border-r py-3"
    >
      <div className="px-gap flex flex-col gap-3.5 pt-1 pb-[18px]">
        <button
          type="button"
          onClick={closeSettings}
          className="text-label font-regular text-text-subtle hover:text-text-default flex h-6 cursor-default items-center gap-1.5"
        >
          <ChevronLeftIcon size={14} />
          <span className="flex-1 text-left">Back to orchestrate</span>
          <Kbd>esc</Kbd>
        </button>
        <h1 className="text-title text-text-strong font-medium">Settings</h1>
      </div>
      {SECTION_GROUPS.map((group) => (
        <div key={group.title} className="pb-panel flex flex-col">
          <h2 className="text-caption text-text-subtle px-row-x pb-1.5">{group.title}</h2>
          {group.sections.map((section) => (
            <NavItem
              key={section}
              section={section}
              selected={section === current}
              onSelect={() => openSettings(section)}
            />
          ))}
        </div>
      ))}
      <span className="flex-1" />
      <div className="h-row px-row-x text-label text-text-default flex shrink-0 items-center gap-2.5">
        <PixelPolarisIcon size={16} className="text-starlight" />
        About Polaris
        <span className="text-caption text-text-subtle font-regular">{version}</span>
      </div>
    </nav>
  );
};

const Page = ({ route }: { readonly route: SettingsRoute }) => {
  switch (route.section) {
    case "appearance":
      return <AppearancePage />;
    case "harnesses":
      return <HarnessesPage />;
    case "usage":
      return <UsagePage />;
    case "hosts":
      return <slots.SettingsHosts adding={route.adding} />;
  }
};

export const SettingsPage = ({ route }: { readonly route: SettingsRoute }) => {
  const { closeSettings } = useShellActions();

  useEscapeCloses(closeSettings);

  return (
    <main className="flex min-h-0 flex-1" data-testid="settings">
      <SettingsNav current={route.section} />
      <div
        className="bg-bg min-w-0 flex-1 [scrollbar-gutter:stable_both-edges] overflow-y-auto"
        data-section={route.section}
      >
        <Page route={route} />
      </div>
    </main>
  );
};
