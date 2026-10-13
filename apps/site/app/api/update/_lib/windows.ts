import { trackAfter, type AnalyticsOptions } from "../../../../lib/analytics";
import { Predicate } from "effect";
import { errorInfo, withWideEvent, type WideEvent } from "../../../../lib/log";
import {
  latestRelease,
  releaseAssetNamed,
  releasesPage,
  windowsAssetName,
  type PublishedRelease,
  type WindowsArch,
} from "./releases.ts";
import { compareVersions, parseVersion } from "./version.ts";
import { requestFields } from "./telemetry.ts";

const headers = { "Cache-Control": "no-store" };

const unavailable = () =>
  Response.json(
    { error: "The latest release is unavailable. Try again shortly." },
    {
      status: 503,
      headers: { ...headers, "Retry-After": "60" },
    }
  );

/** Preserve Squirrel's hash and byte length; only a validated full-package URL reaches the Client. */
export const windowsReleases = (
  release: PublishedRelease,
  arch: WindowsArch,
  body: string
): string => {
  const name = windowsAssetName(release.version.text, arch, "nupkg");
  const line = /^([a-fA-F0-9]{40}) ([A-Za-z0-9._-]+) ([1-9]\d*)$/.exec(body.trim());

  if (line === null || line[2] !== name) throw new Error("Invalid Squirrel RELEASES");

  return `${line[1]} ${releaseAssetNamed(release, name)} ${line[3]}\n`;
};

export const windowsDownloadArch = (request: Request): WindowsArch | null => {
  const explicit = new URL(request.url).searchParams.get("arch");

  if (explicit !== null) return explicit === "x64" || explicit === "arm64" ? explicit : null;
  const hint = request.headers.get("sec-ch-ua-arch");

  if (hint === '"arm"' || hint === '"arm64"') return "arm64";

  return /\b(?:ARM64|aarch64)\b/i.test(request.headers.get("user-agent") ?? "") ? "arm64" : "x64";
};

interface Dependencies {
  readonly latest: () => Promise<PublishedRelease | null>;
  readonly fetch?: (url: string, init: RequestInit) => Promise<Response>;
  readonly log?: NonNullable<Parameters<typeof withWideEvent>[2]>;
  /** Overrides for the Vercel Analytics event (tests). */
  readonly analytics?: Partial<AnalyticsOptions>;
}

export const createWindowsRoutes = (deps: Dependencies) => ({
  releases: (arch: WindowsArch) =>
    withWideEvent<{ params: Promise<{ version: string }> }>(
      `/api/update/win32-${arch}/[version]/RELEASES`,
      async (request, event, context) => {
        const { version } = await context.params;
        Object.assign(
          event,
          requestFields(request, "update_check", version, { platform: "win32", arch })
        );
        const caller = parseVersion(version);

        if (!caller)
          return Response.json(
            { error: "Use a valid semantic version." },
            { status: 400, headers }
          );

        try {
          const release = await deps.latest();
          event.release_version = release?.tag_name ?? null;

          if (!release || compareVersions(caller, release.version) >= 0) {
            event.update = "current";

            return new Response(null, { status: 204, headers });
          }

          const url = releaseAssetNamed(
            release,
            windowsAssetName(release.version.text, arch, "releases")
          );

          const response = await (deps.fetch ?? fetch)(url, {
            cache: "no-store",
            signal: AbortSignal.timeout(5_000),
          });

          if (!response.ok) throw new Error("Squirrel manifest unavailable");
          const body = windowsReleases(release, arch, await response.text());
          event.update = "available";

          return new Response(body, {
            headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" },
          });
        } catch (error) {
          event.failure = "release_unavailable";
          event.error = errorInfo(error);

          return unavailable();
        }
      },
      deps.log
    ),
  download: withWideEvent<unknown>(
    "/download/windows",
    async (request, event) => {
      const arch = windowsDownloadArch(request);

      if (arch === null)
        return Response.json({ error: "Use arch=x64 or arch=arm64." }, { status: 400, headers });
      Object.assign(event, requestFields(request, "download", null, { platform: "win32", arch }));
      const response = await windowsDownload(deps, event, arch);
      trackAfter(
        request,
        "download",
        {
          platform: "win32",
          arch,
          release_version: Predicate.isString(event.release_version) ? event.release_version : null,
        },
        deps.analytics
      );

      return response;
    },
    deps.log
  ),
});

async function windowsDownload(deps: Dependencies, event: WideEvent, arch: WindowsArch) {
  try {
    const release = await deps.latest();
    event.release_version = release?.tag_name ?? null;

    if (!release) return releasesPage();

    const url = releaseAssetNamed(release, windowsAssetName(release.version.text, arch, "setup"));

    return new Response(null, { status: 307, headers: { ...headers, Location: url } });
  } catch (error) {
    event.failure = "release_unavailable";
    event.error = errorInfo(error);

    return releasesPage();
  }
}

export const windowsRoutes = createWindowsRoutes({ latest: latestRelease });
