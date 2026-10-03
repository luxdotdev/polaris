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

/** Allowlisted request fields for the wide event: no IP, raw User-Agent, query or headers. */
export function requestFields(
  request: Request,
  route: "update_check" | "download",
  version: string | null
) {
  const installId = request.headers.get(INSTALL_ID_HEADER) ?? "";
  const country = request.headers.get("x-vercel-ip-country") ?? "";

  return {
    event: route,
    version: version && parseVersion(version) ? version : null,
    arch: "arm64",
    macos_version: macosVersion(request.headers)?.replaceAll("_", ".") ?? null,
    install_id: uuid.test(installId) ? installId.toLowerCase() : null,
    country: /^[A-Z]{2}$/.test(country) ? country : null,
  };
}
