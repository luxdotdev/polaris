import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { App, PopoutApp, buildWorkspaces } from './App';
import * as bench from './bench';
import { diff } from './diffView';
import { FIXTURE_URL, flags } from './flags';
import './styles.css';

declare global {
  interface Window {
    __bench: typeof bench & { ready: Promise<any> };
    __app: { popout(fixture?: string): void };
  }
}

const navStart = performance.timeOrigin;

async function boot() {
  const root = createRoot(document.getElementById('root')!);
  let loadTiming;
  // Start the fixture fetch before anything renders.
  const diffText = fetch(FIXTURE_URL(flags.fixture)).then((r) => r.text());
  if (flags.popout) {
    root.render(<PopoutApp fixture={flags.fixture} />);
    await new Promise((r) => setTimeout(r, 0));
    loadTiming = await diff.load(flags.fixture, diffText);
  } else {
    const sessionsP = fetch('app://spike/fixtures/sessions.json').then((r) => r.json());
    const workspaces = buildWorkspaces(await sessionsP);
    flushSync(() => root.render(<App workspaces={workspaces} />));
    loadTiming = await diff.load(flags.fixture, diffText);
  }
  const paint = await bench.waitForPaint({ highlighted: false });
  const toWall = (t: number) => (t ? navStart + t : 0);
  const hl = bench.waitForPaint({ highlighted: true }).then((p) => toWall(p.highlightAt));
  return {
    navStartWall: navStart,
    firstLinesFrameWall: toWall(paint.presentedAt),
    loadTiming,
    firstHighlightedWall: await hl,
  };
}

window.__app = {
  popout(fixture = '290k') {
    const q = new URLSearchParams(location.search);
    q.set('popout', '1');
    q.set('fixture', fixture);
    window.open(`app://spike/index.html?${q}`, 'popout', 'width=1100,height=860');
  },
};

window.__bench = Object.assign({}, bench, { ready: boot() });
