/** Whether to keep the UI still: the app's Motion setting, else the system's Reduce Motion. */
export function reducedMotion(): boolean {
  const setting = document.documentElement.dataset.reduceMotion;

  if (setting !== undefined) return setting === "true";

  return matchMedia("(prefers-reduced-motion: reduce)").matches;
}
