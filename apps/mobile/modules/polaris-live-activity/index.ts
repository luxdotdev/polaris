/** The native half of the aggregate Live Activity (docs/adr/0088). */
import { type EventSubscription, requireOptionalNativeModule } from "expo";

/** `{ v: 1, slices }`: each followed Host's sealed slice, ordered by Host relay address. */
export interface LiveContentState {
  readonly v: 1;
  readonly slices: ReadonlyArray<string>;
}

interface PolarisLiveActivityNative {
  enabled(): boolean;
  /** Starts the activity, or adopts the live one; its id, or null below iOS 17.2. */
  start(state: string): Promise<string | null>;
  /** `timestamp` in Unix seconds; `alert` lights the screen for a Needs You. */
  update(state: string, timestamp: number, alert: boolean): Promise<void>;
  end(): Promise<void>;
  addListener(
    event: "pushToken",
    listener: (event: { activityId: string; token: string }) => void
  ): EventSubscription;
  addListener(
    event: "pushToStartToken",
    listener: (event: { token: string }) => void
  ): EventSubscription;
}

/** Null where ActivityKit isn't built in (Android, an old dev client). */
export const PolarisLiveActivity =
  requireOptionalNativeModule<PolarisLiveActivityNative>("PolarisLiveActivity");
