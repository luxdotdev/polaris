/** Layout F: title bar, the adaptive top bar, then Input → Intent → Output (ENG-177). */
import { useOnboardingState, Welcome } from "../features/onboarding/index.ts";
import { Columns } from "../shell/Columns.tsx";
import { useNav, useSelection, useShellActions } from "../shell/hooks.ts";
import { Sidebar } from "../shell/sidebar/Sidebar.tsx";
import { TitleBar } from "../shell/TitleBar.tsx";
import { TopBar } from "../shell/TopBar.tsx";
import { slots } from "./slots.tsx";

const LATER: Readonly<Record<"review" | "edit", string>> = {
  review: "Review arrives in a later release. ⌘1 goes back to Orchestrate.",
  edit: "The editor arrives in a later release. ⌘1 goes back to Orchestrate.",
};

export const Shell = () => {
  const { mode } = useSelection();
  const jumpOpen = useNav((s) => s.jumpOpen);
  const { setJumpOpen } = useShellActions();
  const welcome = useOnboardingState((s) => s.welcome);

  // Until the settings say, a plain frame: the welcome never flashes for a returning user.
  if (welcome === "unknown") return <div className="bg-bg h-full" />;

  if (welcome === "show") return <Welcome />;

  return (
    <div className="flex h-full flex-col">
      <TitleBar />
      {mode === "orchestrate" ? (
        <>
          <TopBar />
          <main className="flex min-h-0 flex-1">
            <Sidebar />
            <Columns />
          </main>
        </>
      ) : (
        <main className="text-body text-text-faint grid flex-1 place-items-center">
          {LATER[mode]}
        </main>
      )}
      <slots.JumpMenu open={jumpOpen} onOpenChange={setJumpOpen} />
    </div>
  );
};
