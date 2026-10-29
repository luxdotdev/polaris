/**
 * "View all tasks" (Paper MX-X): every task as the rail's rows in an instrument sheet, where a
 * handed-up claim keeps its Accept and Send back; tapping a task opens its task sheet.
 */
import { claimChoices, taskKey, useKept } from "../../duo/kept.ts";
import { InstrumentSheet, SheetHeader } from "../../sheet/index.tsx";
import type { ConstellationView } from "../model.ts";
import { GroupHeader, TaskRowView } from "../rows.tsx";
import type { Verdicts } from "../useVerdicts.ts";

export interface TasksSheetProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly view: ConstellationView;
  readonly verdicts: Verdicts;
  readonly hostId: string;
  readonly constellationId: string;
  readonly onToggleGroup: (group: string, open: boolean) => void;
  readonly onPressTask: (taskId: string) => void;
}

const Rail = ({
  view,
  verdicts,
  keyOf,
  onToggleGroup,
  onPressTask,
}: Pick<TasksSheetProps, "view" | "verdicts" | "onToggleGroup" | "onPressTask"> & {
  readonly keyOf: (taskId: string) => string;
}) => {
  const [choices, setChoice] = useKept(claimChoices);

  return view.rows.map((row, i) => {
    if (row.kind === "group")
      return (
        <GroupHeader
          key={`group:${row.name}`}
          group={row}
          onToggle={() => onToggleGroup(row.name, !row.open)}
        />
      );

    const previous = view.rows[i - 1];

    return (
      <TaskRowView
        key={row.id}
        row={row}
        first={previous === undefined || previous.kind === "group"}
        last={i === view.rows.length - 1}
        delivery={verdicts.find(row)}
        onVerdict={verdicts.send(row)}
        onCancel={() => verdicts.cancel(row)}
        unsent={choices.get(keyOf(row.id)) ?? null}
        onUnsent={(next) => setChoice(keyOf(row.id), next)}
        onPress={() => onPressTask(row.id)}
      />
    );
  });
};

export const TasksSheet = ({
  open,
  onClose,
  view,
  verdicts,
  hostId,
  constellationId,
  onToggleGroup,
  onPressTask,
}: TasksSheetProps) => (
  <InstrumentSheet open={open} onClose={onClose} detents={["large"]}>
    <SheetHeader title="All tasks" kicker={view.bar.total} onClose={onClose} />
    <Rail
      view={view}
      verdicts={verdicts}
      keyOf={(taskId) => taskKey(hostId, constellationId, taskId)}
      onToggleGroup={onToggleGroup}
      onPressTask={onPressTask}
    />
  </InstrumentSheet>
);
