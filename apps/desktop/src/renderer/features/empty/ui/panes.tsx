/**
 * Pane-tier empty states (Paper 5SH-1): a 48px Starlight-washed tile, one
 * sentence, one fact, at most one action; never a signal colour, so "Nothing
 * needs you" is never yellow.
 */
import { EmptyState, PixelCheckIcon, PixelSparkleIcon } from "@polaris/ui";
import { useApp } from "../../../shell/hooks.ts";
import { nothingNeedsYouFact } from "../model.ts";

const glyph = "text-text-strong";

type HostModels = ReturnType<typeof useHostModels>;

const useHostModels = () => useApp((s) => s.hostModels);

const workingIn = (models: HostModels) =>
  Object.values(models).map(
    (model) => [...model.sessions.values()].filter((e) => e.session.state === "working").length
  );

/** The Needs You inbox with nothing in it. */
export const NothingNeedsYou = () => {
  const perHost = workingIn(useHostModels());
  const sessions = perHost.reduce((a, b) => a + b, 0);
  const hosts = perHost.filter((n) => n > 0).length;

  return (
    <div className="grid flex-1 place-items-center" data-testid="nothing-needs-you">
      <EmptyState
        icon={<PixelCheckIcon size={24} className={glyph} />}
        title="Nothing needs you"
        fact={nothingNeedsYouFact(sessions, hosts)}
      />
    </div>
  );
};

export interface LaterModeProps {
  readonly title: string;
  readonly fact: string;
}

/** Review and Edit before their milestones: say so plainly, and how to get back. */
export const LaterMode = ({ title, fact }: LaterModeProps) => (
  <div className="grid flex-1 place-items-center">
    <EmptyState icon={<PixelSparkleIcon size={24} className={glyph} />} title={title} fact={fact} />
  </div>
);
