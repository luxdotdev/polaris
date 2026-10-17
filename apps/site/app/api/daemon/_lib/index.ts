import { Schema } from "effect";
import { trackAfter, type AnalyticsOptions } from "../../../../lib/analytics";
import { withWideEvent } from "../../../../lib/log";
import { INSTALL_ID_HEADER } from "../../update/_lib/telemetry.ts";
import { parseVersion } from "../../update/_lib/version.ts";

/** The Daemon platforms a Release carries, as `scripts/build-daemon.ts` names them. */
export const DAEMON_PLATFORMS = [
  "darwin-arm64",
  "linux-x64",
  "linux-arm64",
  "linux-x64-musl",
  "linux-arm64-musl",
  "windows-x64",
] as const;

export type DaemonPlatform = (typeof DAEMON_PLATFORMS)[number];

const isDaemonPlatform = Schema.is(Schema.Literals(DAEMON_PLATFORMS));

/** The Release asset holding one platform's Daemon (polaris and betterleaks). */
export const daemonAssetName = (version: string, platform: DaemonPlatform) =>
  `polaris-daemon-${version}-${platform}.tar.gz`;

export const daemonAssetUrl = (version: string, platform: DaemonPlatform) =>
  `https://github.com/luxdotdev/polaris/releases/download/v${version}/${daemonAssetName(version, platform)}`;

const headers = { "Cache-Control": "no-store" };

const DAEMON_ROUTE = "/api/daemon/[version]/[platform]";

interface Dependencies {
  /** Overrides for the wide event's scheduling, emission, environment and clock (tests). */
  readonly log?: NonNullable<Parameters<typeof withWideEvent>[2]>;
  /** Overrides for the Vercel Analytics event (tests). */
  readonly analytics?: Partial<AnalyticsOptions>;
}

const uuid = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;

function callerFields(request: Request) {
  const query = new URL(request.url).searchParams;
  const client = query.get("client") ?? "";
  const via = query.get("via");
  const installId = request.headers.get(INSTALL_ID_HEADER) ?? "";
  const country = request.headers.get("x-vercel-ip-country") ?? "";

  return {
    client_version: parseVersion(client) ? client : null,
    via: via === "host" || via === "client" ? via : null,
    install_id: uuid.test(installId) ? installId.toLowerCase() : null,
    country: /^[A-Z]{2}$/.test(country) ? country : null,
  };
}

function targetFields(platform: DaemonPlatform) {
  const [os, arch, libc] = platform.split("-");

  return { platform, os: os!, arch: arch!, libc: os === "linux" ? (libc ?? "gnu") : null };
}

const notFound = (error: string) => Response.json({ error }, { status: 404, headers });

export function createDaemonRoutes(deps: Dependencies = {}) {
  return {
    download: withWideEvent<{ params: Promise<{ version: string; platform: string }> }>(
      DAEMON_ROUTE,
      async (request, event, context) => {
        const params = await context.params;
        const caller = callerFields(request);
        const valid = parseVersion(params.version) !== null;

        Object.assign(event, {
          event: "daemon_download",
          version: valid ? params.version : null,
          platform: isDaemonPlatform(params.platform) ? params.platform : null,
          ...caller,
        });

        if (!valid) {
          event.rejection = "invalid_version";

          return Response.json(
            { error: "Use a valid semantic version." },
            { status: 400, headers }
          );
        }

        if (!isDaemonPlatform(params.platform)) {
          event.rejection = "unknown_platform";

          return notFound(`Daemons are published for ${DAEMON_PLATFORMS.join(", ")}.`);
        }

        const target = targetFields(params.platform);
        Object.assign(event, target);

        // Dev builds have no Release: the Desktop App bundles every platform for them.
        if (/-dev\./.test(params.version) || params.version.includes("+")) {
          event.rejection = "unreleased_version";

          return notFound("Development builds are not published.");
        }

        trackAfter(
          request,
          "daemon_download",
          {
            version: params.version,
            platform: target.platform,
            arch: target.arch,
            client_version: caller.client_version,
            via: caller.via,
          },
          deps.analytics
        );

        return new Response(null, {
          status: 307,
          headers: { ...headers, Location: daemonAssetUrl(params.version, params.platform) },
        });
      },
      deps.log
    ),
  };
}

export const daemonRoutes = createDaemonRoutes();
