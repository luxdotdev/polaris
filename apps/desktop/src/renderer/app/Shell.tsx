/** Layout F: title bar, the adaptive top bar, then Input → Intent → Output (ENG-177). */
import { useOnboardingState, Welcome } from "../features/onboarding/index.ts";
import { LaterMode, type LaterModeProps } from "../features/empty/index.ts";
import { SettingsPage } from "../features/settings/index.ts";
import { Columns } from "../shell/Columns.tsx";
import { ShortcutHelp } from "../shell/ShortcutHelp.tsx";
import { useNav, useSelection, useShellActions } from "../shell/hooks.ts";
import { Sidebar } from "../shell/sidebar/Sidebar.tsx";
import { TitleBar } from "../shell/TitleBar.tsx";
import { TopBar } from "../shell/TopBar.tsx";
import { slots } from "./slots.tsx";

const LATER: Readonly<Record<"review" | "edit", LaterModeProps>> = {
  review: { title: "Review arrives in a later release", fact: "⌘1 goes back to orchestrate" },
  edit: { title: "The editor arrives in a later release", fact: "⌘1 goes back to orchestrate" },
};

/** Settings replaces the three zones (DESIGN.md, Settings); otherwise the mode's view. */
const Body = () => {
  const { mode, settings } = useSelection();

  if (settings !== null) return <SettingsPage route={settings} />;

  if (mode !== "orchestrate") {
    return (
      <main className="flex flex-1 flex-col">
        <LaterMode {...LATER[mode]} />
      </main>
    );
  }

  return (
    <>
      <TopBar />
      <main className="flex min-h-0 flex-1">
        <Sidebar />
        <Columns />
      </main>
    </>
  );
};

export const Shell = () => {
  const jumpOpen = useNav((s) => s.jumpOpen);
  const { setJumpOpen } = useShellActions();
  const welcome = useOnboardingState((s) => s.welcome);

  // Until the settings say, a plain frame: the welcome never flashes for a returning user.
  if (welcome === "unknown") return <div className="bg-bg h-full" />;

  if (welcome === "show") return <Welcome />;

  return (
    <div className="flex h-full flex-col">
      <TitleBar />
      <Body />
      <slots.JumpMenu open={jumpOpen} onOpenChange={setJumpOpen} />
      <slots.OpenFolder />
      <ShortcutHelp />
    </div>
  );
};
