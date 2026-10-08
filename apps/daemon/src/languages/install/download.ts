import { checkAbort, failure } from "./validation.ts";
import { defaultLimits, type ExactArtifact } from "./types.ts";

export type ArtifactFetch = (url: string, init: RequestInit) => Promise<Response>;

/** Runs on the file's Host. A relay may implement this port; it must honor identity bytes and abort. */
export function httpsArtifactDownload(
  fetchArtifact: ArtifactFetch,
  maxBytes = defaultLimits.downloadBytes
) {
  return async function* download(exact: ExactArtifact, signal: AbortSignal) {
    checkAbort(signal);
    let url = new URL(exact.artifact.url);

    if (url.protocol !== "https:" || url.username || url.password || url.hash)
      throw failure("audit-required", "Artifact download URL is not permitted");
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });

    let reader:
      | Pick<ReadableStreamDefaultReader<Uint8Array>, "read" | "cancel" | "releaseLock">
      | undefined;

    try {
      let response = await fetchArtifact(url.href, {
        signal: controller.signal,
        redirect: "manual",
        credentials: "omit",
        headers: { "accept-encoding": "identity" },
      });

      checkAbort(signal);
      const redirected = await releaseRedirect(response, url);

      if (redirected !== null) {
        url = redirected;
        response = await fetchArtifact(url.href, {
          signal: controller.signal,
          redirect: "manual",
          credentials: "omit",
          headers: { "accept-encoding": "identity" },
        });
        checkAbort(signal);
      }

      if (
        response.status !== 200 ||
        response.redirected ||
        (response.url && response.url !== url.href)
      ) {
        await response.body?.cancel();
        throw failure("install-failed", `Artifact download returned HTTP ${response.status}`, true);
      }

      const length = response.headers.get("content-length");

      if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes)) {
        await response.body?.cancel();
        throw failure("too-large", "Artifact download exceeds limit");
      }

      if (!response.body) throw failure("install-failed", "Artifact download has no body", true);
      reader = response.body.getReader();
      let total = 0;

      while (true) {
        checkAbort(signal);
        const next = await reader.read();
        checkAbort(signal);

        if (next.done) break;
        total += next.value.length;

        if (total > maxBytes) throw failure("too-large", "Artifact download exceeds limit");
        yield next.value;
      }

      if (length !== null && Number(length) !== total)
        throw failure("install-failed", "Artifact download is incomplete", true);
    } finally {
      controller.abort();
      await reader?.cancel().catch(() => {});
      reader?.releaseLock();
      signal.removeEventListener("abort", abort);
    }
  };
}

async function releaseRedirect(response: Response, url: URL) {
  if (
    ![301, 302, 303, 307, 308].includes(response.status) ||
    url.hostname !== "github.com" ||
    !/^\/[^/]+\/[^/]+\/releases\/download\//.test(url.pathname)
  )
    return null;
  const location = response.headers.get("location");
  await response.body?.cancel();
  const target = location === null ? null : new URL(location, url);

  if (
    target === null ||
    target.protocol !== "https:" ||
    target.hostname !== "release-assets.githubusercontent.com" ||
    target.port ||
    target.username ||
    target.password ||
    target.hash
  )
    throw failure("audit-required", "GitHub release redirect is not permitted");

  return target;
}
