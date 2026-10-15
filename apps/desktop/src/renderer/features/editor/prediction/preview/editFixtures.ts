/** The Paper EP1–EP6a fixtures: score.ts as the artboards show it, one variant and placement per scene. */
import type { PredictedEdit } from "@polaris/protocol";
import {
  DEFAULT_PREDICTION_PREFERENCES,
  type PredictionPreferences,
} from "../../../../../shared/predictionPlacement.ts";
import { path } from "../../preview/fixtures.ts";
import type { EditPhase } from "../edit/index.ts";

export const SCORE_PATH = path("client/src/prediction/score.ts");

const HEAD = `import type {
  CapabilityReport,
  PlacementInput,
  PredictionSide,
  PredictionTarget,
} from "./types.ts";

const GiB = 1024 ** 3;

const smallModel = /qwen[\\W_]*2[._-]?5[\\W_]*coder[\\W_]*1[._-]?5b/i;

const mediumModel = /mellum[\\W_]*2.*12b.*a2[._-]?5b/i;

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
`;

const TAIL = `      ? endpoint.models.find((name) => name === input.model)
      : endpoint.models.find((name) => models.test(name));

    if (!model || editModelFormat(model) !== null) return [];

    if (input.format === "zeta-2.1" || input.format === "sweep-next-edit") return [];

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

  const edits =
    input.mode === "complete"
      ? []
      : sides
          .filter(
            (side) => side === "client" || (input.host !== null && hostCanServe(input.host.machine))
          )
          .flatMap((side) => editTargets(side, input[side], input));

  const candidates =
    edits.length > 0 || input.mode === "edit"
      ? edits
      : sides.flatMap((side) => targets(side, input[side], input));

  return candidates.sort(
    (a, b) =>
      b.tier - a.tier ||
      (a.p50Ms !== null && b.p50Ms !== null ? a.p50Ms - b.p50Ms : 0) ||
      (a.side === b.side ? 0 : a.side === "client" ? -1 : 1)
  );
};
`;

const BASE = HEAD + TAIL;

const swap = (doc: string, from: string, to: string) => {
  if (!doc.includes(from)) throw new Error(`fixture lacks ${JSON.stringify(from)}`);

  return doc.replace(from, to);
};

const at = (doc: string, needle: string, offset = 0) => {
  const index = doc.indexOf(needle);

  if (index < 0) throw new Error(`fixture lacks ${JSON.stringify(needle)}`);

  return index + offset;
};

const lineEnd = (doc: string, needle: string) => doc.indexOf("\n", at(doc, needle));

const lineStart = (doc: string, needle: string) => doc.lastIndexOf("\n", at(doc, needle)) + 1;

export interface Placed {
  readonly cursor: number;
  readonly hunks: ReadonlyArray<PredictedEdit>;
  /** The cursor when the prediction was requested; defaults to `cursor`. */
  readonly anchor?: number;
  readonly phase?: EditPhase;
  /** v1 ghost text at the cursor instead of an Edit Prediction. */
  readonly ghost?: string;
  /** An import Edit Prediction with the server's title, and the diagnostic it fixes. */
  readonly import?: {
    readonly title: string;
    readonly diagnostic: { readonly from: number; readonly to: number; readonly message: string };
  };
}

export interface EditScene {
  readonly doc: string;
  readonly preferences: PredictionPreferences;
  readonly altHeld?: boolean;
  readonly place: (doc: string) => Placed;
}

const FULL = DEFAULT_PREDICTION_PREFERENCES;

const SUBTLE: PredictionPreferences = { ...DEFAULT_PREDICTION_PREFERENCES, display: "subtle" };

const RENAMED_TIER = swap(BASE, "const tierOf = (ramBytes", "const ramTier = (ramBytes");

const RENAMED_SMALL = swap(BASE, "const smallModel = /qwen", "const qwenModel = /qwen");

const replaceTierOf = (doc: string): Placed => {
  const cursor = at(doc, "tierOf(report");

  return { cursor, hunks: [{ from: cursor, to: cursor + 6, text: "ramTier" }] };
};

const replaceSmallModel = (doc: string, needle: string) => {
  const from = at(doc, needle, needle.startsWith("!") ? 1 : 0);

  return { from, to: from + "smallModel".length, text: "qwenModel" };
};

const DELETE_IMPORT = '} from "./types.ts";\nimport { hostCanServe } from "./probe.ts";\nconst GiB';

const LARGE_IMPORT =
  '} from "./types.ts";\nimport { hostCanServe, promptableModel, tierOf } from "./probe.ts";\nconst GiB';

const LOCAL_HOST_CAN_SERVE = `/** A Host serves completion only with 8 GB or more and not on a Raspberry Pi-class chip. */
export const hostCanServe = (machine: CapabilityReport["machine"]) =>
  machine.ramBytes >= 8 * GiB && !/raspberry|cortex-a72|bcm27/i.test(machine.chip);

`;

const placeImport = (doc: string): Placed => {
  const from = at(doc, "hostCanServe(report");

  return {
    cursor: lineEnd(doc, "hostCanServe(report"),
    hunks: [
      {
        from: lineStart(doc, "\nconst GiB"),
        to: lineStart(doc, "\nconst GiB"),
        text: 'import { hostCanServe } from "./probe.ts";\n',
      },
    ],
    import: {
      title: 'Add import from "./probe.ts"',
      diagnostic: {
        from,
        to: from + "hostCanServe".length,
        message: "Cannot find name 'hostCanServe'.",
      },
    },
  };
};

const SCENES = {
  replace: { doc: RENAMED_TIER, preferences: FULL, place: replaceTierOf },
  multiline: {
    doc: swap(
      BASE,
      "smallModel.test(model);\n\n",
      "smallModel.test(model);\nconst zetaModel = /zeta[\\W_]*2[._-]?1/i;\n\n"
    ),
    preferences: FULL,
    place: (doc) => ({
      cursor: lineEnd(doc, "const zetaModel"),
      hunks: [
        {
          from: lineStart(doc, "export const promptableModel"),
          to: lineEnd(doc, "export const promptableModel") + 1,
          text: "export const promptableModel = (model: string) =>\n  mediumModel.test(model) || smallModel.test(model) || zetaModel.test(model);\n",
        },
      ],
    }),
  },
  delete: {
    doc: swap(BASE, '} from "./types.ts";\n\nconst GiB', DELETE_IMPORT),
    preferences: FULL,
    place: (doc) => {
      const from = lineStart(doc, "/** A Host serves");

      return {
        cursor: from,
        hunks: [{ from, to: lineEnd(doc, "machine.ramBytes >= 8 * GiB") + 1, text: "" }],
      };
    },
  },
  "delete-large": {
    doc: swap(BASE, '} from "./types.ts";\n\nconst GiB', LARGE_IMPORT),
    preferences: FULL,
    place: (doc) => {
      const from = lineStart(doc, "/** Polaris knows");

      return {
        cursor: from,
        phase: "armed",
        hunks: [{ from, to: lineEnd(doc, "machine.ramBytes >= 8 * GiB") + 2, text: "" }],
      };
    },
  },
  jump: {
    doc: RENAMED_SMALL,
    preferences: FULL,
    place: (doc) => ({
      cursor: lineEnd(doc, "const qwenModel"),
      hunks: [replaceSmallModel(doc, "smallModel.test(model);")],
    }),
  },
  "jump-offscreen": {
    doc: swap(
      swap(RENAMED_SMALL, "|| smallModel.test(model);", "|| qwenModel.test(model);"),
      "mediumModel : smallModel;",
      "mediumModel : qwenModel;"
    ),
    preferences: FULL,
    place: (doc) => ({
      cursor: lineEnd(doc, "mediumModel : qwenModel;"),
      hunks: [replaceSmallModel(doc, "!smallModel.test(model)")],
    }),
  },
  jumped: {
    doc: RENAMED_SMALL,
    preferences: FULL,
    place: (doc) => {
      const hunk = replaceSmallModel(doc, "smallModel.test(model);");

      return {
        cursor: hunk.from,
        anchor: lineEnd(doc, "const qwenModel"),
        phase: "jumped",
        hunks: [hunk],
      };
    },
  },
  subtle: { doc: RENAMED_TIER, preferences: SUBTLE, place: replaceTierOf },
  "subtle-held": {
    doc: RENAMED_SMALL,
    preferences: SUBTLE,
    altHeld: true,
    place: (doc) => {
      const hunk = replaceSmallModel(doc, "smallModel.test(model);");

      return { cursor: hunk.from, hunks: [hunk] };
    },
  },
  insert: {
    doc: BASE,
    preferences: FULL,
    place: (doc) => ({
      cursor: lineEnd(doc, "mediumModel : smallModel;"),
      hunks: [],
      ghost: " // tier 2 needs 16 GB",
    }),
  },
  import: { doc: swap(BASE, LOCAL_HOST_CAN_SERVE, ""), preferences: FULL, place: placeImport },
  "import-subtle": {
    doc: swap(BASE, LOCAL_HOST_CAN_SERVE, ""),
    preferences: SUBTLE,
    place: placeImport,
  },
} satisfies Record<string, EditScene>;

export const EDIT_SCENES = new Map<string, EditScene>(Object.entries(SCENES));
