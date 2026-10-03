import { errorInfo, withWideEvent, type ErrorInfo, type WideEvent } from "../../../../lib/log";
import { latestRelease, releaseAsset, type PublishedRelease } from "./releases.ts";
import { requestFields } from "./telemetry.ts";
import { compareVersions, parseVersion } from "./version.ts";

type WideEventOptions = NonNullable<Parameters<typeof withWideEvent>[2]>;

interface Dependencies {
  latest: () => Promise<PublishedRelease | null>;
  /** Overrides for the wide event's scheduling, emission, environment and clock (tests). */
  log?: WideEventOptions;
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
  async function release(event: WideEvent) {
    const found = await deps.latest();
    event.release_version = found ? found.tag_name : null;

    if (!found) event.failure = "no_release";

    return found;
  }

  function failed(error: ErrorInfo, event: WideEvent) {
    event.failure = "release_unavailable";
    event.error = error;

    return unavailable();
  }

  async function updateResponse(version: string, event: WideEvent) {
    const caller = parseVersion(version);

    if (!caller) {
      event.rejection = "invalid_version";

      return Response.json({ error: "Use a valid semantic version." }, { status: 400, headers });
    }

    try {
      const latest = await release(event);

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
        : unavailable();
    } catch (error) {
      return failed(errorInfo(error), event);
    }
  }

  return {
    update: withWideEvent<{ params: Promise<{ version: string }> }>(
      UPDATE_ROUTE,
      async (request, event, context) => {
        const { version } = await context.params;
        Object.assign(event, requestFields(request, "update_check", version));

        return updateResponse(version, event);
      },
      deps.log
    ),
    download: withWideEvent<unknown>(
      DOWNLOAD_ROUTE,
      async (request, event) => {
        Object.assign(event, requestFields(request, "download", null));

        return downloadResponse(event);
      },
      deps.log
    ),
  };
}

export const releaseRoutes = createReleaseRoutes({ latest: latestRelease });
