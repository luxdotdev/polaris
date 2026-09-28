// Imperative wrapper around Pierre's virtualized CodeView. React never re-renders it:
// the React tree mounts one host <div>, and everything else goes through this controller.
import { CodeView, parsePatchFiles, type CodeViewItem, type FileDiffMetadata } from '@pierre/diffs';
import { getOrCreateWorkerPoolSingleton, type WorkerPoolManager } from '@pierre/diffs/worker';
import DiffsWorker from '@pierre/diffs/worker/worker.js?worker';
import { FIXTURE_URL, flags } from './flags';

declare global {
  interface Window {
    __spikePool?: WorkerPoolManager;
  }
}

let pool: WorkerPoolManager | undefined;

function getPool(): WorkerPoolManager | undefined {
  if (!flags.workers) return undefined;
  if (pool) return pool;
  // Pop-out shares the opener's Shiki worker pool: same renderer process, same-origin realm.
  const opener = window.opener as Window | null;
  if (flags.sharePool && opener?.__spikePool) {
    pool = opener.__spikePool;
    return pool;
  }
  pool = getOrCreateWorkerPoolSingleton({
    poolOptions: { workerFactory: () => new DiffsWorker(), poolSize: flags.poolSize, totalASTLRUCacheSize: flags.astCache },
    highlighterOptions: {
      theme: 'pierre-light',
      langs: ['rust'],
      preferredHighlighter: flags.highlighter,
      tokenizeMaxLineLength: 1000,
    },
  });
  window.__spikePool = pool;
  return pool;
}

const UNSAFE_CSS = `
:host { --diffs-font-family: "JetBrains Mono", "SF Mono", Menlo, monospace; --diffs-header-font-family: Inter, -apple-system, system-ui, sans-serif; --diffs-font-size: 12px; --diffs-line-height: 19px; }
[data-diffs-header] { font-size: 12px; }
`;

export interface LoadTiming {
  fixture: string;
  files: number;
  lines: number;
  fetchMs: number;
  parseMs: number;
  setItemsMs: number;
}

export class DiffController {
  view: CodeView | null = null;
  root: HTMLElement | null = null;
  files: FileDiffMetadata[] = [];
  fixture = '';
  private rotation = 0;
  private generation = 0;

  mount(root: HTMLElement) {
    this.root = root;
    this.view = new CodeView(
      {
        theme: 'pierre-light',
        themeType: 'light',
        diffStyle: 'unified',
        stickyHeaders: true,
        overflow: 'scroll',
        hunkSeparators: 'line-info-basic',
        lineDiffType: 'word-alt',
        unsafeCSS: UNSAFE_CSS,
        itemMetrics: { lineHeight: 19 },
      },
      getPool(),
    );
    this.view.setup(root);
  }

  async load(fixture: string, prefetched?: Promise<string>): Promise<LoadTiming> {
    const t0 = performance.now();
    const text = await (prefetched ?? fetch(FIXTURE_URL(fixture)).then((r) => r.text()));
    const t1 = performance.now();
    const gen = ++this.generation;
    const parsed = parsePatchFiles(text, `${fixture}-${gen}`);
    const files = parsed.flatMap((p) => p.files);
    const t2 = performance.now();
    this.files = files;
    this.fixture = fixture;
    this.rotation = 0;
    this.root!.scrollTop = 0;
    this.view!.setItems(this.items());
    const t3 = performance.now();
    return {
      fixture,
      files: files.length,
      lines: files.reduce((n, f) => n + f.unifiedLineCount, 0),
      fetchMs: t1 - t0,
      parseMs: t2 - t1,
      setItemsMs: t3 - t2,
    };
  }

  // A Workspace switch swaps the review content: rotate the file list so the visible file changes.
  showWorkspace(index: number) {
    if (!this.files.length) return;
    this.rotation = (index * 7) % this.files.length;
    this.root!.scrollTop = 0;
    this.view!.setItems(this.items());
  }

  private items(): CodeViewItem<undefined>[] {
    const n = this.files.length;
    const out: CodeViewItem<undefined>[] = new Array(n);
    for (let i = 0; i < n; i++) {
      const f = this.files[(i + this.rotation) % n];
      out[i] = { id: `${this.fixture}:${f.name}:${(i + this.rotation) % n}`, type: 'diff', fileDiff: f, version: 0 };
    }
    return out;
  }
}

// Walk open shadow roots and find the first rendered code line and highlighted token.
export function probeRendered(root: HTMLElement): { lines: boolean; highlighted: boolean; firstFile?: string } {
  let lines = false;
  let highlighted = false;
  const stack: (Element | ShadowRoot)[] = [root];
  const rr = root.getBoundingClientRect();
  while (stack.length) {
    const node = stack.pop()!;
    const sr = (node as Element).shadowRoot;
    if (sr) stack.push(sr);
    const line = (node as ParentNode).querySelector?.('[data-line]');
    if (line) {
      const r = line.getBoundingClientRect();
      if (r.bottom > rr.top && r.top < rr.bottom) {
        lines = true;
        if (line.querySelector('span[style*="--diffs-token"], span[style*="color"]')) highlighted = true;
      }
    }
    for (const c of (node as ParentNode).children ?? []) if ((c as Element).shadowRoot || c.children.length) stack.push(c);
    if (lines && highlighted) break;
  }
  return { lines, highlighted };
}

export const diff = new DiffController();

// Is there painted code at viewport y? Geometry-based (Pierre disables pointer events while
// scrolling, so hit-testing is useless): find the item host under y, then binary-search its lines.
function contentAt(root: HTMLElement, y: number): 'code' | 'highlighted' | 'chrome' | 'blank' {
  for (const host of root.querySelectorAll('diffs-container')) {
    const hr = host.getBoundingClientRect();
    if (y < hr.top || y >= hr.bottom || !host.shadowRoot) continue;
    const lines = host.shadowRoot.querySelectorAll('[data-line]');
    let lo = 0;
    let hi = lines.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const r = lines[mid].getBoundingClientRect();
      if (y < r.top) hi = mid - 1;
      else if (y >= r.bottom) lo = mid + 1;
      else return lines[mid].querySelector('span[style]') ? 'highlighted' : 'code';
    }
    return 'chrome'; // header, separator or padding inside a rendered item
  }
  return 'blank';
}

// Sample 5 points down the code column: fraction showing code, and fraction highlighted.
export function viewportCoverage(root: HTMLElement) {
  const r = root.getBoundingClientRect();
  let code = 0;
  let hl = 0;
  let blank = 0;
  for (let i = 1; i <= 5; i++) {
    const c = contentAt(root, r.top + (r.height * i) / 6);
    if (c === 'code' || c === 'highlighted') code++;
    if (c === 'highlighted') hl++;
    if (c === 'blank') blank++;
  }
  return { code: code / 5, highlighted: hl / 5, blank: blank / 5 };
}
