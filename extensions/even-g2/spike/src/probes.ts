export type ProbeResult = { name: string; ok: boolean; detail: string };

const TIMEOUT_MS = 10_000;

// Not in app.json's whitelist: tells us whether the whitelist is enforced at all.
const CONTROL_URL = "wss://ws.postman-echo.com/raw";

const probeFetch = async (url: string): Promise<ProbeResult> => {
  const started = performance.now();

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    const body = await response.text();
    const ms = Math.round(performance.now() - started);

    return { name: "https", ok: response.ok, detail: `${response.status} in ${ms} ms: ${body}` };
  } catch (error) {
    return { name: "https", ok: false, detail: String(error) };
  }
};

const probeSocket = (name: string, url: string): Promise<ProbeResult> =>
  new Promise((resolve) => {
    const started = performance.now();
    let socket: WebSocket;

    try {
      socket = new WebSocket(url);
    } catch (error) {
      resolve({ name, ok: false, detail: `refused: ${String(error)}` });

      return;
    }

    const timer = setTimeout(() => finish(false, `no echo in ${TIMEOUT_MS} ms`), TIMEOUT_MS);

    const finish = (ok: boolean, detail: string) => {
      clearTimeout(timer);
      socket.close();
      resolve({ name, ok, detail });
    };

    socket.addEventListener("open", () => socket.send(`ping from ${location.href}`));
    socket.addEventListener("message", (event) => {
      const ms = Math.round(performance.now() - started);

      finish(true, `echo in ${ms} ms: ${String(event.data).slice(0, 160)}`);
    });
    socket.addEventListener("error", () => finish(false, "error event before an echo"));
    socket.addEventListener("close", (event) =>
      finish(false, `closed ${event.code} ${event.reason}`)
    );
  });

const report = (host: string, results: ReadonlyArray<ProbeResult>) =>
  fetch(`https://${host}/polaris-spike/report`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ href: location.href, userAgent: navigator.userAgent, results }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch(() => undefined);

export const runProbes = async (host: string) => {
  const https = await probeFetch(`https://${host}/polaris-spike/hello`);
  const wss = await probeSocket("wss", `wss://${host}/polaris-spike/ws`);
  const control = await probeSocket("control", CONTROL_URL);
  const results = [https, wss, control];

  await report(host, results);

  return results;
};
