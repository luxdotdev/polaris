// Runs every scenario sequentially, one fresh Electron process per scenario.
// Usage: node scripts/bench.mjs [scenario ...]   (env SPIKE_* toggles pass through)
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const electron = require('electron'); // path to the Electron binary
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ALL = ['cold-start', 'open-diff', 'scroll-10k', 'scroll-40k', 'scroll-290k', 'switch', 'memory-idle', 'memory-heavy'];
const scenarios = process.argv.slice(2).length ? process.argv.slice(2) : ALL;

function run(scenario) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn(electron, [root, '--bench', scenario], {
      env: { ...process.env, BENCH_T0: String(t0) },
      stdio: ['ignore', 'inherit', 'pipe'],
    });
    child.stderr.on('data', (d) => {
      const s = String(d);
      if (!/sandbox_extension|^\s*$/.test(s)) process.stderr.write(s);
    });
    const kill = setTimeout(() => child.kill('SIGKILL'), 240_000);
    child.on('exit', (code) => {
      clearTimeout(kill);
      console.log(`[bench] ${scenario}: exit ${code} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      resolve(code);
    });
  });
}

const settle = () => new Promise((r) => setTimeout(r, 2000)); // let the machine settle between launches
const resultsDir = process.env.SPIKE_RESULTS || path.join(root, 'results');
const variant = process.env.SPIKE_VARIANT && process.env.SPIKE_VARIANT !== 'default' ? `.${process.env.SPIKE_VARIANT}` : '';

// cold-start: one discarded warm-up launch (fills the OS file cache and V8 code cache after a
// rebuild), then 5 measured launches; the file keeps every run and the median.
async function coldStart() {
  const file = path.join(resultsDir, `electron-cold-start${variant}.json`);
  await run('cold-start');
  await settle();
  const runs = [];
  for (let i = 0; i < 5; i++) {
    if ((await run('cold-start')) !== 0) return 1;
    runs.push(JSON.parse(fs.readFileSync(file, 'utf8')));
    await settle();
  }
  const med = (k) => runs.map((r) => r.result[k]).sort((a, b) => a - b)[2];
  const out = { ...runs[0], result: { launchToFirstDiffFrameMs: med('launchToFirstDiffFrameMs'), launchToHighlightedFrameMs: med('launchToHighlightedFrameMs'), aggregation: 'median of 5 launches after 1 discarded warm-up', runs: runs.map((r) => r.result) } };
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  return 0;
}

let failed = 0;
for (const s of scenarios) {
  if ((await (s === 'cold-start' ? coldStart() : run(s))) !== 0) failed++;
  await settle();
}
process.exit(failed ? 1 : 0);
