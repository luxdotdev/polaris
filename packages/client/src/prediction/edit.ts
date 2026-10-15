import type { EditPredictionFormat } from "@polaris/protocol";
import type {
  CapabilityReport,
  PlacementInput,
  PredictionSide,
  PredictionTarget,
} from "./types.ts";

/** Recognise endpoint model ids, including repository prefixes, quantisations and Ollama tags. */
export const editModelFormat = (model: string): EditPredictionFormat | null => {
  if (/zeta[\W_]*2[._-]?1/i.test(model)) return "zeta-2.1";

  if (/sweep.*next[\W_]*edit/i.test(model)) return "sweep-next-edit";

  return null;
};

export const editTargets = (
  side: PredictionSide,
  report: CapabilityReport | null,
  input: PlacementInput
): PredictionTarget[] => {
  if (report === null) return [];
  const ram = report.machine.ramBytes;

  const available = report.endpoints.flatMap((endpoint) =>
    endpoint.models.flatMap((model) => {
      const format = editModelFormat(model);

      if (format === null || (input.model && model !== input.model)) return [];
      const p50 = input.latency?.(side, endpoint) ?? null;

      return [
        {
          side,
          endpoint,
          model,
          format,
          tier: ram >= 16 * 1024 ** 3 ? 2 : 1,
          p50Ms: p50 !== null && Number.isFinite(p50) && p50 >= 0 ? p50 : null,
          managed: endpoint.managed === true,
        },
      ];
    })
  );

  if (input.model) return available;

  const preferred =
    ram >= 32 * 1024 ** 3 && available.some((target) => target.format === "zeta-2.1")
      ? "zeta-2.1"
      : "sweep-next-edit";

  return available.filter((target) => target.format === preferred);
};
