import { Schema } from "effect";
import { parseVersion } from "./version.ts";

export const INSTALL_ID_HEADER = "X-Polaris-Install-ID";

export const MACOS_VERSION_HEADER = "X-Polaris-macOS-Version";

const uuid = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;

const osVersion = /^\d{1,2}(?:[._]\d{1,3}){1,2}$/;

function macosVersion(headers: Headers) {
  const explicit = headers.get(MACOS_VERSION_HEADER) ?? "";

  if (osVersion.test(explicit)) return explicit.replaceAll("_", ".");

  const extracted = /Mac OS X (\d{1,2}(?:[._]\d{1,3}){1,2})(?:[;)\s]|$)/.exec(
    headers.get("user-agent") ?? ""
  )?.[1];

  return extracted ?? null;
}

export function requestEvent(
  request: Request,
  route: "update_check" | "download",
  version: string | null,
  status: number
) {
  const installId = request.headers.get(INSTALL_ID_HEADER) ?? "";
  const country = request.headers.get("x-vercel-ip-country") ?? "";

  return {
    _time: new Date().toISOString(),
    event: route,
    route: route === "update_check" ? "/api/update/darwin-arm64/[version]" : "/download/mac",
    version: version && parseVersion(version) ? version : null,
    arch: "arm64",
    macos_version: macosVersion(request.headers)?.replaceAll("_", ".") ?? null,
    install_id: uuid.test(installId) ? installId.toLowerCase() : null,
    country: /^[A-Z]{2}$/.test(country) ? country : null,
    status,
  };
}

export type RequestEvent = ReturnType<typeof requestEvent>;

const decodeIngest = Schema.decodeUnknownSync(
  Schema.Struct({ ingested: Schema.Number, failed: Schema.Number })
);

export async function ingestEvent(
  event: RequestEvent,
  env: Readonly<{
    AXIOM_TOKEN?: string | undefined;
    AXIOM_DATASET?: string | undefined;
  }> = { AXIOM_TOKEN: process.env.AXIOM_TOKEN, AXIOM_DATASET: process.env.AXIOM_DATASET },
  fetcher: typeof fetch = fetch
) {
  if (!env.AXIOM_TOKEN || !env.AXIOM_DATASET) {
    console.warn("Release request logging is unconfigured");

    return;
  }

  try {
    const response = await fetcher(
      `https://api.axiom.co/v1/ingest/${encodeURIComponent(env.AXIOM_DATASET)}`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${env.AXIOM_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify([event]),
        cache: "no-store",
        signal: AbortSignal.timeout(5_000),
      }
    );

    if (!response.ok) throw new Error("Ingest rejected");
    const receipt = decodeIngest(await response.json());

    if (receipt.ingested !== 1 || receipt.failed !== 0) throw new Error("Ingest rejected");
  } catch {
    console.warn("Release request logging failed");
  }
}
