// perf-setup.ts <download|adopt|starts|first|serve> <modelsDir> <out.json> [model] [runs]: the Daemon's own
// ManagedServer with its real ports (fetch, extract, spawn, health, ps), timed from its status stream.
// The only change is the idle unload: IDLE_UNLOAD_MS maps to PERF_IDLE_MS (5 s) through the timers port.
import { appendFileSync } from "node:fs";
import { loadavg } from "node:os";
import { join } from "node:path";
import { readdir, rm } from "node:fs/promises";
import type { ManagedModelId, ManagedServerStatus } from "../../../../packages/protocol/src/index.ts";
import { IDLE_UNLOAD_MS, ManagedServer } from "../../../../apps/daemon/src/prediction/managed/server.ts";
import { modelFor } from "../../../../apps/daemon/src/prediction/managed/catalog.ts";
import { buildDir, spawnServer, type Spawn } from "../../../../apps/daemon/src/prediction/managed/process.ts";
import { residency } from "./perf-pagecache.ts";

const [mode = "", dir = "", out = "", model = "sweep-next-edit-1.5b", runsArg = "3"] = process.argv.slice(2);
const runs = Number(runsArg);
const idleMs = Number(process.env.PERF_IDLE_MS ?? 5000);
const id = model as ManagedModelId;
const file = modelFor(id).file;
const load = () => loadavg().map((l) => Math.round(l * 100) / 100);
const log = (m: string) => console.error(`${new Date().toISOString().slice(11, 19)} ${m}`);

/** spawnServer, with llama-server's stderr also appended to PERF_LOG with seconds since spawn. */
const teeSpawn: Spawn = (command, args, cwd) => {
  const child = spawnServer(command, args, cwd);
  const path = process.env.PERF_LOG;
  if (!path || child.stderr === null) return child;
  const [mine, theirs] = child.stderr.tee();
  const t0 = performance.now();
  void (async () => {
    const dec = new TextDecoder();
    appendFileSync(path, `--- spawn ${new Date().toISOString()}\n`);
    for await (const chunk of mine)
      for (const l of dec.decode(chunk).split("\n")) if (l) appendFileSync(path, `${((performance.now() - t0) / 1000).toFixed(3)} ${l}\n`);
  })();
  return { ...child, stderr: theirs };
};

type Mark = { t: number; tag: string; file?: string; received?: number };

const managed = () => {
  const marks: Mark[] = [];
  const server = new ManagedServer({
    defaultDir: dir,
    spawn: teeSpawn,
    timers: {
      after: (run, ms) => {
        const handle = setTimeout(run, ms === IDLE_UNLOAD_MS ? idleMs : ms);
        return () => clearTimeout(handle);
      },
      now: () => performance.now(),
    },
  });
  server.watch((s: ManagedServerStatus) => {
    const p = s.phase;
    marks.push({ t: performance.now(), tag: p._tag, ...(p._tag === "Downloading" ? { file: p.file, received: p.receivedBytes } : {}) });
  });
  const waitFor = async (tag: string, timeoutMs: number, after = 0) => {
    const deadline = performance.now() + timeoutMs;
    while (performance.now() < deadline) {
      const hit = marks.find((m) => m.tag === tag && m.t >= after);
      if (hit) return hit.t;
      await Bun.sleep(20);
    }
    throw new Error(`no ${tag} within ${timeoutMs} ms`);
  };
  return { server, marks, waitFor };
};

const ps = (pid: number) => {
  const rss = Number(Bun.spawnSync(["ps", "-o", "rss=", "-p", String(pid)]).stdout.toString().trim()) * 1024;
  const fp = Bun.spawnSync(["footprint", "-p", String(pid)]).stdout.toString();
  const m = /Footprint:\s*([\d.]+)\s*(KB|MB|GB)/.exec(fp);
  const footprint = m ? Number(m[1]) * { KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 }[m[2] as "KB"] : null;
  return { rssBytes: rss || null, footprintBytes: footprint };
};

const serverPid = (port: string) =>
  Number(Bun.spawnSync(["lsof", "-t", "-iTCP:" + port, "-sTCP:LISTEN"]).stdout.toString().trim().split("\n")[0]) || null;

const healthPoll = async (url: string, signal: AbortSignal) => {
  const t0 = performance.now();
  while (!signal.aborted) {
    try {
      if ((await fetch(`${url}/health`, { signal: AbortSignal.timeout(1000) })).status === 200) return performance.now() - t0;
    } catch {}
    await Bun.sleep(25);
  }
  return null;
};

const complete = async (url: string, alias: string) => {
  const t0 = performance.now();
  const res = await fetch(`${url}/v1/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: alias, prompt: "<|file_sep|>a.ts\nexport const sum = (xs: number[]) =>", max_tokens: 16, temperature: 0, cache_prompt: true }),
  });
  await res.json();
  return performance.now() - t0;
};

const evictAll = async () => {
  const files = [join(dir, file.name)];
  for (const d of [buildDir(dir)]) {
    try {
      for (const e of await readdir(d, { recursive: true, withFileTypes: true }))
        if (e.isFile() && !e.name.endsWith(".gguf")) files.push(join(e.parentPath, e.name));
    } catch {}
  }
  for (const f of files) residency(f, true);
  return residency(join(dir, file.name));
};

/** One start: product start() and its loadMs, our own 25 ms health poll, first request, memory. */
const timedStart = async (m: ReturnType<typeof managed>, kind: "cold" | "warm") => {
  const resident = kind === "cold" ? await evictAll() : residency(join(dir, file.name));
  const before = load();
  const t0 = performance.now();
  const url = (await m.server.status(dir, id)).endpoint!.url;
  const probe = new AbortController();
  const health = healthPoll(url, probe.signal);
  await m.server.start();
  const startMs = performance.now() - t0;
  const healthMs = await health;
  probe.abort();
  const status = await m.server.status(dir, id);
  const pid = serverPid(new URL(url).port);
  const firstRequestMs = await complete(url, modelFor(id).alias);
  const secondRequestMs = await complete(url, modelFor(id).alias);
  const memWarm = pid ? ps(pid) : null;
  await Bun.sleep(Math.max(0, idleMs - 1500));
  const memIdle = pid ? ps(pid) : null;
  const tIdle = performance.now();
  const stoppedAt = await m.waitFor("Stopped", idleMs + 30_000, tIdle - idleMs);
  await Bun.sleep(1500);
  const exited = pid ? Bun.spawnSync(["kill", "-0", String(pid)]).exitCode !== 0 : null;
  const row = { kind, residentBefore: resident, load: before, startMs, healthMs, productLoadMs: status.loadMs, productMemoryBytes: status.memoryBytes, firstRequestMs, secondRequestMs, memWarm, memIdle, unloadedAfterMs: stoppedAt - t0, exited };
  log(JSON.stringify(row));
  return row;
};

const results: unknown[] = [];
const save = () => Bun.write(out, JSON.stringify({ mode, model: id, dir, idleMs, results }, null, 2) + "\n");

if (mode === "download") {
  for (let i = 0; i < runs; i++) {
    const m = managed();
    await m.server.remove(dir, id);
    const before = load();
    const t0 = performance.now();
    await m.server.setup(dir, id);
    const total = performance.now() - t0;
    const st = await m.server.status(dir, id);
    const firstModel = m.marks.find((k) => k.file === "model")!;
    const lastModel = m.marks.findLast((k) => k.file === "model")!;
    const verifying = m.marks.find((k) => k.tag === "Verifying" && k.t > lastModel.t)!;
    const stopped = m.marks.find((k) => k.tag === "Stopped" && k.t > verifying.t)!;
    const serverS = (firstModel.t - t0) / 1000;
    const modelS = (verifying.t - firstModel.t) / 1000;
    const row = { run: i + 1, load: before, loadAfter: load(), phase: st.phase._tag, totalS: total / 1000, serverBuildS: serverS, modelDownloadS: modelS,
      modelMBps: file.sizeBytes / 1e6 / modelS, verifyS: (stopped.t - verifying.t) / 1000 };
    log(JSON.stringify(row));
    results.push(row);
    await save();
    m.server.dispose();
  }
} else if (mode === "adopt") {
  for (let i = 0; i < runs; i++) {
    const m = managed();
    const resident = i === 0 ? residency(join(dir, file.name)) : await evictAll();
    const before = load();
    const t0 = performance.now();
    await m.server.status(dir, id);
    const stopped = await m.waitFor("Stopped", 10 * 60_000);
    const row = { run: i + 1, residentBefore: resident, load: before, verifyS: (stopped - t0) / 1000 };
    log(JSON.stringify(row));
    results.push(row);
    await save();
    m.server.dispose();
  }
} else if (mode === "starts") {
  const m = managed();
  await m.server.status(dir, id);
  await m.waitFor("Stopped", 10 * 60_000);
  for (let i = 0; i < runs; i++) {
    results.push(await timedStart(m, "cold"));
    results.push(await timedStart(m, "warm"));
    await save();
  }
  m.server.dispose();
} else if (mode === "first") {
  // The first start after setup: a freshly extracted build (re-downloaded) and an evicted model.
  for (let i = 0; i < runs; i++) {
    await rm(buildDir(dir), { recursive: true, force: true });
    const m = managed();
    await m.server.setup(dir, id);
    results.push({ run: i + 1, ...(await timedStart(m, "cold")) });
    await save();
    m.server.dispose();
  }
} else if (mode === "serve") {
  const m = managed();
  await m.server.status(dir, id);
  await m.waitFor("Stopped", 10 * 60_000);
  await m.server.start();
  const url = m.server.endpoint()!.url;
  await Bun.write(out, JSON.stringify({ url, pid: serverPid(new URL(url).port), alias: modelFor(id).alias }) + "\n");
  log(`serving ${url}`);
  const keep = setInterval(() => m.server.touch(), 1000);
  const stop = () => { clearInterval(keep); m.server.stop(); setTimeout(() => process.exit(0), 3000); };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
} else throw new Error("mode: download | adopt | starts | serve");
