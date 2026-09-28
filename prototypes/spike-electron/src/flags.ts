// Runtime toggles, passed from the main process through the page URL query.
const q = new URLSearchParams(location.search);

export const flags = {
  popout: q.get('popout') === '1',
  fixture: q.get('fixture') ?? '10k',
  workers: q.get('workers') !== '0',
  poolSize: Number(q.get('poolSize') ?? 1),
  sharePool: q.get('sharePool') !== '0',
  switchMode: (q.get('switchMode') ?? 'full') as 'full' | 'sidebar',
  highlighter: (q.get('highlighter') ?? 'shiki-wasm') as 'shiki-wasm' | 'shiki-js',
  astCache: Number(q.get('astCache') ?? 100),
  bench: q.get('bench') ?? '',
};

export const FIXTURE_URL = (name: string) => `app://spike/fixtures/review-${name}.diff`;
