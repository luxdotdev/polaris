#!/usr/bin/env bash
# Runs every ENG-184 scenario for the GPUI spike, one process per scenario,
# and writes results/gpui-<scenario>.json. Needs an unlocked, awake screen:
# GPUI stops its display link for occluded windows, so nothing draws otherwise.
set -uo pipefail
cd "$(dirname "$0")"

if ioreg -n Root -d1 | grep -q '"CGSSessionScreenIsLocked"=Yes' && [ -z "${FORCE:-}" ]; then
  echo "Screen is locked: GPUI draws no frames for occluded windows. Unlock and rerun (FORCE=1 to run anyway)." >&2
  exit 1
fi

cargo build --release || exit 1
BIN=target/release/spike-gpui
mkdir -p results
system_profiler SPDisplaysDataType > results/gpui-displays.txt 2>/dev/null

COLD_RUNS=${COLD_RUNS:-5}
for i in $(seq 1 "$COLD_RUNS"); do
  echo "== cold-start run $i"
  "$BIN" --bench cold-start && cp results/gpui-cold-start.json "results/.cold-start-$i.json"
  sleep 1
done
python3 - "$COLD_RUNS" <<'PY'
import json, sys, statistics, os
n = int(sys.argv[1]); runs = []
for i in range(1, n + 1):
    p = f"results/.cold-start-{i}.json"
    if os.path.exists(p):
        runs.append(json.load(open(p))); os.remove(p)
if runs:
    out = dict(runs[-1])
    ms = [r["ms"] for r in runs if "ms" in r]
    out["runs"] = runs and [{k: r.get(k) for k in ("ms", "process_start_to_main_ms", "main_to_first_frame_ms", "ms_to_first_frame_with_visible_rows_highlighted")} for r in runs]
    out["ms"] = statistics.median(ms) if ms else None
    out["note_runs"] = f"ms = median of {len(ms)} launches"
    json.dump(out, open("results/gpui-cold-start.json", "w"), indent=2)
PY

for s in open-diff scroll-10k scroll-40k scroll-290k switch memory-idle memory-heavy; do
  echo "== $s"
  "$BIN" --bench "$s" || echo "!! $s failed" >&2
  sleep 2
done
"$BIN" --hl-stats > results/gpui-hl-stats.json
echo "done: $(ls results/*.json | wc -l) result files in $(pwd)/results"
