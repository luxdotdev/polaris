export function classify(value: number): "low" | "mid" | "high" {
  if (value < 10) return "low";
  if (value < 100) return "mid";
  return "high";
}
