/**
 * The rail's Activity block (Paper R1, R2): what the session does now, from the transcript's
 * live item, a pending request, or the Host's connection when it isn't connected.
 */
import { cn, ReloadIcon } from "@polaris/ui";
import type { SessionId } from "@polaris/protocol";
import { useEffect, useState } from "react";
import { activityOf, sessionLine } from "../../../../shell/copy.ts";
import { SessionGlyph } from "../../../../shell/glyphs.tsx";
import { useApp } from "../../../../shell/hooks.ts";
import type { SessionModel } from "../../../../store/sessionModel.ts";
import { useHost } from "../../hooks.ts";
import { waitingOn, waitingPhrase } from "../../model/background.ts";
import { harnessName } from "../../model/polarisTools/words.ts";
import { BackgroundTasksHover } from "../../ui/background.tsx";
import { type Activity, activity, type ActivityInput, type Phrase } from "./model.ts";
import { ROW, Slot } from "./parts.tsx";

/** The clock, read again every `every` ms while `every` isn't null. */
const useNow = (every: number | null) => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (every === null) return undefined;
    const timer = setInterval(() => setNow(Date.now()), every);

    return () => clearInterval(timer);
  }, [every]);

  return now;
};

const SECOND = 1000;

/** Working and a Reconnecting Host count seconds; "ended 2m ago" moves by the minute. */
const tickFor = (input: Omit<ActivityInput, "now">) => {
  if (input.host.state !== "connected") return SECOND;

  if (input.state === "working" || input.state === "starting") return SECOND;

  return input.turn?.endedAt === null || input.turn === null ? null : 30 * SECOND;
};

const Title = ({ title, attention }: { readonly title: Phrase; readonly attention: boolean }) => (
  <span
    className={cn("text-label truncate", attention ? "text-needs-you-text" : "text-text-strong")}
    data-testid="rail-activity"
  >
    {title.text}
    {title.code === null ? null : (
      <span className="text-code-inline font-mono font-normal">{title.code}</span>
    )}
  </span>
);

const Glyph = ({ shown, model }: { readonly shown: Activity; readonly model: SessionModel }) => {
  const session = model.session;

  if (shown.glyph === "connection") return <ReloadIcon size={12} />;

  return session === null ? null : (
    <SessionGlyph state={session.state} harness={session.harness} size={12} />
  );
};

const useActivityInput = (
  hostKey: string,
  sessionId: SessionId,
  model: SessionModel
): Omit<ActivityInput, "now"> | null => {
  const host = useHost(hostKey);
  const entry = useApp((s) => s.hostModels[hostKey]?.sessions.get(sessionId));
  const session = model.session;

  if (session === null) return null;
  const latest = model.turns.at(-1)?.turn ?? null;
  const tasks = waitingOn(session);

  return {
    host: {
      label: host?.label ?? hostKey,
      state: host?.status.state ?? "connected",
      since: host?.status.since ?? 0,
    },
    harness: harnessName(session.harness),
    state: session.state,
    request: entry !== undefined && entry.pendingApprovals.length > 0 ? sessionLine(entry) : null,
    live: activityOf(model),
    waiting: tasks.length === 0 ? null : waitingPhrase(tasks),
    turn:
      latest === null
        ? null
        : {
            number: latest.userTurnNumber ?? latest.index + 1,
            startedAt: latest.startedAt,
            endedAt: latest.endedAt,
          },
    lastError: session.lastError,
    limitResetsAt: session.limitResetsAt ?? null,
  };
};

export const ActivityBlock = ({
  hostKey,
  sessionId,
  model,
}: {
  readonly hostKey: string;
  readonly sessionId: SessionId;
  readonly model: SessionModel;
}) => {
  const input = useActivityInput(hostKey, sessionId, model);
  const now = useNow(input === null ? null : tickFor(input));

  if (input === null) return null;
  const shown = activity({ ...input, now });
  const tasks = model.session === null ? [] : waitingOn(model.session);
  const title = <Title title={shown.title} attention={shown.attention} />;

  return (
    <div className={cn(ROW, "items-start pt-1.5 pb-3.5")}>
      <Slot className="pt-[3px]">
        <Glyph shown={shown} model={model} />
      </Slot>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {input.waiting === null || shown.glyph === "connection" ? (
          title
        ) : (
          <BackgroundTasksHover tasks={tasks} side="right">
            <span className="flex min-w-0" data-testid="rail-waiting">
              {title}
            </span>
          </BackgroundTasksHover>
        )}
        <span className="text-caption text-text-subtle truncate">{shown.sub}</span>
      </div>
    </div>
  );
};
