# Summarises tune-* runs: warm server p50, draft acceptance, and whether outputs match no-spec.
import json,glob,statistics as st,sys
pre=sys.argv[1]
load=lambda f:[json.loads(l) for l in open(f)]
base={(r['id'],r['step']):r['content'] for r in load(pre+'none.jsonl')}
for f in sorted(glob.glob(pre+'*.jsonl')):
    rows=load(f)
    srv=[r['timings']['prompt_ms']+r['timings']['predicted_ms'] for r in rows if r['step']>0]
    dn=sum(r['timings'].get('draft_n') or 0 for r in rows); da=sum(r['timings'].get('draft_n_accepted') or 0 for r in rows)
    same=sum(r['content']==base.get((r['id'],r['step'])) for r in rows)
    print(f"{f[:-6]:30} warm p50 {st.median(srv):6.0f} p90 {sorted(srv)[int(len(srv)*.9)]:6.0f} draft {dn} acc {da} same-as-none {same}/{len(rows)}")
