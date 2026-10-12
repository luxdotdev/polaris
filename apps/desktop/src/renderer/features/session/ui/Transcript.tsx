/**
 * The conversation with what sits over it: the ⌘F find bar and, from three
 * Turns on, the Turn rail. Both bring a row into view through `reveal`.
 */
import type { SessionId } from "@polaris/protocol";
import { type RefObject, useEffect, useRef, useState } from "react";
import { useCommands } from "../../../shell/hooks.ts";
import type { TurnView } from "../../../store/sessionModel.ts";
import { olderRow, type Row, turnStartRow } from "../model/conversation.ts";
import { useOlderTurns } from "../older.ts";
import { RAIL_MIN_TURNS } from "../model/rail.ts";
import { setTurnOpen } from "../state.ts";
import { Conversation, type Reveal } from "./Conversation.tsx";
import type { RowContext } from "./rows.tsx";
import { TranscriptSearch } from "./TranscriptSearch.tsx";
import { createRowRange, TurnRail } from "./TurnRail.tsx";

/** ⌘F while this conversation is on screen; null while the find bar is closed. */
const useFind = (host: RefObject<HTMLDivElement | null>) => {
  const commands = useCommands();
  const [finding, setFinding] = useState<number | null>(null);

  useEffect(
    () =>
      commands.register({
        "transcript.find": {
          run: () => setFinding((n) => (n ?? 0) + 1),
          enabled: () => host.current?.checkVisibility() ?? false,
        },
      }),
    [commands, host]
  );

  return { finding, close: () => setFinding(null) };
};

export interface TranscriptProps {
  readonly uiKey: string;
  readonly hostKey: string;
  readonly sessionId: SessionId;
  /** The Host can page older Turns (`session.turn-paging`). */
  readonly canPage: boolean;
  readonly turns: ReadonlyArray<TurnView>;
  readonly rows: ReadonlyArray<Row>;
  /** The rows' context; the Transcript adds paging (`onLoadOlder`). */
  readonly ctx: Omit<RowContext, "onLoadOlder">;
}

export const Transcript = (props: TranscriptProps) => {
  const { uiKey, turns } = props;
  const host = useRef<HTMLDivElement>(null);
  const find = useFind(host);
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const [range] = useState(createRowRange);
  const rail = turns.length >= RAIL_MIN_TURNS;
  const older = useOlderTurns({ ...props, enabled: props.canPage });
  const rows = older.state === null ? props.rows : [olderRow(older.state), ...props.rows];
  const ctx: RowContext = { ...props.ctx, onLoadOlder: older.load };

  // Reaching the top loads the Turns before the first one shown.
  useEffect(
    () =>
      range.subscribe((start) => {
        if (start === 0 && older.state === "idle") older.load();
      }),
    [range, older]
  );

  const revealRow = (key: string, align: "center" | "start") =>
    setReveal((r) => ({ key, nonce: (r?.nonce ?? 0) + 1, align }));

  return (
    <div ref={host} className="relative flex min-h-0 flex-1 flex-col">
      <Conversation
        scrollKey={uiKey}
        rows={rows}
        ctx={ctx}
        reveal={reveal}
        onRange={range.emit}
        gutter={rail}
        firstTurnId={turns[0]?.turn.id ?? null}
      />
      {rail ? (
        <TurnRail
          turns={turns}
          rows={rows}
          range={range}
          onJump={(turnId) => {
            const row = rows[turnStartRow(rows, turnId)];

            if (row !== undefined) revealRow(row.key, "start");
          }}
        />
      ) : null}
      {find.finding === null ? null : (
        <TranscriptSearch
          turns={turns}
          host={host.current}
          focusNonce={find.finding}
          onReveal={(hit) => {
            setTurnOpen(uiKey, hit.turnId, true);
            revealRow(hit.rowKey, "center");
          }}
          onClose={find.close}
        />
      )}
    </div>
  );
};
