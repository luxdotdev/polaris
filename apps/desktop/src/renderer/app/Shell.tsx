/** Layout F: title bar, the adaptive top bar, then Input → Intent → Output (ENG-177). */
import { useEffect } from "react";
import { useOnboardingState, Welcome } from "../features/onboarding/index.ts";
import { LaterMode, type LaterModeProps } from "../features/empty/index.ts";
import { preloadReview } from "../features/review/index.ts";
import { SettingsPage } from "../features/settings/index.ts";
import { closeReviewSubject, useReviewSubject } from "../routes/review.ts";
import { Columns } from "../shell/Columns.tsx";
import { ShortcutHelp } from "../shell/ShortcutHelp.tsx";
import { useNav, useSelection, useShellActions } from "../shell/hooks.ts";
import { Sidebar } from "../shell/sidebar/Sidebar.tsx";
import { TitleBar } from "../shell/TitleBar.tsx";
import { TopBar } from "../shell/TopBar.tsx";
import { slots } from "./slots.tsx";

const LATER: LaterModeProps = {
  title: "The editor arrives in a later release",
  fact: "⌘1 goes back to orchestrate",
};

/** Review: the subject open (`routes/review.ts`), or the pull request list. */
const Review = () => {
  const subject = useReviewSubject();
  const { openSettings } = useShellActions();

  // The Review view's chunk loads while the pull request list is on screen.
  useEffect(preloadReview, []);

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      {subject === null ? (
        <slots.PullRequests onAddAccount={() => openSettings()} />
      ) : (
        <slots.ReviewSubject subject={subject} onBack={closeReviewSubject} />
      )}
    </main>
  );
};

/** Settings replaces the three zones (DESIGN.md, Settings); otherwise the mode's view. */
const Body = () => {
  const { mode, settings } = useSelection();

  if (settings !== null) return <SettingsPage route={settings} />;

  if (mode === "review") return <Review />;

  if (mode === "edit") {
    return (
      <main className="flex flex-1 flex-col">
        <LaterMode {...LATER} />
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
