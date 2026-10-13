import type {
  CapabilityReport,
  PlacementInput,
  PredictionSide,
  PredictionTarget,
} from "./types.ts";

const GiB = 1024 ** 3;

const smallModel = /qwen[\W_]*2[._-]?5[\W_]*coder[\W_]*1[._-]?5b/i;

const mediumModel = /mellum[\W_]*2.*12b.*a2[._-]?5b/i;

/** Polaris knows how to prompt these models without a chosen format. */
export const promptableModel = (model: string) => mediumModel.test(model) || smallModel.test(model);

const tierOf = (ramBytes: number) => (ramBytes >= 16 * GiB ? 2 : 1);

/** A Host serves completion only with 8 GB or more and not on a Raspberry Pi-class chip. */
export const hostCanServe = (machine: CapabilityReport["machine"]) =>
  machine.ramBytes >= 8 * GiB && !/raspberry|cortex-a72|bcm27/i.test(machine.chip);

const targets = (
  side: PredictionSide,
  report: CapabilityReport | null,
  input: PlacementInput
): PredictionTarget[] => {
  if (report === null) return [];

  if (side === "host" && !hostCanServe(report.machine)) return [];
  const tier = tierOf(report.machine.ramBytes);
  const models = tier === 2 ? mediumModel : smallModel;

  return report.endpoints.flatMap((endpoint) => {
    const model = input.model
      ? endpoint.models.find((name) => name === input.model)
      : endpoint.models.find((name) => models.test(name));

    if (!model) return [];

    if (!input.format && !mediumModel.test(model) && !smallModel.test(model)) return [];
    const format = input.format ?? (mediumModel.test(model) ? "mellum-spm" : "qwen-fim");
    const p50 = input.latency?.(side, endpoint) ?? null;
    const p50Ms = p50 !== null && Number.isFinite(p50) && p50 >= 0 ? p50 : null;

    return [{ side, endpoint, model, format, tier, p50Ms }];
  });
};

/** RAM tier first, then measured latency. Equal or unmeasured sides prefer the Client. */
export const scorePlacement = (input: PlacementInput): ReadonlyArray<PredictionTarget> => {
  if (input.override === "off") return [];

  const sides: ReadonlyArray<PredictionSide> =
    input.override === "auto" ? ["client", "host"] : [input.override];

  return sides
    .flatMap((side) => targets(side, input[side], input))
    .sort(
      (a, b) =>
        b.tier - a.tier ||
        (a.p50Ms !== null && b.p50Ms !== null ? a.p50Ms - b.p50Ms : 0) ||
        (a.side === b.side ? 0 : a.side === "client" ? -1 : 1)
    );
};
