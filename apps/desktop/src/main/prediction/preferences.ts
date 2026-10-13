import { Schema } from "effect";
import {
  DEFAULT_PREDICTION_PREFERENCES,
  PredictionPreferences,
  PredictionClientEndpoints,
} from "../../shared/predictionPlacement.ts";
import type { Settings } from "../settings.ts";

export class PredictionSettings {
  constructor(
    private readonly read: () => Settings,
    private readonly commit: (settings: Settings) => void
  ) {}

  getClientEndpoints(): PredictionClientEndpoints {
    return this.read().predictionClientEndpoints ?? [];
  }

  setClientEndpoints(endpoints: PredictionClientEndpoints): PredictionClientEndpoints {
    const validated = Schema.decodeUnknownSync(PredictionClientEndpoints)(endpoints);
    this.commit({ ...this.read(), predictionClientEndpoints: validated });

    return validated;
  }

  get(hostKey: string): PredictionPreferences {
    return this.read().prediction?.[hostKey] ?? DEFAULT_PREDICTION_PREFERENCES;
  }

  set(hostKey: string, preferences: PredictionPreferences): PredictionPreferences {
    const validated = Schema.decodeUnknownSync(PredictionPreferences)(preferences);
    this.commit({
      ...this.read(),
      prediction: { ...this.read().prediction, [hostKey]: validated },
    });

    return validated;
  }
}
