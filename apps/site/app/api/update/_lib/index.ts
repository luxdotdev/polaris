import { Predicate } from "effect";
import { trackAfter, type AnalyticsOptions } from "../../../../lib/analytics";
import { errorInfo, withWideEvent, type ErrorInfo, type WideEvent } from "../../../../lib/log";
import {
  latestRelease,
  releaseAsset,
  releasesPage,
  requestChannel,
  CHANNEL_ERROR,
  type Channel,
  type PublishedRelease,
} from "./releases.ts";
import { requestFields } from "./telemetry.ts";
import { compareVersions, parseVersion } from "./version.ts";

type WideEventOptions = NonNullable<Parameters<typeof withWideEvent>[2]>;

interface Dependencies {
  /** The channel's Release; downloads always ask for stable. */
  latest: (channel: Channel) => Promise<PublishedRelease | null>;
  /** Overrides for the wide event's scheduling, emission, environment and clock (tests). */
  log?: WideEventOptions;
  /** Overrides for the Vercel Analytics event (tests). */
  analytics?: Partial<AnalyticsOptions>;
}

const headers = { "Cache-Control": "no-store" };

const unavailable = () =>
  Response.json(
    { error: "The latest release is unavailable. Try again shortly." },
    {
      status: 503,
      headers: { ...headers, "Retry-After": "60" },
    }
  );

const UPDATE_ROUTE = "/api/update/darwin-arm64/[version]";

const DOWNLOAD_ROUTE = "/download/mac";

export function createReleaseRoutes(deps: Dependencies) {
  async function release(event: WideEvent, channel: Channel = "stable") {
    const found = await deps.latest(channel);
    event.release_version = found ? found.tag_name : null;

    if (!found) event.failure = "no_release";

    return found;
  }

  function failed(error: ErrorInfo, event: WideEvent) {
    event.failure = "release_unavailable";
    event.error = error;

    return unavailable();
  }

  async function updateResponse(version: string, channel: Channel | null, event: WideEvent) {
    const caller = parseVersion(version);

    if (!caller) {
      event.rejection = "invalid_version";

      return Response.json({ error: "Use a valid semantic version." }, { status: 400, headers });
    }

    if (!channel) {
      event.rejection = "invalid_channel";

      return Response.json({ error: CHANNEL_ERROR }, { status: 400, headers });
    }

    try {
      const latest = await release(event, channel);

      // Never lower than the caller: a nightly caller on Stable waits for a newer Stable Release.
      if (!latest || compareVersions(caller, latest.version) >= 0) {
        event.update = "current";

        return new Response(null, { status: 204, headers });
      }

      event.update = "available";

      return Response.json(
        {
          url: releaseAsset(latest, "zip"),
          name: latest.name ?? latest.tag_name,
          notes: latest.body ?? "",
          pub_date: latest.published_at,
        },
        { headers }
      );
    } catch (error) {
      return failed(errorInfo(error), event);
    }
  }

  async function downloadResponse(event: WideEvent) {
    try {
      const latest = await release(event);

      return latest
        ? new Response(null, {
            status: 307,
            headers: { ...headers, Location: releaseAsset(latest, "dmg") },
          })
        : releasesPage();
    } catch (error) {
      failed(errorInfo(error), event);

      return releasesPage();
    }
  }

  return {
    update: withWideEvent<{ params: Promise<{ version: string }> }>(
      UPDATE_ROUTE,
      async (request, event, context) => {
        const { version } = await context.params;
        const channel = requestChannel(request);
        Object.assign(event, requestFields(request, "update_check", version), { channel });

        return updateResponse(version, channel, event);
      },
      deps.log
    ),
    download: withWideEvent<unknown>(
      DOWNLOAD_ROUTE,
      async (request, event) => {
        Object.assign(event, requestFields(request, "download", null));
        const response = await downloadResponse(event);
        trackAfter(
          request,
          "download",
          {
            platform: "darwin",
            arch: "arm64",
            release_version: Predicate.isString(event.release_version)
              ? event.release_version
              : null,
          },
          deps.analytics
        );

        return response;
      },
      deps.log
    ),
  };
}

export const releaseRoutes = createReleaseRoutes({ latest: latestRelease });
