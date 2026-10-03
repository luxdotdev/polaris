import { after } from "next/server";
import { latestRelease, releaseAsset, type PublishedRelease } from "./releases.ts";
import { ingestEvent, requestEvent, type RequestEvent } from "./telemetry.ts";
import { compareVersions, parseVersion } from "./version.ts";

interface Dependencies {
  latest: () => Promise<PublishedRelease | null>;
  schedule: (callback: () => Promise<void>) => void;
  log: (event: RequestEvent) => Promise<void>;
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

export function createReleaseRoutes(deps: Dependencies) {
  function logged(
    request: Request,
    route: "update_check" | "download",
    version: string | null,
    response: Response
  ) {
    const event = requestEvent(request, route, version, response.status);
    deps.schedule(() => deps.log(event));

    return response;
  }

  async function updateResponse(version: string) {
    const caller = parseVersion(version);

    if (!caller)
      return Response.json({ error: "Use a valid semantic version." }, { status: 400, headers });

    try {
      const release = await deps.latest();

      if (!release || compareVersions(caller, release.version) >= 0)
        return new Response(null, { status: 204, headers });

      return Response.json(
        {
          url: releaseAsset(release, "zip"),
          name: release.name ?? release.tag_name,
          notes: release.body ?? "",
          pub_date: release.published_at,
        },
        { headers }
      );
    } catch {
      return unavailable();
    }
  }

  return {
    async update(this: void, request: Request, context: { params: Promise<{ version: string }> }) {
      const { version } = await context.params;

      return logged(request, "update_check", version, await updateResponse(version));
    },
    async download(this: void, request: Request) {
      let response: Response;

      try {
        const release = await deps.latest();
        response = release
          ? new Response(null, {
              status: 307,
              headers: { ...headers, Location: releaseAsset(release, "dmg") },
            })
          : unavailable();
      } catch {
        response = unavailable();
      }

      return logged(request, "download", null, response);
    },
  };
}

export const releaseRoutes = createReleaseRoutes({
  latest: latestRelease,
  schedule: after,
  log: ingestEvent,
});
