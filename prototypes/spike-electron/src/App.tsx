import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { diff } from './diffView';
import { flags } from './flags';

export interface Session {
  id: string;
  host: string;
  workspace: string;
  title: string;
  harness: string;
  state: string;
  branch: string;
}
export interface Host {
  id: string;
  name: string;
  machine: string;
}
export interface Workspace {
  key: string;
  name: string;
  host: Host;
  sessions: Session[];
}

export function buildWorkspaces(data: { hosts: Host[]; sessions: Session[] }): Workspace[] {
  const map = new Map<string, Workspace>();
  for (const s of data.sessions) {
    const key = `${s.host}/${s.workspace}`;
    let ws = map.get(key);
    if (!ws) {
      ws = { key, name: s.workspace, host: data.hosts.find((h) => h.id === s.host)!, sessions: [] };
      map.set(key, ws);
    }
    ws.sessions.push(s);
  }
  return [...map.values()];
}

// Commit hook for the switch benchmark: fires in the layout phase of the commit that shows a workspace.
export const commitListeners = new Set<(ws: number) => void>();

type Mode = 'Orchestrate' | 'Review' | 'Edit';
const MODES: Mode[] = ['Orchestrate', 'Review', 'Edit'];

const Titlebar = memo(function Titlebar({ mode, onMode, title }: { mode: Mode; onMode: (m: Mode) => void; title: string }) {
  return (
    <header className="titlebar">
      <div className="segmented" role="tablist">
        {MODES.map((m) => (
          <button key={m} role="tab" aria-selected={m === mode} className={m === mode ? 'on' : ''} onClick={() => onMode(m)}>
            {m}
          </button>
        ))}
      </div>
      <div className="title">{title}</div>
    </header>
  );
});

const WorkspaceBar = memo(function WorkspaceBar({ workspaces, selected, onSelect }: { workspaces: Workspace[]; selected: number; onSelect: (i: number) => void }) {
  return (
    <nav className="wsbar">
      {workspaces.map((w, i) => (
        <button key={w.key} className={'chip' + (i === selected ? ' on' : '')} onClick={() => onSelect(i)} title={`${w.host.name} · ⌃${i + 1}`}>
          <span className="host">{w.host.name}</span>
          <span className="name">{w.name}</span>
          {i < 9 && <kbd>⌃{i + 1}</kbd>}
        </button>
      ))}
    </nav>
  );
});

const InputColumn = memo(function InputColumn({ ws, index }: { ws: Workspace; index: number }) {
  useLayoutEffect(() => {
    for (const l of commitListeners) l(index);
  }, [index]);
  return (
    <aside className="inputs">
      <div className="inputs-head">
        <span>{ws.name}</span>
        <span className="muted">{ws.host.machine}</span>
      </div>
      <ul>
        {ws.sessions.map((s) => (
          <li key={s.id} className="session">
            <span className={`dot ${s.state}`} title={s.state} />
            <div className="stext">
              <div className="stitle">{s.title}</div>
              <div className="smeta">
                {s.harness} · {s.branch} · {s.state}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </aside>
  );
});

// The diff host never re-renders: CodeView owns its subtree.
const DiffPane = memo(function DiffPane() {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    diff.mount(ref.current!);
  }, []);
  return <div className="diff-host" ref={ref} />;
});

export function App({ workspaces }: { workspaces: Workspace[] }) {
  const [selected, setSelected] = useState(0);
  const [mode, setMode] = useState<Mode>('Review');
  const selectRef = useRef<(i: number) => void>(null);

  const select = (i: number) => {
    if (i < 0 || i >= workspaces.length) return;
    setSelected(i);
    if (flags.switchMode === 'full') diff.showWorkspace(i);
  };
  selectRef.current = select;

  useEffect(() => {
    // ⌃1…⌃9 selects a Workspace chip. The switch benchmark dispatches this same event.
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.metaKey && e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        selectRef.current!(Number(e.key) - 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const ws = workspaces[selected];
  return (
    <div className="app">
      <Titlebar mode={mode} onMode={setMode} title={`Review · ${diff.fixture || flags.fixture}`} />
      <WorkspaceBar workspaces={workspaces} selected={selected} onSelect={select} />
      <main className="body">
        <InputColumn ws={ws} index={selected} />
        <section className="output">
          <DiffPane />
        </section>
      </main>
    </div>
  );
}

export function PopoutApp({ fixture }: { fixture: string }) {
  return (
    <div className="app popout">
      <header className="titlebar">
        <div className="title">Pop-out · review-{fixture}.diff</div>
      </header>
      <main className="body">
        <section className="output">
          <DiffPane />
        </section>
      </main>
    </div>
  );
}
