/**
 * `polaris://` links, the Raycast extension's contract: `polaris://session/<hostId>/<sessionId>`
 * and `polaris://workspace/<hostId>/<workspaceId>`, ids percent-encoded. A link only navigates.
 */
import { HostId, SessionId, WorkspaceId } from "@polaris/protocol";
import { Option, Schema } from "effect";

export const DEEP_LINK_SCHEME = "polaris";

const MAX_LINK_LENGTH = 2048;

/** One path segment, decoded: not empty, no slash or control characters. */
const segment = <S extends Schema.Codec<string, string>>(id: S) =>
  id.check(Schema.isMaxLength(256), Schema.isPattern(/^[^/\p{Cc}]+$/u));

const decodeSegments = Schema.decodeUnknownOption(
  Schema.Union([
    Schema.Tuple([Schema.Literal("session"), segment(HostId), segment(SessionId)]),
    Schema.Tuple([Schema.Literal("workspace"), segment(HostId), segment(WorkspaceId)]),
  ])
);

export type DeepLink =
  | { readonly target: "session"; readonly hostId: HostId; readonly sessionId: SessionId }
  | { readonly target: "workspace"; readonly hostId: HostId; readonly workspaceId: WorkspaceId };

export type ParsedDeepLink = { readonly link: DeepLink } | { readonly ignored: string };

const ignored = (reason: string): ParsedDeepLink => ({ ignored: reason });

const decodeComponents = (parts: ReadonlyArray<string>): Option.Option<ReadonlyArray<string>> => {
  try {
    return Option.some(parts.map(decodeURIComponent));
  } catch {
    return Option.none();
  }
};

type Parts = { readonly parts: Array<string> } | { readonly ignored: string };

/** The URL's parts, `[target, hostId, id]`, or why the link isn't one Polaris opens. */
const partsOf = (text: string): Parts => {
  if (text.length > MAX_LINK_LENGTH) return { ignored: "too long" };
  const url = URL.parse(text);

  if (url === null || url.protocol !== `${DEEP_LINK_SCHEME}:`) {
    return { ignored: "not a polaris:// link" };
  }

  if (url.username !== "" || url.password !== "" || url.port !== "") {
    return { ignored: "unexpected authority" };
  }

  if (url.search !== "" || url.hash !== "") return { ignored: "unexpected query or fragment" };
  const path = url.pathname.split("/").slice(1);

  // One trailing slash is tolerated: `polaris://session/h/s/`.
  if (path.at(-1) === "") path.pop();

  return { parts: [url.hostname.toLowerCase(), ...path] };
};

/** Parses a link from the OS; anything but the two shapes above is ignored, with the reason. */
export const parseDeepLink = (text: string): ParsedDeepLink => {
  const parts = partsOf(text);

  if ("ignored" in parts) return parts;
  const decoded = decodeComponents(parts.parts);

  if (Option.isNone(decoded)) return ignored("malformed percent-encoding");
  const segments = decodeSegments(decoded.value);

  if (Option.isNone(segments)) return ignored("not a session or workspace link");
  const value = segments.value;

  return value[0] === "session"
    ? { link: { target: value[0], hostId: value[1], sessionId: value[2] } }
    : { link: { target: value[0], hostId: value[1], workspaceId: value[2] } };
};

/** The first `polaris://` argument: how Windows and Linux hand a link to the app. */
export const deepLinkArg = (argv: ReadonlyArray<string>): string | null =>
  argv.find((arg) => arg.toLowerCase().startsWith(`${DEEP_LINK_SCHEME}://`)) ?? null;
