/** The constellation header's star chart (MX-W), compressing to dots past about 30 tasks (MX-X). */
import { useState } from "react";
import { type LayoutChangeEvent, View } from "react-native";
import { DotChart } from "./DotChart.tsx";
import { isCompact } from "./layout.ts";
import type { StarChartProps } from "./types.ts";
import { WaveChart } from "./WaveChart.tsx";

/** Fits its container's width: no scrolling or pinch-zoom; the waves wrap instead. */
export const StarChart = ({
  tasks,
  bands,
  compact,
  selectedTaskId = null,
  onPressTask,
}: StarChartProps) => {
  const [width, setWidth] = useState<number | null>(null);
  const onLayout = (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width);

  if (isCompact(tasks, compact))
    return (
      <DotChart
        tasks={tasks}
        bands={bands}
        selectedTaskId={selectedTaskId}
        onPressTask={onPressTask}
      />
    );

  return (
    <View onLayout={onLayout}>
      {width === null ? null : (
        <WaveChart
          tasks={tasks}
          bands={bands}
          width={width}
          selectedTaskId={selectedTaskId}
          onPressTask={onPressTask}
        />
      )}
    </View>
  );
};
