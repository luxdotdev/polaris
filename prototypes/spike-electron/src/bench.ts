// Renderer-side measurement helpers. The main process drives them via executeJavaScript.
import { commitListeners } from './App';
import { diff, probeRendered, viewportCoverage, type LoadTiming } from './diffView';

const raf = () => new Promise<number>((r) => requestAnimationFrame(r));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function stats(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number) => (s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0);
  const mean = s.reduce((a, b) => a + b, 0) / (s.length || 1);
  const r = (n: number) => Math.round(n * 100) / 100;
  return {
    count: s.length,
    p50: r(q(0.5)),
    p95: r(q(0.95)),
    p99: r(q(0.99)),
    max: r(s[s.length - 1] ?? 0),
    mean: r(mean),
    pctOver8_33: r((100 * s.filter((x) => x > 8.34).length) / (s.length || 1)),
    pctOver16_7: r((100 * s.filter((x) => x > 16.7).length) / (s.length || 1)),
  };
}

// Long Animation Frames: Chromium's own per-frame main-thread accounting (cheap to observe).
function observeLoaf() {
  const entries: { duration: number; blockingDuration: number; styleAndLayoutMs: number; scripts: string[] }[] = [];
  let po: PerformanceObserver | null = null;
  try {
    po = new PerformanceObserver((list) => {
      for (const e of list.getEntries() as any[])
        entries.push({
          duration: e.duration,
          blockingDuration: e.blockingDuration,
          styleAndLayoutMs: Math.round(e.styleAndLayoutStart ? e.startTime + e.duration - e.styleAndLayoutStart : 0),
          scripts: (e.scripts ?? []).slice(0, 3).map((x: any) => `${x.invoker} ${x.sourceFunctionName}@${String(x.sourceURL).split('/').pop()}:${x.sourceCharPosition} ${Math.round(x.duration)}ms`),
        });
    });
    po.observe({ type: 'long-animation-frame', buffered: false });
  } catch {}
  return () => {
    po?.disconnect();
    return {
      count: entries.length,
      maxMs: Math.round(Math.max(0, ...entries.map((e) => e.duration))),
      totalBlockingMs: Math.round(entries.reduce((a, e) => a + e.blockingDuration, 0)),
      top: [...entries].sort((a, b) => b.duration - a.duration).slice(0, 5).map((e) => ({ ...e, duration: Math.round(e.duration) })),
    };
  };
}

// Wait until the diff host paints code lines in its viewport; returns wall-clock timestamps.
export async function waitForPaint(opts: { highlighted?: boolean; timeoutMs?: number } = {}) {
  const root = diff.root!;
  const start = performance.now();
  let linesAt = 0;
  let highlightAt = 0;
  for (;;) {
    const t = await raf();
    const p = probeRendered(root);
    if (p.lines && !linesAt) linesAt = t;
    if (p.highlighted && !highlightAt) highlightAt = t;
    if (linesAt && (!opts.highlighted || highlightAt)) break;
    if (performance.now() - start > (opts.timeoutMs ?? 30000)) break;
  }
  // The rAF in which content was first found runs before that frame is painted; the next
  // rAF timestamp is our estimate of when the frame was presented.
  const next = await raf();
  return { linesAt, highlightAt, presentedAt: next };
}

export async function measureRefreshHz() {
  const ts: number[] = [];
  for (let i = 0; i < 90; i++) ts.push(await raf());
  const d = ts.slice(1).map((t, i) => t - ts[i]).sort((a, b) => a - b);
  const med = d[Math.floor(d.length / 2)];
  return { medianFrameMs: Math.round(med * 100) / 100, hz: Math.round(1000 / med) };
}

// Steady programmatic scroll: every rAF sets scrollTop = v * elapsed.
export async function scrollSteady(pxPerSec = 4000, maxMs = 10000) {
  const root = diff.root!;
  root.scrollTop = 0;
  await sleep(300);
  const stop = observeLoaf();
  const intervals: number[] = [];
  let t0 = -1;
  let last = 0;
  let reachedEnd = false;
  let y = 0;
  let frame = 0;
  const cov = { samples: 0, blankPoints: 0, plainPoints: 0, highlightedPoints: 0 };
  await new Promise<void>((resolve) => {
    const tick = (t: number) => {
      // Sampled coverage check of what the previous frame left in the viewport (costs ~0.1 ms).
      if (++frame % 8 === 0) {
        const c = viewportCoverage(root);
        cov.samples += 5;
        cov.blankPoints += c.blank * 5;
        cov.highlightedPoints += c.highlighted * 5;
        cov.plainPoints += (c.code - c.highlighted) * 5;
      }
      if (t0 < 0) t0 = last = t;
      else {
        intervals.push(t - last);
        last = t;
      }
      const max = root.scrollHeight - root.clientHeight;
      y = Math.min(max, ((t - t0) * pxPerSec) / 1000);
      root.scrollTop = y;
      if (y >= max) reachedEnd = true;
      if (reachedEnd || t - t0 >= maxMs) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  return {
    pxPerSec,
    durationMs: Math.round(last - t0),
    distancePx: Math.round(y),
    scrollHeight: root.scrollHeight,
    reachedEnd,
    frameIntervals: stats(intervals),
    longAnimationFrames: stop(),
    viewportSamples: {
      points: cov.samples,
      pctBlank: Math.round((1000 * cov.blankPoints) / (cov.samples || 1)) / 10,
      pctPlainCode: Math.round((1000 * cov.plainPoints) / (cov.samples || 1)) / 10,
      pctHighlightedCode: Math.round((1000 * cov.highlightedPoints) / (cov.samples || 1)) / 10,
    },
    rawIntervals: intervals.map((x) => Math.round(x * 100) / 100),
  };
}

// Random jumps: time from setting scrollTop to the frame that shows code at the new position.
export async function randomJumps(n = 20, seed = 42) {
  const root = diff.root!;
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const stop = observeLoaf();
  const toContent: number[] = [];
  const firstFrame: number[] = [];
  const intervals: number[] = [];
  for (let i = 0; i < n; i++) {
    await raf();
    const t0 = performance.now();
    root.scrollTop = rnd() * (root.scrollHeight - root.clientHeight);
    let prev = await raf();
    firstFrame.push(prev - t0);
    for (let k = 0; k < 120; k++) {
      if (viewportCoverage(root).code >= 0.6) break;
      const t = await raf();
      intervals.push(t - prev);
      prev = t;
    }
    const presented = await raf();
    intervals.push(presented - prev);
    toContent.push(presented - t0);
    await sleep(150);
  }
  return { jumps: n, rawToContentMs: toContent.map((x) => Math.round(x * 10) / 10), toContentFrame: stats(toContent), frameAfterJump: stats(firstFrame), intervalsDuringJumps: stats(intervals), longAnimationFrames: stop() };
}

// Workspace switch via the ⌃N keydown path.
export async function switchBench(n = 50, workspaceCount = 10) {
  const toCommit: number[] = [];
  const toFrameStart: number[] = [];
  const toPresented: number[] = [];
  for (let i = 0; i < n; i++) {
    await sleep(120);
    await raf();
    const target = (i + 1) % Math.min(9, workspaceCount);
    let commitAt = 0;
    const listener = (ws: number) => {
      if (ws === target) commitAt = performance.now();
    };
    commitListeners.add(listener);
    const t0 = performance.now();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: String(target + 1), ctrlKey: true, bubbles: true }));
    // React flushes discrete-event updates synchronously or in a microtask; wait for commit.
    while (!commitAt) await new Promise((r) => setTimeout(r, 0));
    commitListeners.delete(listener);
    const f1 = await raf(); // frame that paints the new DOM begins
    const f2 = await raf(); // next vsync ~ when that frame was presented
    toCommit.push(commitAt - t0);
    toFrameStart.push(f1 - t0);
    toPresented.push(f2 - t0);
  }
  return { switches: n, inputToCommit: stats(toCommit), inputToFrameStart: stats(toFrameStart), inputToPresentedFrame: stats(toPresented) };
}

// Used by memory-heavy: a steady scroll segment plus evenly spaced jumps through the whole diff.
export async function scrollThrough() {
  const steady = await scrollSteady(4000, 4000);
  const root = diff.root!;
  for (let i = 1; i <= 20; i++) {
    root.scrollTop = (i / 20) * (root.scrollHeight - root.clientHeight);
    await raf();
    await sleep(120);
  }
  return { steadyFrames: steady.frameIntervals };
}

export async function load(fixture: string): Promise<LoadTiming & { toFirstFrameMs: number; toHighlightedMs: number }> {
  const t0 = performance.now();
  const timing = await diff.load(fixture);
  const p = await waitForPaint({ highlighted: true, timeoutMs: 20000 });
  return { ...timing, toFirstFrameMs: Math.round(p.presentedAt - t0), toHighlightedMs: p.highlightAt ? Math.round(p.highlightAt - t0) : -1 };
}

export async function openDiff() {
  const out: Record<string, any> = {};
  for (const f of ['10k', '40k', '290k']) {
    const runs = [];
    for (let i = 0; i < 3; i++) {
      runs.push(await load(f));
      await sleep(500);
    }
    out[f] = { medianToFirstFrameMs: [...runs].map((r) => r.toFirstFrameMs).sort((a, b) => a - b)[1], runs };
  }
  // back to the default fixture
  await diff.load('10k');
  return out;
}

export function heap() {
  const m = (performance as any).memory;
  return m ? { usedJSHeapMB: Math.round(m.usedJSHeapSize / 1048576), totalJSHeapMB: Math.round(m.totalJSHeapSize / 1048576) } : null;
}

export const coverage = () => viewportCoverage(diff.root!);
