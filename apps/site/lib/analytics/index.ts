import { track as vercelTrack } from "@vercel/analytics/server";
import { after } from "next/server";

export type AnalyticsValue = string | number | boolean | null;

export type Track = (
  name: string,
  properties: Record<string, AnalyticsValue>,
  options: { headers: Record<string, string> }
) => Promise<void>;

export interface AnalyticsOptions {
  readonly schedule: (task: () => Promise<void>) => void;
  readonly track: Track;
}

const defaults = (): AnalyticsOptions => ({ schedule: after, track: vercelTrack });

/**
 * Records a Vercel Web Analytics event after the response is sent. Only the
 * User-Agent goes along as session context: never the IP, cookies or other headers.
 */
export function trackAfter(
  request: Request,
  name: string,
  properties: Record<string, AnalyticsValue>,
  overrides: Partial<AnalyticsOptions> = {}
): void {
  const options = { ...defaults(), ...overrides };
  const headers = { "user-agent": request.headers.get("user-agent") ?? "" };

  try {
    options.schedule(async () => {
      try {
        await options.track(name, properties, { headers });
      } catch {
        console.warn(`analytics: ${name} was not recorded`);
      }
    });
  } catch {
    console.warn(`analytics: ${name} could not be scheduled`);
  }
}
