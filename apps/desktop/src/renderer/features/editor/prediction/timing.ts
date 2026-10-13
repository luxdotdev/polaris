/** Bounded marks for the latest Editor request; no timers, text or background work. */
export const markPrediction = (stage: string, detail?: Readonly<Record<string, number>>) => {
  const name = `polaris.prediction.${stage}`;
  performance.clearMarks(name);
  performance.mark(name, { detail });
};
