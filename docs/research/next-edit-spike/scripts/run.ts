// run.ts <tag> <format> <gguf | url> [llama-server args…]
// Starts llama-server on a private port (unless given a URL), sends each case's keystroke
// sequence (step 0 = first request in the file, steps 1–4 = next keystrokes), records timings,
// outputs and the server's memory, then stops only the server it started.
import { spawn } from "bun";
import { mkdirSync } from "node:fs";
import { loadCases } from "./build.ts";
import { FORMATS, type Format } from "./prompts.ts";

const [tag, fmt, model, ...serverArgs] = process.argv.slice(2) as [string, Format, string, ...string[]];
const out = new URL(`../raw/`, import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const port = Number(process.env.SPIKE_PORT ?? 8091);
const only = process.env.SPIKE_CASES?.split(",");
const external = model.startsWith("http");
const base = external ? model : `http://127.0.0.1:${port}`;

let server: ReturnType<typeof spawn> | undefined;
if (!external) {
  const log = Bun.file(`${out}${tag}.server.log`);
  server = spawn(["llama-server", "-m", model, "--host", "127.0.0.1", "--port", String(port), "-c", "8192", "-np", "1", "-ngl", "99", "--cache-reuse", "256", ...serverArgs], { stdout: log, stderr: log });
  for (let i = 0; ; i++) {
    if (i > 300) throw new Error("server did not start");
    const ok = await fetch(`${base}/health`).then((r) => r.ok, () => false);
    if (ok) break;
    await Bun.sleep(1000);
  }
}

async function memory(pid: number) {
  const rss = Number((await Bun.$`ps -o rss= -p ${pid}`.quiet().text()).trim()) * 1024;
  const fp = await Bun.$`footprint -p ${pid}`.quiet().nothrow().text();
  const phys = /phys_footprint:\s*([\d.]+\s*\w+)/.exec(fp)?.[1] ?? /Footprint:\s*([\d.]+\s*\w+)/.exec(fp)?.[1] ?? null;
  return { rssBytes: rss, footprint: phys };
}

const cases = (await loadCases()).filter((c) => !only || only.includes(c.id)).filter((c) => !fmt.startsWith("mellum") || c.cat === "insertion");
const rows: unknown[] = [];
// one throwaway request so Metal kernels are compiled before the first measured case
await fetch(`${base}/completion`, { method: "POST", body: JSON.stringify({ prompt: "hello", n_predict: 4, cache_prompt: false }) });
let peak = server ? await memory(server.pid) : null;

for (const c of cases) {
  for (let i = 0; i < c.steps.length; i++) {
    const built = FORMATS[fmt](c, c.steps[i]!);
    const t0 = performance.now();
    const res = await fetch(`${base}/completion`, {
      method: "POST",
      body: JSON.stringify({ prompt: built.prompt, n_predict: built.nPredict, temperature: 0, stop: built.stop, cache_prompt: true }),
    });
    const body: any = await res.json();
    const wall = performance.now() - t0;
    rows.push({ id: c.id, cat: c.cat, step: i, wallMs: wall, content: body.content, timings: body.timings, tokensCached: body.tokens_cached, stop: body.stop_type ?? body.stopping_word, promptChars: built.prompt.length });
  }
  if (server) {
    const m = await memory(server.pid);
    if (!peak || m.rssBytes > peak.rssBytes) peak = m;
  }
  process.stderr.write(`${c.id} `);
}
process.stderr.write("\n");
await Bun.write(`${out}${tag}.jsonl`, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
await Bun.write(`${out}${tag}.meta.json`, JSON.stringify({ tag, fmt, model, serverArgs, memory: peak, at: new Date().toISOString(), load: (await Bun.$`sysctl -n vm.loadavg`.quiet().text()).trim() }, null, 1));
if (server) {
  server.kill();
  await server.exited;
}
