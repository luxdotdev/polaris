import type { EmailEnv } from "./transport";

/** This function accepts no request data, so telemetry cannot carry an address or IP. */
export async function logEmailRequested(
  env: EmailEnv,
  send: (input: string, init: RequestInit) => Promise<Response> = fetch
) {
  if (env.NODE_ENV !== "production" || !env.AXIOM_TOKEN || !env.AXIOM_DATASET) return;

  try {
    await send(`https://api.axiom.co/v1/ingest/${encodeURIComponent(env.AXIOM_DATASET)}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.AXIOM_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify([
        { event: "email_requested", route: "/api/email", _time: new Date().toISOString() },
      ]),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // Telemetry is best effort; provider errors may contain private data and are discarded.
  }
}
