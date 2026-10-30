/** The native half of the aggregate Live Activity (docs/adr/0088). */
import { type EventSubscription, requireOptionalNativeModule } from "expo";

interface PolarisLiveActivityNative {
  enabled(): boolean;
  /**
   * Starts the activity with each Host's slice JSON, sealed natively, or adopts the live one;
   * its id, or null below iOS 17.2 or before the push key exists.
   */
  start(slices: ReadonlyArray<string>): Promise<string | null>;
  /** `timestamp` in Unix seconds; `alert` lights the screen for a Needs You. */
  update(slices: ReadonlyArray<string>, timestamp: number, alert: boolean): Promise<void>;
  end(): Promise<void>;
  /** The live activity's update token, lowercase hex, once APNs has issued it. */
  pushToken(): string | null;
  /** The takeover's answers not yet taken: `{hostId, sessionId, requestId, decision}`. */
  takeAnswers(): ReadonlyArray<unknown>;
  /** Lets the intent that asked return: `id` is `<hostId>:<requestId>`. */
  answered(id: string): void;
  addListener(
    event: "pushToken",
    listener: (event: { activityId: string; token: string }) => void
  ): EventSubscription;
  addListener(
    event: "pushToStartToken",
    listener: (event: { token: string }) => void
  ): EventSubscription;
  addListener(event: "answer", listener: () => void): EventSubscription;
}

/** Null where ActivityKit isn't built in (Android, an old dev client). */
export const PolarisLiveActivity =
  requireOptionalNativeModule<PolarisLiveActivityNative>("PolarisLiveActivity");
